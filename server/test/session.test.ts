import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSession } from '../src/session.ts'
import { createStore, type Store } from '../src/store.ts'
import { FakeExchange } from '../src/fake-exchange.ts'
import { TEMPLATES, type Draft } from '../src/registry.ts'
import { UNKNOWN_BLOCK_MS, closeProposal } from '../src/execute.ts'
import type { Position } from '../src/types.ts'

const START = 1_800_000_000_000

function btc(o: Partial<Position> = {}): Position {
  return {
    symbol: 'BTCUSDT', side: 'Buy', size: 0.05, entryPrice: 62000, markPrice: 61000, liqPrice: 59500, unrealisedPnl: -50,
    stopLoss: 60000, takeProfit: 0, positionIM: 310, leverage: 10, isolated: true, positionIdx: 0, openedAt: START - 3_600_000, ...o,
  }
}

/** Template n as an enabled shortcut, with optional changes to its draft. */
const tpl = (n: number, change: (d: Draft) => void = () => {}) => {
  const d = structuredClone(TEMPLATES[n - 1].draft)
  change(d)
  return { ...d, enabled: true }
}

function setup(positions: Position[] = [btc()], shortcuts: object[] = [tpl(7)]) {
  let now = START
  const ex = new FakeExchange()
  ex.now = () => now
  ex.list = positions
  ex.prices = { BTCUSDT: 61000 }
  const store = createStore(':memory:', () => now)
  for (const s of shortcuts) {
    const r = store.createShortcut(s)
    assert.ok(r.ok, JSON.stringify(!r.ok && r.issues))
  }
  const s = createSession(ex, store, () => now)
  const ticks = async (n = 1) => { for (let i = 0; i < n; i++) { await s.tick(); now += 2000 } }
  return { ex, store, s, ticks, advance: (ms: number) => { now += ms }, now: () => now }
}

const last = (store: Store) => store.history()[0]

test('a shortcut made in the editor raises a proposal from the poll, and a tap executes exactly it', async () => {
  const { ex, store, s, ticks } = setup()
  await ticks()
  const card = s.state().card!
  assert.equal(card.title, 'BTC long · liquidation distance 2.5%')
  assert.equal(card.question, 'Add 100 USDT margin to BTC?')
  assert.deepEqual(card.terms, { type: 'addMargin', symbol: 'BTCUSDT', positionIdx: 0, usd: 100 })
  assert.equal(last(store).status, 'Waiting for a tap on Even G2')
  const r = await s.confirm(card.id, 'tap-1')
  assert.equal(r.ok, true)
  assert.deepEqual(ex.calls, [card.terms])
  assert.equal(r.message, 'Done · added 100 USDT margin')
  assert.equal(last(store).status, 'Done · added 100 USDT margin')
  assert.equal(s.state().card, null)
})

test('duplicate and concurrent taps send once and return the same execution', async () => {
  const { ex, s, ticks } = setup()
  await ticks()
  const id = s.state().card!.id
  const [a, b] = await Promise.all([s.confirm(id, 'k1'), s.confirm(id, 'k2')])
  const c = await s.confirm(id, 'k1')
  assert.equal(ex.calls.length, 1)
  assert.equal(a.execution!.id, b.execution!.id)
  assert.equal(c.execution!.id, a.execution!.id)
})

test('an ambiguous submit is UNKNOWN, never retried, blocks the position, and the next read settles it', async () => {
  const { ex, store, s, ticks } = setup([btc({ stopLoss: 0 })], [tpl(8, d => { (d.action as { target: { percent: string } }).target.percent = '-3' }), tpl(7)])
  await ticks()
  const stop = store.pendingProposals().find(p => p.terms.type === 'setStop')!
  const margin = store.pendingProposals().find(p => p.terms.type === 'addMargin')!
  ex.failNext = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
  const r = await s.confirm(stop.id, 'k1')
  assert.equal(r.ok, false)
  assert.equal(r.execution!.status, 'UNKNOWN')
  assert.equal(r.message, 'Unknown result · check Bybit')
  assert.equal((await s.confirm(stop.id, 'k1')).execution!.status, 'UNKNOWN') // the same tap again: same answer, no resend
  assert.match((await s.confirm(margin.id, 'k2')).message, /unknown result/) // nothing else on this position meanwhile
  assert.equal(ex.calls.length, 0)

  ex.list[0].stopLoss = (stop.terms as { price: number }).price // it did go through on Bybit
  await ticks()
  assert.equal(store.execution(r.execution!.id)!.status, 'APPLIED')
  assert.equal(UNKNOWN_BLOCK_MS, 60_000)
})

