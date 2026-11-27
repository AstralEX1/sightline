/**
 * Alert and proposal service, the pure half: what a fired shortcut asks for on one target, resolved to one exact
 * exchange command and guarded (§6, §7), plus the words the lens and History print. No I/O.
 */
import { ACTION_TITLE, type Action, type Condition, type Dec, type Target } from './registry.ts'
import type { Balance, Execution, Instrument, Order, Position, Proposal, Side, Slot, Terms, Ticker } from './types.ts'
import { toStep } from './bybit.ts'
import { coin, dollars, fmt, money, price } from './format.ts'
import { liqDistancePct } from './rules.ts'

/** One target of a shortcut's scope, as the poll saw it. */
export interface TargetRef {
  /** 'pos:BTCUSDT:0:<epoch>', 'sym:BTCUSDT' or 'ord:<orderId>' */
  key: string
  symbol: string
  /** "BTC long", "BTC", "BTC order" */
  label: string
  /** The position it acts on: its own, or the one the scoped order opened */
  position?: Position
  epoch?: string
  /** ORDER scope: the order as last seen */
  order?: Order
}

/** Fresh exchange facts a proposal is resolved and guarded with. */
export interface Market {
  ticker: Ticker
  instrument: Instrument
  orders: Order[]
  positions: Position[]
  balance: Balance | null
  /** Open only: the symbol's position slots, for leverage and one-way vs hedge mode */
  slots: Slot[]
}

export type Resolved =
  | { ok: true; terms: Terms; question: string; note?: string }
  | { ok: false; code: string; reason: string }

const skip = (code: string, reason: string): Resolved => ({ ok: false, code, reason })
const dir = (side: Side) => (side === 'Buy' ? 1 : -1)

export const positionLabel = (p: Pick<Position, 'symbol' | 'side'>) => `${coin(p.symbol)} ${p.side === 'Buy' ? 'long' : 'short'}`

/** One price for a Target: percent > 0 is the favorable side of `base` for this side (§4). */
export const targetPrice = (t: Target, base: number, side: Side) =>
  t.kind === 'PRICE' ? Number(t.price) : base * (1 + (dir(side) * Number(t.percent)) / 100)

/** What the position is worth if a stop at `px` fills, before fees and slippage. */
const ifStopped = (p: Position, px: number) => `if stopped: ${money((px - p.entryPrice) * p.size * dir(p.side))}`

/**
 * Resolves a shortcut's action on one target into the exact command a tap authorizes, or says why not.
 * With `authorized` (a confirm, or the per-tick recheck) an Open or Increase keeps its authorized qty and stops, and every
 * order keeps its orderLinkId, so `sameTerms` tells a real change from a new price tick. `pick`: the size and leverage
 * an Open was given on the glasses; without it the first of each. Pure.
 */
