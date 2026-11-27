import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createExecutor, SETTLE_MS, LOOKUP_EVERY_MS } from '../src/execute.ts'
import { createStore } from '../src/store.ts'
import { FakeExchange } from '../src/fake-exchange.ts'
import type { Execution, ExecutionStatus, Fill, Order, Position, Terms } from '../src/types.ts'

const T0 = 1_800_000_000_000
const order: Terms = { type: 'order', symbol: 'BTCUSDT', side: 'Sell', qty: '0.025', positionIdx: 0, reduceOnly: true, orderLinkId: 'link-1' }
const pos = (o: Partial<Position> = {}): Position => ({
  symbol: 'BTCUSDT', side: 'Buy', size: 0.05, entryPrice: 62000, markPrice: 61000, liqPrice: 59500, unrealisedPnl: -50,
  stopLoss: 0, takeProfit: 0, positionIM: 310, leverage: 10, isolated: true, positionIdx: 0, openedAt: T0, ...o,
})

/** One execution in `status` at T0, an executor over it, and a clock to move. */
function setup(terms: Terms, status: ExecutionStatus = 'UNKNOWN') {
  let now = T0
  const ex = new FakeExchange()
  const store = createStore(':memory:', () => now)
  const e: Execution = { id: 'e1', proposalId: 'p1', idempotencyKey: 'k1', terms, status, message: '', filledQty: 0, avgPrice: 0, createdAt: T0, updatedAt: T0 }
  store.saveExecution(e)
  const x = createExecutor({ ex, store, clock: () => now, revalidate: async () => ({ ok: true }) })
  const at = async (ms: number, positions: Position[] = [], fills: Fill[] = []) => {
    now = T0 + ms
    await x.reconcile(fills, positions)
    return store.execution('e1')!
  }
  return { ex, at }
}

test('an unknown order Bybit never got is rejected on the second miss after the settle time, not before', async () => {
  const { at } = setup(order)
  assert.equal((await at(SETTLE_MS - 1)).status, 'UNKNOWN') // a late request could still land
  assert.equal((await at(SETTLE_MS)).status, 'UNKNOWN') // first miss
  assert.equal((await at(SETTLE_MS + LOOKUP_EVERY_MS - 1)).status, 'UNKNOWN') // not looked up again yet
  const e = await at(SETTLE_MS + LOOKUP_EVERY_MS)
  assert.equal(e.status, 'REJECTED')
  assert.match(e.message, /never reached Bybit/)
})

test('an unknown order Bybit has becomes acknowledged, so its fills finish it', async () => {
  const { ex, at } = setup(order)
  ex.placed.set('link-1', { orderId: 'o9', status: 'New', cumExecQty: 0, avgPrice: 0 })
  const e = await at(SETTLE_MS)
  assert.equal(e.status, 'ACKNOWLEDGED')
  assert.equal(e.orderId, 'o9')
})

test('an order Bybit cancelled with nothing filled is rejected', async () => {
  const a = setup(order, 'ACKNOWLEDGED')
  a.ex.placed.set('link-1', { orderId: 'o9', status: 'Cancelled', cumExecQty: 0, avgPrice: 0 })
  assert.match((await a.at(SETTLE_MS)).message, /Bybit cancelled it/)
})

const partial: Fill = { id: 'f1', orderId: 'o9', orderLinkId: 'link-1', symbol: 'BTCUSDT', side: 'Sell', qty: 0.01, price: 61000, leavesQty: 0.015, time: T0 + 1 }

test('lookup settles a timed-out linear IOC with a partial fill, and late fills leave its terminal result intact', async () => {
  const { ex, at } = setup(order)
  ex.placed.set('link-1', { orderId: 'o9', status: 'Cancelled', cumExecQty: 0.015, avgPrice: 60900 })
  const final = await at(SETTLE_MS)
  assert.deepEqual([final.status, final.filledQty, final.avgPrice, final.orderId], ['PARTIALLY_FILLED_CANCELLED', 0.015, 60900, 'o9'])
  assert.deepEqual(await at(2 * SETTLE_MS, [], [partial]), final)
  assert.equal(ex.calls.length, 0)
})

