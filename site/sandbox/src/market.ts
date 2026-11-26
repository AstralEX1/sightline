/**
 * The exchange side of the sandbox: one BTCUSDT market on the server's FakeExchange. FakeExchange answers the server
 * (positions, orders, fills, tickers, candles, balance) and executes its orders; this adds what a real exchange does on
 * its own: candles, limit fills, closes by stop, take profit or liquidation, isolated liquidation prices, and a wallet.
 * Fees are left out everywhere.
 */
import { FakeExchange } from '../../../server/src/fake-exchange.ts'
import type { ClosedBy } from '../../../server/src/registry.ts'
import type { Order, OrderRequest, Position, Side } from '../../../server/src/types.ts'

export const SYMBOL = 'BTCUSDT'
export const START_PRICE = 96_000
export const START_BALANCE = 10_000 // USDT
const MINUTE = 60_000
const FUNDING_EVERY = 8 * 60 * 60_000
const HISTORY_MIN = 90 // VOLUME_SPIKE compares 5 minutes with the hour before them
const MMR = 0.005 // maintenance margin rate for the liquidation estimate
const BASE_VOLUME = 1000
const round6 = (n: number) => Math.round(n * 1e6) / 1e6

export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number }

/** Isolated liquidation from the entry: where the loss eats the initial margin down to the maintenance margin. */
export const liqOf = (side: Side, entry: number, leverage: number) =>
  entry * (side === 'Buy' ? 1 - 1 / leverage + MMR : 1 + 1 / leverage - MMR)

export class Market {
  ex = new FakeExchange()
  bars: Bar[] = []
  /** While a scenario runs the price stops here, 1% short of liquidation, so a fast drag cannot skip the alert. */
  floor = 0
  #listeners = new Set<() => void>()
  /** Where the hand or a scenario last put the price: time passing wanders around it, never away. */
  #anchor = 0
  #movedAt = 0
  /** Margin added to a position on top of its initial margin (Add margin), per side: it moves liquidation away. */
  #extra = new Map<Side, number>()
  /** The take profit and stop a resting limit order brings to the position it fills. */
  #orderStops = new Map<string, { tp: number; sl: number }>()
  /** Realised PnL since the account opened. */
  #realized = 0

  constructor() { this.reset() }

  get price() { return this.ex.prices[SYMBOL] }
  get positions() { return this.ex.list.filter(p => p.symbol === SYMBOL) }
  get orders() { return this.ex.orders.filter(o => o.symbol === SYMBOL) }

