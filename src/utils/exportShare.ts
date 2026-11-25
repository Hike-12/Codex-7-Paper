import { compressToBase64, decompressFromBase64 } from 'lz-string'
import { COLS, ROWS, PAPER_W, PAPER_H, NODE_COUNT } from '../engine/PaperPhysics'
import type { PhysicsState } from '../engine/PaperPhysics'
import { fonts, stocks, templates } from '../engine/sheet'
import type { Sheet } from '../engine/sheet'

export type StudioState = { sheet: Sheet; mesh: PhysicsState }
const prefix = '#ts1.'
const faceCount = (COLS - 1) * (ROWS - 1) * 2
const gravityOptions = ['pins', 'zero', 'desk'] as const

function rest(axis: number, id: number) {
  if (axis === 0) return (id % COLS / (COLS - 1) - 0.5) * PAPER_W
  if (axis === 1) return (Math.floor(id / COLS) / (ROWS - 1) - 0.5) * PAPER_H
  return 0
}

function pack(positions: Float32Array) {
  const encoded: number[] = []
  let unchanged = 0
  for (let i = 0; i < positions.length; i++) {
    const delta = Math.round((positions[i] - rest(i % 3, Math.floor(i / 3))) * 4)
    if (delta === 0) { unchanged++; continue }
    if (unchanged) { encoded.push(0, unchanged); unchanged = 0 }
    encoded.push(delta)
  }
  if (unchanged) encoded.push(0, unchanged)
  return encoded
}

function unpack(encoded: unknown) {
  if (!Array.isArray(encoded) || encoded.length > NODE_COUNT * 6) throw new Error('Invalid mesh coordinates')
  const positions = new Float32Array(NODE_COUNT * 3)
  for (let i = 0; i < positions.length; i++) positions[i] = rest(i % 3, Math.floor(i / 3))
  let index = 0
  for (let i = 0; i < encoded.length; i++) {
    const delta = encoded[i]
    if (!Number.isInteger(delta) || Math.abs(delta) > 16000 || index >= positions.length) throw new Error('Invalid mesh coordinate')
    if (delta === 0) {
      const skip = encoded[++i]
      if (!Number.isInteger(skip) || skip < 1) throw new Error('Invalid mesh range')
      index += skip
    } else {
      positions[index++] += delta / 4
    }
  }
  if (index !== positions.length) throw new Error('Invalid mesh length')
  return positions
}

function encodeCuts(cut: Uint8Array) {
  const bytes = new Uint8Array(Math.ceil(faceCount / 8))
  for (let i = 0; i < cut.length; i++) if (cut[i]) bytes[i >> 3] |= 1 << (i & 7)
  return btoa(String.fromCharCode(...bytes))
}

function decodeCuts(encoded: string) {
  const bytes = atob(encoded)
  if (bytes.length !== Math.ceil(faceCount / 8)) throw new Error('Invalid tear data')
  return Uint8Array.from({ length: faceCount }, (_, i) => bytes.charCodeAt(i >> 3) >> (i & 7) & 1)
}

function isSheet(sheet: Sheet) {
  return sheet && Object.hasOwn(stocks, sheet.stock) && Object.hasOwn(templates, sheet.template) &&
    typeof sheet.secret === 'string' && sheet.secret.length <= 280 && Array.isArray(sheet.blocks) && sheet.blocks.length <= 120 &&
    sheet.blocks.every(block => block && typeof block.id === 'string' && block.id.length <= 80 &&
      typeof block.text === 'string' && block.text.length <= 280 && fonts.includes(block.font) &&
      Number.isFinite(block.size) && block.size >= 8 && block.size <= 180 &&
      Number.isFinite(block.u) && block.u >= 0 && block.u <= 1 &&
      Number.isFinite(block.v) && block.v >= 0 && block.v <= 1 &&
      (block.stamp === undefined || typeof block.stamp === 'boolean'))
}

export function shareURL(state: StudioState, href = location.href) {
  const packed = {
    s: state.sheet, p: pack(state.mesh.positions), c: encodeCuts(state.mesh.cut),
    g: gravityOptions.indexOf(state.mesh.gravity), w: state.mesh.wadded, r: state.mesh.creased,
  }
  const encoded = compressToBase64(JSON.stringify(packed)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  const url = new URL(href)
  url.hash = prefix + encoded
  return url.toString()
}

export function readShare(hash: string): StudioState | undefined {
  if (!hash.startsWith(prefix)) return undefined
  const encoded = hash.slice(prefix.length)
  if (encoded.length > 64000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('This share link is damaged')
  try {
    const input = encoded.replaceAll('-', '+').replaceAll('_', '/')
    const packed = JSON.parse(decompressFromBase64(input.padEnd(Math.ceil(input.length / 4) * 4, '=')))
    if (!isSheet(packed.s) || !gravityOptions[packed.g] ||
        typeof packed.w !== 'boolean' || typeof packed.r !== 'boolean') throw new Error('Invalid sheet')
    return {
      sheet: packed.s,
      mesh: { cut: decodeCuts(packed.c), positions: unpack(packed.p),
        gravity: gravityOptions[packed.g], wadded: packed.w, creased: packed.r },
    }
  } catch {
    throw new Error('This share link is damaged')
  }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export async function exportPNG(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The canvas could not make a PNG')
  download(blob, 'tear-sheet.png')
}

export function videoType() {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return undefined
  return ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find(type => MediaRecorder.isTypeSupported(type))
}

export function recordClip(canvas: HTMLCanvasElement, type: string, audio?: MediaStream) {
  const stream = canvas.captureStream(60)
  audio?.getAudioTracks().forEach(track => stream.addTrack(track))
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  let timer = 0
  const stopTracks = () => stream.getTracks().forEach(track => track.stop())
  return new Promise<void>((resolve, reject) => {
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
    recorder.onerror = () => {
      window.clearTimeout(timer)
      stopTracks()
      reject(new Error('Recording could not finish'))
    }
    recorder.onstop = () => {
      stopTracks()
      if (chunks.length === 0) { reject(new Error('The clip is empty')); return }
      download(new Blob(chunks, { type: 'video/webm' }), 'tear-sheet-5s.webm')
      resolve()
    }
    try {
      recorder.start(100)
      timer = window.setTimeout(() => { if (recorder.state === 'recording') recorder.stop() }, 5000)
    } catch (error) {
      stopTracks()
      reject(error)
    }
  })
}
