import type { Execution, Position, Proposal, ServerState, Side } from '../../server/src/types.ts'
import type { ConditionType } from '../../server/src/registry.ts'
import { coin, price } from '../../server/src/format.ts'
import { liqDistancePct } from '../../server/src/rules.ts'
import { getTextWidth } from '@evenrealities/pretext'
import type { IconName } from './icons.ts'

/** Which boxes main.ts LAYOUTS puts on the lens (docs/glasses-shortcuts.md §4). */
export type Layout = 'main' | 'alert' | 'review'
/** What a tap on opt1 / opt2 does: dismiss the proposal, confirm it, open its Review, or close a result. */
export type Choice = 'dismiss' | 'confirm' | 'review' | 'close'

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
  /** The 48 px icon in the frame, '' on Main */
  icon: IconName | ''
  /** What a tap does on opt1, opt2; none while waiting for Bybit */
  choices: Choice[]
  /** The choice that carries `>` */
  at: number
  /** The alert or Review on the lens (not a result): the proposal a tap answers */
  card: Proposal | null
}

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
  /** Table page, moved by a swipe when there are more positions than rows */
  page?: number
  /** The server answered 401, so the phone page still needs the token */
  needToken?: boolean
  /** The gesture line on Main. Shown for a moment after launch: it teaches, then gets out of the way. */
  hints?: boolean
  /** Phone clock for the time in the top line; none in tests */
  now?: number
  outcome?: Outcome
  /** Id of the card whose Review is open */
  review?: string
  /** Id of a card being dismissed: gone from the lens before the server says so */
  hide?: string
  /** Where a swipe put `>`, on the page with this key */
  cursor?: { key: string; at: number }
}

export const ROWS = 5
/** "liq 5.9%" shows in the flag column below this distance. */
const LIQ_FLAG_PCT = 10
/** Inner width of each box in main.ts LAYOUTS: its width minus 2 × 2 px padding. */
export const INNER_PX: Record<string, number> = {
  top: 540, name: 140, price: 124, loss: 100, gain: 100, flag: 164, hint: 540,
  who: 380, why: 380, queue: 68, ask: 452, terms: 452, opt1: 540, opt2: 540,
}
/** Brightness of each box unless a state says otherwise (§4). */
const TONE: Record<string, number> = {
  top: 3, name: 3, price: 3, loss: 4, gain: 3, flag: 4, hint: 2,
  frame: 3, who: 4, why: 3, queue: 2, ask: 4, terms: 3, opt1: 3, opt2: 3,
}
const SPACE_PX = getTextWidth(' ')
/** As wide as '> ' (15 px), so an unselected choice lines up with the selected one. */
const UNMARKED = '   '

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

/** The condition behind the alert names its icon; the text says it too. */
const REASON_ICON: Record<ConditionType, IconName> = {
  NEAR_LIQUIDATION: 'warn', LOSS: 'trendDown', SL_MISSING: 'shieldOff', NEAR_SL: 'shield', PROFIT: 'trendUp',
  NEAR_TP: 'target', PRICE_CHANGE: 'pulse', PRICE: 'bell', ORDER_FILLED: 'check', ORDER_PARTIAL: 'half',
}
// shortcut: a test alert has no reasonType, so it wears the bell; send the shortcut's first condition type with a test to show its own icon
export const iconOf = (c: Proposal): IconName => (c.reasonType ? REASON_ICON[c.reasonType] : c.voice ? 'mic' : 'bell')

/** Open and Increase add exposure: their action opens Review, never the order (spec §10). */
const grows = (c: Proposal) => c.terms.type === 'order' && !c.terms.reduceOnly
/** Increase acts on an open position; Open needs the symbol flat. */
const heldBy = (s: ServerState, c: Proposal) =>
  s.positions.find(p => p.symbol === c.terms.symbol && c.terms.type === 'order' && p.positionIdx === c.terms.positionIdx && p.size > 0)

