import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createNotifier, type NotifyStore } from '../src/notify.ts'
import { DEFAULT_SETTINGS, type AlertRecord, type OutboxRow, type Proposal, type Settings, type TelegramLink } from '../src/types.ts'

const TOKEN = '123456:SECRET-token'
const LINKED: TelegramLink = { chatId: 42, name: 'alex', offset: 0 }

function fakeStore(tg: TelegramLink = { offset: 0 }, notifications: Settings['notifications'] = { glasses: true, app: true, telegram: true }) {
  const s = {
    tg,
    outbox: [] as OutboxRow[],
    sent: [] as string[],
    retries: [] as { id: string; error: string }[],
    settings: () => ({ ...DEFAULT_SETTINGS, notifications }),
    telegram: () => s.tg,
    saveTelegram: (t: TelegramLink) => { s.tg = t },
    enqueue: (o: { alertId: string; channel: OutboxRow['channel']; text: string }) => {
      const id = `o${s.outbox.length + 1}`
      s.outbox.push({ id, ...o, attempts: 0 })
      return id
    },
    dueOutbox: () => s.outbox.filter(r => !s.sent.includes(r.id)),
    outboxSent: (id: string) => { s.sent.push(id) },
    outboxRetry: (id: string, _now: number, error: string) => { s.retries.push({ id, error }) },
  }
  return s satisfies NotifyStore
}

/** Records each Bot API call; `reply` returns the result, a Response, or throws for a network error. */
function fakeFetch(reply: (method: string, body: Record<string, unknown>) => unknown = () => true) {
  const calls: { url: string; method: string; body: Record<string, unknown> }[] = []
  const f = (async (url: string, init: RequestInit) => {
    const method = url.split('/').pop()!
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    calls.push({ url, method, body })
    const r = reply(method, body)
    return r instanceof Response ? r : Response.json({ ok: true, result: r })
  }) as typeof fetch
  return { f, calls }
}

function setup(o: { tg?: TelegramLink; notifications?: Settings['notifications']; token?: string | null; reply?: Parameters<typeof fakeFetch>[0] } = {}) {
  const store = fakeStore(o.tg, o.notifications)
  const http = fakeFetch(o.reply)
  const clock = { now: 1_000_000 }
  const n = createNotifier({ store, token: o.token === null ? undefined : (o.token ?? TOKEN), fetch: http.f, clock: () => clock.now })
  return { store, calls: http.calls, clock, n }
}

const alert = (o: Partial<AlertRecord> = {}): AlertRecord => ({
  id: 'a1', shortcutId: 's1', version: 1, targetKey: 'pos:BTCUSDT:0:1', target: 'BTCUSDT long', title: 'Close Position',
  reason: 'liquidation distance 3.2%', matched: ['c1'], priority: 'CRITICAL', simulated: false,
  delivery: { glasses: true, phone: true }, channels: [], status: '', createdAt: 0, ...o,
})

const proposal: Proposal = {
  id: 'p1', key: 'k', title: 'Close Position', detail: '', question: 'Close 50% · 0.025 BTC?', who: 'BTC long', why: 'liquidation distance 3.2%',
  createdAt: 1_000_000, expiresAt: 1_030_000,
  alertId: 'a1', shortcutId: 's1', version: 1, targetKey: 'pos:BTCUSDT:0:1',
  terms: { type: 'order', symbol: 'BTCUSDT', side: 'Sell', qty: '0.025', positionIdx: 0, reduceOnly: true, orderLinkId: 'x' },
  simulated: false, priority: 'CRITICAL', status: 'PENDING',
}

const update = (update_id: number, text: string, chat = { id: 7, username: 'trader' }) => ({ update_id, message: { text, chat } })

test('lens open: glasses only, no Telegram', () => {
  const { n, store } = setup({ tg: LINKED })
  n.seen('lens')
  assert.deepEqual(n.route(alert(), proposal), ['glasses'])
  assert.equal(store.outbox.length, 0)
})