test('a clear rejection says why and sends nothing more', async () => {
  const { ex, store, s, ticks } = setup()
  await ticks()
  ex.failNext = 'Add margin works on isolated margin only (Bybit 110076)'
  const r = await s.confirm(s.state().card!.id, 'k')
  assert.equal(r.execution!.status, 'REJECTED')
  assert.equal(last(store).status, 'Rejected · Add margin works on isolated margin only (Bybit 110076)')
  assert.equal(ex.calls.length, 0)
})

test('changed terms supersede the proposal, and a tap aimed at the old one does nothing', async () => {
  const { ex, s, ticks } = setup([btc()], [tpl(6)])
  await ticks()
  const old = s.state().card!
  assert.equal(old.question, 'Close 50% · 0.025 BTC?')
  ex.list[0].size = 0.04 // a partial close elsewhere: 50% is now another qty
  await ticks()
  const fresh = s.state().card!
  assert.equal(fresh.supersedes, old.id)
  assert.equal(fresh.question, 'Close 50% · 0.02 BTC?')
  assert.deepEqual(await s.confirm(old.id, 'k-old'), { ok: false, message: 'Replaced by a newer proposal, nothing sent' })
  assert.equal(ex.calls.length, 0)
  assert.equal((await s.confirm(fresh.id, 'k-new')).ok, true)
  assert.equal(ex.calls.length, 1)
})

test('terms that change between the poll and the tap are not sent: a fresh proposal waits instead', async () => {
  const { ex, s, ticks } = setup([btc()], [tpl(6)])
  await ticks()
  const card = s.state().card!
  ex.list[0].size = 0.04
  const r = await s.confirm(card.id, 'k')
  assert.equal(r.execution!.status, 'REJECTED')
  assert.match(r.message, /terms changed/)
  assert.equal(ex.calls.length, 0)
  assert.equal(s.state().card!.supersedes, card.id)
})

test('a proposal expires after the settings expiry and then cannot run', async () => {
  const { ex, store, s, ticks, advance } = setup()
  await ticks()
  const id = s.state().card!.id
  advance(60_000)
  await ticks()
  assert.equal(s.state().card, null)
  assert.equal(last(store).status, 'Expired · not confirmed within 60 s')
  assert.equal(s.state().toast, 'Expired, nothing sent: BTC long · liquidation distance 2.5%')
  assert.deepEqual(await s.confirm(id, 'k'), { ok: false, message: 'Expired, nothing sent' })
  assert.equal(ex.calls.length, 0)
})

test('editing, pausing or deleting the shortcut withdraws its proposal', async () => {
  const { ex, store, s, ticks } = setup()
  await ticks()
  const id = s.state().card!.id
  const sc = store.listShortcuts()[0]
  store.setEnabled(sc.id, false, sc.version)
  assert.equal(s.state().card, null)
  assert.equal((await s.confirm(id, 'k')).message, 'Replaced by a newer proposal, nothing sent')
  assert.equal(ex.calls.length, 0)
})

test('a dismissal records where it came from and sends nothing', async () => {
  const { ex, store, s, ticks } = setup()
  await ticks()
  const id = s.state().card!.id
  assert.equal(s.dismiss(id, 'glasses').ok, true)
  assert.equal(last(store).status, 'Dismissed on Even G2')
  assert.equal(store.proposal(id)!.dismissedBy, 'glasses')
  assert.equal(s.dismiss(id, 'glasses').ok, false)
  assert.equal(ex.calls.length, 0)
})

test('a test alert is simulated: confirming it never reaches the exchange', async () => {
  const { ex, store, s, ticks } = setup([btc()], [{ ...tpl(7), enabled: false }])
  await ticks()
  assert.equal(s.state().card, null) // paused: the engine skips it
  const t = await s.test(store.listShortcuts()[0].id)
  assert.equal(t.message, 'Simulation · nothing sent to Bybit')
  const card = s.state().card!
  assert.equal(card.simulated, true)
  assert.match(card.title, /^TEST · /)
  const r = await s.confirm(card.id, 'k')
  assert.equal(r.message, 'Test only · nothing was sent')
  assert.deepEqual(ex.calls, [])
})

test('a notify shortcut alerts and never touches the exchange', async () => {
  const { ex, store, s, ticks } = setup([btc()], [tpl(6, d => { d.action = { type: 'NOTIFY' } })])
  await ticks()
  assert.equal(s.state().card, null)
  assert.equal(last(store).status, 'Shown on Even G2')
  assert.equal(s.state().toast, 'Notify · BTC long · liquidation distance 2.5%')
  assert.deepEqual(ex.calls, [])
})

