import type { Position, ServerState } from '../../server/src/types.ts'
import { coin, dollars, money, price, usd } from '../../server/src/format.ts'
import { liqDistancePct } from '../../server/src/rules.ts'
import { getTextWidth, pxTruncate } from '@evenrealities/pretext'
import type { IconName } from './icons.ts'

export { money, price }

/**
 * Text for each glasses container. Table columns are separate containers, so rows line up
 * even though the firmware font is proportional.
 */
export interface Screen {
  head: string
  /** Name, PnL, liquidation, stop: one line per position */
  cols: [string, string, string, string]
  /** Full-width body: the card's detail, or a message instead of the table */
  main: string
  /** Card choices for the native list. Skip first: the firmware highlights item 0 on every rebuild. */
  items: string[]
  /** Bottom edge: message (up to two lines), then the gesture hint */
  foot: string
  /** The card's icon, '' with no card */
  icon: IconName | ''
  /** Boxes drawn at low brightness: what supports the main line, never a warning */
  dim: string[]
}

export const ROWS = 5
const BAR = 10 // ━ and ─ are ~21 px each on the lens
// shortcut: line budget in characters, from the ~10 px average of the simulator font; table cells are measured in px below
const LINE = 44
/** Inner width of each column box in main.ts BOXES (width minus 2 × 2 px padding). PnL stops 10 px short, a gap before liq. */
const CELL_PX = [136, 126, 116, 140] as const
const SPACE_PX = getTextWidth(' ')
/** Inner width of the full-width boxes (544 - 2 × 2 px padding) and of a list item (360 - 2 × 4 px). */
const WIDE_PX = 540
const ITEM_PX = 352
/** Inner width of a card's title and detail, right of its icon (main.ts CARD_BOXES). */
const CARD_PX = 480
/** Time left to answer a card, in ━ and ─: long enough to read at a glance, short enough to stay quiet. */
const CLOCK = 12

/** Right-aligned with spaces: the font is proportional, so digits differ in width (0 is 12 px, 1 is 8 px). */
export function alignRight(s: string, px: number): string {
  const t = pxTruncate(s, px)
  return ' '.repeat(Math.max(0, Math.floor((px - getTextWidth(t)) / SPACE_PX))) + t
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s)

/** Whole dollars from $10,000 up, so a cell never wraps. */
const cell = (n: number) => (Math.abs(n) >= 10_000 ? `${n < 0 ? '-' : '+'}${usd(Math.round(Math.abs(n)))}` : money(n))

/** Day loss as a share of the limit: ━━━─────── */
export function lossBar(dayPnl: number, limit: number): string {
  const n = limit > 0 ? Math.min(BAR, Math.round((Math.max(0, -dayPnl) / limit) * BAR)) : 0
  return '━'.repeat(n) + '─'.repeat(BAR - n)
}

/** Like Even's own stock widget: direction arrow, ticker, then the side in words. A long ticker is cut, never the side. */
function name(p: Position): string {
  const arrow = p.unrealisedPnl >= 0 ? '↗' : '↘'
  const side = p.side === 'Buy' ? 'long' : 'short'
  return `${arrow} ${pxTruncate(coin(p.symbol), CELL_PX[0] - getTextWidth(`${arrow}  ${side}`))} ${side}`
}

function row(p: Position): string[] {
  const dist = liqDistancePct(p)
  return [
    name(p),
    alignRight(cell(p.unrealisedPnl), CELL_PX[1]),
    pxTruncate(Number.isFinite(dist) ? `liq ${dist.toFixed(1)}%` : '', CELL_PX[2]),
    pxTruncate(p.stopLoss ? `stop ${price(p.stopLoss)}` : '▲ no stop', CELL_PX[3]),
  ]
}

/** Which of your own rules raised a card: shown under it, so it reads as your rule firing, not advice. */
function ruleLine(key: string): string {
  const kind = key.split(':')[0]
  return kind === 'liq' ? 'Your rule: warn near liquidation'
    : kind === 'lock' ? 'Your rule: lock profit at entry'
    : kind === 'nostop' ? 'Your rule: every position gets a stop'
    : kind === 'alert' ? 'Your price alert'
    : 'You asked for this'
}

/** The icon a card wears: what kind of thing is asking. */
export function iconOf(key: string): IconName {
  const [kind, command] = key.split(':')
  if (kind === 'voice') return command === 'stop' ? 'shield' : command === 'lock' ? 'lock' : 'mic'
  return kind === 'liq' ? 'warn' : kind === 'lock' ? 'lock' : kind === 'nostop' ? 'shield' : 'bell'
}

/** How long the card still waits, measured on the server's clock so a phone clock that is off does not matter. */
export function cardClock(c: { createdAt: number; expiresAt: number }, now: number): string {
  const left = Math.max(0, Math.min(1, (c.expiresAt - now) / (c.expiresAt - c.createdAt || 1)))
  const n = Math.ceil(left * CLOCK)
  return '━'.repeat(n) + '─'.repeat(CLOCK - n)
}

/** Up to two lines, broken at a space. */
function wrap2(s: string): string[] {
  if (s.length <= LINE) return [s]
  const space = s.lastIndexOf(' ', LINE)
  const at = space > 0 ? space : LINE
  return [s.slice(0, at), clip(s.slice(at).trimStart(), LINE)]
}

