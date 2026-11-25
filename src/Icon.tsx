const lines = {
  peel: 'M3 17V4h13l5 5v4M16 4v5h5M5 20c7 0 10-1 13-4l3-3m-7 1h7v7',
  rip: 'm4 20 5-5m5-5 6-6M7 4l2 5 5 2-3 4 2 5M16 16l4 4',
  type: 'M4 5h16m-8 0v14m-4 0h8M4 5v3m16-3v3',
  wad: 'm3 10 4-5 5-2 6 3 3 5-1 6-5 4-6-1-5-4zM7 5l3 6-3 5m3-5 5 2 3-7m-3 7 5 4m-5-4v8',
  stock: 'm3 8 9-5 9 5-9 5zM3 12l9 5 9-5M3 16l9 5 9-5',
  template: 'M4 4h16v16H4zm0 5h16m-6 0v11',
  chevron: 'm7 10 5 5 5-5',
  download: 'M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4',
  record: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  share: 'M11 7h6a4 4 0 0 1 0 8h-3m-1 2H7a4 4 0 0 1 0-8h3m-2 3h8',
  audio: 'M4 9h4l5-4v14l-5-4H4zm12 0c2 2 2 4 0 6m2-8c3 3 3 7 0 10',
  mute: 'M4 9h4l5-4v14l-5-4H4zm12 1 4 4m0-4-4 4',
  undo: 'm8 5-5 5 5 5m-5-5h10a6 6 0 0 1 6 6v2',
  reset: 'M5 7a8 8 0 1 1-1 8M4 3v5h5',
  pin: 'm8 4 8 0-1 5 3 3v2H6v-2l3-3zm4 10v7',
  close: 'm6 6 12 12M18 6 6 18',
  stamp: 'M5 14h14l2 4H3zm3 0 1-4-1-3a4 4 0 1 1 8 0l-1 3 1 4M5 21h14',
  secret: 'M4 5h16v14H4zm0 1 8 7 8-7',
  check: 'm5 12 4 4L19 6',
} as const

export function Icon({ name, size = 17 }: { name: keyof typeof lines; size?: number }) {
  return <svg data-icon={name} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.45"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={lines[name]} /></svg>
}
