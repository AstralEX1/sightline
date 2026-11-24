import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { createServer } from '../src/http.ts'
import { loadConfig, saveConfig, tokenProblem, validateConfig } from '../src/config.ts'
import { DEFAULT_CONFIG } from '../src/rules.ts'
import type { Session } from '../src/session.ts'
import type { Config, SessionState } from '../src/types.ts'

const answers: Array<[string, boolean]> = []
const voiced: string[] = []
const fakeState = { positions: [], balance: null, dayPnl: 1, dailyLossLimitUsd: 200, locked: false, card: null, pending: 0, toast: null, error: null, updatedAt: 5 } as SessionState
const session: Session = {
  tick: async () => {},
  state: () => fakeState,
  answer: async (id, yes) => { answers.push([id, yes]); return { ok: true, message: 'Skipped' } },
  voice: text => { voiced.push(text); return { ok: true, message: 'Voice: buy eth' } },
  command: kind => { voiced.push(`menu ${kind}`); return { ok: true, message: `Menu: ${kind}` } },
}
let config: Config = { ...DEFAULT_CONFIG }
const server = createServer({ session, token: 'secret', getConfig: () => config, setConfig: c => { config = c } })
await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
after(() => server.close())

const auth = { Authorization: 'Bearer secret' }

test('401 without token', async () => {
  const res = await fetch(`${base}/api/state`)
  assert.equal(res.status, 401)
  assert.equal((await fetch(`${base}/api/state`, { headers: { Authorization: 'Bearer wrong' } })).status, 401)
})

test('state with token', async () => {
  const res = await fetch(`${base}/api/state`, { headers: auth })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ...fakeState, voice: false, source: '' })
})

test('answer passes cardId and yes', async () => {
  const res = await fetch(`${base}/api/answer`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ cardId: 'c1', yes: true }) })
  assert.deepEqual(await res.json(), { ok: true, message: 'Skipped' })
  assert.deepEqual(answers.at(-1), ['c1', true])
})

test('answer rejects a bad body', async () => {
  const res = await fetch(`${base}/api/answer`, { method: 'POST', headers: auth, body: JSON.stringify({ cardId: 1 }) })
  assert.equal(res.status, 400)
})

test('put config rejects negative limit', async () => {
  const res = await fetch(`${base}/api/config`, { method: 'PUT', headers: auth, body: JSON.stringify({ ...DEFAULT_CONFIG, dailyLossLimitUsd: -5 }) })
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /dailyLossLimitUsd/)
  assert.equal(config.dailyLossLimitUsd, 200)
})

test('put config saves a valid config', async () => {
  const next = { ...DEFAULT_CONFIG, maxActionUsd: 250 }
  const res = await fetch(`${base}/api/config`, { method: 'PUT', headers: auth, body: JSON.stringify(next) })
  assert.equal(res.status, 200)
  assert.equal(config.maxActionUsd, 250)
  assert.equal((await (await fetch(`${base}/api/config`, { headers: auth })).json()).maxActionUsd, 250)
})

test('options is 204 with CORS header', async () => {
  const res = await fetch(`${base}/api/state`, { method: 'OPTIONS' })
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  assert.match(res.headers.get('access-control-allow-headers') ?? '', /Authorization/)
})

test('body over 64 KB is 413', async () => {
  const res = await fetch(`${base}/api/config`, { method: 'PUT', headers: auth, body: 'x'.repeat(70_000) })
  assert.equal(res.status, 413)
})

test('validateConfig checks alerts', () => {
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, alerts: [{ id: 'a', symbol: 'btc usdt', when: 'above', price: 1 }] }), /symbol/)
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, alerts: [{ id: 'a', symbol: 'BTCUSDT', when: 'sideways', price: 1 }] }), /when/)
  const ok = validateConfig({ ...DEFAULT_CONFIG, alerts: [{ id: 'a', symbol: 'BTCUSDT', when: 'above', price: 60000, orderUsd: 200, side: 'Buy' }] })
  assert.equal(ok.alerts[0].orderUsd, 200)
})

