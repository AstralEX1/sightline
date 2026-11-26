// The sandbox exchange's money math: liquidation follows the average entry and added margin, one-way netting, stops
// before liquidation on a gap, liquidation at the bankruptcy price, and the wallet the server reads. Fees are left out.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Market, START_PRICE as P, SYMBOL, liqOf } from '../src/market.ts'

const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 0.01, `${what}: ${a} ≠ ${b}`)

async function long(sl = 0) {
  const m = new Market()
  await m.open('Buy', 0.05, 10, 0, sl) // 4,800 USDT at 96,000, 480 USDT margin
  return m
}

test('a limit add moves liquidation with the average entry', async () => {
  const m = await long()
  m.limit('Buy', 0.05, 90_000)
  m.setPrice(90_000)
  const [p] = m.positions
  near(p.size, 0.1, 'size')
  near(p.entryPrice, 93_000, 'entry')
  near(p.liqPrice, liqOf('Buy', 93_000, 10), 'liquidation')
})

test('an opposite limit reduces the position instead of opening a second one', async () => {
  const m = await long()
  m.limit('Sell', 0.05, 97_000)
  m.setPrice(97_000)
  assert.equal(m.positions.length, 0)
  near(m.ex.available, 10_050, 'available after +50 realised')
})

test('a gap through the stop and liquidation closes at the stop', async () => {
  const m = await long(94_080)
  m.setPrice(80_000)
  const fill = m.ex.fills.at(-1)!
  assert.equal(fill.closedBy, 'SL')
  near(fill.price, 94_080, 'stop fill')
  near(m.ex.available, 10_000 - 96, 'available after the stop loss')
})

test('liquidation closes at the bankruptcy price and loses exactly the margin', async () => {
  const m = await long()
  m.setPrice(80_000)
  const fill = m.ex.fills.at(-1)!
  assert.equal(fill.closedBy, 'LIQUIDATION')
  near(fill.price, 86_400, 'bankruptcy price')
  near(m.ex.available, 10_000 - 480, 'available after liquidation')
})

test('the wallet the server reads: margin held, equity with the open PnL', async () => {
  const m = await long()
  near(m.ex.available, 9_520, 'available with 480 margin held')
  m.setPrice(97_000)
  near(m.ex.equity, 10_050, 'equity with +50 open')
  near(m.ex.available, 9_520, 'open profit is not available')
})

test('added margin moves liquidation away and is held from the wallet', async () => {
  const m = await long()
  await m.ex.addMargin(SYMBOL, 0, 480)
  near(m.positions[0].liqPrice, liqOf('Buy', P, 10) - 480 / 0.05, 'liquidation')
  near(m.ex.available, 9_040, 'available')
})

test('a limit order brings its take profit and stop to the position it opens', () => {
  const m = new Market()
  m.limit('Buy', 0.05, 95_000, Date.now(), 99_000, 93_000)
  m.setPrice(95_000)
  const [p] = m.positions
  assert.equal(p.takeProfit, 99_000)
  assert.equal(p.stopLoss, 93_000)
})