export function resolve(action: Action, t: TargetRef, m: Market, authorized?: Terms, newId = () => crypto.randomUUID(), pick?: { size: number; leverage: number }): Resolved {
  const { tickSize, qtyStep, minOrderQty, maxMktOrderQty, minNotionalValue } = m.instrument
  const tick = (px: number) => Number(toStep(px, tickSize, Math.round))
  /** The price exactly as it is sent: every decimal of the tick, thousands grouped. */
  const shown = (px: number) => px.toLocaleString('en-US', { maximumFractionDigits: (tickSize.split('.')[1] ?? '').length })
  const name = coin(t.symbol)
  const { last, mark } = m.ticker
  const p = t.position && t.position.size > 0 ? t.position : undefined
  const ordersOn = (q: Position) => m.orders.filter(o => o.symbol === q.symbol && o.positionIdx === q.positionIdx)
  const linkId = authorized?.type === 'order' ? authorized.orderLinkId : newId()
  // A stop must sit behind both prices it can be checked against, a take profit ahead of both.
  // A price at or under zero (a short's take profit at 100 %) is no price: Bybit would drop or refuse it.
  const behind = (side: Side, px: number) => px > 0 && dir(side) * ((side === 'Buy' ? Math.min(last, mark) : Math.max(last, mark)) - px) > 0
  const ahead = (side: Side, px: number) => px > 0 && dir(side) * (px - (side === 'Buy' ? Math.max(last, mark) : Math.min(last, mark))) > 0
  /** What the rounded-down qty costs, not the size asked for: floored to qtyStep it can be far less (0.001 BTC for 100 USDT). */
  const cost = (qty: string, lev: number) => ({ notionalUsdt: Math.round(Number(qty) * last * 100) / 100, leverage: lev, marginUsdt: Math.round((Number(qty) * last / lev) * 100) / 100 })

  /** Open and Increase: size, notional, margin and attached stops of the authorized qty. */
  const grow = (o: Extract<Terms, { type: 'order' }>, lev: number): Resolved | null => {
    const qty = Number(o.qty)
    if (!(qty >= minOrderQty)) return skip('below_min', `below the ${minOrderQty} ${name} minimum`)
    if (qty * last < minNotionalValue) return skip('below_min', `below the ${minNotionalValue} USDT minimum`)
    if (qty > maxMktOrderQty) return skip('above_max', `more than ${maxMktOrderQty} ${name} in one market order`)
    if (!m.balance) return skip('no_balance', 'free balance unknown')
    if (m.balance.available < (qty * last) / lev) return skip('insufficient', `only ${dollars(m.balance.available)} free`)
    if (o.stopLoss !== undefined && !behind(o.side, o.stopLoss)) return skip('past_price', 'stop would be past the price')
    if (o.takeProfit !== undefined && !ahead(o.side, o.takeProfit)) return skip('past_price', 'take profit would be past the price')
    // Flat before an Open, so no liquidation price yet: at `lev` the margin is gone 1/lev from the price, a little sooner with maintenance margin.
    if (o.stopLoss !== undefined && dir(o.side) * (o.stopLoss - last * (1 - dir(o.side) / lev)) <= 0) return skip('past_liquidation', 'stop would be past liquidation')
    return null
  }

  switch (action.type) {
    case 'CLOSE_POSITION': {
      if (!p) return skip('no_position', 'position is closed')
      const pct = Number(action.percent)
      const qty = toStep(pct >= 100 ? p.size : (p.size * pct) / 100, qtyStep, Math.floor)
      if (Number(qty) < minOrderQty) return skip('below_min', `${pct}% is below the ${minOrderQty} ${name} minimum`)
      // never split into several orders, never qty "0" with closeOnTrigger (§6)
      if (Number(qty) > maxMktOrderQty) return skip('above_max', `more than ${maxMktOrderQty} ${name} in one market order`)
      const terms: Terms = { type: 'order', symbol: t.symbol, side: p.side === 'Buy' ? 'Sell' : 'Buy', qty, positionIdx: p.positionIdx, reduceOnly: true, orderLinkId: linkId }
      // Rounded down to qtyStep the qty can be less than asked (50% of 0.003 is 0.001).
      // The choice keeps the rule's percent; the note says the smaller quantity that will actually be sent.
      const sent = (Number(qty) / p.size) * 100
      const exact = Math.abs(sent - pct) < 1e-6
      return { ok: true, terms, question: `Close ${pct}% · ${qty} ${name}?`, note: exact ? 'market, reduce-only' : `market, reduce-only · ${pct}% rounds down to ${qty} ${name}` }
    }
    case 'MOVE_SL':
    case 'SET_SL': {
      if (!p) return skip('no_position', 'position is closed')
      if (ordersOn(p).some(o => o.stopOrderType === 'PartialStopLoss')) return skip('partial_stops', 'partial stop orders on this position')
      const px = tick(targetPrice(action.target, p.entryPrice, p.side))
      if (action.type === 'SET_SL' && p.stopLoss > 0) return skip('has_stop', 'already has a stop loss')
      if (action.type === 'MOVE_SL') {
        if (!p.stopLoss) return skip('no_stop', 'no stop loss to move')
        if (dir(p.side) * (px - p.stopLoss) <= 0) return skip('not_tighter', px === p.stopLoss ? 'stop is already there' : 'would loosen the stop')
      }
      if (!behind(p.side, px)) return skip('past_price', 'stop would be past the price') // strict Set SL (§15.3)
      if (p.liqPrice > 0 && dir(p.side) * (px - p.liqPrice) <= 0) return skip('past_liquidation', 'stop would be past liquidation')
      const terms: Terms = { type: 'setStop', symbol: t.symbol, positionIdx: p.positionIdx, price: px }
      const at = action.target.kind === 'ENTRY_OFFSET' && Number(action.target.percent) === 0 ? `entry ${shown(px)}` : shown(px)
      return { ok: true, terms, question: action.type === 'SET_SL' ? `Set ${name} stop at ${at}?` : `Move ${name} stop to ${at}?`, note: ifStopped(p, px) }
    }
    case 'SET_TP': {
      if (!p) return skip('no_position', 'position is closed')
      if (ordersOn(p).some(o => o.stopOrderType === 'PartialTakeProfit')) return skip('partial_stops', 'partial take profit orders on this position')
      const px = tick(targetPrice(action.target, p.entryPrice, p.side))
      if (!ahead(p.side, px)) return skip('past_price', 'take profit would be past the price')
      if (px === p.takeProfit) return skip('not_modified', 'take profit is already there') // Bybit refuses a no-op (34040)
      return { ok: true, terms: { type: 'setTakeProfit', symbol: t.symbol, positionIdx: p.positionIdx, price: px }, question: `Set ${name} take profit at ${shown(px)}?`, ...(p.takeProfit > 0 && { note: `replaces ${shown(p.takeProfit)}` }) }
    }
    case 'ADD_MARGIN': {
      if (!p) return skip('no_position', 'position is closed')
      if (!p.isolated) return skip('not_isolated', 'add margin works on isolated margin only')
      const pct = action.unit === 'MARGIN_PERCENT' ? Number(action.amount) : null
      if (pct !== null && !(p.positionIM > 0)) return skip('no_margin', 'position margin unknown')
      // A percent of the position's margin, down to the cent
      const usd = pct === null ? Number(action.amount) : Math.floor(p.positionIM * pct) / 100
      if (!(usd >= 0.01)) return skip('below_min', 'less than 0.01 USDT')
      if (!m.balance) return skip('no_balance', 'free balance unknown')
      if (m.balance.available < usd) return skip('insufficient', `only ${dollars(m.balance.available)} free`)
      return {
        ok: true, terms: { type: 'addMargin', symbol: t.symbol, positionIdx: p.positionIdx, usd }, question: `Add ${usd} USDT margin to ${name}?`,
        ...(pct !== null && { note: `${fmt(action.amount)}% of its ${dollars(p.positionIM)} margin` }),
      }
    }
    case 'OPEN_LONG':
    case 'OPEN_SHORT': {
      if (m.positions.some(q => q.symbol === t.symbol && q.size > 0) || m.slots.some(s => s.size > 0)) return skip('not_flat', `${name} already has a position`)
      const side: Side = action.type === 'OPEN_LONG' ? 'Buy' : 'Sell'
      const slot = m.slots.find(s => s.positionIdx === 0) ?? m.slots.find(s => s.positionIdx === (side === 'Buy' ? 1 : 2))
      if (!slot) return skip('no_slot', 'position mode unknown')
      if (authorized?.type === 'order' && authorized.positionIdx !== slot.positionIdx) return skip('slot_changed', 'position mode changed')
      // The symbol is flat, so the leverage picked on the glasses is set on it before the order; never changed unasked (§6).
      const open = (notional: number, lev: number): Resolved => {
        const qty = toStep(notional / last, qtyStep, Math.floor)
        const terms = authorized?.type === 'order' ? authorized : {
          type: 'order' as const, symbol: t.symbol, side, qty, positionIdx: slot.positionIdx, reduceOnly: false, orderLinkId: linkId,
          ...(action.sl && { stopLoss: tick(targetPrice(action.sl, last, side)) }),
          ...(action.tp && { takeProfit: tick(targetPrice(action.tp, last, side)) }),
          ...cost(qty, lev),
        }
        const stops = [terms.stopLoss !== undefined ? `stop ${shown(terms.stopLoss)}` : 'no stop', ...(terms.takeProfit !== undefined ? [`tp ${shown(terms.takeProfit)}`] : [])].join(' · ')
        return grow(terms, terms.leverage ?? lev) ?? { ok: true, terms, question: `Open ${side === 'Buy' ? 'long' : 'short'} ${terms.qty} ${name} · ${terms.notionalUsdt} USDT?`, note: `${terms.leverage}x · margin ~${dollars(terms.marginUsdt ?? 0)} · ${stops}` }
      }
      // A card with choices holds the first one that can be opened, so a choice the balance cannot carry hides none of the others.
      const choices = pick || authorized ? [[pick?.size ?? Number(action.sizes[0]), pick?.leverage ?? Number(action.leverages[0])]]
        : action.sizes.flatMap(s => action.leverages.map(l => [Number(s), Number(l)]))
      let first: Resolved | undefined
      for (const [size, lev] of choices) {
        const r = open(size, lev)
        if (r.ok) return r
        first ??= r
      }
      return first!
    }
    case 'INCREASE_POSITION': {
      if (!p) return skip('no_position', 'position is closed')
      if (!p.stopLoss) return skip('no_stop', 'set a stop loss first')
      if (!(p.leverage > 0)) return skip('leverage', 'leverage unknown')
      if (authorized?.type === 'order' && authorized.leverage !== p.leverage) return skip('leverage_changed', 'position leverage changed')
      const qty = toStep(Number(action.notionalUsdt) / last, qtyStep, Math.floor)
      const terms = authorized?.type === 'order' ? authorized : {
        type: 'order' as const, symbol: t.symbol, side: p.side, qty, positionIdx: p.positionIdx, reduceOnly: false, orderLinkId: linkId, ...cost(qty, p.leverage),
      }
      return grow(terms, p.leverage) ?? { ok: true, terms, question: `Add ${terms.qty} ${name} to ${positionLabel(p)}?`, note: `${terms.notionalUsdt} USDT · ${p.leverage}x · stop ${shown(p.stopLoss)}` }
    }
    case 'CANCEL_ORDER': {
      const o = m.orders.find(o => o.orderId === t.order?.orderId)
      if (!o || o.leavesQty <= 0) return skip('no_order', 'order is no longer open')
      if (isTpsl(o) || o.reduceOnly) return skip('protective', 'order protects a position')
      return { ok: true, terms: { type: 'cancel', symbol: o.symbol, orderId: o.orderId }, question: `Cancel the rest · ${o.leavesQty} ${name}?` }
    }
    case 'NOTIFY':
      return { ok: true, terms: { type: 'notify' }, question: '' }
    default:
      return skip('unknown_action', 'edit this shortcut to choose a supported action')
  }
}

