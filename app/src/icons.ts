/**
 * One icon set for the lens and the phone: SVG path data on a 24-unit grid, stroked, never filled.
 * The phone draws it as SVG; the lens gets it as a PNG drawn on a canvas from the same paths.
 */
const SHIELD = 'M12 3 L19 6 V11 C19 15.5 16 19 12 21 C8 19 5 15.5 5 11 V6 Z'
const RING = 'M3 12 A9 9 0 1 0 21 12 A9 9 0 1 0 3 12'

export const ICONS = {
  /** Near liquidation: danger */
  warn: ['M12 3.5 L21.5 20 H2.5 Z', 'M12 10 V14', 'M12 17 V17.01'],
  /** Near stop: a stop protects the position */
  shield: [SHIELD],
  /** Stop missing */
  shieldOff: [SHIELD, 'M4 3 L20 21'],
  /** Stop moved to entry: the profit is locked */
  lock: ['M6 11 H18 V20 H6 Z', 'M8.5 11 V8 A3.5 3.5 0 0 1 15.5 8 V11'],
  /** Price level */
  bell: ['M6 16 V11 A6 6 0 0 1 18 11 V16 L19.5 18 H4.5 Z', 'M10 20.5 A2 2 0 0 0 14 20.5'],
  /** Something you said */
  mic: ['M9 5 A3 3 0 0 1 15 5 V11 A3 3 0 0 1 9 11 Z', 'M5.5 11 A6.5 6.5 0 0 0 18.5 11', 'M12 17.5 V21'],
  /** Profit */
  trendUp: ['M3 17 L9 11 L13 15 L21 7', 'M15 7 H21 V13'],
  /** Loss */
  trendDown: ['M3 7 L9 13 L13 9 L21 17', 'M15 17 H21 V11'],
  /** Near take profit */
  target: ['M4 12 A8 8 0 1 0 20 12 A8 8 0 1 0 4 12', 'M8.5 12 A3.5 3.5 0 1 0 15.5 12 A3.5 3.5 0 1 0 8.5 12'],
  /** Price change */
  pulse: ['M3 12 H7 L10 5 L14 19 L17 12 H21'],
  /** Order filled, and a result that went through */
  check: [RING, 'M8 12.5 L11 15.5 L16 9'],
  /** Partly filled: strokes only, so the "fill" is hatching on one half */
  half: [RING, 'M12 3 V21', 'M15.5 3.8 V20.2', 'M19 6.4 V17.6'],
  /** Review of an Open or Increase */
  grow: ['M7 17 L17 7', 'M9 7 H17 V15'],
  /** Sent, waiting for Bybit */
  clock: [RING, 'M12 7 V12 L15 14'],
  /** Rejected */
  reject: [RING, 'M9 9 L15 15', 'M15 9 L9 15'],
  /** No answer yet */
  question: [RING, 'M9.5 9.5 A2.5 2.5 0 1 1 12 12 V13.5', 'M12 17 V17.01'],
  /** Expired, or the data is stale: nothing was sent */
  hourglass: ['M7 3 H17', 'M7 21 H17', 'M8 3 C8 9 16 9 16 12 C16 15 8 15 8 21', 'M16 3 C16 9 8 9 8 12 C8 15 16 15 16 21'],
} as const

export type IconName = keyof typeof ICONS

/** Inline SVG for the phone page; takes the text color. */
export const svg = (name: IconName) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name].map(d => `<path d="${d}"/>`).join('')}</svg>`

/** A black canvas to draw on, and its PNG bytes: light on black, which the host turns into 4-bit grey. */
async function draw(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, w, h)
  paint(g)
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
  if (!blob) throw new Error('no PNG')
  return new Uint8Array(await blob.arrayBuffer())
}

/** The same icon as PNG bytes for an image container. */
export const png = (name: IconName, px: number) => draw(px, px, g => {
  g.scale(px / 24, px / 24)
  Object.assign(g, { strokeStyle: '#fff', lineWidth: 2, lineCap: 'round', lineJoin: 'round' })
  for (const d of ICONS[name]) g.stroke(new Path2D(d))
})

/**
 * Dotted digits for the one number that leads the lens, like Even's own clock and weather. 7 rows each; '#' is a dot.
 * The native font has one size, so a big number has to be a picture.
 */
const DOTS: Record<string, string[]> = {
  '0': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '$': ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  '.': ['..', '..', '..', '..', '..', '##', '##'],
  ',': ['..', '..', '..', '..', '..', '.#', '#.'],
  'k': ['#....', '#....', '#..#.', '#.#..', '##...', '#.#..', '#..#.'],
  '▼': ['.......', '.......', '#######', '.#####.', '..###..', '...#...', '.......'],
  '▲': ['.......', '.......', '...#...', '..###..', '.#####.', '#######', '.......'],
  '△': ['.......', '.......', '...#...', '..#.#..', '.#...#.', '#######', '.......'],
}
/** One dot and the gap after it, in lens pixels. */
export const DOT_PX = 5

/** The rows of dots for a string, one empty column between characters. Characters it has no dots for are left out. */
export function dots(text: string): string[] {
  const glyphs = [...text].map(c => DOTS[c]).filter(Boolean)
  return Array.from({ length: 7 }, (_, y) => glyphs.map(g => g[y]).join('.'))
}

/** The dotted number as PNG bytes, left-aligned in a w × h image. */
export const numeralPng = (text: string, w: number, h: number) => draw(w, h, g => {
  g.fillStyle = '#fff'
  dots(text).forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') g.fillRect(x * DOT_PX, y * DOT_PX, DOT_PX - 1, DOT_PX - 1) }))
})
