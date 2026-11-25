export const stocks = {
  cotton: { name: 'Obsidian Cotton', weight: '320 gsm', base: '#222225', ink: '#f4f4f0', dim: '#a9a5a2', accent: '#ff683e', opacity: 1 },
  kraft: { name: 'Warm Kraft', weight: '180 gsm', base: '#eae2d3', ink: '#141413', dim: '#59554b', accent: '#a72e1e', opacity: 1 },
  cyanotype: { name: 'Cyanotype Blueprint', weight: '250 gsm', base: '#0f294a', ink: '#f0f6ff', dim: '#a5bdd0', accent: '#ff9866', opacity: 1 },
  vellum: { name: 'Tracing Vellum', weight: '110 gsm', base: '#d8d6cc', ink: '#17191d', dim: '#44474d', accent: '#a42c22', opacity: 0.76 },
} as const
export type Stock = keyof typeof stocks

export const templates = {
  manifesto: 'Architectural Manifesto',
  classified: 'Classified Field Note',
  blank: 'Blank Studio Sheet',
} as const
export type Template = keyof typeof templates
export const fonts = ['Serif', 'Italic', 'Sans', 'Mono'] as const
export type InkFont = typeof fonts[number]
export type InkBlock = {
  id: string
  u: number
  v: number
  text: string
  font: InkFont
  size: number
  stamp?: boolean
}
export type Sheet = { stock: Stock; template: Template; blocks: InkBlock[]; secret: string }
export const stamps = ['CONFIDENTIAL', 'DAY 07', 'ARCHIVE', 'APPROVED'] as const
export const defaultSecret = 'Everything you fold\nleaves a trace.'

const sheetBlocks: Record<Template, InkBlock[]> = {
  manifesto: [
    { id: 'title-1', u: 0.072, v: 0.365, text: 'Paper has', font: 'Serif', size: 145 },
    { id: 'title-2', u: 0.069, v: 0.615, text: 'a memory.', font: 'Italic', size: 152 },
    { id: 'caption', u: 0.079, v: 0.775, text: 'A crease records the pressure.\nA tear records the direction.', font: 'Sans', size: 15 },
  ],
  classified: [
    { id: 'field-title', u: 0.073, v: 0.36, text: 'Field note', font: 'Serif', size: 133 },
    { id: 'field-serial', u: 0.077, v: 0.60, text: 'No. 007', font: 'Italic', size: 144 },
    { id: 'field-copy', u: 0.08, v: 0.775, text: 'The reverse side contains the second copy.\nLift a corner to read it.', font: 'Mono', size: 13 },
    { id: 'field-stamp', u: 0.52, v: 0.78, text: 'CONFIDENTIAL', font: 'Mono', size: 20, stamp: true },
  ],
  blank: [],
}

export const createSheet = (template: Template = 'manifesto', stock: Stock = 'cotton', secret = defaultSecret): Sheet => ({
  template, stock, secret, blocks: sheetBlocks[template].map(block => ({ ...block }))
})
