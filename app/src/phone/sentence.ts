/**
 * Rule → the editor's sentence (spec §5.2, arch §4 table) and the short strings around it. Pure, no DOM.
 * shortcut: the sentence words live here because GET /catalog sends labels only, move them to the catalog when it sends words.
 */
import { ACTION_TITLE, SCOPE_LABEL, type Action, type Condition, type Scope, type ShortcutRule, type Target, type Template } from '../../../server/src/registry.ts'
import { coin, fmt } from '../../../server/src/format.ts'

export { fmt }

/** Which editor a token opens. */
export type Key = 'metric' | 'compare' | 'logic' | 'threshold' | 'percent' | 'window' | 'distance' | 'multiplier' | 'rate' | 'minutes'
  | 'action' | 'close' | 'target' | 'amount' | 'unit' | 'notional' | 'sizes' | 'leverages'
export type Tok = { key: Key; text: string; aria?: string; empty?: boolean }
/** Plain grammar words are strings; tokens are buttons. */
export type Part = string | Tok

/** What the user typed → the decimal string sent to the server, or null. "30.50" → "30.5", "007" → "7". */
export function parseDec(raw: string): string | null {
  const s = raw.trim().replace(',', '.').replace(/\.$/, '')
  if (!/^\d{1,12}(\.\d{1,10})?$/.test(s)) return null
  return s.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

// usdtPlain: the unit is a token of its own (Add margin), so the number does not repeat it
const UNIT = { '%': ['%', 'percent'], USDT: [' USDT', 'USDT'], usdtPlain: ['', 'USDT'], min: [' min', 'minutes'], '×': ['×', 'times'] } as const
type Unit = keyof typeof UNIT

/** A number token; '' is a value the user still has to enter. */
function num(key: Key, v: string, unit: Unit, field: string, placeholder: string, sign = ''): Tok {
  if (v === '') return { key, text: placeholder, aria: `${field}, not set, edit`, empty: true }
  const [shown, spoken] = UNIT[unit]
  return { key, text: `${sign}${fmt(v)}${shown}`, aria: `${field}, ${sign ? 'minus ' : ''}${v} ${spoken}, edit` }
}

/** The metric token's word, also used in "Not with …". */
export function metricWord(c: Condition): string {
  switch (c.type) {
    case 'PRICE': return 'price'
    case 'PRICE_CHANGE': return 'price change'
    case 'PROFIT': case 'LOSS': return c.unit === 'ROI_PERCENT' ? 'ROI' : c.type === 'PROFIT' ? 'profit' : 'loss'
    case 'NEAR_LIQUIDATION': return 'liquidation distance'
    case 'NEAR_SL': return 'stop loss distance'
    case 'NEAR_TP': return 'take profit distance'
    case 'ORDER_FILLED': case 'ORDER_PARTIAL': case 'ORDER_STALE': return 'order'
    case 'VOLUME_SPIKE': return 'volume'
    case 'FUNDING': return 'funding rate'
    case 'POSITION_CLOSED': return 'position'
  }
}

const CLOSED_BY = { SL: 'closed by stop loss', TP: 'closed by take profit', LIQUIDATION: 'liquidated' } as const

const PRICE_OPS = { GTE: 'above', LTE: 'below', UP_CROSS: 'crosses above', DOWN_CROSS: 'crosses below' } as const

/** The comparison menu of a condition (spec §5.4), or null when it has none. */
export function compareMenu(c: Condition): { items: string[]; current: string } | null {
  switch (c.type) {
    case 'PRICE': return { items: Object.values(PRICE_OPS), current: PRICE_OPS[c.operator] }
    case 'PRICE_CHANGE': return { items: ['rises', 'falls'], current: c.direction === 'UP' ? 'rises' : 'falls' }
    case 'PROFIT': case 'LOSS': return c.unit === 'ROI_PERCENT' ? { items: ['above', 'below'], current: c.type === 'PROFIT' ? 'above' : 'below' } : null
    case 'ORDER_FILLED': case 'ORDER_PARTIAL': return { items: ['filled', 'partly filled'], current: c.type === 'ORDER_FILLED' ? 'filled' : 'partly filled' }
    case 'POSITION_CLOSED': return { items: Object.values(CLOSED_BY), current: CLOSED_BY[c.by] }
    default: return null
  }
}

/** One condition line after its lead ("When" or the operator token). */
export function conditionParts(c: Condition): Part[] {
  const metric: Tok = { key: 'metric', text: metricWord(c), aria: `Condition, ${metricWord(c)}, change` }
  const cmp = compareMenu(c)
  const compare: Tok | null = cmp && { key: 'compare', text: cmp.current }
  switch (c.type) {
    case 'PRICE': {
      const level = num('threshold', c.threshold, 'USDT', 'Price level', 'set price')
      return c.operator === 'GTE' || c.operator === 'LTE' ? [metric, 'is', compare!, level] : [metric, compare!, level]
    }
    case 'PRICE_CHANGE':
      return [metric, compare!, 'by', num('percent', c.percent, '%', 'Price change', 'set percent'), 'since switched on']
    case 'PROFIT':
    case 'LOSS':
      if (c.unit === 'ROI_PERCENT') return [metric, 'is', compare!, num('threshold', c.threshold, '%', 'ROI threshold', 'set percent', c.type === 'LOSS' ? '−' : '')]
      return [metric, 'is above', num('threshold', c.threshold, 'USDT', `${c.type === 'PROFIT' ? 'Profit' : 'Loss'} threshold`, 'set amount')]
    case 'NEAR_LIQUIDATION':
    case 'NEAR_SL':
    case 'NEAR_TP':
      return [metric, 'is below', num('distance', c.distancePct, '%', `${metricWord(c)[0].toUpperCase()}${metricWord(c).slice(1)} threshold`, 'set percent')]
    case 'ORDER_FILLED':
    case 'ORDER_PARTIAL':
    case 'POSITION_CLOSED': return [metric, 'is', compare!]
    case 'VOLUME_SPIKE':
      return [metric, 'within', num('window', String(c.windowSec / 60), 'min', 'Time window', 'set time'), 'is above',
        num('multiplier', c.multiplier, '×', 'Volume multiple', 'set multiple'), 'the hourly average']
    case 'FUNDING':
      return [metric, 'is above', num('rate', c.ratePct, '%', 'Funding rate', 'set rate'), 'with',
        num('minutes', String(c.minutesBefore), 'min', 'Time before funding', 'set time'), 'to payment']
    case 'ORDER_STALE': return [metric, 'is open for over', num('minutes', String(c.minutes), 'min', 'Order age', 'set time')]
  }
}

export function targetText(t: Target): string {
  if (t.kind === 'PRICE') return t.price === '' ? 'set price' : `${fmt(t.price)} USDT`
  if (t.percent === '') return 'set percent'
  const p = Number(t.percent)
  return p === 0 ? 'entry price' : `${fmt(t.percent.replace('-', ''))}% ${p < 0 ? 'adverse' : 'favorable'} from entry`
}

/** The Do line after "Do". */
export function actionParts(a: Action): Part[] {
  const word = ACTION_TITLE[a.type].toLowerCase()
  const action: Tok = { key: 'action', text: word, aria: `Action, ${word}, change` }
  switch (a.type) {
    case 'CLOSE_POSITION': return [action, 'by', num('close', a.percent, '%', 'Close amount', 'set amount')]
    case 'MOVE_SL':
    case 'SET_SL':
    case 'SET_TP': {
      const field = a.type === 'SET_TP' ? 'Take profit' : 'Stop loss'
      const text = targetText(a.target)
      const empty = text.startsWith('set ')
      return [action, 'to', { key: 'target', text, aria: `${field}, ${empty ? 'not set' : text}, edit`, empty }]
    }
    case 'ADD_MARGIN': return a.unit === 'USDT'
      ? [action, 'of', num('amount', a.amount, 'usdtPlain', 'Margin', 'set amount'), { key: 'unit', text: 'USDT', aria: 'Unit, USDT, change' }]
      : [action, 'of', num('amount', a.amount, '%', 'Margin', 'set percent'), { key: 'unit', text: 'of its margin', aria: 'Unit, percent of the position margin, change' }]
    case 'OPEN_LONG':
    case 'OPEN_SHORT': {
      const list = (key: 'sizes' | 'leverages', vs: string[], unit: ' USDT' | '×', field: string, placeholder: string): Tok => vs.length
        ? { key, text: unit === '×' ? vs.map(v => `${fmt(v)}×`).join(' · ') : `${vs.map(fmt).join(' · ')}${unit}`, aria: `${field}, ${vs.join(', ')}, edit` }
        : { key, text: placeholder, aria: `${field}, not set, edit`, empty: true }
      const ask = a.sizes.length > 1 || a.leverages.length > 1
      return [action, 'of', list('sizes', a.sizes, ' USDT', 'Sizes', 'set sizes'), 'at', list('leverages', a.leverages, '×', 'Leverage', 'set leverage'),
        ...(ask ? ['· you pick on Even G2'] : [])]
    }
    case 'INCREASE_POSITION': return [action, 'by', num('notional', a.notionalUsdt, 'USDT', 'Additional notional', 'set amount')]
    case 'CANCEL_ORDER':
    case 'NOTIFY': return [action]
  }
}

type Opts = Pick<ShortcutRule, 'trigger' | 'delivery'> & { voicePhrase?: string }
const TRIGGER = { ON_ENTRY: 'On entry', ON_EVENT: 'On event', ONCE: 'Once', REPEAT: 'Repeat' } as const
export const triggerLabel = (t: Opts['trigger']) => (t.mode === 'REPEAT' ? `Every ${(t.intervalSec ?? 300) / 60} min` : TRIGGER[t.mode])

/** The Options row: "On entry · Glasses + phone", plus "· Voice" with a phrase. */
export function optionsSummary(o: Opts): string {
  const d = o.delivery
  const to = d.glasses && d.phone ? 'Glasses + phone' : d.glasses ? 'Glasses' : d.phone ? 'Phone' : 'Off'
  return [triggerLabel(o.trigger), to, o.voicePhrase ? 'Voice' : ''].filter(Boolean).join(' · ')
}

export const titleOf = (r: { name?: string; action?: Action }) => r.name || (r.action ? ACTION_TITLE[r.action.type] : 'New Shortcut')
export const templateTitle = (t: Pick<Template, 'title' | 'sub'>) => t.sub || t.title

/** "BTC, ETH longs", "SOL": the coins of Positions by coin and the side it keeps. */
export const coinsText = (sc: Extract<Scope, { type: 'COIN_POSITIONS' }>) =>
  `${sc.symbols.map(coin).join(', ')}${sc.side === 'ANY' ? '' : sc.side === 'LONG' ? ' longs' : ' shorts'}`

/** The one target a tile is bound to, for its tag ("BTC long", "SOL order"); null for All positions and All orders. */
export function targetTag(sc: Scope): string | null {
  switch (sc.type) {
    case 'ALL_POSITIONS': case 'ALL_ORDERS': return null
    case 'COIN_POSITIONS': return sc.symbols.length ? coinsText(sc) : SCOPE_LABEL.COIN_POSITIONS
    case 'SYMBOL': return sc.symbol ? coin(sc.symbol) : SCOPE_LABEL.SYMBOL
    case 'ORDER': return sc.symbol ? `${coin(sc.symbol)} order` : SCOPE_LABEL.ORDER
    case 'POSITION': // the epoch starts with the side it was opened on
      return sc.symbol ? `${coin(sc.symbol)}${sc.epoch.startsWith('Buy:') ? ' long' : sc.epoch.startsWith('Sell:') ? ' short' : ''}` : SCOPE_LABEL.POSITION
  }
}
