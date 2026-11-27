import type { Execution, Position, Proposal, ServerState, Side } from '../../server/src/types.ts'
import type { ConditionType } from '../../server/src/registry.ts'
import { coin, price } from '../../server/src/format.ts'
import { liqDistancePct } from '../../server/src/rules.ts'
import { getTextWidth } from '@evenrealities/pretext'
import type { IconName } from './icons.ts'

// Measure on physical glasses before changing the delay that guards taps meant for the previous card.
export const CARD_SETTLE_MS = 1000

/** Which boxes main.ts LAYOUTS puts on the lens (docs/glasses-shortcuts.md §4). */
export type Layout = 'quiet' | 'main' | 'detail' | 'alert' | 'review'
/** What a tap on opt1 / opt2 does: dismiss the proposal, confirm it, acknowledge a notice, open its Review, close a result, or pick an Open's size or leverage. */
export type Choice = 'dismiss' | 'confirm' | 'ok' | 'review' | 'close' | 'pick' | 'ack-glasses-test'

/**
 * Text for each glasses container. Table columns are separate containers, so rows line up
 * even though the firmware font is proportional.
 */
export interface Screen {
  layout: Layout
  /** Another key needs a rebuild: another layout or another card. The `>` belongs to a key, so a new card starts on Dismiss. */
  key: string
  /** Container name → content; '' is a blank box */
  text: Record<string, string>
  /** Container name → textColor: 4 primary and selected, 3 ordinary text, 2 hints and supporting values */
  tone: Record<string, number>
  /** The 48 px icon in the frame, '' on Main and Detail */
  icon: IconName | ''
  /** What a tap does on opt1, opt2; none while waiting for Bybit */
  choices: Choice[]
  /** The choice that carries `>` */
  at: number
  /** The alert or Review on the lens (not a result): the proposal a tap answers */
  card: Proposal | null
  /** The alert whose notification is visible in the status line. */
  toastAlertId?: string
  /** Detail's coin and side, drawn big ("BTC long") */
  title?: string
  /** Detail's PnL, drawn as big as the title ("PNL: +$50") */
  pnl?: string
  /** Detail's price chart: whose closes to fetch and the position's levels drawn across them (0 = none) */
  chart?: { symbol: string; entry: number; stop: number; tp: number; liq: number }
}

export type RenderedAlert = { id: string; actionable: boolean }

/** What became of the card the lens answered, or lost before an answer. On the lens until OK or Dismiss. */
export interface Outcome {
  card: Proposal
  /** From the server once the confirm made one, polled until final */
  execution?: Execution
  /** The server's answer when it made no execution: "Expired, nothing sent" */
  message?: string
  /** The card left the queue unanswered: its time ran out */
  expired?: boolean
  /** The confirm got no reply: it may have reached Bybit */
  lost?: boolean
}

/** What the lens is drawn from besides the server state. */
export interface View {
  offline?: boolean
  /** A voice or menu note: wins over every other message */
  voice?: string
  /** Minutes left on a pause from the menu; while > 0 alerts wait and the table stays up */
  pausedMin?: number
  /** Index into liquidation-sorted positions: Main `>` and which Detail (wraps) */
  focus?: number
  /** Detail of the focused position is open */
  detail?: boolean
  quiet?: boolean
  positionsOpen?: boolean
  /** The server answered 401, so the phone page still needs the token */
  needToken?: boolean
  /** The optional tips on Main and Detail (tap: details, swipe: next position). Double tap always shows. So does the
   * way to the menu when a position is listed, and `tap: close` on a position. Alerts, reviews and results always keep their line. */
  hints?: boolean
  /** Phone clock for the time in the top line; none in tests */
  now?: number
  outcome?: Outcome
  /** Id of the card whose Review is open */
  review?: string
  /** The size picked for the card `id` (its picks): the next page asks the leverage */
  pick?: { id: string; size: number }
  /** Id of a card being dismissed: gone from the lens before the server says so */
  hide?: string
  /** Where a swipe put `>`, on the page with this key */
  cursor?: { key: string; at: number }
}