test('Set SL is strict: a stop already past the mark builds no proposal, History says why', async () => {
  const { store, s, ticks } = setup([btc({ stopLoss: 0, markPrice: 60500 })], [tpl(8)])
  await ticks()
  assert.equal(s.state().card, null)
  assert.equal(last(store).status, 'Skipped · stop would be past the price')
})

test('a stop that would loosen or sit past liquidation is skipped', async () => {
  const { ex, store, ticks } = setup([btc({ stopLoss: 62500, markPrice: 63500, unrealisedPnl: 75 })], [tpl(1, d => { (d.conditions.items[0] as { threshold: string }).threshold = '5' })])
  ex.prices.BTCUSDT = 63500
  await ticks()
  assert.equal(last(store).status, 'Skipped · would loosen the stop')
})

test('a voice phrase raises proposals only for targets whose guards pass; a voice-only shortcut never fires by itself', async () => {
  const eth: Position = { ...btc(), symbol: 'ETHUSDT', side: 'Sell', size: 1, entryPrice: 3100, markPrice: 3080, liqPrice: 3600, unrealisedPnl: 20, stopLoss: 0, positionIM: 310 }
  const { ex, store, s, ticks } = setup([btc(), eth], [])
  ex.prices.ETHUSDT = 3080
  store.seed()
  await ticks(3)
  assert.equal(s.state().pending, 0) // voice-only: the engine never evaluates it
  assert.deepEqual(await s.voice('Protect all!'), { ok: true, message: 'Heard "protect all" · 1 proposal' })
  const card = s.state().card!
  assert.equal(card.question, 'Set ETH stop at 3,162?')
  assert.equal(card.voice, true)
  assert.equal(store.history().find(a => a.target === 'BTC long')!.status, 'Skipped · already has a stop loss')
  assert.equal((await s.voice('buy the dip')).message, 'No shortcut for "buy the dip"')
  assert.equal((await s.confirm(card.id, 'k')).ok, true)
  assert.deepEqual(ex.calls, [{ type: 'setStop', symbol: 'ETHUSDT', positionIdx: 0, price: 3162 }])
})

test('a value wobbling inside the hysteresis band fires once', async () => {
  const { ex, store, s, ticks } = setup([btc()], [tpl(6, d => { d.action = { type: 'NOTIFY' } })])
  for (const mark of [61000, 62800, 62600, 62900, 62700]) { // liq distance 2.5%, 5.3%, 5.0%, 5.4%, 5.1%: never clears 5.5%
    ex.setMark('BTCUSDT', mark)
    await ticks()
  }
  assert.equal(store.history().length, 1)
  ex.setMark('BTCUSDT', 63500) // 6.3%: a definite false rearms it
  await ticks()
  ex.setMark('BTCUSDT', 61000)
  await ticks(31) // the 60 s cooldown
  assert.equal(store.history().length, 2)
})

test('a close above maxMktOrderQty is rejected, not split', async () => {
  const { ex, store, s, ticks } = setup([btc({ size: 300 })], [tpl(6, d => { (d.action as { percent: string }).percent = '100' })])
  ex.instruments.BTCUSDT = { tickSize: '0.1', qtyStep: '0.001', minOrderQty: 0.001, maxMktOrderQty: 100, minNotionalValue: 5 }
  await ticks()
  assert.equal(s.state().card, null)
  assert.equal(last(store).status, 'Skipped · more than 100 BTC in one market order')
})

test('global position rules evaluate each position on its own, and a reopened position is a new target', async () => {
  const sol: Position = { ...btc(), symbol: 'SOLUSDT', entryPrice: 140, markPrice: 145, liqPrice: 112, unrealisedPnl: 50, positionIM: 140 }
  const { ex, store, s, ticks } = setup([btc(), sol], [tpl(6, d => { d.action = { type: 'NOTIFY' } })])
  ex.prices.SOLUSDT = 145
  await ticks()
  assert.deepEqual(store.history().map(a => a.target), ['BTC long'])
  const epoch = s.pickers().positions[0].epoch
  ex.list = [sol]
  await ticks()
  ex.list = [btc(), sol]
  await ticks()
  assert.notEqual(s.pickers().positions.find(p => p.symbol === 'BTCUSDT')!.epoch, epoch)
  assert.equal(store.history().length, 2) // the reopened BTC fires again: a new lifecycle, a new trigger state
})

