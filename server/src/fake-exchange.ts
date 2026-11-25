import type { Candle, Exchange, Fill, Instrument, Order, OrderRequest, OrderState, Position, Terms } from './types.ts'
import type { PriceSource } from './registry.ts'
import { toStep } from './bybit.ts'

const rejected = (message: string) => Object.assign(new Error(message), { name: 'ExchangeRejected' })
const INSTRUMENT: Instrument = { tickSize: '0.1', qtyStep: '0.001', minOrderQty: 0.001, maxMktOrderQty: 100, minNotionalValue: 5 }
const LEVERAGE = 10

/** In-memory exchange for tests, local work without keys and the demo video. */
export class FakeExchange implements Exchange {
  list: Position[] = []
  fills: Fill[] = []
  /** Open orders, plain and conditional */
  orders: Order[] = []
  /** Last prices; a position's mark stands in when missing */
  prices: Record<string, number> = {}
  /** Index prices; the mark when missing */
  index: Record<string, number> = {}
  /** Leverage of new positions per symbol, 10 when missing */
  leverage: Record<string, number> = {}
  /** Instrument rules per symbol, INSTRUMENT when missing */
  instruments: Record<string, Instrument> = {}
  /** Next funding per symbol: rate in percent and when it is charged; none when missing */
  funding: Record<string, { ratePct: number; at: number }> = {}
  /** 1-minute candles per symbol, the same for every price source */
  candles: Record<string, Candle[]> = {}
  /** What was written, in order */
  calls: Terms[] = []
  /** Bybit's order records by orderLinkId and by orderId; a market order lands here as Filled */
  placed = new Map<string, OrderState>()
  /** The next write throws: a string is a clear exchange rejection, an Error is thrown as is. */
  failNext: string | Error | null = null
  /** Every read throws with this message while set. */
  failReads: string | null = null
  now: () => number = Date.now

  equity = 10_000
  available = 8_000

  setMark(symbol: string, mark: number): void {
    for (const p of this.list.filter(p => p.symbol === symbol)) {
      p.markPrice = mark
      p.unrealisedPnl = (mark - p.entryPrice) * p.size * (p.side === 'Buy' ? 1 : -1)
    }
  }

  private read<T>(value: T): Promise<T> {
    return this.failReads ? Promise.reject(new Error(this.failReads)) : Promise.resolve(structuredClone(value))
  }

  private fail(): void {
    const fail = this.failNext
    this.failNext = null
    if (fail) throw typeof fail === 'string' ? rejected(fail) : fail
  }

  private find(symbol: string, positionIdx: number): Position | undefined {
    return this.list.find(p => p.symbol === symbol && p.positionIdx === positionIdx)
  }

  private last(symbol: string): number {
    const px = this.prices[symbol] ?? this.list.find(p => p.symbol === symbol)?.markPrice
    if (px === undefined) throw rejected(`Unknown symbol ${symbol}`)
    return px
  }

  async balance() { return this.read({ equity: this.equity, available: this.available }) }
  async positions() { return this.read(this.list) }
  async openOrders() { return this.read(this.orders) }
  async fillsSince(ms: number) { return this.read(this.fills.filter(f => f.time > ms)) }

  async ticker(symbol: string) {
    const last = this.last(symbol)
    const mark = this.list.find(p => p.symbol === symbol)?.markPrice ?? last
    return this.read({ last, mark, index: this.index[symbol] ?? mark, ...(this.funding[symbol] && { funding: this.funding[symbol] }) })
  }

  async kline(symbol: string, _source: PriceSource, limit: number) { return this.read((this.candles[symbol] ?? []).slice(-limit)) }
  async instrument(symbol: string) { return this.read(this.instruments[symbol] ?? INSTRUMENT) }

  async slots(symbol: string) {
    const own = this.list.filter(p => p.symbol === symbol).map(p => ({ positionIdx: p.positionIdx, leverage: p.leverage, size: p.size }))
    // shortcut: a flat symbol is one one-way slot, no empty hedge slots; add a hedge flag when a test needs one
    return this.read(own.length ? own : [{ positionIdx: 0, leverage: this.leverage[symbol] ?? LEVERAGE, size: 0 }])
  }

  async apiKeyInfo() { return this.read({ readOnly: false, permissions: { ContractTrade: ['Order', 'Position'], Wallet: [] } }) }

  async setStop(symbol: string, positionIdx: number, price: number) {
    this.fail()
    this.calls.push({ type: 'setStop', symbol, positionIdx, price })
    const p = this.find(symbol, positionIdx)
    if (p) p.stopLoss = price
  }

  async setTakeProfit(symbol: string, positionIdx: number, price: number) {
    this.fail()
    this.calls.push({ type: 'setTakeProfit', symbol, positionIdx, price })
    const p = this.find(symbol, positionIdx)
    if (p) p.takeProfit = price
  }

  async addMargin(symbol: string, positionIdx: number, usd: number) {
    this.fail()
    this.calls.push({ type: 'addMargin', symbol, positionIdx, usd })
    const p = this.find(symbol, positionIdx)
    if (p) p.liqPrice += ((p.side === 'Buy' ? -1 : 1) * usd) / p.size
  }