test('loadConfig falls back to defaults and round-trips', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gt-'))
  const file = join(dir, 'sub', 'config.json')
  assert.deepEqual(loadConfig(file), DEFAULT_CONFIG)
  saveConfig(file, { ...DEFAULT_CONFIG, liqWarnPct: 5 })
  assert.equal(loadConfig(file).liqWarnPct, 5)
})

test('percentages that would put a stop at zero are refused', () => {
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, stopLossPct: 100 }), /stopLossPct/)
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, liqWarnPct: 101 }), /liqWarnPct/)
})

test('a short token is refused, loopback too: any web page can call localhost', () => {
  assert.match(tokenProblem('short') ?? '', /16/)
  assert.equal(tokenProblem('a'.repeat(16)), null)
  assert.match(tokenProblem('') ?? '', /APP_TOKEN/)
})

test('voice is 503 without a transcriber', async () => {
  const res = await fetch(`${base}/api/voice`, { method: 'POST', headers: auth, body: new Uint8Array(16_000) })
  assert.equal(res.status, 503)
})

test('voice transcribes with the phrases as a hint and queues the result', async () => {
  let hint = ''
  const shortcuts: Config['shortcuts'] = [{ phrase: 'buy eth', command: 'buy', symbol: 'ETHUSDT', usd: 100 }]
  const s2 = createServer({
    session, token: 'secret', getConfig: () => ({ ...DEFAULT_CONFIG, shortcuts }), setConfig: () => {},
    transcribe: async (pcm, h) => {
      if (pcm.length === 32_000) throw new Error('quota')
      hint = h
      return `got ${pcm.length}`
    },
  })
  await new Promise<void>(r => s2.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(s2.address() as AddressInfo).port}/api/voice`
  const post = (bytes: number) => fetch(url, { method: 'POST', headers: auth, body: new Uint8Array(bytes) })
  try {
    assert.deepEqual(await (await post(16_000)).json(), { heard: 'got 16000', ok: true, message: 'Voice: buy eth' })
    assert.equal(hint, 'buy eth')
    assert.equal(voiced.at(-1), 'got 16000')
    const failed = await post(32_000)
    assert.equal(failed.status, 502)
    assert.match((await failed.json()).error, /quota/)
    assert.equal((await post(100)).status, 400)
    assert.equal((await post(400_000)).status, 413)
  } finally {
    s2.close()
  }
})

test('validateConfig checks shortcuts', () => {
  const v = (s: unknown) => validateConfig({ ...DEFAULT_CONFIG, shortcuts: [s] })
  assert.throws(() => v({ phrase: 'Buy ETH!', command: 'buy', symbol: 'ETHUSDT', usd: 1 }), /phrase/)
  assert.throws(() => v({ phrase: 'buy eth', command: 'yolo', symbol: 'ETHUSDT', usd: 1 }), /command/)
  assert.throws(() => v({ phrase: 'buy all', command: 'buy', symbol: 'ALL', usd: 1 }), /one symbol/)
  assert.throws(() => v({ phrase: 'buy eth', command: 'buy', symbol: 'ETHUSDT' }), /usd/)
  assert.deepEqual(v({ phrase: 'protect all', command: 'stop', symbol: 'ALL', usd: 5 }).shortcuts, [{ phrase: 'protect all', command: 'stop', symbol: 'ALL' }])
})

test('command passes stop or lock and rejects anything else', async () => {
  const post = (body: unknown) => fetch(`${base}/api/command`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const ok = await post({ command: 'lock' })
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { ok: true, message: 'Menu: lock' })
  assert.equal(voiced.at(-1), 'menu lock')
  assert.equal((await post({ command: 'buy' })).status, 400)
})

test('state tells the app what only the server knows: voice and which account', async () => {
  const s2 = createServer({ session, token: 'secret', getConfig: () => config, setConfig: () => {}, transcribe: async () => '', source: 'Bybit testnet' })
  await new Promise<void>(r => s2.listen(0, '127.0.0.1', r))
  try {
    const res = await fetch(`http://127.0.0.1:${(s2.address() as AddressInfo).port}/api/state`, { headers: auth })
    assert.deepEqual(await res.json(), { ...fakeState, voice: true, source: 'Bybit testnet' })
  } finally {
    s2.close()
  }
})