test('a repeated partial fill does not prevent lookup and transient errors keep it open', async () => {
  const { ex, at } = setup(order, 'ACKNOWLEDGED')
  assert.equal((await at(1, [], [partial])).status, 'PARTIALLY_FILLED')
  ex.failReads = 'Bybit HTTP 502'
  assert.equal((await at(SETTLE_MS + 1, [], [partial])).status, 'PARTIALLY_FILLED')
  ex.failReads = null
  ex.placed.set('link-1', { orderId: 'o9', status: 'Cancelled', cumExecQty: 0.015, avgPrice: 60900 })
  const final = await at(SETTLE_MS + 1 + LOOKUP_EVERY_MS, [], [partial])
  assert.deepEqual([final.status, final.filledQty, final.avgPrice], ['PARTIALLY_FILLED_CANCELLED', 0.015, 60900])
})

test('an order snapshot with a larger partial fill survives a shorter fill window', async () => {
  const { ex, at } = setup(order, 'ACKNOWLEDGED')
  ex.placed.set('link-1', { orderId: 'o9', status: 'PartiallyFilled', cumExecQty: 0.015, avgPrice: 60900 })
  const pending = await at(SETTLE_MS)
  assert.deepEqual([pending.status, pending.filledQty, pending.avgPrice], ['PARTIALLY_FILLED', 0.015, 60900])
  assert.deepEqual(await at(SETTLE_MS + 1, [], [partial]), pending)
  // The persisted fill still counts if the order response momentarily omits quantity.
  ex.placed.set('link-1', { orderId: 'o9', status: 'PartiallyFilledCanceled', cumExecQty: 0, avgPrice: 0 })
  const final = await at(2 * SETTLE_MS)
  assert.deepEqual([final.status, final.filledQty, final.avgPrice], ['PARTIALLY_FILLED_CANCELLED', 0.015, 60900])
})

test('a failed lookup decides nothing and does not count as a miss', async () => {
  const { ex, at } = setup(order)
  ex.failReads = 'Bybit HTTP 502'
  assert.equal((await at(SETTLE_MS)).status, 'UNKNOWN')
  ex.failReads = null
  assert.equal((await at(SETTLE_MS + LOOKUP_EVERY_MS)).status, 'UNKNOWN') // first real miss
  assert.equal((await at(SETTLE_MS + 2 * LOOKUP_EVERY_MS)).status, 'REJECTED')
})

test('an unknown stop is applied when the position shows it, rejected once settled when it does not', async () => {
  const stop: Terms = { type: 'setStop', symbol: 'BTCUSDT', positionIdx: 0, price: 60000 }
  const a = setup(stop)
  assert.equal((await a.at(1000, [pos({ stopLoss: 60000 })])).status, 'APPLIED')
  const b = setup(stop)
  assert.equal((await b.at(1000, [pos()])).status, 'UNKNOWN')
  const e = await b.at(SETTLE_MS, [pos({ stopLoss: 59000 })])
  assert.equal(e.status, 'REJECTED')
  assert.match(e.message, /not applied, Bybit shows 59,000/)
})

