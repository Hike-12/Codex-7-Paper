import { PAPER_H, PAPER_W, NODE_COUNT, project } from './PaperPhysics'
import type { PaperPhysics, Point } from './PaperPhysics'
import { makeCanvas, PaperTexture, seeded } from './PaperTexture'
import { stocks } from './sheet'
import type { Sheet } from './sheet'

type Camera = { width: number; height: number; scale: number; cx: number; cy: number }
const tilt = -0.045
const cos = Math.cos(tilt)
const sin = Math.sin(tilt)
const tapePositions = [-PAPER_W / 2 + 94, PAPER_W / 2 - 94]

const vertexSource = `#version 300 es
precision highp float;
layout(location=0) in vec3 position;
layout(location=1) in vec2 uv;
layout(location=2) in vec3 smoothNormal;
uniform vec4 view;
uniform vec2 lens;
uniform float shadow;
uniform float wadded;
out vec3 vPosition;
out vec2 vUV;
out vec3 vNormal;
void main() {
  vPosition = position;
  vUV = uv;
  vNormal = smoothNormal;
  vec2 lamp = mix(vec2(0.23, 0.49), vec2(0.095, 0.145), wadded);
  vec2 p = shadow > 0.0
    ? position.xy + vec2(3.0, 7.0) + position.z * lamp + lens
    : position.xy + position.z * vec2(0.13, -0.24);
  vec2 rotated = mat2(0.9989877, -0.0449848, 0.0449848, 0.9989877) * p;
  vec2 clip = rotated * view.xy + view.zw;
  gl_Position = vec4(clip, -position.z / 2048.0, 1.0);
}`

const fragmentSource = `#version 300 es
precision highp float;
in vec3 vPosition;
in vec2 vUV;
in vec3 vNormal;
uniform sampler2D paper;
uniform float opacity;
uniform float shadow;
uniform float wadded;
out vec4 color;
void main() {
  if (shadow > 0.0) {
    color = vec4(0.015, 0.010, 0.008, shadow);
    return;
  }
  vec3 ink = texture(paper, vUV).rgb;
  vec3 area = cross(dFdx(vPosition), dFdy(vPosition));
  vec3 facet = area / max(length(area), 0.00001);
  vec3 blendedNormal = vNormal / max(length(vNormal), 0.00001);
  vec3 orientedFacet = gl_FrontFacing ? facet : -facet;
  vec3 normal = normalize(mix(blendedNormal, orientedFacet, 0.13 + wadded * 0.87));
  normal *= normal.z < 0.0 ? -1.0 : 1.0;
  vec3 light = normalize(vec3(-0.55, -0.76, 0.75));
  float diffuse = dot(light, normal);
  float grazing = pow(max(dot(normal, normalize(vec3(-0.32, -0.3, 0.74))), 0.0), 15.0);
  float fold = clamp(length(normal.xy) * 2.0, 0.0, 1.0);
  float relief = max(fold, wadded * 0.64);
  vec3 lit = ink * (1.0 + relief * (0.77 * diffuse - 0.37));
  lit += relief * grazing * vec3(0.157, 0.138, 0.110);
  if (gl_FrontFacing) {
    float grey = dot(ink, vec3(0.33, 0.43, 0.24));
    float bounce = 0.09 + max(0.0, diffuse) * 0.074;
    lit = mix(lit * 0.48, vec3(grey * 0.48 + bounce, grey * 0.45 + bounce * 0.91, grey * 0.43 + bounce * 0.82), 0.66);
  }
  float coverage = opacity + (1.0 - opacity) * (1.0 - smoothstep(0.17, 0.61, dot(ink, vec3(0.333))));
  color = vec4(clamp(lit, 0.0, 1.0), coverage);
}`

function createProgram(gl: WebGL2RenderingContext) {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Paper shader could not compile')
    return shader
  }
  const program = gl.createProgram()!
  const vertex = compile(gl.VERTEX_SHADER, vertexSource)
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource)
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Paper shader could not link')
  return program
}