  async placeOrder(o: OrderRequest) {
    this.fail()
    if (this.fills.some(f => f.orderLinkId === o.orderLinkId)) throw rejected('Duplicate orderLinkId (Bybit 110072)')
    const qty = Number(o.qty)
    if (!(qty > 0)) throw rejected(`Bad order qty ${o.qty}`)
    const p = this.find(o.symbol, o.positionIdx)
    if (o.reduceOnly && (!p || p.side === o.side || qty > p.size)) throw rejected('Reduce-only order would not reduce the position (Bybit 110017)')
    // shortcut: an opposite order without reduceOnly (one-way netting) is not modelled; add it when the server sends one
    if (!o.reduceOnly && p && p.side !== o.side) throw new Error('FakeExchange: opposite order without reduceOnly')
    const price = this.last(o.symbol)
    this.calls.push({ type: 'order', ...o })
    const orderId = crypto.randomUUID()
    const state = { orderId, status: 'Filled', cumExecQty: qty, avgPrice: price }
    this.placed.set(o.orderLinkId, state).set(orderId, state)
    this.fills.push({ id: crypto.randomUUID(), orderId, orderLinkId: o.orderLinkId, symbol: o.symbol, side: o.side, qty, price, leavesQty: 0, time: this.now() })

    if (p && o.reduceOnly) {
      const size = Number(toStep(p.size - qty, (this.instruments[o.symbol] ?? INSTRUMENT).qtyStep, Math.round)) // no 1e-17 leftovers
      if (size === 0) this.list.splice(this.list.indexOf(p), 1)
      else Object.assign(p, { positionIM: (p.positionIM * size) / p.size, size })
    } else if (p) {
      Object.assign(p, { entryPrice: (p.entryPrice * p.size + price * qty) / (p.size + qty), size: p.size + qty, positionIM: p.positionIM + (qty * price) / p.leverage })
    } else {
      const leverage = this.leverage[o.symbol] ?? LEVERAGE
      this.list.push({
        symbol: o.symbol, side: o.side, size: qty, entryPrice: price, markPrice: price, liqPrice: 0, unrealisedPnl: 0,
        stopLoss: o.stopLoss ?? 0, takeProfit: o.takeProfit ?? 0, positionIM: (qty * price) / leverage, leverage,
        isolated: false, positionIdx: o.positionIdx, openedAt: this.now(),
      })
    }
    const after = this.find(o.symbol, o.positionIdx)
    if (after) this.setMark(o.symbol, after.markPrice)
    return { orderId }
  }

  async cancelOrder(symbol: string, orderId: string) {
    this.fail()
    const i = this.orders.findIndex(x => x.symbol === symbol && x.orderId === orderId)
    if (i < 0) throw rejected('Order does not exist (Bybit 110001)')
    this.calls.push({ type: 'cancel', symbol, orderId })
    this.orders.splice(i, 1)
    this.placed.set(orderId, { orderId, status: 'Cancelled', cumExecQty: 0, avgPrice: 0 })
  }

  async order(_symbol: string, ref: { orderLinkId: string } | { orderId: string }) {
    const open = 'orderId' in ref && this.orders.find(o => o.orderId === ref.orderId)
    if (open) return this.read<OrderState>({ orderId: open.orderId, status: 'New', cumExecQty: open.qty - open.leavesQty, avgPrice: 0 })
    return this.read(this.placed.get('orderId' in ref ? ref.orderId : ref.orderLinkId) ?? null)
  }
}

/**
 * Demo scenario: SOL in profit, ETH without a stop, BTC sliding towards liquidation; XRP has no position, so Open Position can be tried.
 * BTC longs pay 0.06% funding in 20 min, and SOL's last 5 minutes traded 4× its usual volume.
 */
export function demoExchange(now: number): { ex: FakeExchange; stop: () => void } {
  const ex = new FakeExchange()
  ex.prices = { BTCUSDT: 61800, ETHUSDT: 3080, SOLUSDT: 145, XRPUSDT: 2.5 }
  ex.funding = { BTCUSDT: { ratePct: 0.06, at: now + 20 * 60_000 }, ETHUSDT: { ratePct: 0.01, at: now + 20 * 60_000 } }
  const minute = Math.floor(now / 60_000) * 60_000
  ex.candles.SOLUSDT = Array.from({ length: 70 }, (_, i) => ({ start: minute - (70 - i) * 60_000, close: 145, volume: i >= 65 ? 4000 : 1000 }))
  ex.list = [
    { symbol: 'BTCUSDT', side: 'Buy', size: 0.05, entryPrice: 62000, markPrice: 61800, liqPrice: 59500, unrealisedPnl: -10, stopLoss: 0, takeProfit: 0, positionIM: 310, leverage: 10, isolated: true, positionIdx: 0, openedAt: now - 30_000 },
    { symbol: 'ETHUSDT', side: 'Sell', size: 1.2, entryPrice: 3100, markPrice: 3080, liqPrice: 3600, unrealisedPnl: 24, stopLoss: 0, takeProfit: 0, positionIM: 372, leverage: 10, isolated: false, positionIdx: 0, openedAt: now - 70_000 },
    { symbol: 'SOLUSDT', side: 'Buy', size: 10, entryPrice: 140, markPrice: 145, liqPrice: 112, unrealisedPnl: 50, stopLoss: 135, takeProfit: 0, positionIM: 140, leverage: 10, isolated: false, positionIdx: 0, openedAt: now - 600_000 },
  ]
  const timer = setInterval(() => {
    const btc = ex.list.find(p => p.symbol === 'BTCUSDT')
    if (!btc) return
    // Last price slides with the mark, so LAST and MARK conditions both see it.
    ex.prices.BTCUSDT = Math.max(59700, btc.markPrice - 40)
    ex.setMark('BTCUSDT', ex.prices.BTCUSDT)
  }, 2000)
  return { ex, stop: () => clearInterval(timer) }
}