/** Today's result. The loss meter shows up only once you are losing, and says what is left, not the limit. */
function today(s: ServerState): string {
  const pnl = `Today  ${money(s.dayPnl)}`
  if (s.locked) return `${pnl}   Locked for today`
  if (s.dayPnl >= 0) return pnl
  const left = Math.max(0, Math.floor(s.dailyLossLimitUsd + s.dayPnl)) // floor: never overstate what you can still lose
  return `${pnl}   ${lossBar(s.dayPnl, s.dailyLossLimitUsd)}   ${usd(left)} left`
}

/** What the lens is drawn from besides the server state. */
export interface View {
  offline?: boolean
  /** A voice or menu note: wins over every other message */
  voice?: string
  /** Minutes left on a pause from the menu; while > 0 cards wait and the table stays up */
  pausedMin?: number
  /** Table page, moved by a swipe when there are more positions than rows */
  page?: number
  /** The server answered 401, so the phone page still needs the token */
  needToken?: boolean
  /** The gesture line on the calm screen. Shown for a moment after launch: it teaches, then gets out of the way. */
  hints?: boolean
}

/** The whole glasses screen. Pure, so it is tested without the SDK. */
export function screen(s: ServerState | null, v: View = {}): Screen {
  const pausedMin = v.pausedMin ?? 0
  const cols: Screen['cols'] = ['', '', '', '']
  let head = ''
  let main = ''
  let items: string[] = []
  const dim: string[] = []
  // A card that cannot be answered (server down, token refused) is not drawn: a tap on it would go nowhere.
  const card = pausedMin > 0 || v.offline || v.needToken ? null : s?.card
  if (!s) {
    if (v.needToken) main = 'Open Sightline on your phone\nand enter the server token.'
    else if (!v.offline) main = 'Connecting…'
  } else if (card) {
    head = pxTruncate(`${card.title}${s.pending > 1 ? `    1 of ${s.pending}` : ''}`, CARD_PX)
    main = `${pxTruncate(card.detail, CARD_PX)}\n${cardClock(card, s.updatedAt)}`
    // The safe choice comes first, and the other names its outcome ("Add $100 margin"), not YES.
    items = ['Not now', pxTruncate(card.question.replace(/\?$/, ''), ITEM_PX)]
  } else {
    head = today(s)
    // Closest to liquidation first: the row that needs you is on top.
    const sorted = [...s.positions].sort((a, b) => liqDistancePct(a) - liqDistancePct(b) || 0)
    // More than fit: pages of ROWS - 1, and the last row says where you are.
    const paged = sorted.length > ROWS
    const per = paged ? ROWS - 1 : ROWS
    const pages = Math.ceil(sorted.length / per)
    const from = paged ? ((((v.page ?? 0) % pages) + pages) % pages) * per : 0 // wraps past either end
    const rows = sorted.slice(from, from + per).map(row)
    if (paged) rows.push([`${from + 1}–${from + rows.length} of ${sorted.length}`, '', '', ''])
    for (let i = 0; i < 4; i++) cols[i] = rows.map(r => r[i]).join('\n')
    if (!s.positions.length) main = 'No open positions'
    dim.push('c2') // liquidation distance supports the row; a card speaks up when it gets close
    if (!cols[3].includes('▲')) dim.push('c3') // stops dim, unless one is missing
  }

  const loud = v.voice || (v.needToken ? 'Server token missing or wrong' : '') ||
    (v.offline ? 'Server offline. Retrying…' : '') || s?.toast ||
    (s?.error ? `Exchange: ${s.error}` : '') ||
    (pausedMin > 0 ? `Cards paused · ${pausedMin} min left${s?.pending ? ` · ${s.pending} waiting` : ''}` : '') ||
    (s?.locked ? 'Daily loss limit reached. Stops only.' : '')
  // Nothing to say: the quiet line names the rule behind a card, or shows what a Move-to-Trading card draws on.
  const message = loud || (card ? ruleLine(card.key) : '') ||
    (s?.balance ? `Equity ${dollars(s.balance.equity)} · Free ${dollars(s.balance.available)}` : '')
  if (!loud) dim.push('foot')
  const talk = s?.voice === false ? [] : ['Tap to speak'] // no speech key on the server: do not invite a tap that ends in an error
  const hint = card ? 'Swipe to choose  ·  Tap to confirm'
    : v.hints && s ? [...(s.positions.length > ROWS ? ['Swipe for more'] : []), ...talk, 'Tap then long press: menu'].join('  ·  ') : ''
  const lines = [...(message ? wrap2(message) : []), ...(hint ? [hint] : [])]
  const foot = [...Array(3 - lines.length).fill(''), ...lines].join('\n') // kept at the bottom edge
  return { head: pxTruncate(head, WIDE_PX), cols, main, items, foot, icon: card ? iconOf(card.key) : '', dim }
}

/** The same screen as plain lines, for the phone page. */
export function previewText(sc: Screen): string {
  const split = sc.cols.map(c => c.split('\n'))
  const table = split[0].map((_, i) => split.map(c => (c[i] ?? '').trim()).join('  ').trimEnd()).filter(Boolean)
  const body = sc.items.length ? [sc.main, '', ...sc.items.map((t, i) => `${i ? '  ' : '▶ '}${t}`)] : sc.main ? sc.main.split('\n') : table
  return [sc.head, ...body, '', ...sc.foot.split('\n').filter(Boolean)]
    .filter((l, i) => l || i > 0).join('\n')
}