export const ROWS = 5
/** Optional tips stay on for this many launches, unless the phone switch was set. */
const TIP_LAUNCHES = 3
/** `setting` is the phone switch ('on', 'off', '' if never touched), `launches` counts the earlier starts. */
export const tipsShown = (setting: string, launches: number) => (setting ? setting === 'on' : launches < TIP_LAUNCHES)
/** "liq 5.9%" shows in the flag column below this distance. */
const LIQ_FLAG_PCT = 10
/** Coin quantity, right-aligned in the name box. Wide enough for 0.000012 and 123,456. */
const SIZE_PX = 84
/** Empty pixels after the size, so it does not touch the price. */
const SIZE_GAP = 8
/** Inner width of each box in main.ts LAYOUTS: its width minus 2 × 2 px padding. */
export const INNER_PX: Record<string, number> = {
  top: 540, name: 228, cur: 228, price: 124, loss: 100, gain: 100, flag: 76, hint: 540,
  who: 380, why: 380, queue: 68, ask: 452, terms: 452, opt1: 540, opt2: 540,
  table: 236, lev: 268,
}
/** Brightness of each box unless a state says otherwise (§4). */
const TONE: Record<string, number> = {
  top: 3, name: 3, cur: 4, price: 3, loss: 4, gain: 2, flag: 4, hint: 2,
  frame: 3, who: 4, why: 3, queue: 2, ask: 4, terms: 3, opt1: 3, opt2: 3,
  table: 3, lev: 3,
}
const SPACE_PX = getTextWidth(' ')
/** As wide as '> ' (15 px), so an unselected choice lines up with the selected one. */
const UNMARKED = '   '
/** Main's row mark, and blanks as wide as it (▶ is 20 px, a space 5) */
const ROW_MARK = '▶ '
const ROW_UNMARKED = '     '

/** Cut to `px` with a one-character ellipsis (pretext's pxTruncate adds three dots). */
export function fit(s: string, px: number): string {
  if (getTextWidth(s) <= px) return s
  let t = s
  while (t && getTextWidth(`${t}…`) > px) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}

/** Right-aligned with spaces: the font is proportional, so digits differ in width (0 is 12 px, 1 is 8 px). */
export function alignRight(s: string, px: number): string {
  const t = fit(s, px)
  let r = ' '.repeat(Math.max(0, Math.floor((px - getTextWidth(t)) / SPACE_PX))) + t
  while (getTextWidth(r) > px) r = r.slice(1) // kerning makes the sum a pixel off now and then
  return r
}

