import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSession } from '../src/session.ts'
import { FakeExchange } from '../src/fake-exchange.ts'
import { DEFAULT_CONFIG } from '../src/rules.ts'
import type { Config, Position } from '../src/types.ts'

const START = 1_800_000_000_000

function btc(o: Partial<Position> = {}): Position {
  return {
    symbol: 'BTCUSDT', side: 'Buy', size: 0.05, entryPrice: 62000, markPrice: 61000, liqPrice: 59500,
    unrealisedPnl: -50, stopLoss: 61000, isolated: true, positionIdx: 0, openedAt: START - 3_600_000, ...o,
  }
}

function setup(positions: Position[] = [btc()], config: Config = DEFAULT_CONFIG) {
  let now = START
  const ex = new FakeExchange()
  ex.list = positions
  ex.closed = -40
  const s = createSession(ex, () => config, () => now)
  return { ex, s, advance: (ms: number) => { now += ms } }
}

test('tick fills state', async () => {
  const { s } = setup()
  await s.tick()
  const st = s.state()
  assert.equal(st.positions.length, 1)
  assert.equal(st.dayPnl, -90)
  assert.equal(st.card?.key, 'liq:BTCUSDT')
  assert.equal(st.pending, 1)
})

test('yes on liq card adds margin', async () => {
  const { ex, s } = setup()
  await s.tick()
  const r = await s.answer(s.state().card!.id, true)
  assert.equal(r.ok, true)
  assert.equal(ex.calls[0].type, 'addMargin')
  assert.equal(s.state().toast, 'Done: Add $100 margin to BTC')
  assert.equal(s.state().card, null)
})

test('no skips without exchange call', async () => {
  const { ex, s } = setup()
  await s.tick()
  const r = await s.answer(s.state().card!.id, false)
  assert.deepEqual(r, { ok: true, message: 'Skipped' })
  assert.equal(ex.calls.length, 0)
  assert.equal(s.state().card, null)
})

test('expired card is rejected', async () => {
  const { ex, s, advance } = setup()
  await s.tick()
  const id = s.state().card!.id
  advance(61_000)
  const r = await s.answer(id, true)
  assert.deepEqual(r, { ok: false, message: 'Card expired' })
  assert.equal(ex.calls.length, 0)
})

test('wrong id is rejected', async () => {
  const { ex, s } = setup()
  await s.tick()
  assert.deepEqual(await s.answer('nope', true), { ok: false, message: 'Card is gone' })
  assert.equal(ex.calls.length, 0)
  assert.notEqual(s.state().card, null)
})

test('a clear rejection is reported and the card comes back on the next tick', async () => {
  const { ex, s } = setup()
  await s.tick()
  ex.failNext = 'Bybit 110017: reduce-only' // the fake throws strings as exchange rejections
  const r = await s.answer(s.state().card!.id, true)
  assert.deepEqual(r, { ok: false, message: 'Failed: Bybit 110017: reduce-only' })
  assert.equal(s.state().toast, 'Failed: Bybit 110017: reduce-only')
  assert.equal(s.state().card, null)
  await s.tick()
  assert.equal(s.state().error, null)
  assert.equal(s.state().card?.key, 'liq:BTCUSDT')
})

test('an unclear failure of a money action is not offered again: it may have gone through', async () => {
  const { ex, s, advance } = setup()
  await s.tick()
  ex.failNext = new Error('Bybit HTTP 502')
  const r = await s.answer(s.state().card!.id, true)
  assert.equal(r.message, 'Unknown result: Bybit HTTP 502. Check the exchange.')
  advance(2_000)
  await s.tick()
  assert.equal(s.state().card, null)
})

test('a timed-out stop is offered again: setting a stop twice is safe', async () => {
  const { ex, s, advance } = setup([btc({ liqPrice: 0, stopLoss: 0 })])
  await s.tick()
  ex.failNext = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
  await s.answer(s.state().card!.id, true)
  advance(2_000)
  await s.tick()
  assert.equal(s.state().card?.key, 'nostop:BTCUSDT')
})

test('lock drops exposure card and keeps stop card', async () => {
  const eth = btc({ symbol: 'ETHUSDT', side: 'Sell', entryPrice: 3100, markPrice: 3090, liqPrice: 0, stopLoss: 0, unrealisedPnl: 12, openedAt: START - 70_000 })
  const { ex, s, advance } = setup([btc(), eth])
  await s.tick()
  const exposureId = s.state().card!.id
  assert.equal(s.state().pending, 2)
  ex.closed = -250
  advance(11_000)
  await s.tick()
  assert.equal(s.state().locked, true)
  assert.equal(s.state().pending, 1)
  assert.equal(s.state().card?.action.type, 'setStop')
  const r = await s.answer(exposureId, true)
  assert.equal(r.ok, false)
  assert.equal(ex.calls.length, 0)
})

