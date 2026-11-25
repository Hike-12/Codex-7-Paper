import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { Icon } from './Icon'
import { PaperPhysics } from './engine/PaperPhysics'
import type { Gravity, Point } from './engine/PaperPhysics'
import { PaperRenderer, meshResolution } from './engine/PaperRenderer'
import { PaperAudio } from './engine/PaperAudio'
import { blockAt } from './engine/PaperTexture'
import { createSheet, fonts, stamps, stocks, templates } from './engine/sheet'
import type { InkBlock, InkFont, Sheet, Stock, Template } from './engine/sheet'
import { exportPNG, readShare, recordClip, shareURL, videoType } from './utils/exportShare'
import type { StudioState } from './utils/exportShare'

const tools = [
  { key: 'peel', label: 'Peel', help: 'Drag a corner to lift the sheet. Double-click an edge for a quick peel.' },
  { key: 'rip', label: 'Rip', help: 'Drag the blade across the sheet. Cut past an edge to free a piece.' },
  { key: 'type', label: 'Type & stamp', help: 'Click anywhere on the paper to set type, or click existing ink to edit it.' },
  { key: 'wad', label: 'Crumple', help: 'Click the sheet to crumple it. Drag and release to toss the ball.' },
] as const
type Tool = typeof tools[number]['key']
type Menu = 'stock' | 'template' | 'export' | 'gravity' | 'stamp' | undefined
type Runtime = { renderer: PaperRenderer; mesh: PaperPhysics; audio: PaperAudio }
type Gesture = { pointer: number; tool: 'peel' | 'rip' | 'wad'; last: Point; before: StudioState; changed: boolean }
const gravityNames: Record<Gravity, string> = { pins: 'Top edge pinned', zero: 'Unpin · Zero-G', desk: 'Unpin · Desk gravity' }

function startingState() {
  try { return { state: readShare(location.hash), warning: '' } }
  catch { return { state: undefined, warning: 'This share link could not be opened.' } }
}