/** A stop or take profit order. Bybit's stopOrderType 'Stop' is a conditional order that opens, like a plain one. */
export const isTpsl = (o: Pick<Order, 'stopOrderType'>) => o.stopOrderType !== '' && o.stopOrderType !== 'Stop'

export const sameTerms = (a: Terms, b: Terms) => JSON.stringify(a) === JSON.stringify(b)

/** Market orders wait the short expiry; protection, margin and cancel the long one (§9). */
export const isMarket = (a: Action) => a.type === 'CLOSE_POSITION' || a.type === 'OPEN_LONG' || a.type === 'OPEN_SHORT' || a.type === 'INCREASE_POSITION'

/** Lens queue (§9): Close, stops, margin, cancel; critical first, then action rank, then age. */
const group = (t: Terms) => t.type === 'notify' ? 2 : t.type === 'order' ? (t.reduceOnly ? 0 : 3) : t.type === 'setTakeProfit' ? 1 : 0
const actionRank = (t: Terms) => t.type === 'order' && t.reduceOnly ? 0 : t.type === 'setStop' ? 1 : t.type === 'addMargin' ? 2 : t.type === 'cancel' ? 3 : 0
export const queueOrder = (a: Proposal, b: Proposal) =>
  group(a.terms) - group(b.terms) || (a.priority === b.priority ? 0 : a.priority === 'CRITICAL' ? -1 : 1)
    || actionRank(a.terms) - actionRank(b.terms) || a.createdAt - b.createdAt

