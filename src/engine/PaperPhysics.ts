export const COLS = 52
export const ROWS = 38
export const PAPER_W = 860
export const PAPER_H = 550
export const NODE_COUNT = COLS * ROWS

type Vector = [number, number, number]
export type Point = { x: number; y: number }
export type Gravity = 'pins' | 'zero' | 'desk'
export type PhysicsState = {
  cut: Uint8Array
  positions: Float32Array
  gravity: Gravity
  wadded: boolean
  creased: boolean
}
type Node = {
  rest: Vector
  p: Vector
  old: Vector
  pinned: boolean
  attached: boolean
}
export type Triangle = { ids: [number, number, number]; dead: boolean }
export type Edge = { a: number; b: number; triangles: number[]; length: number }
type Brace = { a: number; b: number; length: number; support: [Edge, Edge] }
type Grab = { id: number; x: number; y: number; x0: number; y0: number; edge: boolean; preview?: number }

const length = (a: Vector, b: Vector) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
const edgeKey = (a: number, b: number) => Math.min(a, b) * NODE_COUNT + Math.max(a, b)
const pinNode = (id: number) => id < COLS && (id >= 4 && id <= 7 || id >= COLS - 8 && id <= COLS - 5)
export const project = (p: Vector): Point => ({ x: p[0] + p[2] * 0.13, y: p[1] - p[2] * 0.24 })

