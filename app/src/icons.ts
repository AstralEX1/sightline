import type { Candle } from '../../server/src/types.ts'
import { encodePng4, gray4Levels } from './png.ts'

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
  /** Funding due: its own sign, so it never reads as the "Sent" clock */
  percent: ['M18 6 L6 18', 'M5 7 A2 2 0 1 0 9 7 A2 2 0 1 0 5 7', 'M15 17 A2 2 0 1 0 19 17 A2 2 0 1 0 15 17'],
  /** Position closed: out of the trade, not the "Rejected" cross */
  exit: ['M9 4 H5 V20 H9', 'M10 12 H20', 'M16 8 L20 12 L16 16'],
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

/** A black canvas to draw on, and its PNG bytes: light on black, in the lens's 16 greys. */
async function draw(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, w, h)
  paint(g)
  if (typeof CompressionStream === 'function') return encodePng4(gray4Levels(g.getImageData(0, 0, w, h).data), w, h)
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png')) // shortcut: an older WebView sends the 8-bit PNG
  if (!blob) throw new Error('no PNG')
  return new Uint8Array(await blob.arrayBuffer())
}

/** The same icon as PNG bytes for an image container. */
export const png = (name: IconName, px: number) => draw(px, px, g => {
  g.scale(px / 24, px / 24)
  Object.assign(g, { strokeStyle: '#fff', lineWidth: 2, lineCap: 'round', lineJoin: 'round' })
  for (const d of ICONS[name]) g.stroke(new Path2D(d))
})

/** Detail's coin and side, as big as fits: the lens font has one size. */
export const titlePng = (text: string, w: number, h: number) => draw(w, h, g => {
  g.fillStyle = '#fff'
  g.textBaseline = 'middle'
  let px = 36
  do g.font = `bold ${px}px sans-serif`; while (g.measureText(text).width > w && --px > 12)
  g.fillText(text, 0, h / 2 + 1)
})

type Levels = { entry: number; stop: number; tp: number; liq: number }
/** A stop or liquidation this close to the last price joins the scale, so it is drawn before it is hit. */
const DANGER_PCT = 1

/** A level may stretch the scale by this many hour-ranges each way; past that it is pinned to the edge with an arrow. */
const STRETCH = 1.5

/**
 * The scale: the hour's closes, then entry and stop (liq only within DANGER_PCT of the last price) as far as STRETCH
 * hour-ranges or DANGER_PCT allow, whichever is wider, so a far stop never flattens the hour into a line but a near one
 * is always drawn. `pinned` are the levels left past the edge.
 */
export function chartRange(closes: number[], levels: Levels): { lo: number; hi: number; pinned: (keyof Levels)[] } {
  const now = closes[closes.length - 1]
  const hourLo = Math.min(...closes), hourHi = Math.max(...closes)
  const span = Math.max(hourHi - hourLo, hourHi * 0.002) // a flat hour still gets a range
  const want = (['entry', 'stop', 'liq'] as const).filter(k => levels[k] > 0 && (k !== 'liq' || Math.abs(levels.liq - now) / now * 100 < DANGER_PCT))
  const reach = Math.max(STRETCH * span, (now * DANGER_PCT) / 100)
  const fits = (v: number) => v >= hourLo - reach && v <= hourHi + reach
  const all = [hourLo, hourHi, ...want.filter(k => fits(levels[k])).map(k => levels[k])]
  const lo = Math.min(...all), hi = Math.max(...all)
  const pad = Math.max(hi - lo, span) * 0.06 // nothing sits on the edge
  return { lo: lo - pad, hi: hi + pad, pinned: want.filter(k => !fits(levels[k])) }
}

/**
 * Label centres at least `gap` apart, kept inside 0…max, given sorted by y. Crowded labels form a block centred on
 * where they want to be, so a pile stays beside its lines instead of cascading away from them.
 */
export function spread(ys: number[], gap: number, max: number): number[] {
  const blocks: { want: number; n: number }[] = [] // want: the sum of the targets; the block is centred on their mean
  for (const y of ys) {
    blocks.push({ want: y, n: 1 })
    for (let b = blocks.length; b > 1; b = blocks.length) {
      const [p, q] = [blocks[b - 2], blocks[b - 1]]
      if (p.want / p.n + (p.n * gap) / 2 <= q.want / q.n - (q.n * gap) / 2) break
      blocks.splice(b - 2, 2, { want: p.want + q.want, n: p.n + q.n })
    }
  }
  const out: number[] = []
  for (const { want, n } of blocks) {
    const top = Math.min(max - n * gap, Math.max(0, want / n - (n * gap) / 2))
    for (let i = 0; i < n; i++) out.push(top + gap / 2 + i * gap)
  }
  // Two blocks pushed into each other by the edges: one pass down keeps the gap.
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + gap)
  return out
}