class MeshLayer {
  readonly canvas = makeCanvas(1, 1)
  private gl = this.canvas.getContext('webgl2', { alpha: true, antialias: true, stencil: true, preserveDrawingBuffer: true })
  private program: WebGLProgram | null = null
  private vertexBuffer: WebGLBuffer | null = null
  private indexBuffer: WebGLBuffer | null = null
  private texture: WebGLTexture | null = null
  private uniforms: Record<string, WebGLUniformLocation | null> = {}
  private topology = -1
  private indices = new Uint16Array(0)
  private vertices = new Float32Array(0)
  private normals = new Float32Array(NODE_COUNT * 3)
  private fibers: { a: number; b: number; pos: number; scale: number; du: number; dv: number }[] = []

  constructor(private mesh: PaperPhysics) {
    const gl = this.gl
    if (!gl) return
    this.program = createProgram(gl)
    this.vertexBuffer = gl.createBuffer()
    this.indexBuffer = gl.createBuffer()
    this.texture = gl.createTexture()
    gl.useProgram(this.program)
    for (const key of ['view', 'lens', 'shadow', 'opacity', 'wadded', 'paper']) {
      this.uniforms[key] = gl.getUniformLocation(this.program, key)
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 12)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 32, 20)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.uniform1i(this.uniforms.paper, 0)
    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  }

  get supported() { return this.gl !== null }

  upload(source: HTMLCanvasElement) {
    const gl = this.gl
    if (!gl) return
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.generateMipmap(gl.TEXTURE_2D)
  }

  private rebuild() {
    const random = seeded(115)
    const indices: number[] = []
    for (const tri of this.mesh.triangles) {
      if (!tri.dead) indices.push(...tri.ids)
    }
    this.fibers = []
    let next = this.mesh.nodes.length
    for (const edge of this.mesh.edges) {
      if (edge.triangles.length !== 2 || this.mesh.edgeCount(edge) !== 1) continue
      const triangle = this.mesh.triangles[edge.triangles.find(id => !this.mesh.triangles[id].dead)!]
      const other = triangle.ids.find(id => id !== edge.a && id !== edge.b)!
      const a = this.mesh.nodes[edge.a].rest
      const b = this.mesh.nodes[edge.b].rest
      const c = this.mesh.nodes[other].rest
      const x = b[0] - a[0]
      const y = b[1] - a[1]
      const side = Math.sign(x * (c[1] - a[1]) - y * (c[0] - a[0]))
      for (let i = 0; i < 5 && next + 2 < 65535; i++) {
        const center = (i + 0.15 + random() * 0.7) / 5
        const strand = 0.018 + random() ** 2 * 0.24
        const spread = 0.014 + random() * 0.056
        for (const [pos, scale] of [[center - spread, 0], [center + spread, 0], [center + spread * (random() - 0.5), strand]]) {
          this.fibers.push({ a: edge.a, b: edge.b, pos, scale: scale * side, du: y * scale * side, dv: -x * scale * side })
        }
        if (side > 0) indices.push(next + 1, next, next + 2)
        else indices.push(next, next + 1, next + 2)
        next += 3
      }
    }
    this.vertices = new Float32Array(next * 8)
    this.indices = new Uint16Array(indices)
    this.topology = this.mesh.topology
    const gl = this.gl!
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indices, gl.STATIC_DRAW)
  }

  private updateNormals() {
    const normals = this.normals
    const nodes = this.mesh.nodes
    normals.fill(0)
    if (this.mesh.wadded) return
    for (const triangle of this.mesh.triangles) {
      if (triangle.dead) continue
      const [a, b, c] = triangle.ids
      const p = nodes[a].p, q = nodes[b].p, r = nodes[c].p
      const x = q[0] - p[0], y = q[1] - p[1], z = q[2] - p[2]
      const u = r[0] - p[0], v = r[1] - p[1], w = r[2] - p[2]
      const nx = y * w - z * v, ny = z * u - x * w, nz = x * v - y * u
      for (const id of triangle.ids) {
        normals[id * 3] += nx
        normals[id * 3 + 1] += ny
        normals[id * 3 + 2] += nz
      }
    }
  }

  render(camera: Camera, width: number, height: number, opacity: number, shadows: boolean) {
    const gl = this.gl
    if (!gl) return
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
    if (this.topology !== this.mesh.topology) this.rebuild()
    this.updateNormals()
    let i = 0
    let nIndex = 0
    for (const n of this.mesh.nodes) {
      this.vertices[i++] = n.p[0]
      this.vertices[i++] = n.p[1]
      this.vertices[i++] = n.p[2]
      this.vertices[i++] = n.rest[0] / PAPER_W + 0.5
      this.vertices[i++] = n.rest[1] / PAPER_H + 0.5
      this.vertices[i++] = this.normals[nIndex++]
      this.vertices[i++] = this.normals[nIndex++]
      this.vertices[i++] = this.normals[nIndex++]
    }
    for (const fiber of this.fibers) {
      const a = this.mesh.nodes[fiber.a]
      const b = this.mesh.nodes[fiber.b]
      const t = fiber.pos
      this.vertices[i++] = a.p[0] + (b.p[0] - a.p[0]) * t + (b.p[1] - a.p[1]) * fiber.scale
      this.vertices[i++] = a.p[1] + (b.p[1] - a.p[1]) * t - (b.p[0] - a.p[0]) * fiber.scale
      this.vertices[i++] = a.p[2] + (b.p[2] - a.p[2]) * t + Math.abs(fiber.scale)
      this.vertices[i++] = (a.rest[0] + (b.rest[0] - a.rest[0]) * t + fiber.du) / PAPER_W + 0.5
      this.vertices[i++] = (a.rest[1] + (b.rest[1] - a.rest[1]) * t + fiber.dv) / PAPER_H + 0.5
      for (let axis = 0; axis < 3; axis++) {
        const v = this.normals[fiber.a * 3 + axis]
        this.vertices[i++] = v + (this.normals[fiber.b * 3 + axis] - v) * t
      }
    }
    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.bufferData(gl.ARRAY_BUFFER, this.vertices, gl.DYNAMIC_DRAW)
    gl.uniform4f(this.uniforms.view, 2 * camera.scale / camera.width, -2 * camera.scale / camera.height,
      camera.cx * 2 / camera.width - 1, 1 - camera.cy * 2 / camera.height)
    gl.uniform1f(this.uniforms.wadded, Number(this.mesh.wadded))
    if (shadows) {
      gl.disable(gl.DEPTH_TEST)
      gl.enable(gl.STENCIL_TEST)
      gl.stencilFunc(gl.EQUAL, 0, 0xff)
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR)
      for (const [x, y, alpha] of [[-4, 2, 0.12], [6, 7, 0.14], [2, 12, 0.15], [0, 0, 0.37]]) {
        gl.clear(gl.STENCIL_BUFFER_BIT)
        gl.uniform2f(this.uniforms.lens, x, y)
        gl.uniform1f(this.uniforms.shadow, alpha)
        gl.drawElements(gl.TRIANGLES, this.indices.length, gl.UNSIGNED_SHORT, 0)
      }
      gl.disable(gl.STENCIL_TEST)
    }
    gl.enable(gl.DEPTH_TEST)
    gl.uniform1f(this.uniforms.shadow, 0)
    gl.uniform1f(this.uniforms.opacity, opacity)
    gl.drawElements(gl.TRIANGLES, this.indices.length, gl.UNSIGNED_SHORT, 0)
  }
}

