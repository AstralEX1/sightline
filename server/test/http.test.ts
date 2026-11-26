import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createServer, type Transcribe } from '../src/http.ts'
import { tokenProblem } from '../src/config.ts'
import { createStore } from '../src/store.ts'
import { createSession } from '../src/session.ts'
import { createNotifier } from '../src/notify.ts'
import { FakeExchange } from '../src/fake-exchange.ts'
import { template as draft } from './removed-templates.ts'
import type { Position } from '../src/types.ts'

const btc: Position = {
  symbol: 'BTCUSDT', side: 'Buy', size: 0.05, entryPrice: 62000, markPrice: 61000, liqPrice: 59500, unrealisedPnl: -50,
  stopLoss: 60000, takeProfit: 0, positionIM: 310, leverage: 10, isolated: true, positionIdx: 0, openedAt: 0,
}

async function serve(o: { transcribe?: Transcribe; source?: string; telegram?: boolean } = {}) {
  const ex = new FakeExchange()
  ex.list = [structuredClone(btc)]
  const store = createStore(':memory:')
  store.seed()
  const notifier = o.telegram ? createNotifier({ store, token: 'test-bot' }) : undefined
  const session = createSession(ex, store, Date.now, notifier?.route)
  const server = createServer({ session, store, notifier, token: 'secret', apiKeyInfo: () => ex.apiKeyInfo(), ...o })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  after(() => server.close())
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = auth) => {
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : typeof body === 'string' || body instanceof Uint8Array ? body as BodyInit : JSON.stringify(body) })
    return { status: res.status, body: res.status === 204 ? null : await res.json() }
  }
  return { ex, store, session, call, base }
}

const auth = { Authorization: 'Bearer secret' }

test('every route needs the token, and OPTIONS answers CORS', async () => {
  const { call, base } = await serve()
  const opt = await fetch(`${base}/state`, { method: 'OPTIONS' })
  assert.equal(opt.status, 204)
  assert.equal(opt.headers.get('access-control-allow-origin'), '*')
  assert.match(opt.headers.get('access-control-allow-methods') ?? '', /DELETE/)
  assert.equal((await call('GET', '/state', undefined, {})).status, 401)
  assert.equal((await call('GET', '/state', undefined, { Authorization: 'Bearer wrong' })).status, 401)
  assert.equal((await call('POST', '/shortcuts/validate', '{}', {})).status, 401)
})

test('a short token is refused, loopback too: any web page can call localhost', () => {
  assert.match(tokenProblem('short') ?? '', /16/)
  assert.equal(tokenProblem('a'.repeat(16)), null)
  assert.match(tokenProblem('') ?? '', /APP_TOKEN/)
})

test('state tells the lens what only the server knows: voice and which account', async () => {
  const { session, call } = await serve({ transcribe: async () => '', source: 'Bybit testnet' })
  await session.tick()
  const { body } = await call('GET', '/state')
  assert.equal(body.voice, true)
  assert.equal(body.source, 'Bybit testnet')
  assert.equal(body.positions.length, 1)
  assert.equal(body.card, null)
})

test('phone state reads allow Telegram fallback; a lens heartbeat marks glasses active', async () => {
  const { store, session, call } = await serve({ telegram: true })
  store.saveTelegram({ offset: 0, chatId: 42 })
  const made = store.createShortcut({ ...draft(6), action: { type: 'NOTIFY' } })
  assert.ok(made.ok)
  await session.tick()

  await call('GET', '/state')
  assert.equal((await call('GET', '/state?client=lens', undefined, {})).status, 401)
  await session.test(made.shortcut.id)
  assert.deepEqual(store.history()[0].channels, ['telegram'])
  assert.equal(store.dueOutbox(Date.now()).length, 1)

  await call('GET', '/state?client=lens')
  const result = await session.test(made.shortcut.id)
  assert.deepEqual(store.alert(result.alertId!)?.channels, ['glasses'])
  assert.equal(store.dueOutbox(Date.now()).length, 1)
})

