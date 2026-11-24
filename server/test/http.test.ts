import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createServer, type Transcribe } from '../src/http.ts'
import { tokenProblem } from '../src/config.ts'
import { createStore } from '../src/store.ts'
import { createSession } from '../src/session.ts'
import { FakeExchange } from '../src/fake-exchange.ts'
import { TEMPLATES } from '../src/registry.ts'
import type { Position } from '../src/types.ts'

const btc: Position = {
  symbol: 'BTCUSDT', side: 'Buy', size: 0.05, entryPrice: 62000, markPrice: 61000, liqPrice: 59500, unrealisedPnl: -50,
  stopLoss: 60000, takeProfit: 0, positionIM: 310, leverage: 10, isolated: true, positionIdx: 0, openedAt: 0,
}

async function serve(o: { transcribe?: Transcribe; source?: string } = {}) {
  const ex = new FakeExchange()
  ex.list = [structuredClone(btc)]
  const store = createStore(':memory:')
  store.seed()
  const session = createSession(ex, store)
  const server = createServer({ session, store, token: 'secret', apiKeyInfo: () => ex.apiKeyInfo(), ...o })
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
const draft = (n: number) => structuredClone(TEMPLATES[n - 1].draft)

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

test('shortcuts: create, list as tiles, edit with the version, pause, enable, delete', async () => {
  const { call } = await serve()
  const made = await call('POST', '/shortcuts', { ...draft(6), enabled: true })
  assert.equal(made.status, 201)
  assert.equal(made.body.title, 'Close Position')
  assert.equal(made.body.summary, 'Liq. < 5%')
  const tiles = (await call('GET', '/shortcuts')).body
  assert.deepEqual(tiles.map((t: { summary: string }) => t.summary), ['Say "protect all"', 'Say "lock profits"', 'Liq. < 5%'])

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
    ok: false, issues: [{ code: 'incompatible_action', message: 'Liquidation distance is incompatible with Increase Position', conditionId: 'c2' }],
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
  assert.equal(card.question, 'Add 100 USDT margin to BTC?')
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
  assert.equal(history[0].status, 'Done · added 100 USDT margin')
  assert.deepEqual((await call('GET', `/history?before=${history[0].createdAt}`)).body, [])
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

test('voice transcribes with the phrases as a hint and raises the matching shortcut', async () => {
  let hint = ''
  const { ex, session, call } = await serve({
    transcribe: async (pcm, h) => {
      if (pcm.length === 32_000) throw new Error('quota')
      hint = h
      return 'lock profits'
    },
  })
  ex.list[0] = { ...btc, markPrice: 64000, unrealisedPnl: 100 }
  await session.tick()
  const r = await call('POST', '/voice', new Uint8Array(16_000))
  assert.deepEqual(r.body, { heard: 'lock profits', ok: true, message: 'Heard "lock profits" · 1 proposal' })
  assert.deepEqual(hint.split(', ').sort(), ['lock profits', 'protect all'])
  const failed = await call('POST', '/voice', new Uint8Array(32_000))
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
})

test('body over 64 KB is 413', async () => {
  const { call } = await serve()
  assert.equal((await call('PUT', '/settings', 'x'.repeat(70_000))).status, 413)
})

test('catalog and templates are served', async () => {
  const { call } = await serve()
  const c = (await call('GET', '/catalog')).body
  assert.equal(c.conditions.length, 10)
  assert.equal(c.conditionAction.LOSS.INCREASE_POSITION, 'N')
  const t = (await call('GET', '/templates')).body
  assert.equal(t.length, 15)
  assert.equal(t[0].title, 'Move Stop Loss')
})