test('lens closed and linked: Telegram is queued with the alert text', () => {
  const { n, store } = setup({ tg: LINKED })
  assert.deepEqual(n.route(alert(), proposal), ['telegram'])
  assert.deepEqual(store.outbox.map(r => [r.alertId, r.channel, r.text]), [['a1', 'telegram', n.text(alert(), proposal)]])
})

test('app open: in-app notification, for 10 s after its last poll', () => {
  const { n, clock } = setup()
  n.seen('app')
  clock.now += 9_000
  assert.deepEqual(n.route(alert()), ['app'])
  clock.now += 1_000
  assert.deepEqual(n.route(alert()), [])
})

test('delivery.phone off: no app and no Telegram', () => {
  const { n, store } = setup({ tg: LINKED })
  n.seen('app')
  assert.deepEqual(n.route(alert({ delivery: { glasses: true, phone: false } })), [])
  assert.equal(store.outbox.length, 0)
})

test('a Settings switch turns its channel off', () => {
  const off = (k: keyof Settings['notifications']) => setup({ tg: LINKED, notifications: { glasses: true, app: true, telegram: true, [k]: false } })
  const g = off('glasses'); g.n.seen('lens'); g.n.seen('app')
  assert.deepEqual(g.n.route(alert()), ['app'])
  const a = off('app'); a.n.seen('app')
  assert.deepEqual(a.n.route(alert()), ['telegram'])
  const t = off('telegram'); t.n.seen('app')
  assert.deepEqual(t.n.route(alert()), ['app'])
  assert.equal(t.store.outbox.length, 0)
})

test('unlinked: nothing queued or sent', async () => {
  const { n, store, calls } = setup()
  assert.deepEqual(n.route(alert(), proposal), [])
  await n.flush()
  assert.equal(store.outbox.length, 0)
  assert.equal(calls.length, 0)
  assert.deepEqual(n.status(), { configured: true, linked: false, name: undefined })
})

test('no token: no Telegram even with a stored chat, and no bot calls', async () => {
  const { n, store, calls } = setup({ tg: LINKED, token: null })
  assert.deepEqual(n.route(alert()), [])
  assert.equal(store.outbox.length, 0)
  await n.pollUpdates()
  await assert.rejects(n.link(), { message: 'Telegram is off: set TELEGRAM_BOT_TOKEN' })
  assert.equal(calls.length, 0)
  assert.deepEqual(n.status(), { configured: false, linked: false, name: undefined })
})

test('the text is plain, with no link or button, and sendMessage sends only chat_id and text', async () => {
  const { n, calls } = setup({ tg: LINKED })
  const t = n.text(alert(), proposal)
  assert.equal(t, 'Close Position · BTCUSDT long · liquidation distance 3.2%\nClose 50% · 0.025 BTC · confirm on Even G2 within 30 s')
  assert.equal(n.text(alert({ simulated: true })), 'Close Position · BTCUSDT long · liquidation distance 3.2%\nTest · nothing will be sent')
  assert.doesNotMatch(t, /http|t\.me|button/i)
  n.route(alert(), proposal)
  await n.flush()
  assert.equal(calls[0].method, 'sendMessage')
  assert.deepEqual(calls[0].body, { chat_id: 42, text: t })
})

test('flush retries on failure and marks sent on success', async () => {
  let fail: unknown = new Response('', { status: 502 })
  const { n, store } = setup({
    tg: LINKED,
    reply: () => { if (fail instanceof Error) throw fail; return fail ?? true },
  })
  n.route(alert())
  await n.flush()
  fail = Response.json({ ok: false, description: 'Forbidden: bot was blocked by the user' }, { status: 403 })
  await n.flush()
  fail = new TypeError('fetch failed')
  await n.flush()
  assert.deepEqual(store.retries.map(r => r.error), ['Telegram sendMessage: HTTP 502', 'Telegram sendMessage: Forbidden: bot was blocked by the user', 'Telegram sendMessage: network error'])
  assert.deepEqual(store.sent, [])
  fail = undefined
  await n.flush()
  assert.deepEqual(store.sent, ['o1'])
})

