import type { Action, Exchange, Fill, Position, Side } from './types.ts'

/** In-memory exchange for tests, local work without keys and the demo video. */
export class FakeExchange implements Exchange {
  list: Position[] = []
  closed = 0
  fills: Fill[] = []
  prices: Record<string, number> = {}
  calls: Action[] = []
  /** The next write throws: a string is a clear exchange rejection, an Error is thrown as is. */
  failNext: string | Error | null = null
  /** Every read throws with this message while set. */
  failReads: string | null = null

  setMark(symbol: string, mark: number): void {
    for (const p of this.list.filter(p => p.symbol === symbol)) {
      p.markPrice = mark
      p.unrealisedPnl = (mark - p.entryPrice) * p.size * (p.side === 'Buy' ? 1 : -1)
    }
  }

  private read<T>(value: T): Promise<T> {
    return this.failReads ? Promise.reject(new Error(this.failReads)) : Promise.resolve(structuredClone(value))
  }

  private write(a: Action): void {
    const fail = this.failNext
    this.failNext = null
    if (fail) throw typeof fail === 'string' ? Object.assign(new Error(fail), { name: 'ExchangeRejected' }) : fail
    this.calls.push(a)
  }

  private find(symbol: string): Position | undefined {
    return this.list.find(p => p.symbol === symbol)
  }

  equity = 10_000
  available = 8_000

  async balance() { return this.read({ equity: this.equity, available: this.available }) }
  async positions() { return this.read(this.list) }
  async closedPnlSince(_ms: number) { return this.read(this.closed) }
  async fillsSince(ms: number) { return this.read(this.fills.filter(f => f.time > ms)) }

  async lastPrice(symbol: string) {
    const px = this.find(symbol)?.markPrice ?? this.prices[symbol]
    if (px === undefined) throw new Error(`Unknown symbol ${symbol}`)
    return this.read(px)
  }

  async setStop(symbol: string, positionIdx: number, price: number) {
    this.write({ type: 'setStop', symbol, positionIdx, price })
    const p = this.find(symbol)
    if (p) p.stopLoss = price
  }

  async addMargin(symbol: string, positionIdx: number, usd: number) {
    this.write({ type: 'addMargin', symbol, positionIdx, usd })
    const p = this.find(symbol)
    if (p) p.liqPrice += ((p.side === 'Buy' ? -1 : 1) * usd) / p.size
  }

  async transferToTrading(usd: number) {
    this.write({ type: 'transfer', usd })
  }

  async marketOrder(symbol: string, side: Side, usd: number) {
    this.write({ type: 'order', symbol, side, usd })
    const px = this.find(symbol)?.markPrice ?? this.prices[symbol]
    const qty = Math.round((usd / px) * 1000) / 1000
    this.fills.push({ id: crypto.randomUUID(), symbol, side, qty, price: px, time: Date.now() })
    if (!this.find(symbol)) {
      this.list.push({ symbol, side, size: qty, entryPrice: px, markPrice: px, liqPrice: 0, unrealisedPnl: 0, stopLoss: 0, isolated: false, positionIdx: 0, openedAt: Date.now() })
    }
  }
}

/** Demo scenario: SOL in profit, ETH without a stop, BTC sliding towards liquidation. */
export function demoExchange(now: number): { ex: FakeExchange; stop: () => void } {
  const ex = new FakeExchange()
  ex.closed = -40
  ex.prices = { BTCUSDT: 61800, ETHUSDT: 3080, SOLUSDT: 145 }
  ex.list = [
    { symbol: 'BTCUSDT', side: 'Buy', size: 0.05, entryPrice: 62000, markPrice: 61800, liqPrice: 59500, unrealisedPnl: -10, stopLoss: 0, isolated: true, positionIdx: 0, openedAt: now - 30_000 },
    { symbol: 'ETHUSDT', side: 'Sell', size: 1.2, entryPrice: 3100, markPrice: 3080, liqPrice: 3600, unrealisedPnl: 24, stopLoss: 0, isolated: false, positionIdx: 0, openedAt: now - 70_000 },
    { symbol: 'SOLUSDT', side: 'Buy', size: 10, entryPrice: 140, markPrice: 145, liqPrice: 112, unrealisedPnl: 50, stopLoss: 135, isolated: false, positionIdx: 0, openedAt: now - 600_000 },
  ]
  const timer = setInterval(() => {
    const btc = ex.list.find(p => p.symbol === 'BTCUSDT')
    if (btc) ex.setMark('BTCUSDT', Math.max(59700, btc.markPrice - 40))
  }, 2000)
  return { ex, stop: () => clearInterval(timer) }
}