export class PaperRenderer {
  readonly texture = new PaperTexture()
  private surface: CanvasRenderingContext2D
  private desk = makeCanvas(1, 1)
  private layer: MeshLayer
  private sheet: Sheet
  private camera: Camera = { width: 1, height: 1, scale: 1, cx: 0, cy: 0 }
  private dirty = true
  private pixelRatio = 1
  private deskGrain = makeCanvas(256, 256)

  constructor(readonly canvas: HTMLCanvasElement, private mesh: PaperPhysics, sheet: Sheet) {
    this.surface = canvas.getContext('2d', { alpha: false })!
    this.layer = new MeshLayer(mesh)
    this.sheet = sheet
    const ctx = this.deskGrain.getContext('2d')!
    const image = ctx.createImageData(256, 256)
    const random = seeded(494)
    for (let i = 0; i < image.data.length; i += 4) {
      const color = random() > 0.46 ? 216 : 12
      image.data[i] = color
      image.data[i + 1] = color
      image.data[i + 2] = color
      image.data[i + 3] = random() * 12
    }
    ctx.putImageData(image, 0, 0)
    this.setSheet(sheet)
  }

  resize(width: number, height: number) {
    if (width < 2 || height < 2) return
    const margin = width < 620 ? 28 : width < 1000 ? 78 : 155
    this.camera = {
      width, height, cx: width / 2, cy: height * 0.505,
      scale: Math.min((width - margin) / 914, (height - 37) / 619, 1.34)
    }
    this.camera.scale = Math.max(0.04, this.camera.scale)
    this.pixelRatio = Math.min(devicePixelRatio || 1, width < 720 ? 2 : 1.6)
    this.canvas.width = Math.round(width * this.pixelRatio)
    this.canvas.height = Math.round(height * this.pixelRatio)
    this.updateDesk()
    this.dirty = true
  }