/** The matching condition and its observed value: "liquidation distance 3.2%". */
export function reasonText(c: Condition, value = NaN): string {
  const pct = (v: number) => `${Math.abs(v).toFixed(1)}%`
  switch (c.type) {
    case 'PRICE': return `price ${price(value)}`
    case 'PRICE_CHANGE': return `price ${value >= 0 ? 'up' : 'down'} ${pct(value)}`
    case 'PROFIT':
    case 'LOSS': return c.unit === 'ROI_PERCENT' ? `ROI ${value >= 0 ? '+' : '−'}${pct(value)}` : `PnL ${money(value)}`
    case 'NEAR_LIQUIDATION': return `liquidation distance ${pct(value)}`
    case 'NEAR_SL': return `stop loss distance ${pct(value)}`
    case 'NEAR_TP': return `take profit distance ${pct(value)}`
    case 'ORDER_FILLED': return 'order filled'
    case 'ORDER_PARTIAL': return 'order partly filled'
    case 'VOLUME_SPIKE': return `volume ${value.toFixed(1)}× in ${c.windowSec / 60} min`
    case 'FUNDING': return `funding ${value >= 0 ? '' : '−'}${Math.abs(value).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}% due within ${c.minutesBefore} min`
    case 'ORDER_STALE': return `order open ${duration(value)}`
    case 'POSITION_CLOSED': return `${c.by === 'LIQUIDATION' ? 'liquidated' : `closed by ${c.by === 'SL' ? 'stop loss' : 'take profit'}`} at ${price(value)}`
  }
}