test('shortcuts: create, list as tiles, edit with the version, pause, enable, delete', async () => {
  const { call } = await serve()
  const made = await call('POST', '/shortcuts', { ...draft(6), enabled: true })
  assert.equal(made.status, 201)
  assert.equal(made.body.title, 'Close position')
  assert.deepEqual([made.body.summary, made.body.doSummary], ['Liq ≤ 3%', 'Close 50%'])
  const tiles = (await call('GET', '/shortcuts')).body
  assert.deepEqual(tiles.map((t: { summary: string; doSummary: string }) => [t.summary, t.doSummary]),
    [['“protect all”', 'SL at −2%'], ['“lock profits”', 'SL to entry'], ['Liq ≤ 3%', 'Close 50%']])

  const id = made.body.id
  const edit = { ...draft(6), name: 'Half off near liq', version: 1 }
  assert.equal((await call('PUT', `/shortcuts/${id}`, edit)).body.version, 2)
  assert.equal((await call('PUT', `/shortcuts/${id}`, edit)).status, 409) // made against an older version
  assert.equal((await call('PUT', `/shortcuts/${id}`, { ...draft(6) })).status, 400) // no version
  const bad = await call('PUT', `/shortcuts/${id}`, { ...draft(6), action: { type: 'INCREASE_POSITION', notionalUsdt: '100' }, version: 2 })
  assert.equal(bad.status, 400)
  assert.equal(bad.body.issues[0].conditionId, 'c1')

  assert.equal((await call('POST', `/shortcuts/${id}/pause`, { version: 2 })).body.enabled, false)
  assert.equal((await call('POST', `/shortcuts/${id}/enable`, {})).body.enabled, true)
  assert.equal((await call('DELETE', `/shortcuts/${id}?version=4`)).status, 204)
  assert.equal((await call('GET', `/shortcuts/${id}`)).status, 404)
  assert.equal((await call('POST', `/shortcuts/nope/enable`, {})).status, 404)
})

test('incomplete templates persist off until their required values are saved', async () => {
  const { call } = await serve()
  assert.equal((await call('POST', '/shortcuts', { templateId: 'unknown' })).status, 404)
  assert.equal((await call('POST', '/shortcuts', draft(10))).status, 400)
  const made = await call('POST', '/shortcuts', { templateId: 'tpl_10', enabled: true })
  assert.equal(made.status, 201)
  const { id } = made.body
  assert.equal(made.body.draft, true)
  assert.equal(made.body.enabled, false)
  assert.equal((await call('GET', '/shortcuts')).body.find((tile: { id: string }) => tile.id === id).draft, true)
  assert.equal((await call('GET', `/shortcuts/${id}`)).body.scope.symbol, '')
  assert.equal((await call('POST', `/shortcuts/${id}/enable`, { version: 1 })).status, 409)
  assert.equal((await call('POST', `/shortcuts/${id}/test`, {})).body.ok, false)

  const value = made.body
  value.scope.symbol = 'BTCUSDT'
  value.conditions.items[0].threshold = '61000'
  const saved = await call('PUT', `/shortcuts/${id}`, value)
  assert.equal(saved.status, 200)
  assert.equal(saved.body.draft, undefined)
  assert.equal(saved.body.enabled, false)
  assert.equal((await call('POST', `/shortcuts/${id}/enable`, { version: 2 })).body.enabled, true)

  const complete = await call('POST', '/shortcuts', { templateId: 'tpl_1' })
  assert.equal(complete.status, 201)
  assert.equal(complete.body.draft, undefined)
  assert.equal(complete.body.enabled, false)
})

test('two shortcuts cannot share a voice phrase', async () => {
  const { call } = await serve()
  const r = await call('POST', '/shortcuts', { ...draft(1), voicePhrase: 'protect all' })
  assert.equal(r.status, 400)
  assert.equal(r.body.error, 'Another shortcut already uses "protect all"')
})

test('validate flags the incompatible row and, when valid, the targets it matches now', async () => {
  const { session, call } = await serve()
  await session.tick()
  const incompatible = {
    scope: { type: 'ALL_POSITIONS' },
    conditions: { logic: 'ANY', items: [{ id: 'c1', type: 'PROFIT', unit: 'ROI_PERCENT', threshold: '30' }, { id: 'c2', type: 'NEAR_LIQUIDATION', distancePct: '5' }] },
    action: { type: 'INCREASE_POSITION', notionalUsdt: '100' },
    trigger: { mode: 'ONCE' },
    delivery: { glasses: true, phone: true },
  }
  assert.deepEqual((await call('POST', '/shortcuts/validate', incompatible)).body, {
    ok: false, issues: [{ code: 'incompatible_action', message: 'Liquidation distance is incompatible with Increase position', conditionId: 'c2' }],
  })
  const ok = (await call('POST', '/shortcuts/validate', draft(6))).body
  assert.equal(ok.ok, true)
  assert.equal(ok.targets.length, 1)
  assert.equal(ok.targets[0].label, 'BTC long')
  assert.equal(Math.round(ok.targets[0].values.c1 * 10) / 10, 2.5)
  assert.equal((await call('POST', '/shortcuts/validate', '{')).status, 400)
  assert.equal((await call('POST', '/shortcuts/validate', 'null')).body.ok, false)
})