function Options({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <div className={`options ${className}`} role="group" aria-label={label}>
    <div className="menu-title">{label}</div>
    {children}
  </div>
}

export function App() {
  const [initial] = useState(startingState)
  const [sheet, setSheet] = useState(() => initial.state?.sheet ?? createSheet())
  const [tool, setTool] = useState<Tool>('peel')
  const [gravity, setGravity] = useState<Gravity>(() => initial.state?.mesh.gravity ?? 'pins')
  const [wadded, setWadded] = useState(() => initial.state?.mesh.wadded ?? false)
  const [sound, setSound] = useState(false)
  const [menu, setMenu] = useState<Menu>()
  const [editor, setEditor] = useState<InkBlock>()
  const [underNote, setUnderNote] = useState<string>()
  const [stamp, setStamp] = useState<string>()
  const [customStamp, setCustomStamp] = useState<string>()
  const [copyField, setCopyField] = useState<string>()
  const [count, setCount] = useState(0)
  const [recording, setRecording] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [toast, setToast] = useState(initial.warning)
  const [fatal, setFatal] = useState('')
  const canvas = useRef<HTMLCanvasElement>(null)
  const runtime = useRef<Runtime>(null)
  const current = useRef(sheet)
  const gesture = useRef<Gesture>(undefined)
  const lastTouchTap = useRef<{ at: number; point: Point }>(undefined)
  const history = useRef<StudioState[]>([])
  const capture = useRef(false)
  const messageTimer = useRef(0)
  const recordStart = useRef(0)

  useEffect(() => {
    const element = canvas.current!
    const mesh = new PaperPhysics()
    if (initial.state) mesh.restore(initial.state.mesh)
    let renderer: PaperRenderer
    try { renderer = new PaperRenderer(element, mesh, current.current) }
    catch { setFatal('The canvas could not start. Reload to reopen the workbench.'); return }
    const audio = new PaperAudio()
    runtime.current = { renderer, mesh, audio }
    const resize = () => {
      const { width, height } = element.getBoundingClientRect()
      renderer.resize(width, height)
      renderer.render(true)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    resize()
    let disposed = false
    const fontsReady = Promise.allSettled([
      document.fonts.load('145px "Instrument Serif"'),
      document.fonts.load('italic 145px "Instrument Serif"'),
      document.fonts.load('12px "JetBrains Mono"'),
      document.fonts.load('700 20px "JetBrains Mono"'),
      document.fonts.load('15px Inter'),
    ])
    void fontsReady.then(() => {
      if (disposed) return
      renderer.setSheet(current.current)
      resize()
    })
    let then = 0
    let remainder = 0
    let frame = 0
    const tick = (time: number) => {
      const step = 1 / 60
      remainder = Math.min(step * 3, remainder + Math.max(0, (time - (then || time)) / 1000))
      then = time
      while (remainder >= step) {
        const snapped = mesh.step(step, renderer.bounds)
        if (snapped) audio.rip(13 + snapped * 1.2, snapped)
        remainder -= step
      }
      renderer.render(capture.current)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      renderer.dispose()
      audio.dispose()
      window.clearTimeout(messageTimer.current)
      runtime.current = null
    }
  }, [initial])

  function announce(text: string) {
    window.clearTimeout(messageTimer.current)
    setToast(text)
    messageTimer.current = window.setTimeout(() => setToast(''), 3300)
  }

  function snapshot(): StudioState | undefined {
    if (!runtime.current) return undefined
    return { sheet: current.current, mesh: runtime.current.mesh.snapshot() }
  }

  function remember(state = snapshot()) {
    if (!state) return
    const stack = history.current
    stack.push(state)
    if (stack.length > 20) stack.shift()
    setCount(stack.length)
  }

  function showSheet(next: Sheet) {
    current.current = next
    setSheet(next)
    runtime.current?.renderer.setSheet(next)
  }

  function load(state: StudioState) {
    runtime.current?.mesh.restore(state.mesh)
    runtime.current?.renderer.requestFrame()
    setGravity(state.mesh.gravity)
    setWadded(state.mesh.wadded)
    showSheet(state.sheet)
    setEditor(undefined)
    setStamp(undefined)
  }

  function undo() {
    if (gesture.current) return
    const previous = history.current.pop()
    if (!previous) return
    setCount(history.current.length)
    load(previous)
    announce('Undid the last change.')
  }

  function reset(template?: Template) {
    remember()
    const mesh = new PaperPhysics()
    const next = template ? createSheet(template, current.current.stock, current.current.secret) : current.current
    load({ sheet: next, mesh: mesh.snapshot() })
    setMenu(undefined)
    announce(template ? 'New template loaded.' : 'Fresh sheet. Your ink is intact.')
  }

  function openMenu(next: Menu) {
    setMenu(previous => previous === next ? undefined : next)
    if (next !== 'stamp') setCustomStamp(undefined)
  }

  function selectTool(next: Tool) {
    setTool(next)
    setMenu(undefined)
    setStamp(undefined)
    if (next !== 'type') setEditor(undefined)
  }

  function world(event: ReactPointerEvent<HTMLCanvasElement> | { clientX: number; clientY: number }) {
    const rect = canvas.current!.getBoundingClientRect()
    return runtime.current!.renderer.world({ x: event.clientX - rect.left, y: event.clientY - rect.top })
  }

  function place(point: Point) {
    const live = runtime.current
    if (!live) return
    const hit = live.mesh.hit(point)
    if (!hit) { announce('Place ink on the paper.'); return }
    const { u, v } = hit
    if (stamp) {
      if (current.current.blocks.length >= 120) { announce('This sheet holds up to 120 ink blocks.'); return }
      remember()
      const baseline = Math.min(0.97, Math.max(0.08, v))
      const block: InkBlock = { id: crypto.randomUUID(), u, v: baseline, font: 'Mono', size: 23, text: stamp, stamp: true }
      showSheet({ ...current.current, blocks: [...current.current.blocks, block] })
      live.audio.stamp()
      return
    }
    const existing = [...current.current.blocks].reverse().find(block => blockAt(block, u, v, live.renderer.texture.inkContext))
    setEditor(existing ? { ...existing } : { id: crypto.randomUUID(), u, v: Math.max(0.035, v), font: 'Serif', size: 37, text: '' })
  }

  function foldIntoBall() {
    const live = runtime.current
    if (!live || live.mesh.wadded) return
    remember()
    live.mesh.crumple()
    live.audio.crumple(false)
    setWadded(true)
    selectTool('wad')
    live.renderer.requestFrame()
  }

  function iron() {
    const live = runtime.current
    if (!live || !live.mesh.wadded) return
    remember()
    live.mesh.iron()
    live.audio.crumple(true)
    setWadded(false)
    setGravity('pins')
    selectTool('peel')
    live.renderer.requestFrame()
  }

  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!runtime.current || gesture.current || !event.isPrimary || event.button !== 0) return
    const live = runtime.current
    const point = world(event)
    if (tool === 'type') { place(point); return }
    if (tool === 'wad' && !live.mesh.wadded) {
      if (live.mesh.hit(point)) foldIntoBall()
      return
    }
    const before = snapshot()!
    if ((tool === 'peel' || tool === 'wad') && !live.mesh.startGrab(point)) return
    if (tool === 'rip' && live.mesh.wadded) { announce('Iron out the sheet before cutting it.'); return }
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { pointer: event.pointerId, tool, last: point, before, changed: false }
    setDragging(true)
    live.renderer.requestFrame()
  }

  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const active = gesture.current
    const live = runtime.current
    if (!active || event.pointerId !== active.pointer || !live) return
    const samples = event.nativeEvent.getCoalescedEvents?.()
    for (const sample of samples?.length ? samples : [event]) {
      const point = world(sample)
      const speed = Math.hypot(point.x - active.last.x, point.y - active.last.y)
      if (active.tool === 'rip') {
        const removed = live.mesh.cut(active.last, point)
        if (removed) {
          active.changed = true
          live.audio.rip(speed, removed)
          live.renderer.requestFrame()
        }
      } else {
        if (speed > 0.8) active.changed = true
        live.mesh.drag(point)
        if (live.mesh.wadded) live.audio.crackle(speed)
        else live.audio.slide(speed)
      }
      active.last = point
    }
  }

  function pointerEnd(event: ReactPointerEvent<HTMLCanvasElement>) {
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    gesture.current = undefined
    setDragging(false)
    const live = runtime.current
    if (active.changed) remember(active.before)
    live?.mesh.release()
    live?.audio.slide(0)
    live?.renderer.requestFrame()
    if (active.tool === 'peel' && !active.changed && event.pointerType === 'touch' && event.type === 'pointerup') {
      const now = performance.now()
      const previous = lastTouchTap.current
      if (previous && now - previous.at < 340 && Math.hypot(previous.point.x - active.last.x, previous.point.y - active.last.y) < 36) {
        previewCorner(event)
        lastTouchTap.current = undefined
      } else lastTouchTap.current = { at: now, point: active.last }
    }
  }

  function previewCorner(event: { clientX: number; clientY: number }) {
    const live = runtime.current
    if (tool !== 'peel' || !live || live.mesh.wadded) return
    const before = snapshot()
    if (live.mesh.startGrab(world(event), true)) {
      remember(before)
      live.audio.slide(11)
      window.setTimeout(() => live.audio.slide(0), 650)
    }
  }

  function saveInk() {
    if (!editor || !editor.text.trim()) return
    const blocks = current.current.blocks
    const existing = blocks.some(block => block.id === editor.id)
    if (!existing && blocks.length >= 120) { announce('This sheet holds up to 120 ink blocks.'); return }
    remember()
    showSheet({ ...current.current, blocks: existing ? blocks.map(block => block.id === editor.id ? editor : block) : [...blocks, editor] })
    if (editor.stamp) runtime.current?.audio.stamp()
    setEditor(undefined)
  }

  function deleteInk() {
    if (!editor || !current.current.blocks.some(block => block.id === editor.id)) { setEditor(undefined); return }
    remember()
    showSheet({ ...current.current, blocks: current.current.blocks.filter(block => block.id !== editor.id) })
    setEditor(undefined)
  }

  async function toggleSound() {
    try {
      await runtime.current?.audio.setEnabled(!sound)
      setSound(Boolean(runtime.current?.audio.enabled))
    } catch { announce('Paper foley is unavailable in this browser.') }
  }

  async function downloadPoster(backdrop: boolean) {
    setMenu(undefined)
    const live = runtime.current
    if (!live) return
    try {
      await exportPNG(live.renderer.export(backdrop))
      live.renderer.requestFrame()
      announce('2× PNG downloaded.')
    } catch { announce('The PNG could not be created.') }
  }

  async function share() {
    const state = snapshot()
    if (!state) return
    const url = shareURL(state)
    try {
      await navigator.clipboard.writeText(url)
      announce('Share link copied.')
    } catch { setCopyField(url) }
  }

  async function record() {
    const live = runtime.current
    if (!live || capture.current) return
    const type = videoType()
    if (!type) { announce('This browser does not support WebM recording.'); return }
    let audio: ReturnType<PaperAudio['recordAudio']>
    try {
      recordStart.current = performance.now()
      capture.current = true
      setRecording(true)
      live.renderer.render(true)
      audio = live.audio.recordAudio()
      await recordClip(live.renderer.canvas, type, audio?.stream)
      announce('5-second WebM downloaded.')
    } catch { announce('The clip could not be recorded.') }
    finally {
      audio?.disconnect()
      capture.current = false
      setRecording(false)
    }
  }

  useEffect(() => {
    const handleHash = () => {
      try {
        const next = readShare(location.hash)
        if (next) { remember(); load(next); announce('Shared sheet opened.') }
      } catch { announce('This share link could not be opened.') }
    }
    window.addEventListener('hashchange', handleHash)
    return () => window.removeEventListener('hashchange', handleHash)
  }, [])

  useEffect(() => {
    function keys(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setEditor(undefined); setUnderNote(undefined); setMenu(undefined); setCopyField(undefined); setCustomStamp(undefined)
        return
      }
      if (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return
      if (event.metaKey || event.ctrlKey) {
        if (event.key.toLowerCase() === 'z' && !event.shiftKey) { event.preventDefault(); undo() }
        return
      }
      if (event.altKey) return
      const number = Number(event.key) - 1
      if (number >= 0 && number < tools.length) selectTool(tools[number].key)
      if (event.key === 'Enter' && event.target === canvas.current) {
        if (tool === 'type') place({ x: 0, y: 0 })
        else if (tool === 'wad') { if (wadded) iron(); else foldIntoBall() }
      }
    }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  })

  const stock = stocks[sheet.stock]
  const press = matchMedia('(pointer: coarse)').matches ? 'Double-tap' : 'Double-click'
  const help = wadded && (tool === 'wad' || tool === 'peel')
    ? 'Drag the ball and release to toss it. Iron it out to recover the sheet.'
    : stamp && tool === 'type' ? `Press the paper to apply “${stamp}”.`
      : tool === 'peel' ? `Drag a corner to lift the sheet. ${press} an edge for a quick peel.`
        : tools.find(item => item.key === tool)!.help

  return <main className="studio">
    <header className="topbar">
      <div className="brand">
        <img src="/fold.svg" alt="" width="36" height="36" />
        <div><h1>Tear Sheet<span>.</span></h1><div className="brand-caption">Paper workbench</div></div>
      </div>
      <div className="materials">
        <div className="menu-anchor">
          <button className="control material-button" title="Paper stock" aria-expanded={menu === 'stock'} onClick={() => openMenu('stock')}>
            <span className="swatch" style={{ background: stock.base }} /><span className="material-label">{stock.name}</span><Icon name="chevron" size={13} />
          </button>
          {menu === 'stock' && <Options label="Paper stock">{(Object.entries(stocks) as [Stock, typeof stock][]).map(([key, item]) =>
            <button key={key} className="option" aria-pressed={sheet.stock === key} onClick={() => {
              if (sheet.stock !== key) { remember(); showSheet({ ...sheet, stock: key }) }
              setMenu(undefined)
            }}><span className="swatch" style={{ background: item.base }} /><span>{item.name}</span><small>{item.weight}</small></button>
          )}</Options>}
        </div>
        <div className="menu-anchor">
          <button className="control" aria-label="Templates" aria-expanded={menu === 'template'} onClick={() => openMenu('template')}><Icon name="template" /><span>Templates</span><Icon name="chevron" size={13} /></button>
          {menu === 'template' && <Options label="Starter sheets">{(Object.entries(templates) as [Template, string][]).map(([key, name], i) =>
            <button key={key} className="option" aria-pressed={sheet.template === key} onClick={() => reset(key)}><small className="option-number">0{i + 1}</small><span>{name}</span></button>
          )}</Options>}
        </div>
      </div>
      <div className="actions">
        <button className="control icon-button" title={sound ? 'Mute paper foley' : 'Unmute paper foley'} aria-label="Paper foley" aria-pressed={sound} onClick={() => void toggleSound()}><Icon name={sound ? 'audio' : 'mute'} /></button>
        <div className="menu-anchor">
          <button className="control action" title="Export PNG" aria-label="Export PNG" aria-expanded={menu === 'export'} onClick={() => openMenu('export')}><Icon name="download" /><span>PNG</span></button>
          {menu === 'export' && <Options label="Export 2× PNG" className="right-menu">
            <button className="option" onClick={() => void downloadPoster(true)}>Studio backdrop</button>
            <button className="option" onClick={() => void downloadPoster(false)}>Transparent sheet</button>
          </Options>}
        </div>
        <button className={`control action ${recording ? 'recording' : ''}`} title="Record five-second clip" aria-label="Record clip" disabled={recording} onClick={() => void record()}><Icon name="record" /><span>{recording ? 'REC' : 'Record'}</span></button>
        <button className="control action share" title="Copy share link" aria-label="Share link" onClick={() => void share()}><Icon name="share" /><span>Share</span></button>
      </div>
    </header>

    <section className="stage" aria-label="Drafting desk">
      <canvas ref={canvas} className={`desk-canvas tool-${tool} ${dragging ? 'dragging' : ''}`} tabIndex={0}
        aria-label={`${templates[sheet.template]} on ${stock.name}. ${help}`}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}
        onLostPointerCapture={pointerEnd} onDoubleClick={previewCorner} />
      <div className="desk-caption" aria-hidden="true"><i />DRAFTING MAT<span>TS / 07</span></div>
      {fatal && <div className="canvas-error" role="alert">{fatal}</div>}
      {recording && <div className="record-flag" key={recordStart.current} role="status"><i /> Recording • 5 sec<span /></div>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </section>

    <footer className="workbar">
      <div className="tool-row">
        <div className="desk-actions">
          <div className="menu-anchor gravity-anchor">
            <button className="control gravity" aria-expanded={menu === 'gravity'} title={gravityNames[gravity]} onClick={() => openMenu('gravity')}><Icon name="pin" /><span>{gravityNames[gravity]}</span><Icon name="chevron" size={12} /></button>
            {menu === 'gravity' && <Options label="Sheet suspension" className="up-menu">{(Object.entries(gravityNames) as [Gravity, string][]).map(([value, label]) =>
              <button className="option" aria-pressed={gravity === value} key={value} onClick={() => {
                if (gravity !== value) { remember(); runtime.current?.mesh.setGravity(value); runtime.current?.renderer.requestFrame(); setGravity(value) }
                setMenu(undefined)
              }}>{label}</button>
            )}</Options>}
          </div>
          <button className="utility" title="Undo (Ctrl or Cmd + Z)" aria-label="Undo" disabled={!count} onClick={undo}><Icon name="undo" /></button>
          <button className="utility" title="Reset sheet" aria-label="Reset sheet" onClick={() => reset()}><Icon name="reset" /></button>
        </div>
        <div className="dock" role="toolbar" aria-label="Paper tools">
          {tools.map((item, i) => <button key={item.key} aria-keyshortcuts={String(i + 1)} aria-pressed={tool === item.key}
            title={`${item.label} (${i + 1})`} onClick={() => selectTool(item.key)}>
            <Icon name={item.key} size={19} /><span>{item.label}</span><kbd>{i + 1}</kbd>
          </button>)}
        </div>
        <div className="context-actions">
          {tool === 'type' && <div className="menu-anchor">
            <button className={`control ${stamp ? 'active-control' : ''}`} aria-label="Choose a stamp" title="Choose a stamp" aria-expanded={menu === 'stamp'} onClick={() => openMenu('stamp')}><Icon name="stamp" /><span>{stamp || 'Stamp'}</span><Icon name="chevron" size={12} /></button>
            {menu === 'stamp' && <Options label="Ink stamps" className="up-menu right-menu">
              {[...stamps, new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'short', day: '2-digit' }).format(new Date()).toUpperCase()].map(item =>
                <button className="option" key={item} onClick={() => { setStamp(item); setMenu(undefined); setEditor(undefined) }}>{item}</button>)}
              <button className="option" onClick={() => { setCustomStamp(''); setMenu(undefined) }}>Custom stamp</button>
              {stamp && <button className="option" onClick={() => { setStamp(undefined); setMenu(undefined) }}>Return to type</button>}
            </Options>}
          </div>}
          {tool === 'wad' && <button className="control" aria-label={wadded ? 'Iron out' : 'Crumple sheet'} onClick={wadded ? iron : foldIntoBall}><Icon name="wad" /><span>{wadded ? 'Iron out' : 'Crumple sheet'}</span></button>}
          <button className="control note-button" title="Edit under-note" aria-label="Edit under-note" onClick={() => { setMenu(undefined); setUnderNote(sheet.secret) }}><Icon name="secret" /><span>Under-note</span></button>
        </div>
      </div>
      <div className="readout">
        <span className="day-label">DAY <b>07</b> / 30</span>
        <p>{help}</p>
        <span className="mesh-label">{meshResolution} MESH · {stock.weight.toUpperCase()}</span>
      </div>
    </footer>

    {menu && <button className="click-away" tabIndex={-1} aria-label="Close menu" onClick={() => setMenu(undefined)} />}
    {editor && <div className="shade" onPointerDown={event => { if (event.target === event.currentTarget) setEditor(undefined) }}>
      <form className="panel" onSubmit={event => { event.preventDefault(); saveInk() }} aria-label="Edit ink">
        <div className="panel-heading"><h2>{editor.stamp ? 'Edit stamp' : 'Set type'}</h2><button type="button" className="utility" aria-label="Close" onClick={() => setEditor(undefined)}><Icon name="close" /></button></div>
        <label>Ink<textarea autoFocus value={editor.text} maxLength={280} rows={3} placeholder="Type something…" onChange={event => setEditor({ ...editor, text: event.target.value })} /></label>
        <div className="form-row">
          {!editor.stamp && <label>Face<select value={editor.font} onChange={event => setEditor({ ...editor, font: event.target.value as InkFont })}>{fonts.map(font => <option key={font}>{font}</option>)}</select></label>}
          <label>Size <input type="number" value={editor.size} min={8} max={180} onChange={event => setEditor({ ...editor, size: Number(event.target.value) })} /></label>
        </div>
        <div className="form-actions">
          {sheet.blocks.some(block => block.id === editor.id) && <button className="control" type="button" onClick={deleteInk}>Remove ink</button>}
          <button className="control primary" type="submit" disabled={!editor.text.trim()}>Print on sheet</button>
        </div>
      </form>
    </div>}
    {underNote !== undefined && <div className="shade" onPointerDown={event => { if (event.target === event.currentTarget) setUnderNote(undefined) }}>
      <form className="panel" onSubmit={event => { event.preventDefault(); remember(); showSheet({ ...sheet, secret: underNote }); setUnderNote(undefined); announce('Under-note saved.') }} aria-label="Edit under-note">
        <div className="panel-heading"><h2>Under-note</h2><button type="button" className="utility" aria-label="Close" onClick={() => setUnderNote(undefined)}><Icon name="close" /></button></div>
        <label>Print beneath the sheet<textarea autoFocus rows={4} maxLength={280} value={underNote} onChange={event => setUnderNote(event.target.value.split('\n').slice(0, 5).join('\n'))} /></label>
        <div className="form-actions"><button className="control primary" type="submit">Save under-note</button></div>
      </form>
    </div>}
    {customStamp !== undefined && <div className="shade" onPointerDown={event => { if (event.target === event.currentTarget) setCustomStamp(undefined) }}>
      <form className="panel" onSubmit={event => { event.preventDefault(); if (customStamp.trim()) { setStamp(customStamp.trim().toUpperCase()); setCustomStamp(undefined) } }} aria-label="Custom stamp">
        <div className="panel-heading"><h2>Custom stamp</h2><button type="button" className="utility" aria-label="Close" onClick={() => setCustomStamp(undefined)}><Icon name="close" /></button></div>
        <label>Stamp text<input autoFocus value={customStamp} maxLength={26} placeholder="27 NOV 2026" onChange={event => setCustomStamp(event.target.value)} /></label>
        <div className="form-actions"><button className="control primary" type="submit" disabled={!customStamp.trim()}>Use stamp</button></div>
      </form>
    </div>}
    {copyField && <div className="shade"><section className="panel" aria-label="Copy share link">
      <div className="panel-heading"><h2>Share this sheet</h2><button type="button" className="utility" aria-label="Close" onClick={() => setCopyField(undefined)}><Icon name="close" /></button></div>
      <label>Copy the selected link<input autoFocus readOnly value={copyField} onFocus={event => event.currentTarget.select()} /></label>
    </section></div>}
  </main>
}
