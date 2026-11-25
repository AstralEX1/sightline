/**
 * The exchange side of the sandbox: one BTCUSDT market on the server's FakeExchange. FakeExchange answers the server
 * (positions, orders, fills, tickers, candles) and executes its orders; this adds what a real exchange does on its own
 * when the price moves: candles, limit fills, and closes by stop, take profit or liquidation.
 */
import { FakeExchange } from '../../../server/src/fake-exchange.ts'
import type { ClosedBy } from '../../../server/src/registry.ts'
import type { Order, OrderRequest, Position, Side } from '../../../server/src/types.ts'

export const SYMBOL = 'BTCUSDT'
export const START_PRICE = 96_000
const MINUTE = 60_000
const HISTORY_MIN = 90 // VOLUME_SPIKE compares 5 minutes with the hour before them
const MMR = 0.005 // maintenance margin rate for the liquidation estimate
const BASE_VOLUME = 1000

export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number }

/** Isolated margin estimate: where the loss eats the initial margin down to the maintenance margin. */
export const liqOf = (side: Side, entry: number, leverage: number) =>
  entry * (side === 'Buy' ? 1 - 1 / leverage + MMR : 1 + 1 / leverage - MMR)

export class Market {
  ex = new FakeExchange()
  bars: Bar[] = []
  /** Orders that fill half when the price reaches them, and keep the rest open (ORDER_PARTIAL). */
  partial = new Set<string>()
  #listeners = new Set<() => void>()
  /** Where the hand or a scenario last put the price: time passing wanders around it, never away. */
  #anchor = 0
  #movedAt = 0

  constructor() { this.reset() }

  get price() { return this.ex.prices[SYMBOL] }
  get positions() { return this.ex.list.filter(p => p.symbol === SYMBOL) }
  get orders() { return this.ex.orders.filter(o => o.symbol === SYMBOL) }