test('fill toast', async () => {
  const { ex, s, advance } = setup([])
  await s.tick()
  ex.fills.push({ id: 'f1', symbol: 'BTCUSDT', side: 'Buy', qty: 0.05, price: 61000, time: START + 5_000 })
  advance(11_000)
  await s.tick()
  assert.equal(s.state().toast, 'Filled BUY 0.05 BTC @ 61,000')
})

test('two alerts in one tick both show, one after the other', async () => {
  const alerts = [
    { id: 'a', symbol: 'ETHUSDT', when: 'below' as const, price: 3000 },
    { id: 'b', symbol: 'SOLUSDT', when: 'below' as const, price: 130 },
  ]
  const { ex, s, advance } = setup([], { ...DEFAULT_CONFIG, alerts })
  ex.prices = { ETHUSDT: 2990, SOLUSDT: 129 }
  await s.tick()
  assert.match(s.state().toast ?? '', /^ETH below/)
  advance(5_000)
  assert.match(s.state().toast ?? '', /^SOL below/)
  advance(5_000)
  assert.equal(s.state().toast, null)
})

test('your own result shows at once, and a flood of toasts is capped', async () => {
  const alerts = ['AA', 'BB', 'CC', 'DD', 'EE'].map(c => ({ id: c, symbol: `${c}USDT`, when: 'above' as const, price: 1 }))
  const { ex, s, advance } = setup([btc({ liqPrice: 0, stopLoss: 0 })], { ...DEFAULT_CONFIG, alerts })
  ex.prices = Object.fromEntries(alerts.map(a => [a.symbol, 2]))
  await s.tick()
  await s.answer(s.state().card!.id, true)
  const seen: string[] = []
  for (let t = s.state().toast; t; advance(5_000), t = s.state().toast) seen.push(t)
  assert.match(seen[0], /^Done: Set [A-Z]+ stop/)
  assert.ok(seen.length <= 4, `${seen.length} toasts waited: ${seen.join(' | ')}`)
})

test('exchange read error keeps last data', async () => {
  const { ex, s } = setup()
  await s.tick()
  ex.failReads = 'network down'
  await s.tick()
  assert.equal(s.state().error, 'network down')
  assert.equal(s.state().positions.length, 1)
})

const losing = () => btc({ unrealisedPnl: -250, liqPrice: 0 })

test('lock stays when the price bounces back', async () => {
  const { ex, s, advance } = setup([losing()])
  await s.tick()
  assert.equal(s.state().locked, true)
  ex.list[0].unrealisedPnl = 0
  advance(2_000)
  await s.tick()
  assert.equal(s.state().locked, true)
})

test('closed pnl refreshes as soon as a position closes', async () => {
  const { ex, s, advance } = setup([losing()])
  await s.tick()
  ex.list = []
  ex.closed = -290
  advance(2_000)
  await s.tick()
  assert.equal(s.state().dayPnl, -290)
  assert.equal(s.state().locked, true)
})

test('lock resets on the next UTC day', async () => {
  const { ex, s, advance } = setup([losing()])
  await s.tick()
  ex.list[0].unrealisedPnl = 0
  ex.closed = 0
  advance(86_400_000)
  await s.tick()
  assert.equal(s.state().locked, false)
})

test('a bad alert symbol does not stop the rules', async () => {
  const cfg = { ...DEFAULT_CONFIG, alerts: [{ id: 'x', symbol: 'FOOUSDT', when: 'above' as const, price: 1 }] }
  const { s } = setup([btc()], cfg)
  await s.tick()
  assert.equal(s.state().card?.key, 'liq:BTCUSDT')
  assert.match(s.state().error ?? '', /FOOUSDT/)
})

test('a stop card leaves once a tighter stop is set', async () => {
  const { ex, s, advance } = setup([btc({ liqPrice: 0, stopLoss: 0 })])
  await s.tick()
  assert.equal(s.state().card?.key, 'nostop:BTCUSDT')
  ex.list[0].stopLoss = 60000
  advance(2_000)
  await s.tick()
  assert.equal(s.state().card, null)
})

test('an expired card is raised again while the condition holds', async () => {
  const { s, advance } = setup()
  await s.tick()
  const first = s.state().card!.id
  advance(61_000)
  await s.tick()
  assert.equal(s.state().card?.key, 'liq:BTCUSDT')
  assert.notEqual(s.state().card?.id, first)
  assert.equal(s.state().toast, null) // the lens shows a fresh card, not "Expired" over it
})

test('stale data is reported', async () => {
  const { s, advance } = setup()
  await s.tick()
  advance(16_000)
  assert.match(s.state().error ?? '', /No fresh data/)
})

test('a timed-out write reports an unknown result', async () => {
  const { ex, s } = setup()
  await s.tick()
  ex.failNext = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
  const r = await s.answer(s.state().card!.id, true)
  assert.deepEqual(r, { ok: false, message: 'Unknown result: timed out. Check the exchange.' })
})