/** 45 → "45 min", 135 → "2 h 15 min". */
const duration = (min: number) => {
  const m = Math.floor(min)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}

/** History's status and the lens result for an execution (§9). */
export function executionLine(e: Execution): string {
  const t = e.terms
  if (t.type === 'notify') return 'Nothing to send'
  switch (e.status) {
    case 'AUTHORIZED':
    case 'VALIDATING':
    case 'SUBMITTING': return 'Sending…'
    case 'ACKNOWLEDGED': return 'Submitted · waiting for fill'
    case 'FILLED': return `Filled · ${e.filledQty} ${coin(t.symbol)} at ${price(e.avgPrice)}`
    case 'PARTIALLY_FILLED': return `Partly filled · ${e.filledQty} of ${t.type === 'order' ? t.qty : ''} ${coin(t.symbol)}`
    case 'PARTIALLY_FILLED_CANCELLED': return `Filled ${e.filledQty} of ${t.type === 'order' ? t.qty : ''} ${coin(t.symbol)}${e.avgPrice > 0 ? ` at ${price(e.avgPrice)}` : ''} · remainder cancelled`
    case 'APPLIED':
      return t.type === 'setStop' ? `Done · stop at ${price(t.price)}` : t.type === 'setTakeProfit' ? `Done · take profit at ${price(t.price)}`
        : t.type === 'addMargin' ? `Done · added ${t.usd} USDT margin` : t.type === 'cancel' ? 'Done · order cancelled' : 'Done'
    case 'REJECTED': return `Rejected · ${e.message}`
    case 'UNKNOWN': return 'Unknown result · check Bybit'
    case 'SIMULATED': return 'Test only · nothing was sent'
  }
}

/**
 * What a done write changed, from the position before the tap and Bybit's position after it. Liquidation shows only when
 * its price moved: the distance alone drifts with every tick. Undefined for a cancel, or a target that never had a position.
 */
export function receiptLine(t: Terms, before: Position | undefined, after: Position | undefined): string | undefined {
  if (t.type === 'cancel' || t.type === 'notify') return undefined
  const name = coin(t.symbol)
  if (!after) return before && `${before.size} → 0 ${name} · position closed`
  const pct = (p: Position) => (p.liqPrice > 0 ? `${liqDistancePct(p).toFixed(1)}%` : 'none')
  const liq = !before ? (after.liqPrice > 0 ? [`liq ${pct(after)}`] : []) : before.liqPrice !== after.liqPrice ? [`liq ${pct(before)} → ${pct(after)}`] : []
  const level = (n = 0) => (n > 0 ? price(n) : 'none')
  switch (t.type) {
    case 'order': return [`${before?.size ?? 0} → ${after.size} ${name}`, ...liq].join(' · ')
    case 'setStop': return `stop ${level(before?.stopLoss)} → ${level(after.stopLoss)}`
    case 'setTakeProfit': return `take profit ${level(before?.takeProfit)} → ${level(after.takeProfit)}`
    case 'addMargin': return liq[0] ?? `liq ${pct(after)}`
  }
}

/** A value as a tile prints it; one a template still leaves to the user is "…". */
const val = (d: Dec) => (d ? fmt(d) : '…')
/** "5 min", "1 h 30 min" with each number kept on its unit's line. */
const span = (min: number) => duration(min).replace(/(\d) /g, '$1\u00a0')