test('link, then /start <code> links the chat, confirms it and saves the offset', async () => {
  let updates: unknown[] = []
  const { n, store, calls } = setup({ reply: m => m === 'getMe' ? { username: 'ShortcutsBot' } : m === 'getUpdates' ? updates : true })
  const first = await n.link()
  const { code, url } = await n.link()
  assert.notEqual(code, first.code)
  assert.match(code, /^[0-9a-f]{32}$/)
  assert.equal(url, `https://t.me/ShortcutsBot?start=${code}`)
  assert.equal(calls.filter(c => c.method === 'getMe').length, 1)
  updates = [update(5, `/start ${first.code}`, { id: 9, username: 'old' }), update(6, `/start ${code}`)]
  await n.pollUpdates()
  const poll = calls.find(c => c.method === 'getUpdates')!
  assert.deepEqual(poll.body, { offset: 0, timeout: 25, allowed_updates: ['message'] })
  assert.deepEqual(store.tg, { chatId: 7, name: 'trader', offset: 7 })
  const confirm = calls.at(-1)!
  assert.equal(confirm.method, 'sendMessage')
  assert.deepEqual(Object.keys(confirm.body), ['chat_id', 'text'])
  assert.equal(confirm.body.chat_id, 7)
  assert.doesNotMatch(String(confirm.body.text), /http|t\.me/)
  assert.deepEqual(n.status(), { configured: true, linked: true, name: 'trader' })
})

test('a wrong or expired code does not link, and the offset still advances', async () => {
  let updates: unknown[] = []
  const { n, store, clock, calls } = setup({ reply: m => m === 'getMe' ? { username: 'ShortcutsBot' } : m === 'getUpdates' ? updates : true })
  const { code } = await n.link()
  updates = [update(10, '/start nope'), update(11, 'hello')]
  await n.pollUpdates()
  assert.equal(store.tg.chatId, undefined)
  assert.equal(store.tg.offset, 12)
  clock.now += 10 * 60_000
  updates = [update(12, `/start ${code}`, { id: 8, username: 'late' })]
  await n.pollUpdates()
  assert.equal(store.tg.chatId, undefined)
  assert.equal(store.tg.offset, 13)
  assert.equal(calls.filter(c => c.method === 'sendMessage').length, 0)
})

test('unlink stops sending', async () => {
  const { n, store, calls } = setup({ tg: { ...LINKED, offset: 3 } })
  n.route(alert())
  n.unlink()
  assert.deepEqual(store.tg, { offset: 3 })
  await n.flush()
  assert.equal(calls.length, 0)
  assert.deepEqual(store.retries, [{ id: 'o1', error: 'Telegram not linked' }])
  assert.deepEqual(n.route(alert()), [])
})

test('the token never appears in an error message', async () => {
  const quoting = (url: string) => { throw new TypeError(`Failed to parse URL from ${url}`) }
  const f = (async (url: string) => quoting(url)) as typeof fetch
  const store = fakeStore(LINKED)
  const n = createNotifier({ store, token: TOKEN, fetch: f })
  await assert.rejects(n.link(), (e: Error) => !e.message.includes(TOKEN) && !e.message.includes('SECRET'))
  await assert.rejects(n.pollUpdates(), (e: Error) => !e.message.includes(TOKEN))
  n.route(alert())
  await n.flush()
  assert.equal(store.retries.length, 1)
  assert.ok(!store.retries[0].error.includes(TOKEN))
})

test('lens open but nothing else carries the alert: Telegram is the fallback', () => {
  const phoneOnly = setup({ tg: LINKED })
  phoneOnly.n.seen('lens')
  assert.deepEqual(phoneOnly.n.route(alert({ delivery: { glasses: false, phone: true } })), ['telegram'])
  const glassesOff = setup({ tg: LINKED, notifications: { glasses: false, app: true, telegram: true } })
  glassesOff.n.seen('lens')
  assert.deepEqual(glassesOff.n.route(alert()), ['telegram'])
})