test('a One position shortcut follows its epoch and ignores a reopened position', async () => {
  const { ex, store, s, ticks } = setup([btc()], [])
  await ticks()
  const epoch = s.pickers().positions[0].epoch
  const r = store.createShortcut(tpl(6, d => { d.scope = { type: 'POSITION', symbol: 'BTCUSDT', positionIdx: 0, epoch }; d.action = { type: 'NOTIFY' } }))
  assert.ok(r.ok)
  ex.list = []
  await ticks()
  ex.list = [btc()]
  await ticks(2)
  assert.equal(store.history().length, 0)
})

test('a price crossing needs two samples, and a failed poll between them is a gap, not a crossing', async () => {
  const cross = tpl(10, d => { d.scope = { type: 'SYMBOL', symbol: 'ETHUSDT' }; (d.conditions.items[0] as { threshold: string }).threshold = '3000' })
  const { ex, store, ticks } = setup([], [cross])
  ex.prices.ETHUSDT = 3100
  await ticks() // first sample above the level: no fabricated crossing
  assert.equal(store.history().length, 0)
  ex.prices.ETHUSDT = 2900
  await ticks()
  ex.failReads = 'down'
  await ticks()
  ex.failReads = null
  ex.prices.ETHUSDT = 3100
  await ticks() // 2900 → gap → 3100: not a crossing
  assert.equal(store.history().length, 0)
  ex.prices.ETHUSDT = 2950
  await ticks()
  ex.prices.ETHUSDT = 3050
  await ticks()
  const a = store.history()
  assert.equal(a.length, 1)
  assert.equal(a[0].reason, 'price 3,050')
})

test('price change reads the window warmed from 1-minute candles after a restart', async () => {
  const fall = tpl(11, d => { d.scope = { type: 'SYMBOL', symbol: 'ETHUSDT' } })
  const { ex, store, ticks } = setup([], [fall])
  ex.candles.ETHUSDT = Array.from({ length: 10 }, (_, i) => ({ start: START - (10 - i) * 60_000, close: 3100 }))
  ex.prices.ETHUSDT = 2990 // −3.5% from five minutes ago
  await ticks()
  assert.equal(store.history()[0].reason, 'price down 3.5% in 5 min')
})

test('an order fill raises Set TP on the position that order opened', async () => {
  const order = { orderId: 'o1', orderLinkId: '', symbol: 'BTCUSDT', side: 'Buy' as const, orderType: 'Limit', price: 61000, qty: 0.05, leavesQty: 0.05, reduceOnly: false, stopOrderType: '', triggerBy: '', triggerPrice: 0, positionIdx: 0, status: 'New' }
  const { ex, s, ticks, now } = setup([], [tpl(14, d => { d.scope = { type: 'ORDER', symbol: 'BTCUSDT', orderId: 'o1' } })])
  ex.orders = [order]
  await ticks()
  ex.orders = []
  ex.list = [btc({ entryPrice: 61000 })]
  ex.fills.push({ id: 'e1', orderId: 'o1', orderLinkId: '', symbol: 'BTCUSDT', side: 'Buy', qty: 0.05, price: 61000, leavesQty: 0, time: now() })
  await ticks()
  assert.equal(s.state().card!.question, 'Set BTC take profit at 64,050?')
  await ticks(2) // the same execution never fires twice
  assert.equal(s.state().pending, 1)
})

test('a confirm checks the condition again on fresh state', async () => {
  const { ex, s, ticks } = setup()
  await ticks()
  const card = s.state().card!
  ex.setMark('BTCUSDT', 64000) // far from liquidation now
  const r = await s.confirm(card.id, 'k')
  assert.equal(r.execution!.status, 'REJECTED')
  assert.match(r.message, /no longer holds/)
  assert.equal(ex.calls.length, 0)
})

test('a market order execution reconciles to Filled from the fills', async () => {
  const { ex, store, s, ticks } = setup([btc()], [tpl(6)])
  await ticks()
  const r = await s.confirm(s.state().card!.id, 'k')
  assert.equal(r.message, 'Submitted · waiting for fill')
  await ticks()
  assert.equal(store.execution(r.execution!.id)!.status, 'FILLED')
  assert.equal(last(store).status, 'Filled · 0.025 BTC at 61,000')
  assert.equal(ex.list[0].size, 0.025)
})

test('an exchange read error keeps the last data and reports it; stale data is reported', async () => {
  const { ex, s, ticks, advance } = setup()
  await ticks()
  ex.failReads = 'Bybit HTTP 502'
  await ticks()
  assert.equal(s.state().positions.length, 1)
  assert.equal(s.state().error, 'Bybit HTTP 502')
  ex.failReads = null
  await ticks()
  advance(20_000)
  assert.match(s.state().error ?? '', /No fresh data/)
})