  get bounds() {
    return { x: this.camera.width / (this.camera.scale * 2), y: this.camera.height / (this.camera.scale * 2) }
  }

  world(point: Point): Point {
    const c = this.camera
    const x = (point.x - c.cx) / c.scale
    const y = (point.y - c.cy) / c.scale
    return { x: x * cos + y * sin, y: -x * sin + y * cos }
  }

  setSheet(sheet: Sheet) {
    const secretChanged = this.sheet.secret !== sheet.secret
    this.sheet = sheet
    this.layer.upload(this.texture.compose(sheet))
    if (secretChanged) this.updateDesk()
    this.dirty = true
  }

  requestFrame() { this.dirty = true }

  private updateDesk() {
    this.desk.width = Math.max(1, Math.round(this.camera.width * this.pixelRatio))
    this.desk.height = Math.max(1, Math.round(this.camera.height * this.pixelRatio))
    this.drawDesk(this.desk.getContext('2d')!, this.pixelRatio)
  }

  private drawDesk(ctx: CanvasRenderingContext2D, ratio: number) {
    const { width, height, cx, cy, scale } = this.camera
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    const light = ctx.createRadialGradient(cx - width * 0.15, cy - height * 0.23, 0, cx, cy, Math.max(width, height) * 0.69)
    light.addColorStop(0, '#2b2929')
    light.addColorStop(0.55, '#211f20')
    light.addColorStop(1, '#141316')
    ctx.fillStyle = light
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = ctx.createPattern(this.deskGrain, 'repeat')!
    ctx.fillRect(0, 0, width, height)

    const grid = width < 620 ? 18 : 26
    ctx.lineWidth = 0.65
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? '#cbb7a214' : '#cbb7a20b'
      ctx.beginPath()
      for (let n = -Math.ceil(width / grid / 2); n <= width / grid / 2; n++) {
        if (Number(n % 4 === 0) !== pass) continue
        const x = cx + n * grid
        ctx.moveTo(x, 0); ctx.lineTo(x, height)
      }
      for (let n = -Math.ceil(height / grid / 2); n <= height / grid / 2; n++) {
        if (Number(n % 4 === 0) !== pass) continue
        const y = cy + n * grid
        ctx.moveTo(0, y); ctx.lineTo(width, y)
      }
      ctx.stroke()
    }

