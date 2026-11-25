import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertTestnet, createBybit, sign, toStep } from '../src/bybit.ts'
import type { OrderRequest } from '../src/types.ts'

const TS = 1_700_000_000_000

type Call = { url: URL; init: RequestInit }

/** A route is one reply for every call, or an array of replies used in turn. A reply is a JSON body or a Response. */
function fakeFetch(routes: Record<string, unknown>) {
  const calls: Call[] = []
  const fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    calls.push({ url, init })
    const route = routes[url.pathname]
    const body = (Array.isArray(route) ? route.shift() : route) ?? { retCode: 0, retMsg: 'OK', result: {} }
    return body instanceof Response ? body : new Response(JSON.stringify(body), { status: 200 })
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

const client = (routes: Record<string, unknown>) => {
  const f = fakeFetch(routes)
  const waits: number[] = []
  const sleep = async (ms: number) => { waits.push(ms) }
  const ex = createBybit({ key: 'k', secret: 's', base: 'https://api-testnet.bybit.com', fetch: f.fetch, now: () => TS, sleep })
  return { ex, calls: f.calls, waits }
}

const ok = (result: unknown) => ({ retCode: 0, retMsg: 'OK', result })
const bodyOf = (calls: Call[], path: string) => JSON.parse(String(calls.find(c => c.url.pathname === path)!.init.body))

const instruments = ok({ list: [{ symbol: 'BTCUSDT', priceFilter: { tickSize: '0.10' }, lotSizeFilter: { qtyStep: '0.001', minOrderQty: '0.001', maxMktOrderQty: '119', minNotionalValue: '5' } }] })
const order: OrderRequest = { symbol: 'BTCUSDT', side: 'Sell', qty: '0.025', positionIdx: 0, reduceOnly: true, orderLinkId: 'p1-e1' }

test('signs GET with the query string', async () => {
  const { ex, calls } = client({ '/v5/position/list': ok({ list: [] }) })
  await ex.positions()
  const h = new Headers(calls[0].init.headers)
  assert.equal(h.get('X-BAPI-API-KEY'), 'k')
  assert.equal(h.get('X-BAPI-TIMESTAMP'), String(TS))
  assert.equal(h.get('X-BAPI-RECV-WINDOW'), '5000')
  assert.equal(h.get('X-BAPI-SIGN'), sign('s', `${TS}k5000category=linear&settleCoin=USDT&limit=200`))
})

test('signs POST with the JSON body', async () => {
  const { ex, calls } = client({ '/v5/market/instruments-info': instruments })
  await ex.addMargin('BTCUSDT', 0, 100)
  const post = calls.find(c => c.url.pathname === '/v5/position/add-margin')!
  const body = String(post.init.body)
  assert.deepEqual(JSON.parse(body), { category: 'linear', symbol: 'BTCUSDT', margin: '100', positionIdx: 0 })
  assert.equal(new Headers(post.init.headers).get('X-BAPI-SIGN'), sign('s', `${TS}k5000${body}`))
})

test('parses positions and skips empty ones', async () => {
  const { ex } = client({
    '/v5/position/list': ok({ list: [
      { symbol: 'BTCUSDT', side: 'Buy', size: '0.05', avgPrice: '62000', markPrice: '61000', liqPrice: '59500', unrealisedPnl: '-50', stopLoss: '', takeProfit: '65000', positionIM: '310.5', leverage: '10', tradeMode: 1, positionIdx: 0, createdTime: '1600000000000', updatedTime: '1699999000000' },
      { symbol: 'ETHUSDT', side: '', size: '0', avgPrice: '0', markPrice: '3000', liqPrice: '', unrealisedPnl: '0', stopLoss: '0', takeProfit: '', positionIM: '', leverage: '10', tradeMode: 0, positionIdx: 0, createdTime: '1600000000000', updatedTime: '1699999000000' },
    ] }),
  })
  assert.deepEqual(await ex.positions(), [{
    symbol: 'BTCUSDT', side: 'Buy', size: 0.05, entryPrice: 62000, markPrice: 61000, liqPrice: 59500,
    unrealisedPnl: -50, stopLoss: 0, takeProfit: 65000, positionIM: 310.5, leverage: 10, isolated: true, positionIdx: 0, openedAt: 1699999000000,
  }])
})

test('position fields Bybit leaves empty read as 0', async () => {
  const { ex } = client({ '/v5/position/list': ok({ list: [{ symbol: 'BTCUSDT', side: 'Buy', size: '0.05', avgPrice: '62000', markPrice: '61000', takeProfit: '', positionIM: '', leverage: '', positionIdx: 0 }] }) })
  const [p] = await ex.positions()
  assert.deepEqual([p.takeProfit, p.positionIM, p.leverage], [0, 0, 0])
})

test('throws on a non-zero retCode', async () => {
  const { ex } = client({ '/v5/position/list': { retCode: 10001, retMsg: 'params error', result: {} } })
  await assert.rejects(ex.positions(), { message: 'Bybit 10001: params error', name: 'ExchangeRejected' })
})

test('a Bybit server error is not a clear rejection: the write may have gone through', async () => {
  const { ex } = client({ '/v5/position/list': { retCode: 10016, retMsg: 'Internal server error', result: {} } })
  await assert.rejects(ex.positions(), { message: 'Bybit 10016: Internal server error', name: 'Error' })
})

test('toStep rounds to the step without float noise', () => {
  assert.equal(toStep(200 / 61000, '0.001', Math.floor), '0.003')
  assert.equal(toStep(0.3 / 1, '0.1', Math.floor), '0.3') // 0.3 / 0.1 = 2.9999999999999996 in floats
  assert.equal(toStep(60760.04, '0.10', Math.round), '60760')
  assert.equal(toStep(0.01234567, '0.0000001', Math.round), '0.0123457')
  assert.equal(toStep(1234, '100', Math.floor), '1200')
})

test('placeOrder sends the authorized qty as given, with reduceOnly, positionIdx and orderLinkId', async () => {
  const { ex, calls } = client({ '/v5/order/create': ok({ orderId: 'o-1', orderLinkId: 'p1-e1' }) })
  assert.deepEqual(await ex.placeOrder(order), { orderId: 'o-1' })
  assert.deepEqual(bodyOf(calls, '/v5/order/create'), {
    category: 'linear', symbol: 'BTCUSDT', side: 'Sell', orderType: 'Market', qty: '0.025', positionIdx: 0, reduceOnly: true, orderLinkId: 'p1-e1',
  })
  assert.equal(calls.length, 1)
})

test('placeOrder attaches stop and take profit rounded to the tick, never closeOnTrigger', async () => {
  const { ex, calls } = client({ '/v5/market/instruments-info': instruments, '/v5/order/create': ok({ orderId: 'o-2' }) })
  await ex.placeOrder({ ...order, side: 'Buy', reduceOnly: false, positionIdx: 1, stopLoss: 59999.96, takeProfit: 65000.04 })
  const body = bodyOf(calls, '/v5/order/create')
  assert.deepEqual(body, {
    category: 'linear', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: '0.025', positionIdx: 1, reduceOnly: false, orderLinkId: 'p1-e1',
    stopLoss: '60000', takeProfit: '65000',
  })
  assert.equal('closeOnTrigger' in body, false)
})

test('placeOrder refuses a qty that is not above 0 before sending', async () => {
  const { ex, calls } = client({})
  for (const qty of ['0', '-0.01', '', 'abc']) {
    await assert.rejects(ex.placeOrder({ ...order, qty }), { name: 'ExchangeRejected' })
  }
  assert.equal(calls.length, 0)
})

const limited = { retCode: 10006, retMsg: 'Too many visits!', result: {} }
const ticker = ok({ list: [{ symbol: 'BTCUSDT', lastPrice: '61000', markPrice: '61010.5', indexPrice: '61005' }] })

test('a rate-limited order is resent once with the same body, so the same orderLinkId', async () => {
  const { ex, calls, waits } = client({ '/v5/order/create': [limited, ok({ orderId: 'o-3' })] })
  assert.deepEqual(await ex.placeOrder(order), { orderId: 'o-3' })
  const posts = calls.filter(c => c.url.pathname === '/v5/order/create')
  assert.equal(posts.length, 2)
  assert.equal(posts[1].init.body, posts[0].init.body)
  assert.equal(JSON.parse(String(posts[1].init.body)).orderLinkId, 'p1-e1')
  assert.deepEqual(waits, [250])
})

test('still rate-limited after two resends: a clear no, safe to offer again', async () => {
  const { ex, calls, waits } = client({ '/v5/position/list': [limited, limited, limited, ok({ list: [] })] })
  await assert.rejects(ex.positions(), { message: 'Too many requests, try again shortly (Bybit 10006)', name: 'ExchangeRejected' })
  assert.equal(calls.length, 3)
  assert.deepEqual(waits, [250, 750])
})

test('HTTP 429 and 403 are resent; other HTTP errors are not, their result is unknown', async () => {
  const resent = client({ '/v5/market/tickers': [new Response('', { status: 429 }), new Response('', { status: 403 }), ticker] })
  assert.equal((await resent.ex.ticker('BTCUSDT')).last, 61000)
  assert.equal(resent.calls.length, 3)

  const gaveUp = client({ '/v5/market/tickers': [403, 403, 403].map(status => new Response('', { status })) })
  await assert.rejects(gaveUp.ex.ticker('BTCUSDT'), { message: 'Bybit HTTP 403', name: 'ExchangeRejected' })

  const unknown = client({ '/v5/market/tickers': [new Response('', { status: 502 }), ticker] })
  await assert.rejects(unknown.ex.ticker('BTCUSDT'), { message: 'Bybit HTTP 502', name: 'Error' })
  assert.equal(unknown.calls.length, 1)
})

test('ticker: last, mark and index; an unknown symbol is a rejection', async () => {
  const { ex, calls } = client({ '/v5/market/tickers': [ticker, ok({ list: [] })] })
  assert.deepEqual(await ex.ticker('BTCUSDT'), { last: 61000, mark: 61010.5, index: 61005 })
  assert.equal(calls[0].url.search, '?category=linear&symbol=BTCUSDT')
  await assert.rejects(ex.ticker('NOPEUSDT'), { message: 'Unknown symbol NOPEUSDT', name: 'ExchangeRejected' })
})

test('kline asks the path of each price source, 1-minute, and reads start and close', async () => {
  const rows = ok({ list: [['1700000060000', '61000', '61100', '60900', '61050.5', '12', '700000'], ['1700000000000', '60900', '61000', '60800', '61000', '9', '500000']] })
  const { ex, calls } = client({ '/v5/market/kline': rows, '/v5/market/mark-price-kline': rows, '/v5/market/index-price-kline': rows })
  assert.deepEqual(await ex.kline('BTCUSDT', 'LAST', 2), [{ start: 1700000060000, close: 61050.5, volume: 12 }, { start: 1700000000000, close: 61000, volume: 9 }])
  await ex.kline('BTCUSDT', 'MARK', 5000)
  await ex.kline('BTCUSDT', 'INDEX', 30)
  assert.deepEqual(calls.map(c => c.url.pathname), ['/v5/market/kline', '/v5/market/mark-price-kline', '/v5/market/index-price-kline'])
  assert.equal(calls[0].url.search, '?category=linear&symbol=BTCUSDT&interval=1&limit=2')
  assert.equal(calls[1].url.searchParams.get('limit'), '1000') // Bybit's maximum
})

test('openOrders maps plain and conditional orders, a partial stop included', async () => {
  const { ex, calls } = client({ '/v5/order/realtime': ok({ list: [
    { orderId: 'a', orderLinkId: '', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Limit', price: '60000', qty: '0.01', leavesQty: '0.01', reduceOnly: false, stopOrderType: '', triggerBy: '', triggerPrice: '', positionIdx: 0, orderStatus: 'New' },
    { orderId: 'b', orderLinkId: 'x', symbol: 'BTCUSDT', side: 'Sell', orderType: 'Market', price: '0', qty: '0.02', leavesQty: '0.02', reduceOnly: true, stopOrderType: 'PartialStopLoss', triggerBy: 'MarkPrice', triggerPrice: '59000', positionIdx: 1, orderStatus: 'Untriggered' },
  ] }) })
  assert.deepEqual(await ex.openOrders(), [
    { orderId: 'a', orderLinkId: '', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Limit', price: 60000, qty: 0.01, leavesQty: 0.01, reduceOnly: false, stopOrderType: '', triggerBy: '', triggerPrice: 0, positionIdx: 0, status: 'New' },
    { orderId: 'b', orderLinkId: 'x', symbol: 'BTCUSDT', side: 'Sell', orderType: 'Market', price: 0, qty: 0.02, leavesQty: 0.02, reduceOnly: true, stopOrderType: 'PartialStopLoss', triggerBy: 'MarkPrice', triggerPrice: 59000, positionIdx: 1, status: 'Untriggered' },
  ])
  assert.equal(calls[0].url.search, '?category=linear&settleCoin=USDT&limit=50')
})

test('cancelOrder sends symbol and orderId', async () => {
  const { ex, calls } = client({})
  await ex.cancelOrder('BTCUSDT', 'o-9')
  assert.equal(calls[0].url.pathname, '/v5/order/cancel')
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { category: 'linear', symbol: 'BTCUSDT', orderId: 'o-9' })
})

test('apiKeyInfo reads readOnly and the permissions', async () => {
  const permissions = { ContractTrade: ['Order', 'Position'], Wallet: [] }
  const { ex, calls } = client({ '/v5/user/query-api': [ok({ readOnly: 0, permissions }), ok({ readOnly: 1 })] })
  assert.deepEqual(await ex.apiKeyInfo(), { readOnly: false, permissions })
  assert.deepEqual(await ex.apiKeyInfo(), { readOnly: true, permissions: {} })
  assert.equal(calls[0].url.pathname, '/v5/user/query-api')
})

test('instrument carries the market order max and the minimum notional, 0 when Bybit sends none', async () => {
  const { ex, calls } = client({ '/v5/market/instruments-info': [instruments, ok({ list: [{ priceFilter: { tickSize: '0.01' }, lotSizeFilter: { qtyStep: '0.1', minOrderQty: '0.1', maxMktOrderQty: '5000' } }] })] })
  assert.deepEqual(await ex.instrument('BTCUSDT'), { tickSize: '0.10', qtyStep: '0.001', minOrderQty: 0.001, maxMktOrderQty: 119, minNotionalValue: 5 })
  await ex.instrument('BTCUSDT') // cached
  assert.equal((await ex.instrument('XUSDT')).minNotionalValue, 0)
  assert.equal(calls.length, 2)
})

test('slots keep the empty rows: leverage is set per slot', async () => {
  const { ex, calls } = client({ '/v5/position/list': ok({ list: [
    { symbol: 'BTCUSDT', side: 'Buy', size: '0.05', leverage: '10', positionIdx: 1 },
    { symbol: 'BTCUSDT', side: '', size: '0', leverage: '5', positionIdx: 2 },
  ] }) })
  assert.deepEqual(await ex.slots('BTCUSDT'), [{ positionIdx: 1, leverage: 10, size: 0.05 }, { positionIdx: 2, leverage: 5, size: 0 }])
  assert.equal(calls[0].url.search, '?category=linear&symbol=BTCUSDT')
})

test('known exchange codes read as a sentence, the Bybit code last', async () => {
  const { ex } = client({ '/v5/position/list': { retCode: 110007, retMsg: 'ab not enough for new order', result: {} } })
  await assert.rejects(ex.positions(), { message: 'Not enough balance (Bybit 110007)', name: 'ExchangeRejected' })
})

test('stop price is rounded to the tick size', async () => {
  const { ex, calls } = client({ '/v5/market/instruments-info': instruments })
  await ex.setStop('BTCUSDT', 0, 60760.04)
  assert.deepEqual(bodyOf(calls, '/v5/position/trading-stop'), { category: 'linear', symbol: 'BTCUSDT', stopLoss: '60760', tpslMode: 'Full', positionIdx: 0 })
})

test('stop with a 1e-7 tick keeps its digits', async () => {
  const { ex, calls } = client({ '/v5/market/instruments-info': ok({ list: [{ symbol: '1000PEPEUSDT', priceFilter: { tickSize: '0.0000001' }, lotSizeFilter: { qtyStep: '100', minOrderQty: '100' } }] }) })
  await ex.setStop('1000PEPEUSDT', 0, 0.01234567)
  assert.equal(bodyOf(calls, '/v5/position/trading-stop').stopLoss, '0.0123457')
})

test('a stop that rounds to zero is refused before sending', async () => {
  const { ex, calls } = client({ '/v5/market/instruments-info': instruments })
  await assert.rejects(ex.setStop('BTCUSDT', 0, 0.01), { message: 'Bad stop price' })
  assert.equal(calls.some(c => c.url.pathname === '/v5/position/trading-stop'), false)
})

test('take profit is rounded to the tick and sends no stopLoss, so Bybit keeps the stop', async () => {
  const { ex, calls } = client({ '/v5/market/instruments-info': instruments })
  await ex.setTakeProfit('BTCUSDT', 2, 65000.06)
  assert.deepEqual(bodyOf(calls, '/v5/position/trading-stop'), { category: 'linear', symbol: 'BTCUSDT', takeProfit: '65000.1', tpslMode: 'Full', positionIdx: 2 })
  await assert.rejects(ex.setTakeProfit('BTCUSDT', 0, 0.01), { message: 'Bad take profit price', name: 'ExchangeRejected' })
  assert.equal(calls.filter(c => c.url.pathname === '/v5/position/trading-stop').length, 1)
})

test('isolated comes from the unified account margin mode', async () => {
  const { ex } = client({
    '/v5/account/info': ok({ marginMode: 'ISOLATED_MARGIN' }),
    '/v5/position/list': ok({ list: [{ symbol: 'BTCUSDT', side: 'Buy', size: '0.05', avgPrice: '62000', markPrice: '61000', liqPrice: '59500', unrealisedPnl: '-50', stopLoss: '', tradeMode: 0, positionIdx: 0, createdTime: '1', updatedTime: '1' }] }),
  })
  assert.equal((await ex.positions())[0].isolated, true)
})

test('requests carry a timeout signal', async () => {
  const { ex, calls } = client({ '/v5/market/tickers': ticker })
  await ex.ticker('BTCUSDT')
  assert.ok(calls[0].init.signal instanceof AbortSignal)
})

test('maps fills with their order and what is still open, a full page at a time', async () => {
  const { ex, calls } = client({ '/v5/execution/list': ok({ list: [{ execId: 'e1', orderId: 'o1', orderLinkId: 'p1-e1', symbol: 'BTCUSDT', side: 'Sell', execQty: '0.01', execPrice: '61000.5', leavesQty: '0.015', execTime: '1700000001000' }] }) })
  const got = await ex.fillsSince(1)
  assert.equal(calls[0].url.searchParams.get('limit'), '100')
  assert.deepEqual(got, [{ id: 'e1', orderId: 'o1', orderLinkId: 'p1-e1', symbol: 'BTCUSDT', side: 'Sell', qty: 0.01, price: 61000.5, leavesQty: 0.015, time: 1700000001000 }])
})

test('funding payments are not fills, a liquidation is', async () => {
  const row = (execId: string, execType: string) => ({ execId, execType, symbol: 'BTCUSDT', side: 'Sell', execQty: '0.05', execPrice: '59500', execTime: '1700000001000' })
  const { ex } = client({ '/v5/execution/list': ok({ list: [row('t', 'Trade'), row('f', 'Funding'), row('b', 'BustTrade')] }) })
  assert.deepEqual((await ex.fillsSince(1)).map(f => f.id), ['t', 'b'])
})

test('positions ask for the 200 maximum: the default page is 20', async () => {
  const { ex, calls } = client({ '/v5/position/list': ok({ list: [] }) })
  await ex.positions()
  assert.equal(calls[0].url.searchParams.get('limit'), '200')
})

test('assertTestnet accepts only testnet and demo hosts', () => {
  assert.throws(() => assertTestnet('https://api.bybit.com'))
  assert.throws(() => assertTestnet('https://api-testnet.bybit.com.evil.io'))
  for (const base of ['http://api-testnet.bybit.com', 'https://api-demo.bybit.com:8443', 'https://user@api-testnet.bybit.com']) {
    assert.throws(() => createBybit({ base, key: '', secret: '' }))
  }
  assertTestnet('https://api-testnet.bybit.com')
  assertTestnet('https://api-demo.bybit.com')
})

test('balance: unified equity and what is free to use', async () => {
  const { ex, calls } = client({ '/v5/account/wallet-balance': ok({ list: [{ accountType: 'UNIFIED', totalEquity: '99.8736', totalAvailableBalance: '97.2' }] }) })
  assert.deepEqual(await ex.balance(), { equity: 99.8736, available: 97.2 })
  assert.equal(calls[0].url.search, '?accountType=UNIFIED')
  const empty = client({ '/v5/account/wallet-balance': ok({ list: [] }) })
  assert.deepEqual(await empty.ex.balance(), { equity: 0, available: 0 })
})

test('openedAt follows updatedTime: createdTime stays from the first trade of the symbol', async () => {
  const row = (updatedTime: string) => ({ symbol: 'ETHUSDT', side: 'Buy', size: '0.01', avgPrice: '1710', markPrice: '1710', liqPrice: '', unrealisedPnl: '0', stopLoss: '', tradeMode: 0, positionIdx: 0, createdTime: '1000', updatedTime })
  const { ex } = client({ '/v5/position/list': ok({ list: [row('1700000000500')] }), '/v5/account/info': ok({ marginMode: 'REGULAR_MARGIN' }) })
  assert.equal((await ex.positions())[0].openedAt, 1700000000500)
})

test('ticker reads the next funding as percent; a symbol without one has none', async () => {
  const perp = ok({ list: [{ symbol: 'BTCUSDT', lastPrice: '61000', markPrice: '61000', indexPrice: '61000', fundingRate: '-0.00025', nextFundingTime: '1700003600000' }] })
  const { ex } = client({ '/v5/market/tickers': [perp, ticker] })
  assert.deepEqual((await ex.ticker('BTCUSDT')).funding, { ratePct: -0.025, at: 1700003600000 })
  assert.equal((await ex.ticker('BTCUSDT')).funding, undefined)
})

test('fills say what closed the position: stop loss, trailing stop, take profit or liquidation', async () => {
  const row = (execId: string, o: object) => ({ execId, orderId: 'o', symbol: 'BTCUSDT', side: 'Sell', execQty: '0.01', execPrice: '60000', leavesQty: '0', execTime: '1', execType: 'Trade', stopOrderType: '', ...o })
  const { ex } = client({ '/v5/execution/list': ok({ list: [
    row('a', { stopOrderType: 'StopLoss' }), row('b', { stopOrderType: 'TrailingStop' }), row('c', { stopOrderType: 'PartialTakeProfit' }),
    row('d', { execType: 'BustTrade', stopOrderType: 'UNKNOWN' }), row('e', {}), row('f', { execType: 'Funding' }),
  ] }) })
  assert.deepEqual((await ex.fillsSince(0)).map(f => [f.id, f.closedBy]), [['a', 'SL'], ['b', 'SL'], ['c', 'TP'], ['d', 'LIQUIDATION'], ['e', undefined]])
})

test('openOrders keep when the order was placed', async () => {
  const { ex } = client({ '/v5/order/realtime': ok({ list: [{ orderId: 'a', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Limit', price: '1', qty: '1', leavesQty: '1', positionIdx: 0, orderStatus: 'New', createdTime: '1700000000000' }] }) })
  assert.equal((await ex.openOrders())[0].createdAt, 1700000000000)
})

test('order lookup: realtime first, then history, null when Bybit has neither', async () => {
  const row = { orderId: 'o9', orderStatus: 'Filled', cumExecQty: '0.025', avgPrice: '61000.5' }
  const live = client({ '/v5/order/realtime': ok({ list: [row] }) })
  assert.deepEqual(await live.ex.order('BTCUSDT', { orderLinkId: 'p1-e1' }), { orderId: 'o9', status: 'Filled', cumExecQty: 0.025, avgPrice: 61000.5 })
  assert.equal(live.calls[0].url.searchParams.get('orderLinkId'), 'p1-e1')
  assert.equal(live.calls[0].url.searchParams.get('symbol'), 'BTCUSDT')
  const old = client({ '/v5/order/realtime': ok({ list: [] }), '/v5/order/history': ok({ list: [{ ...row, orderStatus: 'Cancelled' }] }) })
  assert.equal((await old.ex.order('BTCUSDT', { orderId: 'o9' }))!.status, 'Cancelled')
  assert.equal(old.calls[1].url.searchParams.get('orderId'), 'o9')
  const none = client({ '/v5/order/realtime': ok({ list: [] }), '/v5/order/history': ok({ list: [] }) })
  assert.equal(await none.ex.order('BTCUSDT', { orderLinkId: 'x' }), null)
})
