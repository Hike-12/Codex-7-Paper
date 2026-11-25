import { PAPER_W, PAPER_H } from './PaperPhysics'
import { stocks } from './sheet'
import type { InkBlock, Sheet, Stock } from './sheet'

export function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export function seeded(seed: number) {
  let state = seed
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

function grain(stock: Stock) {
  const canvas = makeCanvas(PAPER_W * 2, PAPER_H * 2)
  const ctx = canvas.getContext('2d')!
  const random = seeded(701)
  const image = ctx.createImageData(canvas.width, canvas.height)
  const hex = parseInt(stocks[stock].base.slice(1), 16)
  const red = hex >> 16
  const green = hex >> 8 & 255
  const blue = hex & 255
  const layers = [17, 39, 95, 207].map((step, i) => {
    const stride = Math.ceil(canvas.width / step) + 2
    const points = Float32Array.from({ length: stride * (Math.ceil(canvas.height / step) + 2) }, random)
    return { step, stride, points, strength: [9, 5, 3, 2][i] }
  })
  for (let y = 0; y < canvas.height; y++) {
    const rows = layers.map(layer => {
      const position = y / layer.step
      const row = Math.floor(position)
      const fraction = position - row
      return { ...layer, offset: row * layer.stride, blend: fraction * fraction * (3 - 2 * fraction) }
    })
    for (let x = 0; x < canvas.width; x++) {
      let shade = (random() - 0.5) * 22 + 5 - 12 * (x / canvas.width * 0.52 + y / canvas.height * 0.48)
      for (const row of rows) {
        const position = x / row.step
        const col = Math.floor(position)
        const fraction = position - col
        const t = fraction * fraction * (3 - 2 * fraction)
        const idx = row.offset + col
        const a = row.points[idx] * (1 - t) + row.points[idx + 1] * t
        const b = row.points[idx + row.stride] * (1 - t) + row.points[idx + row.stride + 1] * t
        shade += ((a * (1 - row.blend) + b * row.blend) - 0.5) * row.strength
      }
      const i = (y * canvas.width + x) * 4
      image.data[i] = red + shade
      image.data[i + 1] = green + shade
      image.data[i + 2] = blue + shade
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  ctx.scale(2, 2)
  ctx.lineWidth = 0.45
  for (let i = 0; i < 15800; i++) {
    const x = random() * PAPER_W
    const y = random() * PAPER_H
    const length = 0.7 + random() ** 3 * 7
    ctx.strokeStyle = i % 3 ? 'rgba(247,232,209,0.095)' : 'rgba(0,0,0,0.19)'
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + length * 0.4, y + (random() - 0.5) * length, x + length, y + (random() - 0.5) * length)
    ctx.stroke()
  }
  return canvas
}

const families = {
  Serif: '"Instrument Serif", Georgia, serif',
  Italic: '"Instrument Serif", Georgia, serif',
  Sans: 'Inter, sans-serif',
  Mono: '"JetBrains Mono", monospace',
}

function font(block: InkBlock) {
  return `${block.stamp ? '700' : block.font === 'Italic' ? 'italic' : '400'} ${block.size}px ${families[block.font]}`
}

export function blockAt(block: InkBlock, u: number, v: number, ctx: CanvasRenderingContext2D) {
  ctx.font = font(block)
  const width = Math.max(...block.text.split('\n').map(line => ctx.measureText(line).width), 24)
  const x = (u - block.u) * PAPER_W
  const y = (v - block.v) * PAPER_H
  const pad = block.stamp ? 15 : 6
  return x >= -pad && x <= width + pad && y >= -block.size - pad &&
    y <= (block.text.split('\n').length - 1) * block.size * 1.23 + pad + block.size * 0.22
}

function drawInk(ctx: CanvasRenderingContext2D, block: InkBlock, ink: string, accent: string) {
  ctx.save()
  ctx.translate(block.u * PAPER_W, block.v * PAPER_H)
  ctx.font = font(block)
  ctx.fillStyle = ink
  if (block.stamp) {
    const text = block.text.replaceAll('\n', ' ')
    const width = ctx.measureText(text).width
    ctx.rotate(-0.115)
    ctx.fillStyle = accent
    ctx.strokeStyle = accent
    ctx.globalAlpha = 0.84
    ctx.lineWidth = 1.5
    ctx.strokeRect(-8, -block.size * 1.10, width + 16, block.size * 1.6)
    ctx.lineWidth = 0.5
    ctx.strokeRect(-5, -block.size * 0.95, width + 10, block.size * 1.31)
    ctx.fillText(text, 0, 0)
    const random = seeded(32)
    ctx.globalCompositeOperation = 'destination-out'
    for (let i = 0; i < width * 2; i++) {
      ctx.globalAlpha = random() * 0.25
      ctx.clearRect(0, 0, 0, 0)
      ctx.fillRect(-6 + random() * (width + 12), -block.size + random() * block.size * 1.4, 0.4 + random() * 1.5, 0.4 + random())
    }
  } else {
    const lines = block.text.split('\n')
    ctx.shadowColor = 'rgba(17,13,12,.34)'
    ctx.shadowBlur = 0.45
    lines.forEach((line, i) => ctx.fillText(line, 0, i * block.size * 1.23))
  }
  ctx.restore()
}

function rule(ctx: CanvasRenderingContext2D, x: number, y: number, x2: number, y2: number) {
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

function drawDiagram(ctx: CanvasRenderingContext2D, dim: string, accent: string) {
  ctx.save()
  ctx.translate(718, 166)
  ctx.strokeStyle = dim
  ctx.lineWidth = 0.7
  ctx.globalAlpha = 0.82
  const points = [[-26, 13], [26, -12], [75, 8], [73, 57], [21, 82], [-28, 61]]
  ctx.beginPath()
  for (const [i, [x, y]] of points.entries()) i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
  ctx.closePath()
  ctx.stroke()
  rule(ctx, -26, 13, 23, 34)
  rule(ctx, 75, 8, 23, 34)
  rule(ctx, 23, 34, 21, 82)
  ctx.setLineDash([2, 4])
  rule(ctx, -28, 61, 24, 38)
  rule(ctx, 24, 38, 73, 57)
  rule(ctx, 24, 38, 26, -12)
  ctx.setLineDash([])
  for (const [x, y] of points) {
    ctx.strokeRect(x - 1.5, y - 1.5, 3, 3)
  }
  ctx.strokeStyle = accent
  rule(ctx, -33, 83, 14, 104)
  ctx.fillStyle = accent
  ctx.font = '9px "JetBrains Mono", monospace'
  ctx.fillText('A', -39, 94)
  ctx.restore()
}

export class PaperTexture {
  readonly canvas = makeCanvas(PAPER_W * 2, PAPER_H * 2)
  private readonly ink = makeCanvas(PAPER_W * 2, PAPER_H * 2)
  private readonly cache = new Map<Stock, HTMLCanvasElement>()
  get inkContext() { return this.ink.getContext('2d')! }

  compose(sheet: Sheet) {
    let texture = this.cache.get(sheet.stock)
    if (!texture) {
      texture = grain(sheet.stock)
      this.cache.set(sheet.stock, texture)
    }
    const ctx = this.canvas.getContext('2d')!
    ctx.drawImage(texture, 0, 0)
    const art = this.inkContext
    art.setTransform(1, 0, 0, 1, 0, 0)
    art.clearRect(0, 0, this.ink.width, this.ink.height)
    art.scale(2, 2)
    const stock = stocks[sheet.stock]
    if (sheet.stock === 'cyanotype') {
      art.strokeStyle = 'rgba(160,202,243,.15)'
      art.lineWidth = 0.5
      for (let x = 10; x < PAPER_W; x += 16) rule(art, x, 0, x, PAPER_H)
      for (let y = 10; y < PAPER_H; y += 16) rule(art, 0, y, PAPER_W, y)
    }
    if (sheet.template !== 'blank') this.margin(art, sheet)
    for (const block of sheet.blocks) drawInk(art, block, stock.ink, stock.accent)

    ctx.save()
    ctx.globalAlpha = 0.98
    ctx.drawImage(this.ink, 0, 0)
    ctx.restore()
    return this.canvas
  }

  private margin(ctx: CanvasRenderingContext2D, sheet: Sheet) {
    const stock = stocks[sheet.stock]
    ctx.fillStyle = stock.dim
    ctx.strokeStyle = stock.dim
    ctx.globalAlpha = 0.66
    ctx.lineWidth = 0.7
    rule(ctx, 60, 80, 800, 80)
    rule(ctx, 60, 465, 800, 465)
    rule(ctx, 637, 114, 637, 435)
    ctx.globalAlpha = 1
    ctx.textBaseline = 'alphabetic'
    ctx.font = '11px "JetBrains Mono", monospace'
    ctx.fillText(sheet.template === 'manifesto' ? 'MATERIAL STUDIES / A' : 'FIELD RECORD / B', 61, 61)
    ctx.textAlign = 'right'
    ctx.fillText('TS—007', 800, 61)
    ctx.textAlign = 'left'
    ctx.fillText('GRAIN DIRECTION', 61, 497)
    ctx.fillText('FIG. A / FOLD', 663, 317)
    ctx.fillText(stock.name.toUpperCase(), 663, 391)
    ctx.fillText(stock.weight.toUpperCase(), 663, 409)
    ctx.textAlign = 'right'
    ctx.fillText('30 DAYS / 30 PROJECTS', 800, 497)
    ctx.textAlign = 'left'
    ctx.fillStyle = stock.accent
    ctx.fillRect(61, 80, 32, 1.35)
    ctx.fillRect(663, 343, 15, 1.35)
    ctx.strokeStyle = stock.accent
    rule(ctx, 173, 493, 206, 493)
    rule(ctx, 201, 489, 206, 493)
    rule(ctx, 201, 497, 206, 493)
    drawDiagram(ctx, stock.dim, stock.accent)
  }
}