    if (width > 760) {
      const size = 7
      ctx.strokeStyle = '#e1c9b443'
      ctx.fillStyle = '#d0b69b77'
      ctx.font = '9px "JetBrains Mono", monospace'
      for (const [x, y] of [[45, 44], [width - 45, 44], [45, height - 42], [width - 45, height - 42]]) {
        ctx.beginPath()
        ctx.moveTo(x - size, y); ctx.lineTo(x + size, y)
        ctx.moveTo(x, y - size); ctx.lineTo(x, y + size)
        ctx.stroke()
      }
      for (let i = 1; i * 23 < height - 110; i++) {
        const y = 48 + i * 23
        ctx.beginPath()
        ctx.moveTo(44, y); ctx.lineTo(i % 4 ? 49 : 55, y); ctx.stroke()
        if (!(i % 4)) ctx.fillText(String(i).padStart(2, '0'), 63, y + 3)
      }
    }

    ctx.save()
    ctx.translate(cx + 18 * scale, cy + 14 * scale)
    ctx.scale(scale, scale)
    ctx.rotate(0.021)
    ctx.shadowColor = '#09080ae0'
    ctx.shadowBlur = 26 * ratio
    ctx.shadowOffsetY = 12 * ratio
    ctx.fillStyle = '#172131'
    ctx.fillRect(-432, -273, 865, 550)
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0
    ctx.strokeStyle = '#779bb64c'
    ctx.strokeRect(-431.5, -272.5, 864, 549)
    ctx.beginPath()
    for (let x = -425; x < 430; x += 15) {
      ctx.moveTo(x, -271); ctx.lineTo(x, 275)
    }
    for (let y = -262; y < 275; y += 15) {
      ctx.moveTo(-430, y); ctx.lineTo(432, y)
    }
    ctx.strokeStyle = '#719cb030'
    ctx.stroke()
    ctx.strokeStyle = '#8bb6d184'
    ctx.strokeRect(-399, -242, 799, 484)
    ctx.fillStyle = '#abc4d2'
    ctx.font = '12px "JetBrains Mono", monospace'
    ctx.fillText('T E A R   S H E E T  /  R E V E R S E', -370, -201)
    ctx.font = 'italic 71px "Instrument Serif", Georgia, serif'
    ctx.fillStyle = '#dae9f0'
    this.sheet.secret.split('\n').slice(0, 5).forEach((line, i) => ctx.fillText(line, -370, -97 + i * 66, 732))
    ctx.font = '10px "JetBrains Mono", monospace'
    ctx.fillStyle = '#abc4d2'
    ctx.fillText('TS—007 / UNDER NOTE', -370, 210)
    ctx.textAlign = 'right'
    ctx.fillText('KEEP THIS SIDE DOWN', 372, 210)
    ctx.restore()
  }

  private drawTape(ctx: CanvasRenderingContext2D, ratio: number) {
    if (this.mesh.gravity !== 'pins' || this.mesh.wadded) return
    const { cx, cy, scale } = this.camera
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(scale, scale)
    ctx.rotate(tilt)
    for (const [i, x] of tapePositions.entries()) {
      ctx.save()
      ctx.translate(x, -PAPER_H / 2)
      ctx.rotate(i ? 0.13 : -0.14)
      ctx.fillStyle = '#ada3849e'
      ctx.fillRect(-40, -13, 80, 28)
      ctx.strokeStyle = '#e8d8ba43'
      ctx.strokeRect(-39.5, -12.5, 79, 27)
      const rand = seeded(18 + i)
      for (let j = 0; j < 280; j++) {
        ctx.fillStyle = j % 2 ? '#f3e1b826' : '#221d2327'
        ctx.fillRect(-40 + rand() * 79, -12 + rand() * 26, rand() * 3 + 0.3, 0.6)
      }
      ctx.restore()
    }
    ctx.restore()
  }

  private fallback(ctx: CanvasRenderingContext2D, ratio: number) {
    const { cx, cy, scale } = this.camera
    const texture = this.texture.canvas
    const faces = this.mesh.triangles.filter(t => !t.dead).sort((a, b) =>
      a.ids.reduce((z, id) => z + this.mesh.nodes[id].p[2], 0) - b.ids.reduce((z, id) => z + this.mesh.nodes[id].p[2], 0))
    for (const t of faces) {
      const [a, b, c] = t.ids.map(id => this.mesh.nodes[id])
      const [p, q, r] = [a, b, c].map(n => {
        const { x, y } = project(n.p)
        return { x: cx + scale * (x * cos - y * sin), y: cy + scale * (x * sin + y * cos) }
      })
      const [u, v, w] = [a, b, c].map(n => ({ x: (n.rest[0] + PAPER_W / 2) * 2, y: (n.rest[1] + PAPER_H / 2) * 2 }))
      const sx1 = v.x - u.x, sy1 = v.y - u.y, sx2 = w.x - u.x, sy2 = w.y - u.y
      const det = sx1 * sy2 - sy1 * sx2
      const ax = ((q.x - p.x) * sy2 - (r.x - p.x) * sy1) / det
      const bx = ((r.x - p.x) * sx1 - (q.x - p.x) * sx2) / det
      const ay = ((q.y - p.y) * sy2 - (r.y - p.y) * sy1) / det
      const by = ((r.y - p.y) * sx1 - (q.y - p.y) * sx2) / det
      const center = { x: (p.x + q.x + r.x) / 3, y: (p.y + q.y + r.y) / 3 }
      ctx.save()
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.beginPath()
      for (const [i, point] of [p, q, r].entries()) {
        const x = point.x + (point.x - center.x) * 0.025
        const y = point.y + (point.y - center.y) * 0.025
        if (i) ctx.lineTo(x, y)
        else ctx.moveTo(x, y)
      }
      ctx.closePath()
      ctx.clip()
      ctx.transform(ax, ay, bx, by, p.x - ax * u.x - bx * u.y, p.y - ay * u.x - by * u.y)
      ctx.globalAlpha = stocks[this.sheet.stock].opacity
      const minX = Math.max(0, Math.min(u.x, v.x, w.x) - 2)
      const minY = Math.max(0, Math.min(u.y, v.y, w.y) - 2)
      const width = Math.min(texture.width, Math.max(u.x, v.x, w.x) + 2) - minX
      const height = Math.min(texture.height, Math.max(u.y, v.y, w.y) + 2) - minY
      ctx.drawImage(texture, minX, minY, width, height, minX, minY, width, height)
      ctx.restore()
    }
  }

  private compose(ctx: CanvasRenderingContext2D, ratio: number, backdrop: boolean, cached = false) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    if (!backdrop) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    else if (cached) ctx.drawImage(this.desk, 0, 0)
    else this.drawDesk(ctx, ratio)
    if (this.layer.supported) {
      this.layer.render(this.camera, ctx.canvas.width, ctx.canvas.height, stocks[this.sheet.stock].opacity, backdrop)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(this.layer.canvas, 0, 0)
    } else this.fallback(ctx, ratio)
    if (backdrop) this.drawTape(ctx, ratio)
  }

  render(force = false) {
    if (!force && !this.dirty && !this.mesh.moving) return
    this.compose(this.surface, this.pixelRatio, true, true)
    this.dirty = false
  }

  export(backdrop: boolean) {
    const canvas = makeCanvas(Math.round(this.camera.width * 2), Math.round(this.camera.height * 2))
    this.compose(canvas.getContext('2d')!, 2, backdrop)
    return canvas
  }

  dispose() {
    this.layer.canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
