import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeExchange } from '../src/fake-exchange.ts'
import type { OrderRequest, Position } from '../src/types.ts'

const long = (o: Partial<Position> = {}): Position => ({
  symbol: 'BTCUSDT', side: 'Buy', size: 0.05, entryPrice: 60000, markPrice: 61000, liqPrice: 55000, unrealisedPnl: 50,
  stopLoss: 0, takeProfit: 0, positionIM: 300, leverage: 10, isolated: false, positionIdx: 0, openedAt: 1, ...o,
})
const order = (o: Partial<OrderRequest> = {}): OrderRequest => ({ symbol: 'BTCUSDT', side: 'Sell', qty: '0.02', positionIdx: 0, reduceOnly: true, orderLinkId: crypto.randomUUID(), ...o })

test('a reduce-only close reduces the position, then removes it, and never flips it', async () => {
  const ex = new FakeExchange()
  ex.list = [long()]
  await ex.placeOrder(order({ qty: '0.03' }))
  assert.equal(ex.list[0].size, 0.02)
  assert.equal(ex.list[0].positionIM, 120)
  await assert.rejects(ex.placeOrder(order({ qty: '0.021' })), { name: 'ExchangeRejected', message: /110017/ })
  await assert.rejects(ex.placeOrder(order({ side: 'Buy' })), { name: 'ExchangeRejected', message: /110017/ })
  await ex.placeOrder(order({ qty: '0.02' }))
  assert.deepEqual(ex.list, [])
  await assert.rejects(ex.placeOrder(order()), { name: 'ExchangeRejected', message: /110017/ })
  assert.deepEqual(ex.calls.map(c => c.type), ['order', 'order'])
})

test('a second order with the same orderLinkId is a duplicate, as on a Bybit resend', async () => {
  const ex = new FakeExchange()
  ex.prices = { ETHUSDT: 3000 }
  const o = order({ symbol: 'ETHUSDT', side: 'Buy', qty: '0.1', reduceOnly: false })
  await ex.placeOrder(o)
  await assert.rejects(ex.placeOrder(o), { name: 'ExchangeRejected', message: 'Duplicate orderLinkId (Bybit 110072)' })
  assert.equal(ex.list[0].size, 0.1)
  assert.equal(ex.fills.length, 1)
})

test('fills carry the order, its link id, nothing left to fill, and now()', async () => {
  const ex = new FakeExchange()
  ex.now = () => 1_700_000_000_000
  ex.prices = { ETHUSDT: 3000 }
  const { orderId } = await ex.placeOrder(order({ symbol: 'ETHUSDT', side: 'Buy', qty: '0.1', reduceOnly: false, orderLinkId: 'p1-e1' }))
  const [f] = await ex.fillsSince(0)
  assert.deepEqual({ ...f, id: '' }, { id: '', orderId, orderLinkId: 'p1-e1', symbol: 'ETHUSDT', side: 'Buy', qty: 0.1, price: 3000, leavesQty: 0, time: 1_700_000_000_000 })
})

test('an open takes leverage, margin and attached stops; an increase averages the entry', async () => {
  const ex = new FakeExchange()
  ex.now = () => 5
  ex.prices = { ETHUSDT: 3000 }
  ex.leverage = { ETHUSDT: 5 }
  await ex.placeOrder(order({ symbol: 'ETHUSDT', side: 'Buy', qty: '1', reduceOnly: false, positionIdx: 1, stopLoss: 2900, takeProfit: 3300 }))
  assert.deepEqual(ex.list[0], {
    symbol: 'ETHUSDT', side: 'Buy', size: 1, entryPrice: 3000, markPrice: 3000, liqPrice: 0, unrealisedPnl: 0,
    stopLoss: 2900, takeProfit: 3300, positionIM: 600, leverage: 5, isolated: false, positionIdx: 1, openedAt: 5,
  })
  ex.prices.ETHUSDT = 3300
  await ex.placeOrder(order({ symbol: 'ETHUSDT', side: 'Buy', qty: '2', reduceOnly: false, positionIdx: 1 }))
  assert.equal(ex.list[0].size, 3)
  assert.equal(ex.list[0].entryPrice, 3200)
  assert.equal(ex.list[0].positionIM, 1920)
})

test('hedge mode: setStop and setTakeProfit hit the slot with that positionIdx', async () => {
  const ex = new FakeExchange()
  ex.list = [long({ positionIdx: 1 }), long({ side: 'Sell', positionIdx: 2 })]
  await ex.setStop('BTCUSDT', 2, 63000)
  await ex.setTakeProfit('BTCUSDT', 1, 65000)
  assert.deepEqual(ex.list.map(p => [p.positionIdx, p.stopLoss, p.takeProfit]), [[1, 0, 65000], [2, 63000, 0]])
  assert.deepEqual(ex.calls[0], { type: 'setStop', symbol: 'BTCUSDT', positionIdx: 2, price: 63000 })
})

test('failNext: a string is a clear rejection, an Error is thrown as is, and nothing is written', async () => {
  const ex = new FakeExchange()
  ex.list = [long()]
  ex.failNext = 'Bybit 110017: reduce-only'
  await assert.rejects(ex.placeOrder(order()), { name: 'ExchangeRejected', message: 'Bybit 110017: reduce-only' })
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
  ex.failNext = timeout
  await assert.rejects(ex.setStop('BTCUSDT', 0, 59000), e => e === timeout)
  assert.deepEqual(ex.calls, [])
  assert.equal(ex.list[0].stopLoss, 0)
  await ex.setStop('BTCUSDT', 0, 59000) // only the next write fails
  assert.equal(ex.list[0].stopLoss, 59000)
})

test('cancel removes the open order; an unknown orderId is a clear rejection', async () => {
  const ex = new FakeExchange()
  ex.orders = [{ orderId: 'o1', orderLinkId: '', symbol: 'BTCUSDT', side: 'Sell', orderType: 'Market', price: 0, qty: 0.02, leavesQty: 0.02, reduceOnly: true, stopOrderType: 'PartialStopLoss', triggerBy: 'MarkPrice', triggerPrice: 58000, positionIdx: 0, status: 'Untriggered' }]
  await assert.rejects(ex.cancelOrder('BTCUSDT', 'nope'), { name: 'ExchangeRejected' })
  await ex.cancelOrder('BTCUSDT', 'o1')
  assert.deepEqual(await ex.openOrders(), [])
  assert.deepEqual(ex.calls, [{ type: 'cancel', symbol: 'BTCUSDT', orderId: 'o1' }])
})

test('ticker: last from prices, else the mark; index from its override, else the mark', async () => {
  const ex = new FakeExchange()
  ex.list = [long()]
  assert.deepEqual(await ex.ticker('BTCUSDT'), { last: 61000, mark: 61000, index: 61000 })
  ex.prices = { BTCUSDT: 61050 }
  ex.index = { BTCUSDT: 60990 }
  assert.deepEqual(await ex.ticker('BTCUSDT'), { last: 61050, mark: 61000, index: 60990 })
  await assert.rejects(ex.ticker('NOPEUSDT'), { name: 'ExchangeRejected' })
})

test('slots: the positions of a symbol, or one empty slot when flat', async () => {
  const ex = new FakeExchange()
  ex.list = [long({ positionIdx: 1 })]
  ex.leverage = { ETHUSDT: 3 }
  assert.deepEqual(await ex.slots('BTCUSDT'), [{ positionIdx: 1, leverage: 10, size: 0.05 }])
  assert.deepEqual(await ex.slots('ETHUSDT'), [{ positionIdx: 0, leverage: 3, size: 0 }])
})