test('an unknown cancel settles from the order status', async () => {
  const cancel: Terms = { type: 'cancel', symbol: 'BTCUSDT', orderId: 'o5' }
  const open: Order = { orderId: 'o5', orderLinkId: '', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Limit', price: 60000, qty: 0.01, leavesQty: 0.01, reduceOnly: false, stopOrderType: '', triggerBy: '', triggerPrice: 0, positionIdx: 0, status: 'New' }
  const a = setup(cancel)
  a.ex.placed.set('o5', { orderId: 'o5', status: 'Cancelled', cumExecQty: 0, avgPrice: 0 })
  assert.equal((await a.at(SETTLE_MS)).status, 'APPLIED')
  const b = setup(cancel)
  b.ex.orders = [open]
  assert.match((await b.at(SETTLE_MS)).message, /still open/)
  const c = setup(cancel)
  c.ex.placed.set('o5', { orderId: 'o5', status: 'Filled', cumExecQty: 0.01, avgPrice: 60000 })
  assert.match((await c.at(SETTLE_MS)).message, /order filled before the cancel/)
})

test('an unknown add margin keeps blocking while the position is open and settles when it closes', async () => {
  const { at } = setup({ type: 'addMargin', symbol: 'BTCUSDT', positionIdx: 0, usd: 100 })
  assert.equal((await at(10 * SETTLE_MS, [pos()])).status, 'UNKNOWN')
  assert.match((await at(10 * SETTLE_MS, [])).message, /position closed/)
})

test('Bybit shows Filled but the fills were missed: the order settles from the lookup', async () => {
  const { ex, at } = setup(order, 'ACKNOWLEDGED')
  ex.placed.set('link-1', { orderId: 'o9', status: 'Filled', cumExecQty: 0.025, avgPrice: 61000 })
  const e = await at(SETTLE_MS)
  assert.deepEqual([e.status, e.filledQty, e.avgPrice], ['FILLED', 0.025, 61000])
})

test('an unknown cancel of an order Bybit does not know settles on the second miss', async () => {
  const { at } = setup({ type: 'cancel', symbol: 'BTCUSDT', orderId: 'gone' })
  assert.equal((await at(SETTLE_MS)).status, 'UNKNOWN')
  assert.match((await at(SETTLE_MS + LOOKUP_EVERY_MS)).message, /not found on Bybit/)
})

test('on restart only a write being sent turns UNKNOWN; one still validating never left and is rejected', () => {
  const store = createStore(':memory:', () => T0)
  const rec = (id: string, status: ExecutionStatus): Execution => ({ id, proposalId: `p-${id}`, idempotencyKey: id, terms: order, status, message: '', filledQty: 0, avgPrice: 0, createdAt: T0, updatedAt: T0 })
  for (const [id, s] of [['a', 'AUTHORIZED'], ['v', 'VALIDATING'], ['s', 'SUBMITTING']] as const) store.saveExecution(rec(id, s))
  createExecutor({ ex: new FakeExchange(), store, clock: () => T0, revalidate: async () => ({ ok: true }) })
  assert.deepEqual(['a', 'v', 's'].map(id => store.execution(id)!.status), ['REJECTED', 'REJECTED', 'UNKNOWN'])
})

test('an unknown add margin blocks only another add margin: a Close on that position still goes out', async () => {
  let now = T0
  const ex = new FakeExchange()
  ex.list = [pos()]
  ex.prices = { BTCUSDT: 61000 }
  const store = createStore(':memory:', () => now)
  store.saveExecution({ id: 'm0', proposalId: 'p0', idempotencyKey: 'k0', terms: { type: 'addMargin', symbol: 'BTCUSDT', positionIdx: 0, usd: 100 }, status: 'UNKNOWN', message: '', filledQty: 0, avgPrice: 0, createdAt: T0, updatedAt: T0 })
  const x = createExecutor({ ex, store, clock: () => now, revalidate: async () => ({ ok: true }) })
  const propose = (id: string, terms: Terms) => store.saveProposal({
    id, key: id, title: '', detail: '', question: '', who: '', why: '', createdAt: now, expiresAt: now + 30_000,
    alertId: `a-${id}`, shortcutId: 's1', version: 1, targetKey: 'pos:BTCUSDT:0:1', terms, simulated: false, priority: 'CRITICAL', status: 'PENDING',
  })
  propose('close', order)
  const c = await x.confirm('close', 'tap-close')
  assert.equal(c.execution!.status, 'ACKNOWLEDGED')
  propose('margin', { type: 'addMargin', symbol: 'BTCUSDT', positionIdx: 0, usd: 50 })
  const m = await x.confirm('margin', 'tap-margin')
  assert.deepEqual([m.execution!.status, m.execution!.message], ['REJECTED', 'an earlier action on this position has an unknown result, check Bybit'])
  assert.deepEqual(ex.calls.map(t => t.type), ['order'])
})