test('a voice card survives ticks and YES runs it', async () => {
  const shortcuts: Config['shortcuts'] = [{ phrase: 'buy eth', command: 'buy', symbol: 'ETHUSDT', usd: 100 }]
  const { ex, s, advance } = setup([], { ...DEFAULT_CONFIG, shortcuts })
  ex.prices.ETHUSDT = 3000
  await s.tick()
  assert.deepEqual(s.voice('buy eth please'), { ok: true, message: 'Voice: buy eth' })
  s.voice('buy eth') // a repeat while the card waits adds nothing
  advance(2_000)
  await s.tick()
  const st = s.state()
  assert.equal(st.card?.key, 'voice:buy eth')
  assert.equal(st.pending, 1)
  assert.equal(st.toast, null) // the card is the answer; no toast repeats its title
  assert.equal((await s.answer(st.card!.id, true)).ok, true)
  assert.deepEqual(ex.calls, [{ type: 'order', symbol: 'ETHUSDT', side: 'Buy', usd: 100 }])
})

test('a card keeps its id while its condition flickers', async () => {
  const { ex, s, advance } = setup()
  await s.tick()
  const id = s.state().card!.id
  for (const mark of [62000, 61000, 61400, 61000]) { // liq distance 4.0%, 2.5%, 3.1%, 2.5% around the 3% line
    ex.list[0].markPrice = mark
    advance(1_000)
    await s.tick()
    assert.equal(s.state().card?.id, id)
    assert.equal(s.state().pending, 1)
  }
})

test('a stop card leaves when the mark runs past it, then comes back with a fresh price', async () => {
  const { ex, s, advance } = setup([btc({ liqPrice: 0, stopLoss: 0 })])
  await s.tick()
  const first = s.state().card!
  assert.equal(first.action.type === 'setStop' && first.action.price, 59780)
  ex.list[0].markPrice = 59000
  advance(1_000)
  await s.tick()
  assert.equal(s.state().card, null)
  advance(1_000)
  await s.tick()
  const again = s.state().card!
  assert.equal(again.key, 'nostop:BTCUSDT')
  assert.ok(again.action.type === 'setStop' && again.action.price < 59000)
})

test('a margin card leaves when its position closes', async () => {
  const { ex, s, advance } = setup()
  await s.tick()
  ex.list = []
  advance(1_000)
  await s.tick()
  assert.equal(s.state().card, null)
})

test('the menu queues stop cards even when the shortcut list is empty', async () => {
  const { s } = setup([btc({ stopLoss: 0 })], { ...DEFAULT_CONFIG, shortcuts: [], liqWarnPct: 0.1, noStopGraceSec: 999_999 })
  await s.tick()
  const r = s.command('stop')
  assert.equal(r.ok, true)
  assert.equal(r.message, 'Menu: protect all')
  assert.equal(s.state().card?.key, 'voice:stop:BTCUSDT')
  assert.equal(s.command('lock').message, 'Menu: lock profits · nothing to change') // BTC is in a loss
})

test('a card that expires on the lens says so, once its condition is gone', async () => {
  const { ex, s, advance } = setup()
  await s.tick()
  const title = s.state().card!.title
  ex.list[0].liqPrice = 55_000 // the trader added margin by hand: nothing raises the card a second time
  advance(61_000)
  await s.tick()
  assert.equal(s.state().card, null)
  assert.equal(s.state().toast, `Expired, nothing sent: ${title}`)
})

test('a tap does not set a stop that loosens one set after the card was raised', async () => {
  const { ex, s, advance } = setup([btc({ liqPrice: 0, stopLoss: 0 })])
  await s.tick()
  const card = s.state().card!
  assert.ok(card.action.type === 'setStop' && card.action.price === 59780)
  ex.list[0].stopLoss = 60_500 // the trader set a tighter stop by hand
  ex.closedPnlSince = () => Promise.reject(new Error('503')) // the slow read fails after positions came in: tick() returns before the queue check
  advance(11_000)
  await s.tick()
  assert.match(s.state().error ?? '', /503/)
  assert.equal(s.state().card?.id, card.id) // still queued, nothing purged it
  const r = await s.answer(card.id, true)
  assert.deepEqual(r, { ok: false, message: 'No longer valid, nothing sent' })
  assert.equal(ex.calls.length, 0)
  assert.equal(ex.list[0].stopLoss, 60_500)
  assert.equal(s.state().toast, 'No longer valid, nothing sent')
})

test('balance joins the state, and a failing balance read does not stop the rules', async () => {
  const { ex, s, advance } = setup([btc()])
  ex.equity = 99.87
  ex.available = 97.2
  await s.tick()
  assert.deepEqual(s.state().balance, { equity: 99.87, available: 97.2 })
  ex.balance = () => Promise.reject(new Error('wallet down'))
  advance(11_000)
  await s.tick()
  assert.deepEqual(s.state().balance, { equity: 99.87, available: 97.2 }) // keeps the last good value
  assert.equal(s.state().error, null)
  assert.equal(s.state().card?.key, 'liq:BTCUSDT')
})