/**
 * The tile's When line: "Liq ≤ 3%", "ROI ≥ 20% or Liq ≤ 3%", or “protect all” for a voice-only shortcut.
 * ≤ and ≥ because engine.ts compares every threshold inclusively.
 */
export function conditionSummary(r: { conditions: { logic: 'ALL' | 'ANY'; items: Condition[] }; voicePhrase?: string }): string {
  if (!r.conditions.items.length) return `“${r.voicePhrase ?? ''}”`
  const one = (c: Condition): string => {
    switch (c.type) {
      case 'PRICE': {
        const op = { GTE: '≥', LTE: '≤', UP_CROSS: 'crosses above', DOWN_CROSS: 'crosses below' }[c.operator]
        return `${c.source === 'LAST' ? 'Price' : c.source === 'MARK' ? 'Mark' : 'Index'} ${op} ${val(c.threshold)}`
      }
      case 'PRICE_CHANGE': return `Price ${c.direction === 'UP' ? '+' : '−'}${val(c.percent)}%`
      case 'PROFIT': return c.unit === 'ROI_PERCENT' ? `ROI ≥ ${val(c.threshold)}%` : `Profit ≥ ${val(c.threshold)} USDT`
      case 'LOSS': return c.unit === 'ROI_PERCENT' ? `ROI ≤ −${val(c.threshold)}%` : `Loss ≥ ${val(c.threshold)} USDT`
      case 'NEAR_LIQUIDATION': return `Liq ≤ ${val(c.distancePct)}%`
      case 'NEAR_SL': return `SL ≤ ${val(c.distancePct)}%`
      case 'NEAR_TP': return `TP ≤ ${val(c.distancePct)}%`
      case 'ORDER_FILLED': return 'Order filled'
      case 'ORDER_PARTIAL': return 'Order partly filled'
      case 'VOLUME_SPIKE': return `Volume ${val(c.multiplier)}× in ${span(c.windowSec / 60)}`
      case 'FUNDING': return `Funding ≥ ${val(c.ratePct)}% in ${span(c.minutesBefore)}`
      case 'ORDER_STALE': return `Order open ≥ ${span(c.minutes)}`
      case 'POSITION_CLOSED': return c.by === 'LIQUIDATION' ? 'Liquidated' : `Closed by ${c.by === 'SL' ? 'stop loss' : 'take profit'}`
    }
  }
  const all = r.conditions.items.map(one)
  // a rise or a fall of the same size reads as one ("Price ±15%"): spelled out it does not fit a tile
  const either = all.map(s => s.replace(/^Price [+−]/, 'Price ±'))
  if (r.conditions.logic === 'ANY' && all.length === 2 && all[0] !== all[1] && either[0] === either[1]) return either[0]
  return all.join(r.conditions.logic === 'ALL' ? ' and ' : ' or ')
}

/** The tile's Do line: "Close 50%", "SL to entry", "SL at −2%", "Long 100 USDT ×10". */
export function actionSummary(a: Action): string {
  switch (a.type) {
    case 'CLOSE_POSITION': return `Close ${val(a.percent)}%`
    case 'MOVE_SL':
    case 'SET_SL':
    case 'SET_TP': {
      const level = a.type === 'SET_TP' ? 'TP' : 'SL'
      if (a.target.kind === 'PRICE') return `${level} at ${val(a.target.price)}`
      const pct = a.target.percent
      return pct && Number(pct) === 0 ? `${level} to entry` : `${level} at ${Number(pct) > 0 ? '+' : ''}${val(pct)}%`
    }
    case 'ADD_MARGIN': return a.unit === 'USDT' ? `Add ${val(a.amount)} USDT margin` : `Add ${val(a.amount)}% margin`
    case 'OPEN_LONG':
    case 'OPEN_SHORT': {
      // choices are asked on the glasses, and listed they do not fit a tile
      if (a.sizes.length > 1) return ACTION_TITLE[a.type]
      const leverage = a.leverages.length > 1 ? '' : ` ×${val(a.leverages[0])}`
      return `${a.type === 'OPEN_LONG' ? 'Long' : 'Short'} ${val(a.sizes[0])} USDT${leverage}`
    }
    case 'INCREASE_POSITION': return `Add ${val(a.notionalUsdt)} USDT`
    case 'CANCEL_ORDER': return 'Cancel order'
    case 'NOTIFY': return 'Notify me'
  }
}