/** The position, plainly. A long ticker is cut, never the side. */
function name(p: Position): string {
  const side = sideWord(p.side)
  return `${fit(coin(p.symbol), INNER_PX.name - getTextWidth(` ${side}`))} ${side}`
}

/** ROI on the position's initial margin, ▲ / ▼ before it; none when Bybit gives no margin. */
function roi(p: Position): string {
  if (!(p.positionIM > 0)) return ''
  const r = (100 * p.unrealisedPnl) / p.positionIM
  const a = Math.abs(r)
  return `${r < 0 ? '▼' : '▲'} ${a >= 1000 ? Math.round(a).toLocaleString('en-US') : a.toFixed(1)}%`
}

/** name, price, loss, gain, flag: the flag only when the position is in trouble. */
function row(p: Position): string[] {
  const dist = liqDistancePct(p)
  const r = roi(p)
  const cell = r && alignRight(r, INNER_PX.loss)
  const flag = dist < LIQ_FLAG_PCT ? `liq ${dist.toFixed(1)}%` : p.stopLoss ? '' : 'no stop'
  return [name(p), alignRight(price(p.markPrice), INNER_PX.price), r.startsWith('▼') ? cell : '', r.startsWith('▲') ? cell : '', flag && alignRight(flag, INNER_PX.flag)]
}

/** The top line, with the time at its right edge. */
function top(text: string, now?: number): string {
  if (!now) return fit(text, INNER_PX.top)
  const clock = hhmm(now)
  const left = fit(text, INNER_PX.top - getTextWidth(clock) - 3 * SPACE_PX)
  return left + ' '.repeat(Math.floor((INNER_PX.top - getTextWidth(left) - getTextWidth(clock)) / SPACE_PX)) + clock
}

function main(s: ServerState | null, v: View): Screen {
  const pausedMin = v.pausedMin ?? 0
  const live = s && !v.offline && !v.needToken ? s : null
  const n = s?.positions.length ?? 0
  const problem = v.voice || (v.needToken ? 'Server token missing · enter it on the phone' : '') ||
    (v.offline ? 'No connection to your server · retrying' : '') || (!s ? 'Connecting…' : '') ||
    (s?.error ? (s.updatedAt ? `Bybit data stale since ${hhmm(s.updatedAt)} · retrying` : `Bybit: ${s.error}`) : '') ||
    s?.toast || (pausedMin > 0 ? `Cards paused · ${pausedMin} min left${s?.pending ? ` · ${s.pending} waiting` : ''}` : '')
  const head = problem || `${s?.source || 'Bybit'} · ${n ? `${n} position${n === 1 ? '' : 's'}` : 'no open positions'}`
  const text: Record<string, string> = { top: top(head, v.now), name: '', price: '', loss: '', gain: '', flag: '', hint: '' }
  const tone: Record<string, number> = { ...TONE, top: problem ? 4 : 3 }
  if (live) {
    // Closest to liquidation first: the row that needs you is on top.
    const sorted = [...live.positions].sort((a, b) => liqDistancePct(a) - liqDistancePct(b) || 0)
    // More than fit: pages of ROWS - 1, and the last row says where you are.
    const paged = sorted.length > ROWS
    const per = paged ? ROWS - 1 : ROWS
    const pages = Math.ceil(sorted.length / per)
    const from = paged ? ((((v.page ?? 0) % pages) + pages) % pages) * per : 0 // wraps past either end
    const rows = sorted.slice(from, from + per).map(row)
    if (paged) rows.push([`${from + 1}–${from + rows.length} of ${sorted.length}`, '', '', '', ''])
    ;(['name', 'price', 'loss', 'gain', 'flag'] as const).forEach((box, i) => { text[box] = rows.map(r => r[i]).join('\n').trimEnd() })
    if (live.error) for (const box of ['name', 'price', 'loss', 'gain', 'flag']) tone[box] = 2 // stale numbers step back; the top line says since when
    if (v.hints) {
      // no speech key on the server: do not invite a tap that ends in an error
      text.hint = [...(n > ROWS ? ['swipe: more'] : []), ...(live.voice === false ? [] : ['tap: speak']), 'double tap: exit', 'tap, hold: menu'].join(' · ')
    }
  }
  return { layout: 'main', key: 'main', text, tone, icon: '', choices: [], at: 0, card: null }
}

