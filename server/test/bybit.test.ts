import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertTestnet, createBybit, sign } from '../src/bybit.ts'

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

const instruments = ok({ list: [{ symbol: 'BTCUSDT', priceFilter: { tickSize: '0.10' }, lotSizeFilter: { qtyStep: '0.001', minOrderQty: '0.001' } }] })

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
      { symbol: 'BTCUSDT', side: 'Buy', size: '0.05', avgPrice: '62000', markPrice: '61000', liqPrice: '59500', unrealisedPnl: '-50', stopLoss: '', tradeMode: 1, positionIdx: 0, createdTime: '1600000000000', updatedTime: '1699999000000' },
      { symbol: 'ETHUSDT', side: '', size: '0', avgPrice: '0', markPrice: '3000', liqPrice: '', unrealisedPnl: '0', stopLoss: '0', tradeMode: 0, positionIdx: 0, createdTime: '1600000000000', updatedTime: '1699999000000' },
    ] }),
  })
  assert.deepEqual(await ex.positions(), [{
    symbol: 'BTCUSDT', side: 'Buy', size: 0.05, entryPrice: 62000, markPrice: 61000, liqPrice: 59500,
    unrealisedPnl: -50, stopLoss: 0, isolated: true, positionIdx: 0, openedAt: 1699999000000,
  }])
})

test('throws on a non-zero retCode', async () => {
  const { ex } = client({ '/v5/position/list': { retCode: 10001, retMsg: 'params error', result: {} } })
  await assert.rejects(ex.positions(), { message: 'Bybit 10001: params error', name: 'ExchangeRejected' })
})

test('a Bybit server error is not a clear rejection: the write may have gone through', async () => {
  const { ex } = client({ '/v5/position/list': { retCode: 10016, retMsg: 'Internal server error', result: {} } })
  await assert.rejects(ex.positions(), { message: 'Bybit 10016: Internal server error', name: 'Error' })
})

test('market order rounds qty down to the step', async () => {
  const { ex, calls } = client({
    '/v5/market/instruments-info': instruments,
    '/v5/market/tickers': ok({ list: [{ symbol: 'BTCUSDT', lastPrice: '61000' }] }),
  })
  await ex.marketOrder('BTCUSDT', 'Buy', 200)
  const post = calls.find(c => c.url.pathname === '/v5/order/create')!
  const { orderLinkId, ...rest } = JSON.parse(String(post.init.body))
  assert.match(orderLinkId, /^[0-9a-f-]{36}$/) // Bybit allows up to 36 characters
  assert.deepEqual(rest, { category: 'linear', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: '0.003' })
})

const limited = { retCode: 10006, retMsg: 'Too many visits!', result: {} }
const ticker = ok({ list: [{ symbol: 'BTCUSDT', lastPrice: '61000' }] })

test('a rate-limited order is resent once with the same body, so the same orderLinkId', async () => {
  const { ex, calls, waits } = client({ '/v5/market/instruments-info': instruments, '/v5/market/tickers': ticker, '/v5/order/create': [limited, ok({})] })
  await ex.marketOrder('BTCUSDT', 'Buy', 200)
  const posts = calls.filter(c => c.url.pathname === '/v5/order/create')
  assert.equal(posts.length, 2)
  assert.equal(posts[1].init.body, posts[0].init.body)
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
  assert.equal(await resent.ex.lastPrice('BTCUSDT'), 61000)
  assert.equal(resent.calls.length, 3)

  const gaveUp = client({ '/v5/market/tickers': [403, 403, 403].map(status => new Response('', { status })) })
  await assert.rejects(gaveUp.ex.lastPrice('BTCUSDT'), { message: 'Bybit HTTP 403', name: 'ExchangeRejected' })

  const unknown = client({ '/v5/market/tickers': [new Response('', { status: 502 }), ticker] })
  await assert.rejects(unknown.ex.lastPrice('BTCUSDT'), { message: 'Bybit HTTP 502', name: 'Error' })
  assert.equal(unknown.calls.length, 1)
})

test('market order qty survives float noise', async () => {
  const { ex, calls } = client({
    '/v5/market/instruments-info': ok({ list: [{ symbol: 'XUSDT', priceFilter: { tickSize: '0.01' }, lotSizeFilter: { qtyStep: '0.1', minOrderQty: '0.1' } }] }),
    '/v5/market/tickers': ok({ list: [{ symbol: 'XUSDT', lastPrice: '1' }] }),
  })
  await ex.marketOrder('XUSDT', 'Buy', 0.3) // 0.3 / 1 / 0.1 = 2.9999999999999996 in floats
  const post = calls.find(c => c.url.pathname === '/v5/order/create')!
  assert.equal(JSON.parse(String(post.init.body)).qty, '0.3')
})

