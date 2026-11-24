/**
 * One icon set for the lens and the phone: SVG path data on a 24-unit grid, stroked, never filled.
 * The phone draws it as SVG; the lens gets it as a PNG drawn on a canvas from the same paths.
 */
export const ICONS = {
  /** Liquidation: danger */
  warn: ['M12 3.5 L21.5 20 H2.5 Z', 'M12 10 V14', 'M12 17 V17.01'],
  /** A stop protects a position */
  shield: ['M12 3 L19 6 V11 C19 15.5 16 19 12 21 C8 19 5 15.5 5 11 V6 Z'],
  /** Stop moved to entry: the profit is locked */
  lock: ['M6 11 H18 V20 H6 Z', 'M8.5 11 V8 A3.5 3.5 0 0 1 15.5 8 V11'],
  /** A price alert */
  bell: ['M6 16 V11 A6 6 0 0 1 18 11 V16 L19.5 18 H4.5 Z', 'M10 20.5 A2 2 0 0 0 14 20.5'],
  /** Something you said */
  mic: ['M9 5 A3 3 0 0 1 15 5 V11 A3 3 0 0 1 9 11 Z', 'M5.5 11 A6.5 6.5 0 0 0 18.5 11', 'M12 17.5 V21'],
  /** The daily loss limit: a stop sign */
  limit: ['M8.5 3 H15.5 L21 8.5 V15.5 L15.5 21 H8.5 L3 15.5 V8.5 Z', 'M8 12 H16'],
  /** The cap on one tap */
  gauge: ['M4 17 A8 8 0 0 1 20 17', 'M12 17 L16 11'],
} as const

export type IconName = keyof typeof ICONS

/** Inline SVG for the phone page; takes the text color. */
export const svg = (name: IconName) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name].map(d => `<path d="${d}"/>`).join('')}</svg>`

/** The same icon as PNG bytes for an image container: light strokes on black, which the host turns into 4-bit grey. */
export async function png(name: IconName, px: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const g = canvas.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, px, px)
  g.scale(px / 24, px / 24)
  Object.assign(g, { strokeStyle: '#fff', lineWidth: 2, lineCap: 'round', lineJoin: 'round' })
  for (const d of ICONS[name]) g.stroke(new Path2D(d))
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
  if (!blob) throw new Error('no PNG')
  return new Uint8Array(await blob.arrayBuffer())
}