/** The framed pages: `head` is the text inside the frame, `labels` go in opt1 and opt2 with `>` on one. */
function framed(o: { layout: 'alert' | 'review'; key: string; head: Record<string, string>; labels: string[]; choices: Choice[]; icon: IconName; card: Proposal | null; hint: string }, v: View): Screen {
  const at = v.cursor?.key === o.key ? Math.min(v.cursor.at, o.labels.length - 1) : 0 // Dismiss first: a stray tap must not trade
  const text: Record<string, string> = { frame: '', opt1: '', opt2: '', hint: fit(o.hint, INNER_PX.hint) }
  for (const [box, t] of Object.entries(o.head)) text[box] = t.split('\n').map(l => (box === 'queue' ? l && alignRight(l, INNER_PX.queue) : fit(l, INNER_PX[box]))).join('\n')
  const tone = { ...TONE }
  o.labels.forEach((l, i) => {
    text[`opt${i + 1}`] = fit(`${i === at ? '> ' : UNMARKED}${l}`, INNER_PX.opt1)
    tone[`opt${i + 1}`] = i === at ? 4 : 3
  })
  return { layout: o.layout, key: o.key, text, tone, icon: o.icon, choices: o.choices, at, card: o.card }
}

function alert(s: ServerState, c: Proposal, v: View): Screen {
  const t = c.terms
  // Stale exchange data: the server cannot check the terms, so only Dismiss is offered.
  const action = s.error ? [] : [t.type === 'order' && grows(c) ? `Review ${heldBy(s, c) ? 'add' : sideWord(t.side)} · ${usdt(t.notionalUsdt)}` : c.question.replace(/\?$/, '')]
  return framed({
    layout: 'alert', key: `alert:${c.id}`, card: c, icon: s.error ? 'hourglass' : iconOf(c),
    head: { who: c.who, why: s.error ? 'Bybit data is stale' : sentence(c.why), queue: c.simulated ? 'TEST' : c.supersedes ? 'NEW' : s.pending > 1 ? `1/${s.pending}` : '' },
    labels: ['Dismiss', ...action], choices: ['dismiss', ...(action.length ? [grows(c) ? 'review' as const : 'confirm' as const] : [])],
    hint: action.length ? 'swipe: choose · tap: confirm' : 'tap: dismiss',
  }, v)
}

function review(s: ServerState, c: Proposal & { terms: { type: 'order' } }, v: View): Screen {
  const t = c.terms
  const qty = `${t.qty} ${coin(t.symbol)}`
  const held = heldBy(s, c)
  const head = held
    ? { ask: `Add to ${coin(t.symbol)} ${sideWord(t.side)}?`, terms: `${qty} · ${usdt(t.notionalUsdt)}\nStop ${price(held.stopLoss)} stays` }
    : { ask: `Open ${coin(t.symbol)} ${sideWord(t.side)}?`, terms: `${qty} · ${usdt(t.notionalUsdt)} · ${t.leverage}×\nMargin ≈ ${usdt(t.marginUsdt)} · ${t.stopLoss ? `stop ${price(t.stopLoss)}` : 'no stop'}` }
  return framed({
    layout: 'review', key: `review:${c.id}`, card: c, icon: 'grow', head,
    labels: ['Dismiss', held ? `Add · ${qty}` : `Open ${sideWord(t.side)} · ${qty}`], choices: ['dismiss', 'confirm'],
    hint: 'swipe: choose · tap: confirm · double tap: back',
  }, v)
}