test('market order below the minimum is refused before sending', async () => {
  const { ex, calls } = client({
    '/v5/market/instruments-info': instruments,
    '/v5/market/tickers': ok({ list: [{ symbol: 'BTCUSDT', lastPrice: '61000' }] }),
  })
  await assert.rejects(ex.marketOrder('BTCUSDT', 'Buy', 30), { message: 'Amount too small: min 0.001 BTC is about $61' })
  assert.equal(calls.some(c => c.url.pathname === '/v5/order/create'), false)
})

test('known exchange codes read as a sentence, the Bybit code last', async () => {
  const { ex } = client({ '/v5/position/list': { retCode: 110007, retMsg: 'ab not enough for new order', result: {} } })
  await assert.rejects(ex.positions(), { message: 'Not enough balance (Bybit 110007)', name: 'ExchangeRejected' })
})

test('stop price is rounded to the tick size', async () => {
  const { ex, calls } = client({ '/v5/market/instruments-info': instruments })
  await ex.setStop('BTCUSDT', 0, 60760.04)
  const post = calls.find(c => c.url.pathname === '/v5/position/trading-stop')!
  assert.deepEqual(JSON.parse(String(post.init.body)), { category: 'linear', symbol: 'BTCUSDT', stopLoss: '60760', tpslMode: 'Full', positionIdx: 0 })
})

test('stop with a 1e-7 tick keeps its digits', async () => {
  const { ex, calls } = client({ '/v5/market/instruments-info': ok({ list: [{ symbol: '1000PEPEUSDT', priceFilter: { tickSize: '0.0000001' }, lotSizeFilter: { qtyStep: '100', minOrderQty: '100' } }] }) })
  await ex.setStop('1000PEPEUSDT', 0, 0.01234567)
  const post = calls.find(c => c.url.pathname === '/v5/position/trading-stop')!
  assert.equal(JSON.parse(String(post.init.body)).stopLoss, '0.0123457')
})

test('a stop that rounds to zero is refused before sending', async () => {
  const { ex, calls } = client({ '/v5/market/instruments-info': instruments })
  await assert.rejects(ex.setStop('BTCUSDT', 0, 0.01), { message: 'Bad stop price' })
  assert.equal(calls.some(c => c.url.pathname === '/v5/position/trading-stop'), false)
})

test('isolated comes from the unified account margin mode', async () => {
  const { ex } = client({
    '/v5/account/info': ok({ marginMode: 'ISOLATED_MARGIN' }),
    '/v5/position/list': ok({ list: [{ symbol: 'BTCUSDT', side: 'Buy', size: '0.05', avgPrice: '62000', markPrice: '61000', liqPrice: '59500', unrealisedPnl: '-50', stopLoss: '', tradeMode: 0, positionIdx: 0, createdTime: '1', updatedTime: '1' }] }),
  })
  assert.equal((await ex.positions())[0].isolated, true)
})

test('requests carry a timeout signal', async () => {
  const { ex, calls } = client({ '/v5/market/tickers': ok({ list: [{ lastPrice: '1' }] }) })
  await ex.lastPrice('BTCUSDT')
  assert.ok(calls[0].init.signal instanceof AbortSignal)
})

test('sums closed pnl since a time', async () => {
  const { ex, calls } = client({ '/v5/position/closed-pnl': ok({ list: [{ closedPnl: '-30.5' }, { closedPnl: '10' }] }) })
  assert.equal(await ex.closedPnlSince(123), -20.5)
  assert.equal(calls[0].url.searchParams.get('startTime'), '123')
})

test('maps fills', async () => {
  const { ex } = client({ '/v5/execution/list': ok({ list: [{ execId: 'e1', symbol: 'BTCUSDT', side: 'Sell', execQty: '0.01', execPrice: '61000.5', execTime: '1700000001000' }] }) })
  assert.deepEqual(await ex.fillsSince(1), [{ id: 'e1', symbol: 'BTCUSDT', side: 'Sell', qty: 0.01, price: 61000.5, time: 1700000001000 }])
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

test('transfer moves USDT from Funding to Unified', async () => {
  const { ex, calls } = client({})
  await ex.transferToTrading(100)
  const { transferId, ...rest } = JSON.parse(String(calls[0].init.body))
  assert.equal(calls[0].url.pathname, '/v5/asset/transfer/inter-transfer')
  assert.match(transferId, /^[0-9a-f-]{36}$/)
  assert.deepEqual(rest, { coin: 'USDT', amount: '100', fromAccountType: 'FUND', toAccountType: 'UNIFIED' })
})

test('assertTestnet accepts only testnet and demo hosts', () => {
  assert.throws(() => assertTestnet('https://api.bybit.com'))
  assert.throws(() => assertTestnet('https://api-testnet.bybit.com.evil.io'))
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