  onChange(fn: () => void) { this.#listeners.add(fn); return () => this.#listeners.delete(fn) }

  /** A fresh account at the start price with an hour and a half of calm history. */
  reset(price = START_PRICE) {
    this.ex = this.#wrap(new FakeExchange())
    this.#extra.clear()
    this.#orderStops.clear()
    this.#realized = 0
    this.floor = 0
    this.ex.leverage[SYMBOL] = 10
    const now = Math.floor(Date.now() / MINUTE) * MINUTE
    // the usual 0.01% funding at the next 8-hour mark, so the funding templates have something to read
    this.ex.funding[SYMBOL] = { ratePct: 0.01, at: Math.ceil(Date.now() / FUNDING_EVERY) * FUNDING_EVERY }
    let c = price * 0.997
    this.bars = Array.from({ length: HISTORY_MIN }, (_, i) => {
      const o = c
      c = i === HISTORY_MIN - 1 ? price : o * (1 + 0.0009 * Math.sin(i / 3) + 0.0006 * Math.sin(i * 1.7))
      const wick = o * 0.0006
      return { t: now - (HISTORY_MIN - 1 - i) * MINUTE, o, h: Math.max(o, c) + wick, l: Math.min(o, c) - wick, c, v: BASE_VOLUME * (0.8 + 0.4 * Math.abs(Math.sin(i))) }
    })
    this.ex.prices[SYMBOL] = price
    this.#anchor = price
    this.#settle()
    this.#sync()
    this.#emit()
  }

  /**
   * Time passing, once a second: the live candle keeps forming and a new one opens every minute. The price wanders
   * around where it was put (about 0.06% standard deviation, mean-reverting), well inside every scenario's margin,
   * and holds still for a second after a drag or Play moved it.
   */
  drift() {
    if (Date.now() - this.#movedAt < 1000) return
    const noise = (Math.random() + Math.random() + Math.random() - 1.5) * 2 // about one standard deviation
    this.setPrice(this.price + (this.#anchor - this.price) * 0.1 + this.price * 0.00025 * noise, true)
  }

  /** The price moves: the live candle, then whatever the exchange would execute at it. */
  setPrice(price: number, drifting = false) {
    price = Math.max(1, this.floor, Math.round(price * 10) / 10)
    if (!drifting) { this.#anchor = price; this.#movedAt = Date.now() }
    const now = Date.now()
    let bar = this.bars[this.bars.length - 1]
    if (now - bar.t >= MINUTE) {
      bar = { t: Math.floor(now / MINUTE) * MINUTE, o: bar.c, h: bar.c, l: bar.c, c: bar.c, v: 0 }
      this.bars.push(bar)
      if (this.bars.length > 240) this.bars.shift()
    }
    // a hand or a scenario moving the price trades volume; time passing trades the usual amount, never a spike
    bar.v += drifting ? BASE_VOLUME / 60 : (Math.abs(price - bar.c) / price) * 400_000
    bar.c = price
    bar.h = Math.max(bar.h, price)
    bar.l = Math.min(bar.l, price)
    this.ex.prices[SYMBOL] = price
    this.ex.setMark(SYMBOL, price)
    this.#match(price)
    this.#settle()
    this.#sync()
    this.#emit()
  }

  /** Market order: opens or adds, with the stop and take profit Bybit attaches to it. */
  async open(side: Side, qty: number, leverage: number, tp = 0, sl = 0) {
    const exchange = this.ex
    if (!this.positions.some(p => p.side === side)) this.ex.leverage[SYMBOL] = leverage
    const order: OrderRequest = { symbol: SYMBOL, side, qty: String(qty), orderLinkId: crypto.randomUUID(), positionIdx: 0, reduceOnly: false, stopLoss: sl || undefined, takeProfit: tp || undefined }
    await exchange.placeOrder(order)
    if (exchange !== this.ex) return
    const p = this.positions.find(x => x.side === side)
    if (p) { if (tp) p.takeProfit = tp; if (sl) p.stopLoss = sl }
    this.#emit()
  }

  /** Reduce-only market order: the whole position, or `qty` of it. */
  async close(p: Position, qty = p.size) {
    const order: OrderRequest = { symbol: SYMBOL, side: p.side === 'Buy' ? 'Sell' : 'Buy', qty: String(qty), orderLinkId: crypto.randomUUID(), positionIdx: p.positionIdx, reduceOnly: true }
    await this.ex.placeOrder(order)
    this.#emit()
  }

  /** A resting limit order. The panel sends a marketable one as a market order, as an exchange would fill it at once. */
  limit(side: Side, qty: number, price: number, createdAt = Date.now(), tp = 0, sl = 0): Order {
    const o: Order = {
      orderId: crypto.randomUUID(), orderLinkId: crypto.randomUUID(), symbol: SYMBOL, side, orderType: 'Limit', price, qty, leavesQty: qty,
      reduceOnly: false, stopOrderType: '', triggerBy: '', triggerPrice: 0, positionIdx: 0, status: 'New', createdAt,
    }
    this.ex.orders.push(o)
    if (tp || sl) this.#orderStops.set(o.orderId, { tp, sl })
    this.#settle()
    this.#emit()
    return o
  }

  cancel(o: Order) {
    this.#orderStops.delete(o.orderId)
    void this.ex.cancelOrder(o.symbol, o.orderId).then(() => { this.#settle(); this.#emit() })
  }

  setStops(p: Position, tp: number, sl: number) { p.takeProfit = tp; p.stopLoss = sl; this.#emit() }

  /** The app's trades change FakeExchange directly (closes, adds, opens): bring liquidation and the wallet up to date. */
  refresh() {
    if (Date.now() >= (this.ex.funding[SYMBOL]?.at ?? Infinity)) this.ex.funding[SYMBOL].at += FUNDING_EVERY
    this.#settle()
    this.#emit()
  }

  /** Realised PnL and added margin are recorded where FakeExchange trades: its orders and Add margin. */
  #wrap(ex: FakeExchange): FakeExchange {
    const place = ex.placeOrder.bind(ex)
    ex.placeOrder = async (o: OrderRequest) => {
      const p = ex.list.find(x => x.symbol === o.symbol && x.positionIdx === o.positionIdx)
      const cut = p && p.side !== o.side ? Math.min(Number(o.qty), p.size) : 0
      const before = p && { entry: p.entryPrice, long: p.side === 'Buy' }
      const result = await place(o)
      if (ex !== this.ex) return result
      if (cut && before) this.#realized += (this.price - before.entry) * cut * (before.long ? 1 : -1)
      this.#settle()
      return result
    }
    const add = ex.addMargin.bind(ex)
    ex.addMargin = async (symbol: string, positionIdx: number, usd: number) => {
      await add(symbol, positionIdx, usd)
      if (ex !== this.ex) return
      const p = ex.list.find(x => x.symbol === symbol && x.positionIdx === positionIdx)
      if (p) this.#extra.set(p.side, (this.#extra.get(p.side) ?? 0) + usd)
      this.#settle()
    }
    return ex
  }

  /**
   * Isolated liquidation follows the average entry, and added margin moves it away by margin ÷ size. The wallet is
   * the starting balance plus realised PnL; available is the wallet less position and order margin; equity adds the
   * unrealised PnL. FakeExchange answers the server's balance reads with these.
   */
  #settle() {
    for (const side of [...this.#extra.keys()]) if (!this.positions.some(p => p.side === side)) this.#extra.delete(side)
    for (const p of this.positions) {
      p.isolated = true
      p.liqPrice = Math.max(0, liqOf(p.side, p.entryPrice, p.leverage) + ((p.side === 'Buy' ? -1 : 1) * (this.#extra.get(p.side) ?? 0)) / p.size)
    }
    const lev = this.ex.leverage[SYMBOL] ?? 10
    const margin = this.positions.reduce((s, p) => s + p.positionIM + (this.#extra.get(p.side) ?? 0), 0)
      + this.orders.reduce((s, o) => s + (o.leavesQty * o.price) / lev, 0)
    const wallet = START_BALANCE + this.#realized
    this.ex.available = Math.max(0, wallet - margin)
    this.ex.equity = wallet + this.positions.reduce((s, p) => s + p.unrealisedPnl, 0)
  }

  #match(price: number) {
    for (const o of [...this.orders]) {
      if (o.orderType === 'Limit' && (o.side === 'Buy' ? price <= o.price : price >= o.price)) this.#fill(o, o.leavesQty)
    }
    for (const p of [...this.positions]) {
      const long = p.side === 'Buy'
      const against = (level: number) => level > 0 && (long ? price <= level : price >= level)
      // the stop sits between the price and liquidation, so a gap through both meets the stop first
      const stopFirst = p.stopLoss > 0 && (long ? p.stopLoss > p.liqPrice : p.stopLoss < p.liqPrice)
      const by: ClosedBy | null = stopFirst && against(p.stopLoss) ? 'SL'
        : against(p.liqPrice) ? 'LIQUIDATION'
        : against(p.stopLoss) ? 'SL'
        : p.takeProfit > 0 && (long ? price >= p.takeProfit : price <= p.takeProfit) ? 'TP' : null
      if (by) this.#closeBy(p, by)
    }
  }

  /** A limit fill at its price. One-way mode: it reduces an opposite position first and opens only the rest. */
  #fill(o: Order, qty: number) {
    const ex = this.ex
    const now = Date.now()
    o.leavesQty = round6(o.leavesQty - qty)
    if (o.leavesQty <= 0) ex.orders.splice(ex.orders.indexOf(o), 1)
    else o.status = 'PartiallyFilled'
    ex.fills.push({ id: crypto.randomUUID(), orderId: o.orderId, orderLinkId: o.orderLinkId, symbol: o.symbol, side: o.side, qty, price: o.price, leavesQty: o.leavesQty, time: now })
    let rest = qty
    const opposite = this.positions.find(x => x.side !== o.side)
    if (opposite) {
      const cut = Math.min(rest, opposite.size)
      this.#realized += (o.price - opposite.entryPrice) * cut * (opposite.side === 'Buy' ? 1 : -1)
      const size = round6(opposite.size - cut)
      if (size <= 0) ex.list.splice(ex.list.indexOf(opposite), 1)
      else Object.assign(opposite, { positionIM: (opposite.positionIM * size) / opposite.size, size })
      rest = round6(rest - cut)
    }
    const stops = this.#orderStops.get(o.orderId)
    if (o.leavesQty <= 0) this.#orderStops.delete(o.orderId)
    if (rest > 0) {
      const p = this.positions.find(x => x.side === o.side)
      if (p) Object.assign(p, { entryPrice: (p.entryPrice * p.size + o.price * rest) / (p.size + rest), size: round6(p.size + rest), positionIM: p.positionIM + (rest * o.price) / p.leverage })
      else {
        const leverage = ex.leverage[SYMBOL] ?? 10
        ex.list.push({
          symbol: SYMBOL, side: o.side, size: rest, entryPrice: o.price, markPrice: this.price, liqPrice: liqOf(o.side, o.price, leverage), unrealisedPnl: 0,
          stopLoss: 0, takeProfit: 0, positionIM: (rest * o.price) / leverage, leverage, isolated: true, positionIdx: o.positionIdx, openedAt: now,
        })
      }
      const filled = this.positions.find(x => x.side === o.side)
      if (filled && stops) { if (stops.tp) filled.takeProfit = stops.tp; if (stops.sl) filled.stopLoss = stops.sl }
    }
    ex.setMark(SYMBOL, this.price)
  }

  /** Stops and take profits fill at their level; a liquidation at the bankruptcy price, losing exactly the margin. */
  #closeBy(p: Position, by: ClosedBy) {
    const ex = this.ex
    const long = p.side === 'Buy'
    const margin = p.positionIM + (this.#extra.get(p.side) ?? 0)
    const price = by === 'SL' ? p.stopLoss : by === 'TP' ? p.takeProfit : p.entryPrice + ((long ? -1 : 1) * margin) / p.size
    this.#realized += (price - p.entryPrice) * p.size * (long ? 1 : -1)
    ex.list.splice(ex.list.indexOf(p), 1)
    ex.fills.push({ id: crypto.randomUUID(), orderId: crypto.randomUUID(), orderLinkId: '', symbol: p.symbol, side: long ? 'Sell' : 'Buy', qty: p.size, price, leavesQty: 0, time: Date.now(), closedBy: by })
  }

  /** FakeExchange's 1-minute candles: what kline answers for PRICE_CHANGE and VOLUME_SPIKE. */
  #sync() { this.ex.candles[SYMBOL] = this.bars.map(b => ({ start: b.t, close: b.c, volume: b.v })) }

  #emit() { for (const fn of this.#listeners) fn() }
}