  onChange(fn: () => void) { this.#listeners.add(fn); return () => this.#listeners.delete(fn) }

  /** A fresh account at the start price with an hour and a half of calm history. */
  reset(price = START_PRICE) {
    this.ex = new FakeExchange()
    this.partial.clear()
    this.ex.leverage[SYMBOL] = 10
    const now = Math.floor(Date.now() / MINUTE) * MINUTE
    let c = price * 0.997
    this.bars = Array.from({ length: HISTORY_MIN }, (_, i) => {
      const o = c
      c = i === HISTORY_MIN - 1 ? price : o * (1 + 0.0009 * Math.sin(i / 3) + 0.0006 * Math.sin(i * 1.7))
      const wick = o * 0.0006
      return { t: now - (HISTORY_MIN - 1 - i) * MINUTE, o, h: Math.max(o, c) + wick, l: Math.min(o, c) - wick, c, v: BASE_VOLUME * (0.8 + 0.4 * Math.abs(Math.sin(i))) }
    })
    this.ex.prices[SYMBOL] = price
    this.#anchor = price
    this.#sync()
    this.#emit()
  }

  /**
   * Time passing, once a second: the live candle keeps forming and a new one opens every minute. The price wanders
   * ~0.02% around where it was put, well inside every scenario's margin, and holds still for a second after a drag
   * or Play moved it.
   */
  drift() {
    if (Date.now() - this.#movedAt < 1000) return
    const noise = (Math.random() + Math.random() + Math.random() - 1.5) * 2 // about one standard deviation
    this.setPrice(this.price + (this.#anchor - this.price) * 0.1 + this.price * 0.00025 * noise, true)
  }

  /** The price moves: the live candle, then whatever the exchange would execute at it. */
  setPrice(price: number, drifting = false) {
    price = Math.max(1, Math.round(price * 10) / 10)
    if (!drifting) { this.#anchor = price; this.#movedAt = Date.now() }
    const now = Date.now()
    let bar = this.bars[this.bars.length - 1]
    if (now - bar.t >= MINUTE) {
      bar = { t: Math.floor(now / MINUTE) * MINUTE, o: bar.c, h: bar.c, l: bar.c, c: bar.c, v: 0 }
      this.bars.push(bar)
      if (this.bars.length > 240) this.bars.shift()
    }
    bar.v += Math.abs(price - bar.c) / price * 400_000 // moves trade volume
    bar.c = price
    bar.h = Math.max(bar.h, price)
    bar.l = Math.min(bar.l, price)
    this.ex.prices[SYMBOL] = price
    this.ex.setMark(SYMBOL, price)
    this.#match(price)
    this.#sync()
    this.#emit()
  }

  /** Market order: opens or adds, with the stop and take profit Bybit attaches to it. */
  async open(side: Side, qty: number, leverage: number, tp = 0, sl = 0) {
    if (!this.positions.some(p => p.side === side)) this.ex.leverage[SYMBOL] = leverage
    const order: OrderRequest = { symbol: SYMBOL, side, qty: String(qty), orderLinkId: crypto.randomUUID(), positionIdx: 0, reduceOnly: false, stopLoss: sl || undefined, takeProfit: tp || undefined }
    await this.ex.placeOrder(order)
    const p = this.positions[0]
    if (p) { p.isolated = true; p.liqPrice = liqOf(p.side, p.entryPrice, p.leverage); if (tp) p.takeProfit = tp; if (sl) p.stopLoss = sl }
    this.#emit()
  }

  async close(p: Position) {
    const order: OrderRequest = { symbol: SYMBOL, side: p.side === 'Buy' ? 'Sell' : 'Buy', qty: String(p.size), orderLinkId: crypto.randomUUID(), positionIdx: p.positionIdx, reduceOnly: true }
    await this.ex.placeOrder(order)
    this.#emit()
  }

  limit(side: Side, qty: number, price: number, createdAt = Date.now()): Order {
    const o: Order = {
      orderId: crypto.randomUUID(), orderLinkId: crypto.randomUUID(), symbol: SYMBOL, side, orderType: 'Limit', price, qty, leavesQty: qty,
      reduceOnly: false, stopOrderType: '', triggerBy: '', triggerPrice: 0, positionIdx: 0, status: 'New', createdAt,
    }
    this.ex.orders.push(o)
    this.#emit()
    return o
  }

  cancel(o: Order) { void this.ex.cancelOrder(o.symbol, o.orderId).then(() => this.#emit()) }

  setStops(p: Position, tp: number, sl: number) { p.takeProfit = tp; p.stopLoss = sl; this.#emit() }

  /** The last `minutes` closed candles traded `times` their usual volume. */
  spikeVolume(times: number, minutes = 5) {
    const closed = this.bars.slice(0, -1)
    for (const b of closed.slice(-minutes)) b.v = BASE_VOLUME * times
    this.#sync()
  }

  /** Positions opened by a shortcut (Open long or short) come without a liquidation price; a real exchange always has one. */
  refresh() {
    for (const p of this.positions) if (!p.liqPrice) { p.isolated = true; p.liqPrice = liqOf(p.side, p.entryPrice, p.leverage) }
    this.#emit()
  }

  #match(price: number) {
    for (const o of [...this.orders]) {
      if (o.orderType !== 'Limit' || (o.side === 'Buy' ? price > o.price : price < o.price)) continue
      const half = this.partial.has(o.orderId)
      if (half && o.status === 'PartiallyFilled') continue // its rest stays open, so the partial fill is what happened
      this.#fill(o, half ? o.leavesQty / 2 : o.leavesQty)
    }
    for (const p of [...this.positions]) {
      const long = p.side === 'Buy'
      const hit = (level: number, below: boolean) => level > 0 && (below ? price <= level : price >= level)
      const by: ClosedBy | null = hit(p.liqPrice, long) ? 'LIQUIDATION' : hit(p.stopLoss, long) ? 'SL' : hit(p.takeProfit, !long) ? 'TP' : null
      if (by) this.#closeBy(p, by, price)
    }
  }

  #fill(o: Order, qty: number) {
    const ex = this.ex
    const now = Date.now()
    o.leavesQty = Math.round((o.leavesQty - qty) * 1e6) / 1e6
    if (o.leavesQty <= 0) ex.orders.splice(ex.orders.indexOf(o), 1)
    else o.status = 'PartiallyFilled'
    ex.fills.push({ id: crypto.randomUUID(), orderId: o.orderId, orderLinkId: o.orderLinkId, symbol: o.symbol, side: o.side, qty, price: o.price, leavesQty: o.leavesQty, time: now })
    const p = this.positions.find(x => x.side === o.side)
    if (p) Object.assign(p, { entryPrice: (p.entryPrice * p.size + o.price * qty) / (p.size + qty), size: p.size + qty, positionIM: p.positionIM + (qty * o.price) / p.leverage })
    else {
      const leverage = ex.leverage[SYMBOL] ?? 10
      ex.list.push({
        symbol: SYMBOL, side: o.side, size: qty, entryPrice: o.price, markPrice: this.price, liqPrice: liqOf(o.side, o.price, leverage), unrealisedPnl: 0,
        stopLoss: 0, takeProfit: 0, positionIM: (qty * o.price) / leverage, leverage, isolated: true, positionIdx: o.positionIdx, openedAt: now,
      })
    }
    ex.setMark(SYMBOL, this.price)
  }

  #closeBy(p: Position, by: ClosedBy, price: number) {
    const ex = this.ex
    ex.list.splice(ex.list.indexOf(p), 1)
    ex.fills.push({ id: crypto.randomUUID(), orderId: crypto.randomUUID(), orderLinkId: '', symbol: p.symbol, side: p.side === 'Buy' ? 'Sell' : 'Buy', qty: p.size, price, leavesQty: 0, time: Date.now(), closedBy: by })
  }

  /** FakeExchange's 1-minute candles: what kline answers for PRICE_CHANGE and VOLUME_SPIKE. */
  #sync() { this.ex.candles[SYMBOL] = this.bars.map(b => ({ start: b.t, close: b.c, volume: b.v })) }

  #emit() { for (const fn of this.#listeners) fn() }
}