/** The icon, the line and the one choice of a result; no choice while it waits for Bybit. Results come from executions only. */
function told(o: Outcome): [IconName, string, string?] {
  if (o.expired) return ['hourglass', 'Expired · nothing sent', 'Dismiss']
  if (o.lost) return ['question', 'No reply from the server · check Bybit', 'OK'] // it may have gone through: never "not sent"
  if (o.message !== undefined) return ['hourglass', o.message, 'OK']
  const e = o.execution
  if (!e) return ['clock', 'Sent']
  const t = e.terms
  const coinName = coin(t.symbol)
  switch (e.status) {
    case 'AUTHORIZED': case 'VALIDATING': case 'SUBMITTING': return ['clock', 'Sent']
    case 'ACKNOWLEDGED': return ['clock', 'Sent · waiting for the fill']
    case 'FILLED': return ['check', `${t.type === 'order' && t.reduceOnly ? 'Closed' : 'Filled'} ${e.filledQty} ${coinName} · avg ${price(e.avgPrice)}`, 'OK']
    case 'PARTIALLY_FILLED': return ['half', `Partly filled · ${e.filledQty} of ${t.type === 'order' ? t.qty : '?'} ${coinName}`, 'OK']
    case 'APPLIED': return ['check', t.type === 'setStop' ? `Stop at ${price(t.price)}` : t.type === 'setTakeProfit' ? `Take profit at ${price(t.price)}`
      : t.type === 'addMargin' ? `Added ${usdt(t.usd)} margin` : 'Order cancelled', 'OK']
    case 'REJECTED': return ['reject', `Rejected: ${e.message}`, 'OK']
    case 'UNKNOWN': return ['question', 'No answer from Bybit yet', 'OK'] // the server reconciles, never retries
    case 'SIMULATED': return [iconOf(o.card), 'Test only · nothing was sent', 'OK']
  }
}

function result(o: Outcome, v: View): Screen {
  const [icon, why, label] = told(o)
  return framed({
    layout: 'alert', key: `alert:${o.card.id}`, card: null, icon, head: { who: o.card.who, why, queue: '' },
    labels: label ? [label] : [], choices: label ? ['close'] : [],
    hint: label ? `tap: ${label === 'OK' ? label : label.toLowerCase()}` : 'waiting for Bybit…',
  }, v)
}

/** The whole glasses screen. Pure, so it is tested without the SDK. */
export function screen(s: ServerState | null, v: View = {}): Screen {
  // An alert that cannot be answered (server down, token refused) is not drawn: a tap on it would go nowhere.
  const live = s && !v.offline && !v.needToken ? s : null
  if (live && v.outcome) return result(v.outcome, v)
  const c = live && !((v.pausedMin ?? 0) > 0) && live.card?.id !== v.hide ? live.card : null
  if (live && c) return v.review === c.id && c.terms.type === 'order' && grows(c) ? review(live, c as Proposal & { terms: { type: 'order' } }, v) : alert(live, c, v)
  return main(s, v)
}

/** The same screen as plain lines, for the phone page. */
export function previewText(sc: Screen): string {
  const t = sc.text
  if (sc.layout !== 'main') {
    const head = sc.layout === 'review' ? [t.ask, ...t.terms.split('\n')] : [[t.who, t.queue.trim()].filter(Boolean).join('   '), t.why]
    return [...head, '', t.opt1, t.opt2, '', t.hint].join('\n').replace(/\n{3,}/g, '\n\n').trim()
  }
  const cols = ['name', 'price', 'loss', 'gain', 'flag'].map(b => t[b].split('\n'))
  const rows = cols[0].map((_, i) => cols.map(c => (c[i] ?? '').trim()).filter(Boolean).join('  ')).filter(Boolean)
  return [t.top.replace(/ {2,}/, '   '), ...rows, ...(t.hint ? ['', t.hint] : [])].join('\n')
}