test('a write in flight when the server stopped turns UNKNOWN on restart and blocks the position', async () => {
  const { ex, store, s, ticks, now } = setup([btc()], [tpl(7), tpl(7)])
  await ticks()
  const [first, second] = store.pendingProposals()
  // the process dies after sending, before the answer
  store.saveProposal({ ...first, status: 'AUTHORIZED' })
  store.saveExecution({ id: 'e1', proposalId: first.id, idempotencyKey: 'k1', terms: first.terms, status: 'SUBMITTING', message: '', filledQty: 0, avgPrice: 0, createdAt: now(), updatedAt: now() })
  const restarted = createSession(ex, store, now)
  assert.equal(store.execution('e1')!.status, 'UNKNOWN')
  assert.match((await restarted.confirm(second.id, 'k2')).message, /unknown result/)
  assert.equal(ex.calls.length, 0)
  assert.ok(s)
})

test('a confirm rechecks strictly, not with the hysteresis band', async () => {
  const { ex, s, ticks } = setup([btc({ markPrice: 61969, unrealisedPnl: -1.55 })], [tpl(5, d => { (d.conditions.items[0] as { threshold: string }).threshold = '0.3' })])
  await ticks()
  const card = s.state().card!
  assert.equal(card.why, 'ROI −0.5%')
  ex.setMark('BTCUSDT', 62009.3) // ROI +0.15%: inside the band, but no longer a loss
  const r = await s.confirm(card.id, 'k')
  assert.match(r.message, /no longer holds/)
  assert.equal(ex.calls.length, 0)
})

test('an ORDER shortcut ignores an order from another symbol, and a closing order never maps to the position', async () => {
  const order = { orderId: 'o1', orderLinkId: '', symbol: 'BTCUSDT', side: 'Sell' as const, orderType: 'Limit', price: 61000, qty: 0.02, leavesQty: 0.02, reduceOnly: false, stopOrderType: '', triggerBy: '', triggerPrice: 0, positionIdx: 0, status: 'New' }
  const eth: Position = { ...btc(), symbol: 'ETHUSDT', side: 'Sell', size: 1, entryPrice: 3100, markPrice: 3080, liqPrice: 3600, stopLoss: 3200 }
  const { ex, store, s, ticks, now } = setup([btc(), eth], [
    tpl(14, d => { d.scope = { type: 'ORDER', symbol: 'ETHUSDT', orderId: 'o1' } }), // the BTC order under an ETH scope
    tpl(14, d => { d.scope = { type: 'ORDER', symbol: 'BTCUSDT', orderId: 'o1' }; d.action = { type: 'CLOSE_POSITION', percent: '100' } }), // a Sell on a long
  ])
  ex.prices.ETHUSDT = 3080
  ex.orders = [order]
  await ticks()
  ex.orders = []
  ex.fills.push({ id: 'e1', orderId: 'o1', orderLinkId: '', symbol: 'BTCUSDT', side: 'Sell', qty: 0.02, price: 61000, leavesQty: 0, time: now() })
  await ticks()
  assert.equal(s.state().card, null)
  assert.deepEqual(store.history().map(a => a.status), ['Skipped · position is closed', 'Skipped · position is closed'])
  assert.equal(ex.calls.length, 0)
})

test('a read error at the moment a Once shortcut fires does not use it up', async () => {
  const open = tpl(13, d => {
    d.scope = { type: 'SYMBOL', symbol: 'ETHUSDT' }
    ;(d.conditions.items[0] as { threshold: string }).threshold = '3000'
    d.action = { type: 'OPEN_POSITION', side: 'LONG', notionalUsdt: '100', leverage: '10' }
  })
  const { ex, store, s, ticks } = setup([], [open])
  const slots = ex.slots.bind(ex)
  ex.prices.ETHUSDT = 2950
  await ticks()
  ex.slots = async () => { throw new Error('Bybit HTTP 502') }
  ex.prices.ETHUSDT = 3050
  await ticks()
  assert.equal(store.history().length, 0) // retried, not recorded as a skip
  ex.slots = slots
  ex.prices.ETHUSDT = 2950
  await ticks()
  ex.prices.ETHUSDT = 3050
  await ticks()
  assert.equal(s.state().card!.question, 'Open long 0.032 ETH · 100 USDT?')
})

test('closing a proposal does nothing once a tap has authorized it', async () => {
  const { store, s, ticks } = setup()
  await ticks()
  const p = s.state().card!
  store.saveProposal({ ...p, status: 'AUTHORIZED' })
  assert.equal(closeProposal(store, p, 'SUPERSEDED', 'Withdrawn · test'), false)
  assert.equal(store.proposal(p.id)!.status, 'AUTHORIZED')
})