function cross(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function intersects(a: Point, b: Point, c: Point, d: Point) {
  return Math.max(a.x, b.x) >= Math.min(c.x, d.x) &&
    Math.max(c.x, d.x) >= Math.min(a.x, b.x) &&
    Math.max(a.y, b.y) >= Math.min(c.y, d.y) &&
    Math.max(c.y, d.y) >= Math.min(a.y, b.y) &&
    cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0
}

export class PaperPhysics {
  readonly nodes: Node[] = []
  readonly triangles: Triangle[] = []
  readonly edges: Edge[] = []
  topology = 0
  gravity: Gravity = 'pins'
  wadded = false
  creased = false
  moving = false
  private braces: Brace[] = []
  private grab?: Grab
  private time = 0
  private settling = 0
  private center: Vector = [0, 0, 0]
  private velocity: Point = { x: 0, y: 0 }
  private wadBlend = 0
  private ironing = 0
  private flutter = !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  constructor() {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const rest: Vector = [(col / (COLS - 1) - 0.5) * PAPER_W, (row / (ROWS - 1) - 0.5) * PAPER_H, 0]
        const id = this.nodes.length
        this.nodes.push({ rest, p: [...rest], old: [...rest], pinned: pinNode(id), attached: true })
      }
    }
    const edges = new Map<number, Edge>()
    const triangle = (a: number, b: number, c: number) => {
      const index = this.triangles.length
      this.triangles.push({ ids: [a, b, c], dead: false })
      for (const [x, y] of [[a, b], [b, c], [c, a]]) {
        const key = edgeKey(x, y)
        let edge = edges.get(key)
        if (!edge) {
          edge = { a: x, b: y, length: length(this.nodes[x].rest, this.nodes[y].rest), triangles: [] }
          edges.set(key, edge)
        }
        edge.triangles.push(index)
      }
    }
    for (let y = 0; y < ROWS - 1; y++) {
      for (let x = 0; x < COLS - 1; x++) {
        const a = y * COLS + x
        const b = a + 1
        const c = a + COLS
        const d = c + 1
        if ((x + y) % 2 === 0) {
          triangle(a, b, d)
          triangle(a, d, c)
        } else {
          triangle(a, b, c)
          triangle(b, d, c)
        }
      }
    }
    this.edges.push(...edges.values())
    const brace = (a: number, midpoint: number, b: number) => {
      const left = edges.get(edgeKey(a, midpoint))!
      const right = edges.get(edgeKey(midpoint, b))!
      this.braces.push({ a, b, support: [left, right], length: length(this.nodes[a].rest, this.nodes[b].rest) })
    }
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const a = y * COLS + x
        if (x < COLS - 2) brace(a, a + 1, a + 2)
        if (y < ROWS - 2) brace(a, a + COLS, a + 2 * COLS)
      }
    }
  }

  edgeCount(edge: Edge) {
    let count = 0
    for (const id of edge.triangles) if (!this.triangles[id].dead) count++
    return count
  }

  private attach() {
    const adjacent: number[][] = Array.from({ length: NODE_COUNT }, () => [])
    for (const edge of this.edges) {
      if (!this.edgeCount(edge)) continue
      adjacent[edge.a].push(edge.b)
      adjacent[edge.b].push(edge.a)
    }
    const queue: number[] = []
    for (let id = 0; id < NODE_COUNT; id++) {
      const node = this.nodes[id]
      node.attached = node.pinned
      if (node.pinned) queue.push(id)
    }
    for (let i = 0; i < queue.length; i++) {
      for (const next of adjacent[queue[i]]) {
        if (this.nodes[next].attached) continue
        this.nodes[next].attached = true
        queue.push(next)
      }
    }
  }

  setGravity(gravity: Gravity) {
    this.gravity = gravity
    this.settling = 140
    for (let id = 0; id < NODE_COUNT; id++) {
      this.nodes[id].pinned = gravity === 'pins' && pinNode(id)
    }
    this.attach()
  }

  hit(point: Point) {
    let match: { u: number; v: number; z: number; nearest: number } | undefined
    for (const t of this.triangles) {
      if (t.dead) continue
      const a = this.nodes[t.ids[0]], b = this.nodes[t.ids[1]], c = this.nodes[t.ids[2]]
      const pa = project(a.p), pb = project(b.p), pc = project(c.p)
      if (point.x < Math.min(pa.x, pb.x, pc.x) || point.x > Math.max(pa.x, pb.x, pc.x) ||
          point.y < Math.min(pa.y, pb.y, pc.y) || point.y > Math.max(pa.y, pb.y, pc.y)) continue
      const area = cross(pa, pb, pc)
      if (Math.abs(area) < 0.001) continue
      const w1 = cross(point, pb, pc) / area
      const w2 = cross(pa, point, pc) / area
      const w3 = 1 - w1 - w2
      if (w1 < 0 || w2 < 0 || w3 < 0) continue
      const z = a.p[2] * w1 + b.p[2] * w2 + c.p[2] * w3
      if (match && z < match.z) continue
      const x = a.rest[0] * w1 + b.rest[0] * w2 + c.rest[0] * w3
      const y = a.rest[1] * w1 + b.rest[1] * w2 + c.rest[1] * w3
      match = { u: x / PAPER_W + 0.5, v: y / PAPER_H + 0.5, z,
        nearest: t.ids[w1 > w2 && w1 > w3 ? 0 : w2 > w3 ? 1 : 2] }
    }
    return match
  }

  startGrab(point: Point, preview = false) {
    const hit = this.hit(point)
    if (!hit) return false
    const node = this.nodes[hit.nearest]
    const edge = hit.u < 0.17 || hit.u > 0.83 || hit.v > 0.83 || hit.v < 0.17
    this.grab = {
      id: hit.nearest, x: point.x, y: point.y, x0: point.x, y0: point.y, edge,
      ...(preview && edge ? { preview: this.time } : {})
    }
    if (preview && !edge) { this.grab = undefined; return false }
    this.velocity = { x: 0, y: 0 }
    this.settling = 135
    if (!this.wadded) {
      node.pinned = false
      if (pinNode(hit.nearest) && this.gravity === 'pins') this.attach()
    }
    return true
  }

  drag(point: Point) {
    if (!this.grab) return 0
    const dx = point.x - this.grab.x
    const dy = point.y - this.grab.y
    this.velocity = { x: mix(this.velocity.x, dx, 0.54), y: mix(this.velocity.y, dy, 0.54) }
    this.grab.x = point.x
    this.grab.y = point.y
    return Math.hypot(dx, dy)
  }

  release() {
    if (!this.grab) return
    this.settling = 150
    if (!this.wadded && this.gravity === 'pins' && pinNode(this.grab.id)) {
      this.nodes[this.grab.id].pinned = true
      this.attach()
    }
    this.grab = undefined
  }

  cut(from: Point, to: Point) {
    if (Math.hypot(to.x - from.x, to.y - from.y) < 0.01) return 0
    let removed = 0
    for (const tri of this.triangles) {
      if (tri.dead) continue
      const [a, b, c] = tri.ids.map(id => project(this.nodes[id].p))
      if (intersects(from, to, a, b) || intersects(from, to, b, c) || intersects(from, to, c, a) ||
        (cross(a, b, to) >= 0 && cross(b, c, to) >= 0 && cross(c, a, to) >= 0) ||
        (cross(a, b, to) <= 0 && cross(b, c, to) <= 0 && cross(c, a, to) <= 0)) {
        tri.dead = true
        removed++
      }
    }
    if (removed) {
      this.topology++
      this.attach()
      this.settling = 160
    }
    return removed
  }

  crumple() {
    this.release()
    const visible = this.nodes.filter(n => Math.abs(n.p[0]) < 550 && Math.abs(n.p[1]) < 380)
    this.center = [
      visible.reduce((sum, n) => sum + n.p[0], 0) / (visible.length || 1),
      visible.reduce((sum, n) => sum + n.p[1], 0) / (visible.length || 1),
      22
    ]
    this.velocity = { x: 0, y: 0 }
    this.wadded = true
    this.creased = true
    this.wadBlend = 0
  }

  iron() {
    this.wadded = false
    this.release()
    for (const node of this.nodes) node.old = [...node.p]
    this.ironing = 65
    this.setGravity('pins')
  }

  snapshot(): PhysicsState {
    return {
      cut: Uint8Array.from(this.triangles, triangle => Number(triangle.dead)),
      positions: Float32Array.from(this.nodes.flatMap(n => n.p)),
      gravity: this.gravity, wadded: this.wadded, creased: this.creased
    }
  }

  restore(state: PhysicsState) {
    this.release()
    this.creased = state.creased
    this.wadded = state.wadded
    this.wadBlend = state.wadded ? 1 : 0
    this.ironing = 0
    this.velocity = { x: 0, y: 0 }
    this.center = [0, 0, 22]
    for (let i = 0; i < this.triangles.length; i++) this.triangles[i].dead = Boolean(state.cut[i])
    for (let i = 0; i < NODE_COUNT; i++) {
      const n = this.nodes[i]
      for (let axis = 0; axis < 3; axis++) {
        n.p[axis] = state.positions[i * 3 + axis]
        n.old[axis] = n.p[axis]
      }
      this.center[0] += n.p[0] / NODE_COUNT
      this.center[1] += n.p[1] / NODE_COUNT
    }
    this.topology++
    this.setGravity(state.gravity)
    this.settling = 0
    this.moving = true
  }

  private solve(a: Node, b: Node, rest: number, stiffness: number) {
    const dx = b.p[0] - a.p[0]
    const dy = b.p[1] - a.p[1]
    const dz = b.p[2] - a.p[2]
    const distance = Math.hypot(dx, dy, dz)
    if (distance < 0.001) return
    const correction = (distance - rest) / distance * stiffness
    const wa = a.pinned ? 0 : b.pinned ? correction : correction * 0.5
    const wb = b.pinned ? 0 : a.pinned ? correction : correction * 0.5
    a.p[0] += dx * wa; a.p[1] += dy * wa; a.p[2] += dz * wa
    b.p[0] -= dx * wb; b.p[1] -= dy * wb; b.p[2] -= dz * wb
  }

  private fold() {
    const grab = this.grab
    if (!grab) return
    if (grab.preview !== undefined) {
      const age = this.time - grab.preview
      if (age > 1.5) { this.release(); return }
      const n = this.nodes[grab.id]
      const wave = Math.sin(Math.PI * age / 1.5) ** 1.5
      grab.x = grab.x0 - Math.sign(n.rest[0]) * 275 * wave
      grab.y = grab.y0 - Math.sign(n.rest[1]) * 200 * wave
    }
    const dx = grab.x - grab.x0
    const dy = grab.y - grab.y0
    const distance = Math.hypot(dx, dy)
    if (distance < 0.2) return
    const anchor = this.nodes[grab.id]
    const nx = dx / distance
    const ny = dy / distance
    const radius = clamp(18 + distance * 0.095, 19, 48)
    const fold = distance * 0.57
    const nearby = clamp(distance + 74, 95, 425)
    for (const node of this.nodes) {
      if (node.pinned || node.attached !== anchor.attached) continue
      const x = node.rest[0] - anchor.rest[0]
      const y = node.rest[1] - anchor.rest[1]
      const lateral = -x * ny + y * nx
      const along = x * nx + y * ny
      const focus = Math.max(0, 1 - Math.hypot(x, y) / nearby)
      if (!focus && node !== anchor) continue
      const crease = fold - Math.abs(lateral) * 0.19
      const q = crease - along
      if (q < 0 && node !== anchor) continue
      const arc = Math.min(Math.PI, Math.max(0, q / radius))
      const turned = q > radius * Math.PI ? q - radius * Math.PI : radius * Math.sin(arc)
      const rolled = crease - turned * Math.cos(arc)
      const strength = (node === anchor ? 0.61 : 0.46 * focus + 0.11) * (grab.edge ? 1 : 0.73)
      const displacement = grab.edge ? rolled - along : dx * nx * focus * 0.48 + dy * ny * focus * 0.48
      node.p[0] = mix(node.p[0], node.rest[0] + displacement * nx, strength)
      node.p[1] = mix(node.p[1], node.rest[1] + displacement * ny, strength)
      node.p[2] = mix(node.p[2], radius * (1 - Math.cos(arc)) + Math.min(55, distance * 0.16) * focus, strength)
    }
    if (!anchor.attached || !grab.edge) {
      anchor.p[0] = mix(anchor.p[0], grab.x - anchor.p[2] * 0.13, 0.59)
      anchor.p[1] = mix(anchor.p[1], grab.y + anchor.p[2] * 0.24, 0.59)
      anchor.p[2] = mix(anchor.p[2], clamp(distance * 0.28, 0, 100), 0.44)
    }
  }

  private stepWad(bounds: Point) {
    this.wadBlend = Math.min(1, this.wadBlend + 0.019)
    if (this.grab) {
      this.center[0] = mix(this.center[0], this.grab.x, 0.47)
      this.center[1] = mix(this.center[1], this.grab.y, 0.47)
      this.velocity.x *= 0.96
      this.velocity.y *= 0.96
    } else {
      const limitX = Math.max(40, bounds.x - 75)
      const limitY = Math.max(40, bounds.y - 71)
      this.center[0] += this.velocity.x
      this.center[1] += this.velocity.y
      if (Math.abs(this.center[0]) > limitX) {
        this.center[0] = clamp(this.center[0], -limitX, limitX)
        this.velocity.x *= -0.68
      }
      if (Math.abs(this.center[1]) > limitY) {
        this.center[1] = clamp(this.center[1], -limitY, limitY)
        this.velocity.y *= -0.66
      }
      this.velocity.x *= 0.98
      this.velocity.y *= 0.98
    }
    const phi = this.center[0] * 0.013 + this.center[1] * 0.007
    const cos = Math.cos(phi)
    const sin = Math.sin(phi)
    for (const n of this.nodes) {
      const u = n.rest[0] / PAPER_W + 0.5
      const v = n.rest[1] / PAPER_H + 0.5
      const longitude = u * Math.PI * 2 + Math.sin(v * 32 + u * 17) * 0.19
      const latitude = (v - 0.5) * Math.PI + Math.cos(u * 36 + v * 22) * 0.12
      const radius = 80 + Math.sin(u * 47 + v * 24) * 9 + Math.cos(u * 89 - v * 68) * 6
      const x = Math.cos(longitude) * Math.cos(latitude) * radius
      const z = Math.sin(longitude) * Math.cos(latitude) * radius
      const stiffness = mix(0.022, 0.28, this.wadBlend)
      n.p[0] = mix(n.p[0], this.center[0] + x * cos - z * sin, stiffness)
      n.p[1] = mix(n.p[1], this.center[1] + Math.sin(latitude) * radius * 0.86, stiffness)
      n.p[2] = mix(n.p[2], this.center[2] + 49 + x * sin + z * cos, stiffness)
    }
  }

  step(dt: number, bounds: Point) {
    this.time += dt
    if (this.wadded) {
      const active = this.wadBlend < 1 || !!this.grab || Math.hypot(this.velocity.x, this.velocity.y) > 0.06 || this.settling > 0
      this.moving = active
      if (active) {
        this.stepWad(bounds)
        this.settling--
      }
      return 0
    }
    const cut = this.topology > 0 && this.triangles.some(t => t.dead)
    const active = !!this.grab || this.settling > 0 || this.ironing > 0 ||
      (cut && (this.flutter || this.nodes.some(n => !n.attached && this.gravity !== 'zero' && n.p[1] < 1100))) ||
      (this.gravity === 'desk' && this.nodes.some(n => n.p[1] < 1100))
    this.moving = active
    if (!active) return 0
    this.settling--
    const iron = this.ironing > 0
    if (iron) this.ironing--
    const wind = this.flutter ? Math.sin(this.time * 1.67) * 0.05 : 0
    for (const n of this.nodes) {
      const [x, y, z] = n.p
      const [rx, ry] = n.rest
      const corner = Math.max(0, rx / PAPER_W + 0.5 + (0.5 - ry / PAPER_H) - 1.79)
      const restZ = (this.creased ? Math.sin(rx * 0.04 + ry * 0.07) * Math.cos(ry * 0.05) * 4.6 : 0) + corner * corner * 305
      if (n.pinned) {
        n.p[0] = rx; n.p[1] = ry; n.p[2] = 0
      } else {
        const free = !n.attached && !iron
        const falling = free && this.gravity !== 'zero' && y < 1120
        const damping = falling ? 0.981 : 0.84
        const pull = iron ? 0.103 : n.attached && !this.grab ? 0.033 : 0
        n.p[0] = x + (x - n.old[0]) * damping + (rx - x) * pull + (cut ? wind : 0)
        n.p[1] = y + (y - n.old[1]) * damping + (ry - y) * pull + (falling ? 0.43 : 0)
        n.p[2] = z + (z - n.old[2]) * damping + (restZ - z) * (iron ? 0.12 : this.grab ? 0.013 : 0.045) +
          (cut && n.attached ? wind * Math.sin(rx * 0.018 + this.time * 1.9) : 0)
      }
      n.old[0] = x; n.old[1] = y; n.old[2] = z
    }
    this.fold()
    let snapped = 0
    for (let pass = 0; pass < 3; pass++) {
      for (const edge of this.edges) {
        if (!this.edgeCount(edge)) continue
        const a = this.nodes[edge.a]
        const b = this.nodes[edge.b]
        const anchor = this.grab?.id
        if (pass === 0 && anchor !== undefined && length(a.p, b.p) > edge.length * 2.2) {
          for (const id of edge.triangles) {
            if (this.triangles[id].dead) continue
            this.triangles[id].dead = true
            snapped++
          }
        } else {
          this.solve(a, b, edge.length, this.grab ? 0.66 : 0.81)
        }
      }
      for (const brace of this.braces) {
        if (!this.edgeCount(brace.support[0]) || !this.edgeCount(brace.support[1])) continue
        this.solve(this.nodes[brace.a], this.nodes[brace.b], brace.length, 0.13)
      }
    }
    if (snapped) { this.topology++; this.attach() }
    return snapped
  }
}