test('the lens confirms with an idempotency key and dismisses; executions and history answer', async () => {
  const { ex, store, session, call } = await serve()
  store.createShortcut({ ...draft(7), enabled: true })
  await session.tick()
  const card = (await call('GET', '/state')).body.card
  assert.equal(card.question, 'Add 50 USDT margin to BTC?')
  assert.equal((await call('POST', `/proposals/${card.id}/confirm`, {})).status, 400)
  const r = (await call('POST', `/proposals/${card.id}/confirm`, { idempotencyKey: 'tap-1' })).body
  assert.equal(r.ok, true)
  assert.equal(r.status, 'APPLIED')
  assert.equal((await call('POST', `/proposals/${card.id}/confirm`, { idempotencyKey: 'tap-1' })).body.executionId, r.executionId)
  assert.equal(ex.calls.length, 1)
  assert.equal((await call('GET', `/executions/${r.executionId}`)).body.status, 'APPLIED')
  assert.equal((await call('GET', '/executions/nope')).status, 404)
  assert.equal((await call('POST', `/proposals/${card.id}/dismiss`, {})).body.ok, false)
  const history = (await call('GET', '/history')).body
  assert.equal(history[0].status, 'Done · added 50 USDT margin')
  assert.deepEqual((await call('GET', `/history?before=${history[0].createdAt}`)).body, [])
})

test('a lost confirmation response can be recovered by proposal without another write', async () => {
  const { ex, store, session, call } = await serve()
  store.createShortcut({ ...draft(7), enabled: true })
  await session.tick()
  const { id } = session.state().card!
  const path = `/proposals/${id}/execution`
  assert.equal((await call('GET', path, undefined, {})).status, 401)
  assert.equal((await call('GET', path)).status, 404)
  assert.equal(ex.calls.length, 0)

  await call('POST', `/proposals/${id}/confirm`, { idempotencyKey: 'one-tap' })
  const recovered = await call('GET', path)
  assert.equal(recovered.status, 200)
  assert.equal(recovered.body.proposalId, id)
  assert.equal(recovered.body.status, 'APPLIED')
  assert.equal((await call('GET', path)).body.id, recovered.body.id)
  assert.equal(ex.calls.length, 1)
})