const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
const sideWord = (side: Side) => (side === 'Buy' ? 'long' : 'short')
const usdt = (n = 0) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT`
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Closest to liquidation first: the row that needs you is on top. */
export function rankPositions(positions: Position[]): Position[] {
  return [...positions].sort((a, b) => liqDistancePct(a) - liqDistancePct(b) || 0)
}

/** Wrap `focus` into `0…n-1`; 0 when there are no positions. */
export function clampFocus(focus: number | undefined, n: number): number {
  if (n <= 0) return 0
  return ((focus ?? 0) % n + n) % n
}

/** PnL for Detail, "PNL: +$50": tenths under 10, whole dollars from 10, `k` from 10,000 (glasses-shortcuts §4).
 * Coarse on purpose: it is a picture, and cents would resend it on nearly every price tick. */
export function pnlText(n: number): string {
  const a = Math.abs(n), k = a / 1000
  const num = a >= 10_000 ? `${k >= 100 ? Math.round(k).toLocaleString('en-US') : k.toFixed(1)}k`
    : a >= 10 ? Math.round(a).toLocaleString('en-US') : a.toFixed(1)
  return `PNL: ${n < 0 ? '−' : '+'}$${num}`
}

/** The condition behind the alert names its icon; the text says it too. */
const REASON_ICON: Record<ConditionType, IconName> = {
  NEAR_LIQUIDATION: 'warn', LOSS: 'trendDown', NEAR_SL: 'shield', PROFIT: 'trendUp',
  NEAR_TP: 'target', PRICE_CHANGE: 'pulse', PRICE: 'bell', ORDER_FILLED: 'check', ORDER_PARTIAL: 'half',
  VOLUME_SPIKE: 'pulse', FUNDING: 'percent', ORDER_STALE: 'hourglass', POSITION_CLOSED: 'exit',
}
// shortcut: a test alert has no reasonType, so it wears the bell; send the shortcut's first condition type with a test to show its own icon
export const iconOf = (c: Proposal): IconName => (c.reasonType ? REASON_ICON[c.reasonType] : c.voice ? 'mic' : c.manual && c.terms.type === 'order' && c.terms.reduceOnly ? 'exit' : 'bell')

/** Open and Increase add exposure: their action opens Review, never the order (spec §10). */
const grows = (c: Proposal) => c.terms.type === 'order' && !c.terms.reduceOnly
/** Increase acts on an open position; Open needs the symbol flat. */
const heldBy = (s: ServerState, c: Proposal) => {
  const t = c.terms
  if (t.type !== 'order') return undefined
  return s.positions.find(p => p.symbol === t.symbol && p.positionIdx === t.positionIdx && p.size > 0)
}

/** Grouped digits, trailing zeros cut: 0.0500 → 0.05, 81300000 → 81,300,000. */
function plainQty(n: number, decimals: number): string {
  const [i, f = ''] = Math.abs(n).toFixed(Math.max(0, decimals)).split('.')
  const frac = f.replace(/0+$/, '')
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac ? `${int}.${frac}` : int
}

/** Coin quantity for the column `px` wide. Full decimals while they fit, then 81.3k / 1.2M. Never "0" for a real size. */
export function sizeText(n: number, px: number): string {
  if (!(n > 0) || !Number.isFinite(n) || px <= 0) return ''
  const maxDec = n >= 1000 ? 2 : n >= 1 ? 4 : 8
  for (let d = maxDec; d >= 0; d--) {
    const s = plainQty(n, d)
    if (s !== '0' && getTextWidth(s) <= px) return s
  }
  for (const [div, suf] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']] as const) {
    if (n < div) continue
    for (let d = 2; d >= 0; d--) {
      const s = plainQty(n / div, d) + suf
      if (getTextWidth(s) <= px) return s
    }
  }
  return fit(plainQty(n, maxDec), px)
}

/** The position, plainly. A long ticker is cut, never the side. `reservePx` keeps the right of the box for the size. */
function name(p: Position, markPx = 0, reservePx = 0): string {
  const side = sideWord(p.side)
  return `${fit(coin(p.symbol), INNER_PX.name - markPx - reservePx - getTextWidth(` ${side}`))} ${side}`
}

/** Size at the right of the name box, one gap short of the price column. */
function withSize(label: string, sz: string): string {
  if (!sz) return label
  const end = INNER_PX.name - SIZE_GAP
  let spaces = Math.max(1, Math.floor((end - getTextWidth(label) - getTextWidth(sz)) / SPACE_PX))
  while (spaces > 1 && getTextWidth(label + ' '.repeat(spaces) + sz) > end) spaces--
  const line = label + ' '.repeat(spaces) + sz
  return getTextWidth(line) <= INNER_PX.name ? line : fit(line, INNER_PX.name)
}

/** ROI on the position's initial margin, ▲ / ▼ before it; none when Bybit gives no margin. */
function roi(p: Position): string {
  if (!(p.positionIM > 0)) return ''
  const r = (100 * p.unrealisedPnl) / p.positionIM
  const a = Math.abs(r)
  return `${r < 0 ? '▼' : '▲'} ${a >= 1000 ? Math.round(a).toLocaleString('en-US') : a.toFixed(1)}%`
}

/** name (with the size at its right), price, loss, gain, flag: the flag only when the position is in trouble. */
function row(p: Position, on: boolean): string[] {
  const dist = liqDistancePct(p)
  const r = roi(p)
  const cell = r && fit(r, INNER_PX.loss)
  const flag = dist < LIQ_FLAG_PCT ? `liq ${dist.toFixed(1)}%` : ''
  const mark = on ? ROW_MARK : ROW_UNMARKED
  const reserve = SIZE_PX + SIZE_GAP + SPACE_PX
  const label = mark + name(p, getTextWidth(mark), reserve)
  return [withSize(label, sizeText(p.size, SIZE_PX)), fit(price(p.markPrice), INNER_PX.price), r.startsWith('▼') ? cell : '', r.startsWith('▲') ? cell : '', flag && alignRight(flag, INNER_PX.flag)]
}

/** The top line, with the time at its right edge. */
function top(text: string, now?: number): string {
  if (!now) return fit(text, INNER_PX.top)
  const clock = hhmm(now)
  const left = fit(text, INNER_PX.top - getTextWidth(clock) - 3 * SPACE_PX)
  let spaces = Math.floor((INNER_PX.top - getTextWidth(left) - getTextWidth(clock)) / SPACE_PX)
  while (spaces > 1 && getTextWidth(left + ' '.repeat(spaces) + clock) > INNER_PX.top) spaces--
  return left + ' '.repeat(spaces) + clock
}

const pauseLine = (s: ServerState | null, min: number) => (min > 0 ? `Cards paused · ${min} min left${s?.pending ? ` · ${s.pending} waiting` : ''}` : '')

const problemLine = (s: ServerState | null, v: View) =>
  (v.needToken ? 'Server token missing · enter it on the phone' : '') ||
  (v.offline ? 'No connection to your server · retrying' : '') || (!s ? 'Connecting…' : '') ||
  (s?.error ? (s.updatedAt ? `Bybit data stale since ${hhmm(s.updatedAt)} · retrying` : `Bybit: ${s.error}`) : '')

const sourceName = (s: ServerState | null) =>
  s?.source === 'Demo data' || s?.source === 'Bybit demo' ? 'Bybit Demo' : s?.source || 'Bybit'

function quiet(s: ServerState | null, v: View): Screen {
  const toast = v.offline || v.needToken ? null : s?.toast
  const status = v.voice || toast || ''
  return { layout: 'quiet', key: 'quiet', icon: '', choices: [], at: 0, card: null,
    toastAlertId: toast && !v.voice ? s?.toastAlertId : undefined,
    text: { top: fit(status, INNER_PX.top) },
    tone: { top: 4 },
  }
}

function main(s: ServerState | null, v: View): Screen {
  const pausedMin = v.pausedMin ?? 0
  const live = s && !v.offline && !v.needToken ? s : null
  const ranked = live ? rankPositions(live.positions) : []
  const n = ranked.length
  const focus = clampFocus(v.focus, n)
  const override = v.voice || problemLine(s, v)
  const problem = override || s?.toast || pauseLine(s, pausedMin)
  const source = sourceName(s)
  const head = problem || `${source} · ${n ? `${n} position${n === 1 ? '' : 's'}` : 'no open positions'}`
  const text: Record<string, string> = { top: top(head, v.now), name: '', cur: '', price: '', loss: '', gain: '', flag: '', hint: '' }
  // A pause is a state you chose, not news: it stays at ordinary brightness for its 15 minutes.
  const tone: Record<string, number> = { ...TONE, top: problem && problem !== pauseLine(s, pausedMin) ? 4 : 3 }
  if (live) {
    // More than fit: pages of ROWS - 1, and the last row says where you are.
    const paged = ranked.length > ROWS
    const per = paged ? ROWS - 1 : ROWS
    const from = paged ? Math.floor(focus / per) * per : 0
    const slice = ranked.slice(from, from + per)
    const rows = slice.map((p, i) => row(p, from + i === focus))
    if (paged) rows.push([`▼ ${from + 1}–${from + slice.length} of ${ranked.length}`, '', '', '', ''])
    ;(['name', 'price', 'loss', 'gain', 'flag'] as const).forEach((box, i) => { text[box] = rows.map(r => r[i]).join('\n').trimEnd() })
    // The selected name moves to `cur`, drawn brighter on top of the same column
    const sel = focus - from
    text.cur = rows.map((r, i) => (i === sel ? r[0] : '')).join('\n').trimEnd()
    text.name = rows.map((r, i) => (i === sel ? '' : r[0])).join('\n').trimEnd()
    if (live.error) for (const box of ['name', 'cur', 'price', 'loss', 'gain', 'flag']) tone[box] = 2 // stale numbers step back; the top line says since when
  }
  // Hold opens the menu. It does not close by itself, so the line says menu. It stays visible with a position
  // listed, because Close position is the first item there. No "swipe: choose": ▶ already shows the move.
  const tips = v.hints && live
  text.hint = fit([
    tips && n ? 'tap: details' : '',
    (live && n) || (tips && !n) ? 'tap, hold: menu' : '',
    v.quiet ? 'double tap: back' : 'double tap: exit',
  ].filter(Boolean).join(' · '), INNER_PX.hint)
  return { layout: 'main', key: 'main', text, tone, icon: '', choices: [], at: 0, card: null, toastAlertId: override ? undefined : live?.toastAlertId }
}

/** Signed distance from the mark price to a level, as `−1.9%` / `+3.3%`. */
function away(level: number, mark: number, dp: number): string {
  const d = (100 * (level - mark)) / mark
  const t = Math.abs(d).toFixed(dp)
  return Number(t) === 0 ? '0%' : `${d < 0 ? '−' : '+'}${t}%`
}

/** Size and leverage under the coin: "0.05 BTC · 10×". A long ticker drops before the quantity does; the title already names the coin. */
function levLine(p: Position): string {
  const lev = `${p.leverage}×`
  const full = sizeText(p.size, Infinity)
  const withCoin = `${full} ${coin(p.symbol)} · ${lev}`
  if (full && getTextWidth(withCoin) <= INNER_PX.lev) return withCoin
  const bare = `${full} · ${lev}`
  if (full && getTextWidth(bare) <= INNER_PX.lev) return bare
  const tail = ` · ${lev}`
  const sz = sizeText(p.size, INNER_PX.lev - getTextWidth(tail))
  return sz ? fit(sz + tail, INNER_PX.lev) : fit(lev, INNER_PX.lev)
}

/**
 * Coin and side big top left and PnL as big top right (pictures: the font has one size), size and leverage under the
 * coin, the stop and liquidation distances under PnL; the last hour across the bottom (glasses-shortcuts §4).
 */
function detail(p: Position, at: number, total: number, v: View): Screen {
  // Under 1% a tenth hides what matters; both distances then take two decimals, so the line reads evenly.
  const dp = [p.stopLoss, p.liqPrice].some(v => v > 0 && Math.abs(v - p.markPrice) / p.markPrice < 0.01) ? 2 : 1
  const stop = p.stopLoss ? `stop ${away(p.stopLoss, p.markPrice, dp)}` : ''
  const liq = p.liqPrice > 0 ? `liq ${away(p.liqPrice, p.markPrice, dp)}` : ''
  const table = [stop, liq].filter(Boolean).join(' · ')
  const width = INNER_PX.hint - (total > 1 && !v.voice ? 60 : 0)
  const gesture = [total > 1 && v.hints ? 'swipe: next position' : '', 'tap: close', 'double tap: back'].filter(Boolean).join(' · ')
  const hint = fit(v.voice || gesture, width)
  const place = total > 1 && !v.voice ? `${at + 1}/${total}` : ''
  return {
    layout: 'detail', key: 'detail', text: {
      lev: levLine(p), table: fit(table, INNER_PX.table),
      hint: place ? hint + ' '.repeat(Math.floor((INNER_PX.hint - getTextWidth(hint) - getTextWidth(place)) / SPACE_PX)) + place : hint,
    }, tone: { ...TONE }, icon: '', choices: [], at: 0, card: null,
    title: `${coin(p.symbol)} ${sideWord(p.side)}`,
    pnl: pnlText(p.unrealisedPnl),
    chart: { symbol: p.symbol, entry: p.entryPrice, stop: p.stopLoss, tp: p.takeProfit, liq: p.liqPrice },
  }
}

/** The framed pages: `head` is the text inside the frame, `labels` go in opt1 and opt2 with `>` on one. */
/** What a tap does on the choice under `>`, said in the hint line. */
const TAP: Record<Choice, string> = { dismiss: 'tap: dismiss', confirm: 'tap: confirm', ok: 'tap: OK', review: 'tap: review', close: 'tap: close', pick: 'tap: pick', 'ack-glasses-test': 'tap: OK' }

function framed(o: { layout: 'alert' | 'review'; key: string; head: Record<string, string>; labels: string[]; choices: Choice[]; icon: IconName; card: Proposal | null; hint: (at: number) => string }, v: View): Screen {
  const at = v.cursor?.key === o.key ? Math.min(v.cursor.at, o.labels.length - 1) : 0 // Dismiss first: a stray tap must not trade
  const text: Record<string, string> = { frame: '', opt1: '', opt2: '', hint: fit(v.voice || o.hint(at), INNER_PX.hint) } // the mic bar, a countdown or a voice note
  for (const [box, t] of Object.entries(o.head)) text[box] = t.split('\n').map(l => (box === 'queue' ? l && alignRight(l, INNER_PX.queue) : fit(l, INNER_PX[box]))).join('\n')
  const tone: Record<string, number> = { ...TONE, queue: o.head.queue === 'TEST' || o.head.queue === 'NEW' ? 4 : TONE.queue } // a warning, not a counter
  // Two rows show; a longer list (an Open's picks) scrolls with `>`
  const from = Math.max(0, Math.min(at - 1, o.labels.length - 2))
  o.labels.slice(from, from + 2).forEach((l, j) => {
    text[`opt${j + 1}`] = fit(`${from + j === at ? '> ' : UNMARKED}${l}`, INNER_PX.opt1)
    tone[`opt${j + 1}`] = from + j === at ? 4 : 3
  })
  return { layout: o.layout, key: o.key, text, tone, icon: o.icon, choices: o.choices, at, card: o.card }
}

/** The server's reason in the lens's words (glasses-shortcuts §5): "stop", never "stop loss". */
export function lensWhy(why: string): string {
  return sentence(why
    .replace(/^liquidation distance (.+%)$/i, '$1 to liquidation')
    .replace(/^stop loss distance (.+%)$/i, '$1 to stop')
    .replace(/^take profit distance (.+%)$/i, '$1 to take profit')
    .replace(/stop loss/gi, 'stop'))
}

function alert(s: ServerState, c: Proposal, v: View): Screen {
  const t = c.terms
  if (t.type === 'notify') {
    return framed({
      layout: 'alert', key: `alert:${c.id}`, card: c, icon: iconOf(c),
      head: { who: c.who, why: lensWhy(c.why), queue: c.simulated ? 'TEST' : c.supersedes ? 'NEW' : s.pending > 1 ? `1/${s.pending}` : '' },
      labels: ['OK'], choices: ['ok'], hint: () => TAP.ok,
    }, v)
  }
  // Stale exchange data: the server cannot check the terms, so only Dismiss is offered.
  // With picks the size is not chosen yet, so the label names none
  const action = s.error ? [] : [t.type === 'order' && grows(c) ? `Review ${heldBy(s, c) ? 'add' : sideWord(t.side)}${c.picks ? '' : ` · ${usdt(t.notionalUsdt)}`}` : c.question.replace(/\?$/, '')]
  return framed({
    layout: 'alert', key: `alert:${c.id}`, card: c, icon: s.error ? 'hourglass' : iconOf(c),
    head: { who: c.who, why: s.error ? 'Bybit data is stale' : lensWhy(c.why), queue: c.simulated ? 'TEST' : c.supersedes ? 'NEW' : s.pending > 1 ? `1/${s.pending}` : '' },
    labels: ['Dismiss', ...action], choices: ['dismiss', ...(action.length ? [grows(c) ? 'review' as const : 'confirm' as const] : [])],
    hint: at => (action.length ? `swipe: choose · ${TAP[at ? (grows(c) ? 'review' : 'confirm') : 'dismiss']}` : 'tap: dismiss'),
  }, v)
}

function review(s: ServerState, c: Proposal & { terms: { type: 'order' } }, v: View): Screen {
  const t = c.terms
  const qty = `${t.qty} ${coin(t.symbol)}`
  const held = heldBy(s, c)
  const head = held
    ? { ask: `Add to ${coin(t.symbol)} ${sideWord(t.side)}?`, terms: `${qty} · ${usdt(t.notionalUsdt)}${held.stopLoss ? `\nStop ${price(held.stopLoss)} stays` : ''}` }
    : { ask: `Open ${coin(t.symbol)} ${sideWord(t.side)}?`, terms: `${qty} · ${usdt(t.notionalUsdt)} · ${t.leverage}×\nMargin ≈ ${usdt(t.marginUsdt)}${t.stopLoss ? ` · stop ${price(t.stopLoss)}` : ''}` }
  return framed({
    layout: 'review', key: `review:${c.id}`, card: c, icon: 'grow', head,
    labels: ['Dismiss', held ? `Add · ${qty}` : `Open ${sideWord(t.side)} · ${qty}`], choices: ['dismiss', 'confirm'],
    hint: at => `swipe: choose · ${TAP[at ? 'confirm' : 'dismiss']} · double tap: back`,
  }, v)
}

/**
 * An Open with picks, before its Review: the size page, then the leverage page (a list of one is skipped). The tap on the
 * last one sends the pick; the server answers with the proposal Review shows.
 */
function picker(c: Proposal & { terms: { type: 'order' }; picks: NonNullable<Proposal['picks']> }, v: View): Screen {
  const { sizes, leverages } = c.picks
  const size = v.pick?.id === c.id ? v.pick.size : sizes.length === 1 ? sizes[0] : undefined
  const step = size === undefined ? 'size' : 'leverage'
  const key = `pick:${c.id}:${step}`
  const values = step === 'size' ? sizes : leverages
  const at = v.cursor?.key === key ? Math.min(v.cursor.at, values.length - 1) : 0
  const what = `${coin(c.terms.symbol)} ${sideWord(c.terms.side)}`
  const head = step === 'size'
    ? { ask: `Open ${what} · size?`, terms: leverages.length > 1 ? 'Leverage next' : `${leverages[0]}× · margin ≈ ${usdt(sizes[at] / leverages[0])}` }
    : { ask: `Open ${what} · leverage?`, terms: `Size ${usdt(size)}\nMargin ≈ ${usdt(size! / values[at])}` }
  const place = `${at + 1}/${values.length}`
  return framed({
    layout: 'review', key, card: c, icon: 'grow', head,
    labels: values.map(x => (step === 'size' ? usdt(x) : `${x}×`)), choices: values.map(() => 'pick' as const),
    hint: () => `swipe: choose · tap: pick · double tap: back · ${place}`,
  }, { ...v, cursor: { key, at } })
}

/** The icon, the line and the one choice of a result; no choice while it waits for Bybit. Results come from executions only. */
function told(o: Outcome): [IconName, string, string?] {
  if (o.expired) return ['hourglass', 'Expired · nothing sent', 'Dismiss']
  if (o.lost) return ['question', 'No reply from the server · check Bybit', 'OK'] // it may have gone through: never "not sent"
  if (o.message !== undefined) return ['hourglass', o.message, 'OK']
  const e = o.execution
  if (!e) return ['clock', 'Sent']
  const t = e.terms
  if (t.type === 'notify') return ['bell', 'Nothing to send', 'OK']
  const coinName = coin(t.symbol)
  switch (e.status) {
    case 'AUTHORIZED': case 'VALIDATING': case 'SUBMITTING': return ['clock', 'Sent']
    case 'ACKNOWLEDGED': return ['clock', 'Sent · waiting for the fill']
    case 'FILLED': return ['check', `${t.type === 'order' && t.reduceOnly ? 'Closed' : 'Filled'} ${e.filledQty} ${coinName} · avg ${price(e.avgPrice)}`, 'OK']
    case 'PARTIALLY_FILLED': return ['half', `Partly filled · ${e.filledQty} of ${t.type === 'order' ? t.qty : '?'} ${coinName}`, 'OK']
    case 'PARTIALLY_FILLED_CANCELLED': return ['half', `Filled ${e.filledQty} of ${t.type === 'order' ? t.qty : '?'} ${coinName}${e.avgPrice > 0 ? ` · avg ${price(e.avgPrice)}` : ''}`, 'OK']
    case 'APPLIED': return ['check', t.type === 'setStop' ? `Stop at ${price(t.price)}` : t.type === 'setTakeProfit' ? `Take profit at ${price(t.price)}`
      : t.type === 'addMargin' ? `Added ${usdt(t.usd)} margin` : 'Order cancelled', 'OK']
    case 'REJECTED': return ['reject', 'Rejected by Bybit', 'OK'] // the reason goes on the row under OK
    case 'UNKNOWN': return ['question', 'No answer from Bybit yet', 'OK'] // the server reconciles, never retries
    case 'SIMULATED': return [iconOf(o.card), 'Test only · nothing was sent', 'OK']
  }
}

function result(o: Outcome, v: View): Screen {
  const [icon, why, label] = told(o)
  const e = o.execution
  // What changed on the position (a receipt, a poll later) or why Bybit refused is part of the result, so it goes in the frame:
  // the taller review frame takes it as a second line. Under the frame there are only choices.
  const extra = e?.status === 'REJECTED' ? e.message : label ? e?.receipt : ''
  const rest = {
    key: `alert:${o.card.id}`, card: null, icon,
    labels: label ? [label] : [], choices: label ? ['close' as const] : [],
    hint: () => (label ? `tap: ${label === 'OK' ? label : label.toLowerCase()}` : 'waiting for Bybit · double tap: hide'),
  }
  if (e?.status === 'PARTIALLY_FILLED_CANCELLED') return framed({ ...rest, layout: 'review',
    head: { ask: 'Remainder cancelled', terms: [why, extra].filter(Boolean).join('\n') } }, v)
  return extra
    ? framed({ ...rest, layout: 'review', head: { ask: o.card.who, terms: `${why}\n${extra}` } }, v)
    : framed({ ...rest, layout: 'alert', head: { who: o.card.who, why, queue: '' } }, v)
}

/**
 * An unanswered card stays on the lens only when the queue is empty.
 * A newer card is the alert coming back, so the expired screen must not cover it.
 */
export function keepExpired(
  was: { id: string; expiresAt: number } | null | undefined,
  next: { id: string } | null | undefined,
  updatedAt: number,
  slack: number,
  hiddenId: string,
): boolean {
  if (!was || was.id === hiddenId || next) return false
  return was.expiresAt <= updatedAt + slack
}

/** The whole glasses screen. Pure, so it is tested without the SDK. */
export function screen(s: ServerState | null, v: View = {}): Screen {
  // An alert that cannot be answered (server down, token refused) is not drawn: a tap on it would go nowhere.
  const live = s && !v.offline && !v.needToken ? s : null
  if (live && v.outcome) return result(v.outcome, v)
  const c = live && !((v.pausedMin ?? 0) > 0) && live.card?.id !== v.hide ? live.card : null
  if (live && c && v.review === c.id && c.terms.type === 'order' && grows(c)) {
    const order = c as Proposal & { terms: { type: 'order' } }
    return c.picks ? picker({ ...order, picks: c.picks }, v) : review(live, order, v)
  }
  if (live && c) return alert(live, c, v)
  if (live?.glassesTestId) return framed({
    layout: 'alert', key: `glasses-test:${live.glassesTestId}`, card: null, icon: 'bell',
    head: { who: 'Connection check', why: 'Tap OK to confirm you see this', queue: 'TEST' },
    labels: ['OK'], choices: ['ack-glasses-test'], hint: () => TAP['ack-glasses-test'],
  }, { ...v, voice: '' })
  if (live && v.detail) {
    const ranked = rankPositions(live.positions)
    const focus = clampFocus(v.focus, ranked.length)
    const p = ranked[focus]
    if (p) return detail(p, focus, ranked.length, v)
  }
  if (v.quiet && !v.positionsOpen) return quiet(s, v)
  return main(s, v)
}

/** The same screen as plain lines, for the phone page. */
export function previewText(sc: Screen): string {
  const t = sc.text
  if (sc.layout === 'quiet') return t.top
  if (sc.layout === 'detail') {
    return [[sc.title, sc.pnl].filter(Boolean).join('   '), [t.lev, t.table].filter(Boolean).join('   '), '', t.hint].filter((l, i, a) => l || a[i - 1]).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  }
  if (sc.layout !== 'main') {
    const head = sc.layout === 'review' ? [t.ask, ...t.terms.split('\n')] : [[t.who, t.queue.trim()].filter(Boolean).join('   '), t.why]
    return [...head, '', t.opt1, t.opt2, '', t.hint].join('\n').replace(/\n{3,}/g, '\n\n').trim()
  }
  const cur = t.cur.split('\n')
  const cols = ['name', 'price', 'loss', 'gain', 'flag'].map(b => t[b].split('\n'))
  cols[0] = cols[0].map((l, i) => cur[i] || l)
  for (let i = cols[0].length; i < cur.length; i++) cols[0][i] = cur[i]
  const rows = cols[0].map((_, i) => cols.map(c => (c[i] ?? '').trim()).filter(Boolean).join('  ')).filter(Boolean)
  return [t.top.replace(/ {2,}/, '   '), ...rows, ...(t.hint ? ['', t.hint] : [])].join('\n')
}