const AXIS_H = 16
const LABEL_PX = 15

/**
 * Detail's last hour, calm like a ticker: the line with entry dotted and stop dashed across it, each named with its
 * price at the right next to the last price, `−1h` and `now` under it. Liq appears only when near.
 * The lens takes images up to 288 px wide, so the w-wide chart goes as slices: this is the one starting at `fromX`.
 */
export const chartPng = (candles: Candle[], levels: Levels, w: number, h: number, fromX: number, sliceW: number) => draw(sliceW, h, g => {
  if (candles.length < 2) return // black: nothing to draw yet
  g.translate(-fromX, 0)
  const closes = candles.map(c => c.close)
  const now = closes[closes.length - 1]
  const { lo, hi, pinned } = chartRange(closes, levels)
  g.font = `${LABEL_PX}px sans-serif`
  g.textBaseline = 'middle'
  // Each line is named at its right end, so entry and stop read without a legend; the last price is the brightest.
  // A pinned level sits on the edge it lies beyond, with an arrow: on the chart, but not stretching it.
  const lines = ([
    { name: 'entry', v: levels.entry, color: '#777', dash: [2, 3] },
    { name: 'stop', v: levels.stop, color: '#bbb', dash: [6, 4] },
    { name: 'liq', v: levels.liq, color: '#bbb', dash: [10, 3] },
  ] as const).filter(l => (l.v >= lo && l.v <= hi) || pinned.includes(l.name))
    .map(l => ({ ...l, at: l.v > hi ? hi : l.v < lo ? lo : l.v, arrow: l.v > hi ? ' ↑' : l.v < lo ? ' ↓' : '' }))
  // One precision for every label: the usual one for the price (as price() in format.ts), plus a digit while two
  // different prices would still read the same, so 0.99995 is not "1.000" next to "0.9999".
  const values = [now, ...lines.map(l => l.v)]
  let digits = now >= 1000 ? 0 : now >= 1 ? 2 : Math.ceil(-Math.log10(now)) + 3
  const fmt = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  while (digits < 8 && values.some((v, i) => values.some((u, j) => j > i && u !== v && fmt(u) === fmt(v)))) digits++
  const labels = [
    ...lines.map(l => ({ text: `${l.name} ${fmt(l.v)}${l.arrow}`, at: l.at, color: l.color })),
    { text: fmt(now), at: now, color: '#fff' }, // brighter, not bold: bold smeared in 4-bit
  ].sort((a, b) => b.at - a.at)
  const labelW = Math.ceil(Math.max(...labels.map(l => g.measureText(l.text).width))) + 14
  const plotW = w - labelW, plotH = h - AXIS_H
  const y = (v: number) => Math.round(plotH * (hi - v) / (hi - lo))
  const x = (i: number) => Math.round(closes.length < 2 ? plotW - 4 : (i * (plotW - 4)) / (closes.length - 1))

  g.lineWidth = 1
  for (const l of lines) {
    if (l.arrow) continue // a pinned level is only its label at the edge: a line there would look like a real level
    g.strokeStyle = l.color
    g.setLineDash([...l.dash])
    const ly = Math.min(plotH - 1, Math.max(0, y(l.at))) + 0.5
    g.beginPath(); g.moveTo(0, ly); g.lineTo(plotW, ly); g.stroke()
  }
  g.setLineDash([])

  spread(labels.map(l => y(l.at)), LABEL_PX + 2, plotH).forEach((ly, i) => {
    g.fillStyle = labels[i].color
    g.fillText(labels[i].text, plotW + 10, ly)
  })
  g.font = `${LABEL_PX - 2}px sans-serif`
  g.fillStyle = '#888'
  const minutes = Math.round((candles[candles.length - 1].start - candles[0].start) / 60_000) + 1 // a new listing has less than an hour
  g.fillText(minutes >= 60 ? '−1h' : `−${minutes}m`, 0, plotH + AXIS_H / 2 + 1)
  g.textAlign = 'right'
  g.fillText('now', plotW, plotH + AXIS_H / 2 + 1)

  g.strokeStyle = g.fillStyle = '#fff'
  g.lineWidth = 2
  g.lineJoin = 'round'
  g.beginPath()
  closes.forEach((c, i) => (i ? g.lineTo(x(i), y(c)) : g.moveTo(x(i), y(c))))
  g.stroke()
  g.beginPath(); g.arc(x(closes.length - 1), y(now), 3, 0, 2 * Math.PI); g.fill() // now
})