test('pickers list positions with their epoch and open plain orders', async () => {
  const { ex, session, call } = await serve()
  ex.orders = [
    { orderId: 'o1', orderLinkId: '', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Limit', price: 60000, qty: 0.01, leavesQty: 0.01, reduceOnly: false, stopOrderType: '', triggerBy: '', triggerPrice: 0, positionIdx: 0, status: 'New' },
    { orderId: 'o2', orderLinkId: '', symbol: 'BTCUSDT', side: 'Sell', orderType: 'Market', price: 0, qty: 0.05, leavesQty: 0.05, reduceOnly: true, stopOrderType: 'StopLoss', triggerBy: 'MarkPrice', triggerPrice: 60000, positionIdx: 0, status: 'Untriggered' },
  ]
  await session.tick()
  assert.match((await call('GET', '/positions')).body[0].epoch, /^Buy:/)
  assert.deepEqual((await call('GET', '/orders/open')).body.map((o: { orderId: string }) => o.orderId), ['o1'])
})

test('settings: Bybit status and key rights, validated save, Telegram off without a bot token', async () => {
  const { call } = await serve({ source: 'Bybit demo' })
  const s = (await call('GET', '/settings')).body
  assert.deepEqual(s.bybit.apiKey, { readOnly: false, trade: true, withdraw: false })
  assert.equal(s.bybit.liveTrading, false)
  assert.deepEqual(s.telegram, { configured: false, linked: false })
  assert.equal((await call('PUT', '/settings', { ...s.settings, cooldownSec: 5 })).status, 400)
  assert.equal((await call('PUT', '/settings', { ...s.settings, cooldownSec: 90 })).body.cooldownSec, 90)
  assert.equal((await call('GET', '/settings')).body.settings.cooldownSec, 90)
  assert.equal((await call('POST', '/settings/telegram', {})).status, 503)
})

test('notifications lists new alerts for the phone app', async () => {
  const { store, session, call } = await serve()
  store.createShortcut({ ...draft(6), action: { type: 'NOTIFY' }, enabled: true })
  await session.tick()
  const list = (await call('GET', '/notifications?after=0')).body
  assert.equal(list.length, 1)
  assert.equal(list[0].reason, 'liquidation distance 2.5%')
  assert.deepEqual((await call('GET', `/notifications?after=${list[0].createdAt}`)).body, [])
})

test('voice answers the alert: yes or no in any language, silence never reaches the transcriber', async () => {
  let calls = 0
  let said = 'Да.'
  const { call } = await serve({
    transcribe: async pcm => {
      calls++
      if (pcm.length === 32_000) throw new Error('quota')
      return said
    },
  })
  const speech = (n: number) => { const b = new Uint8Array(n); for (let i = 1; i < n; i += 2) b[i] = i % 4 === 1 ? 0x10 : 0xf0; return b } // ±4096
  assert.deepEqual((await call('POST', '/voice', speech(16_000))).body, { heard: 'Да.', answer: 'yes' })
  said = 'No, cancel it'
  assert.deepEqual((await call('POST', '/voice', speech(16_000))).body, { heard: 'No, cancel it', answer: null })
  assert.deepEqual((await call('POST', '/voice', new Uint8Array(16_000))).body, { heard: '', answer: null })
  assert.equal(calls, 2) // the silent one was never sent
  const failed = await call('POST', '/voice', speech(32_000))
  assert.equal(failed.status, 502)
  assert.match(failed.body.error, /quota/)
  assert.equal((await call('POST', '/voice', new Uint8Array(100))).status, 400)
  assert.equal((await call('POST', '/voice', new Uint8Array(400_000))).status, 413)
})

test('voice is 503 without a transcriber; the menu command maps to the seeded phrases', async () => {
  const { call } = await serve()
  assert.equal((await call('POST', '/voice', new Uint8Array(16_000))).status, 503)
  assert.deepEqual((await call('POST', '/command', { command: 'lock' })).body, { ok: false, message: 'Heard "lock profits" · nothing to change' })
  assert.equal((await call('POST', '/command', { command: 'buy' })).status, 400)
  assert.equal((await call('POST', '/command', { command: 'close', position: { symbol: 'BTCUSDT' } })).status, 400)
  assert.equal((await call('POST', '/command', { command: 'toString' })).status, 400)
})

test('body over 64 KB is 413', async () => {
  const { call } = await serve()
  assert.equal((await call('PUT', '/settings', 'x'.repeat(70_000))).status, 413)
})

test('catalog and templates are served', async () => {
  const { call } = await serve()
  const c = (await call('GET', '/catalog')).body
  assert.equal(c.conditions.length, 13)
  assert.equal(c.conditionAction.LOSS.INCREASE_POSITION, 'G')
  assert.equal(c.conditionAction.VOLUME_SPIKE.OPEN_LONG, 'N')
  const t = (await call('GET', '/templates')).body
  assert.equal(t.length, 12)
  assert.deepEqual([t[0].category, t[0].title], ['Protect', 'Close position'])
  assert.deepEqual(t.map((x: { summary: string; doSummary: string }) => `${x.summary} → ${x.doSummary}`), [
    'Liq ≤ 3% → Close 50%',
    'Liq ≤ 5% → Add 25% margin',
    'SL ≤ 1% → Notify me',
    'Closed by stop loss → Notify me',
    'ROI ≥ 20% → SL to entry',
    'ROI ≥ 50% → Close 50%',
    'Price crosses above … → Notify me',
    'Price ±15% → Notify me',
    'Price −2% → Notify me',
    'Funding ≥ 0.05% in 30\u00a0min → Notify me',
    'Order filled → TP at +3%',
    'Order open ≥ 1\u00a0h → Cancel order',
  ])
})

test('symbols lists what the exchange can trade, sorted; an exchange failure is an error, not an empty list', async () => {
  const { ex, call } = await serve()
  ex.prices = { SOLUSDT: 145, ETHUSDT: 3000 }
  assert.deepEqual(await call('GET', '/symbols'), { status: 200, body: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] }) // BTC by its position's mark
  assert.equal((await call('GET', '/symbols', undefined, {})).status, 401)
  ex.failReads = 'down'
  assert.equal((await call('GET', '/symbols')).status, 502)
})
