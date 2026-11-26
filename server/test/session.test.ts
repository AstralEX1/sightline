import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSession } from '../src/session.ts'
import { createStore, type Store } from '../src/store.ts'
import { demoExchange, FakeExchange } from '../src/fake-exchange.ts'
import { receiptLine } from '../src/proposals.ts'
import { CLOSE_SEED, STARTER_RULES, VOICE_SEEDS, type Draft } from '../src/registry.ts'
import { template } from './removed-templates.ts'
import { closeProposal } from '../src/execute.ts'
import type { Position } from '../src/types.ts'

const START = 1_800_000_000_000

function btc(o: Partial<Position> = {}): Position {
  return {
    symbol: 'BTCUSDT', side: 'Buy', size: 0.05, entryPrice: 62000, markPrice: 61000, liqPrice: 59500, unrealisedPnl: -50,
    stopLoss: 60000, takeProfit: 0, positionIM: 310, leverage: 10, isolated: true, positionIdx: 0, openedAt: START - 3_600_000, ...o,
  }
}

/** Template n (current or removed) as an enabled shortcut, with optional changes to its draft. */
const tpl = (n: number, change: (d: Draft) => void = () => {}) => {
  const d = template(n)
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
  assert.equal(card.question, 'Add 50 USDT margin to BTC?')
  assert.deepEqual(card.terms, { type: 'addMargin', symbol: 'BTCUSDT', positionIdx: 0, usd: 50 })
  assert.equal(last(store).status, 'Waiting for a tap on Even G2')
  const r = await s.confirm(card.id, 'tap-1')
  assert.equal(r.ok, true)
  assert.deepEqual(ex.calls, [card.terms])
  assert.equal(r.message, 'Done · added 50 USDT margin')
  assert.equal(last(store).status, 'Done · added 50 USDT margin')
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
  const { ex, store, s, ticks } = setup([btc({ stopLoss: 0 })], [tpl(7, d => { d.action = { type: 'SET_SL', target: { kind: 'ENTRY_OFFSET', percent: '-3' } } }), tpl(7)])
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
})

test('an unresolved timeout still blocks a fresh proposal after a minute and a restart', async () => {
  const { ex, store, s, ticks, advance, now } = setup()
  await ticks()
  ex.failNext = Object.assign(new Error('timeout'), { name: 'TimeoutError' })
  assert.equal((await s.confirm(s.state().card!.id, 'first')).execution?.status, 'UNKNOWN')
  advance(61_000)
  assert.ok(store.createShortcut(tpl(7)).ok)
  const restarted = createSession(ex, store, now)
  await restarted.tick()
  assert.match((await restarted.confirm(restarted.state().card!.id, 'second')).message, /unknown result/)
  assert.equal(ex.calls.length, 0)
})

test('pausing while a poll is reading prevents stale alerts and proposals', async () => {
  const { s, store } = setup()
  const tick = s.tick()
  store.setEnabled(store.listShortcuts()[0].id, false)
  await tick
  assert.equal(store.history().length, 0)
  assert.equal(store.pendingProposals().length, 0)
})

test('editing while a voice shortcut resolves prevents a stale proposal', async () => {
  const { s, store, ticks } = setup([btc({ stopLoss: 0 })], [])
  store.seed()
  await ticks()
  const rule = store.listShortcuts().find(r => r.voicePhrase === 'protect all')!
  const command = s.voice('protect all')
  store.updateShortcut(rule.id, { ...rule, name: 'Updated' }, rule.version)
  assert.equal((await command).ok, false)
  assert.equal(store.history().length, 0)
  assert.equal(store.pendingProposals().length, 0)
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
  const { store, s, ticks } = setup([btc({ stopLoss: 0, markPrice: 60500 })], [tpl(7, d => { d.action = { type: 'SET_SL', target: { kind: 'ENTRY_OFFSET', percent: '-2' } } })])
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
  const { ex, store, ticks } = setup([btc()], [tpl(6, d => { d.action = { type: 'NOTIFY' } })])
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

test('Positions by coin follows every position of its coins on its side, a reopened one too', async () => {
  const eth = (o: Partial<Position> = {}) => btc({ symbol: 'ETHUSDT', entryPrice: 3000, markPrice: 2950, liqPrice: 2880, ...o })
  const r = tpl(6, d => { d.scope = { type: 'COIN_POSITIONS', symbols: ['BTCUSDT', 'ETHUSDT'], side: 'LONG' }; d.action = { type: 'NOTIFY' } })
  const sol = btc({ symbol: 'SOLUSDT', entryPrice: 150, markPrice: 140, liqPrice: 137 })
  const { ex, store, ticks, advance } = setup([btc(), sol, eth({ side: 'Sell', liqPrice: 3010 })], [r])
  await ticks()
  assert.deepEqual(store.history().map(a => a.target), ['BTC long']) // SOL is not one of its coins, the ETH short not its side
  ex.list = [btc()]
  await ticks()
  ex.list = [btc(), eth()]
  advance(120_000)
  await ticks()
  assert.deepEqual(store.history().map(a => a.target).sort(), ['BTC long', 'ETH long'])
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

test('price change counts from the price when the shortcut is turned on, then from its last alert', async () => {
  const fall = tpl(11, d => { d.scope = { type: 'SYMBOL', symbol: 'ETHUSDT' } })
  const { ex, store, s, ticks, advance } = setup([], [fall])
  ex.prices.ETHUSDT = 3000
  await ticks() // the base
  ex.prices.ETHUSDT = 2950 // −1.7%
  await ticks()
  assert.equal(store.history().length, 0)
  ex.prices.ETHUSDT = 2930 // −2.3%
  await ticks()
  assert.deepEqual(store.history().map(a => a.reason), ['price down 2.3%'])
  advance(120_000) // past the cooldown
  ex.prices.ETHUSDT = 2900 // −1.0% from the alert's 2930
  await ticks(2)
  assert.equal(store.history().length, 1)
  ex.prices.ETHUSDT = 2860 // −2.4% from 2930
  await ticks()
  assert.equal(store.history().length, 2)

  // Off and on again: the base is the price at the switch-on, so the earlier fall does not count
  const id = store.listShortcuts()[0].id
  store.setEnabled(id, false)
  store.setEnabled(id, true)
  ex.prices.ETHUSDT = 2850
  advance(120_000)
  await ticks()
  ex.prices.ETHUSDT = 2830 // −0.7% from 2850
  await ticks()
  assert.equal(store.history().length, 2)
  assert.equal(s.state().error, null)
})

test('price moves 15% fires on a rise and on a fall, and stays quiet on a smaller move', async () => {
  const on = (symbol: string) => tpl(26, d => { d.scope = { type: 'SYMBOL', symbol } })
  const { ex, store, ticks } = setup([], [on('ETHUSDT'), on('SOLUSDT'), on('XRPUSDT')])
  ex.prices = { ETHUSDT: 3000, SOLUSDT: 150, XRPUSDT: 2 }
  await ticks()
  ex.prices = { ETHUSDT: 3453, SOLUSDT: 127.35, XRPUSDT: 2.28 } // +15.1%, −15.1%, +14%
  await ticks()
  assert.deepEqual(store.history().map(a => [a.target, a.reason]).sort(), [['ETH', 'price up 15.1%'], ['SOL', 'price down 15.1%']])
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
  assert.equal(s.state().card!.question, 'Set BTC take profit at 62,830?')
  await ticks(2) // the same execution never fires twice
  assert.equal(s.state().pending, 1)
})

test('All orders: a fill sets the take profit of the position that order opened only, and the card outlives the fill', async () => {
  const order = (orderId: string, symbol: string, o: object = {}) => ({ orderId, orderLinkId: '', symbol, side: 'Buy' as const, orderType: 'Limit', price: 61000, qty: 0.05, leavesQty: 0.05, reduceOnly: false, stopOrderType: '', triggerBy: '', triggerPrice: 0, positionIdx: 0, status: 'New', ...o })
  const eth: Position = { ...btc(), symbol: 'ETHUSDT', size: 1, entryPrice: 3000, markPrice: 3000, liqPrice: 2500, stopLoss: 0 }
  const { ex, store, s, ticks, now } = setup([eth], [tpl(14)])
  ex.prices.ETHUSDT = 3000
  ex.orders = [order('o1', 'BTCUSDT'), order('o2', 'ETHUSDT', { price: 3000 })]
  await ticks()
  ex.orders = [order('o2', 'ETHUSDT', { price: 3000 })] // only the BTC order fills
  ex.list = [btc({ entryPrice: 61000 }), eth]
  ex.fills.push({ id: 'e1', orderId: 'o1', orderLinkId: '', symbol: 'BTCUSDT', side: 'Buy', qty: 0.05, price: 61000, leavesQty: 0, time: now() })
  await ticks()
  assert.equal(s.state().card!.question, 'Set BTC take profit at 62,830?')
  await ticks(2) // the filled order left the open list: the card stays, and the same fill never fires twice
  assert.equal(s.state().pending, 1)
  assert.equal(store.history().length, 1)
  const r = await s.confirm(s.state().card!.id, 'k')
  assert.equal(r.ok, true)
  assert.deepEqual(ex.calls, [{ type: 'setTakeProfit', symbol: 'BTCUSDT', positionIdx: 0, price: 62830 }])
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

test('an Open with picks: no confirm until a pick, the pick builds the terms, the picked leverage is set first', async () => {
  const open = tpl(13, d => {
    d.scope = { type: 'SYMBOL', symbol: 'ETHUSDT' }
    ;(d.conditions.items[0] as { threshold: string }).threshold = '3000'
    d.action = { type: 'OPEN_SHORT', sizes: ['100', '300'], leverages: ['2', '5'] }
  })
  const { ex, store, s, ticks } = setup([], [open])
  ex.prices.ETHUSDT = 2950
  await ticks()
  ex.prices.ETHUSDT = 3050
  await ticks()
  const card = s.state().card!
  assert.deepEqual(card.picks, { sizes: [100, 300], leverages: [2, 5] })
  assert.match((await s.confirm(card.id, 'k0')).message, /Pick the size/)
  assert.equal((await s.pick(card.id, 200, 5)).ok, false) // not one of the choices
  const r = await s.pick(card.id, 300, 5)
  assert.ok(r.ok && r.proposalId)
  const picked = store.proposal(r.proposalId!)!
  assert.equal(picked.picks, undefined)
  assert.equal(picked.supersedes, card.id)
  assert.equal(store.proposal(card.id)!.status, 'SUPERSEDED')
  assert.ok(picked.terms.type === 'order')
  assert.deepEqual([picked.terms.side, picked.terms.notionalUsdt, picked.terms.leverage], ['Sell', 298.9, 5]) // what 0.098 ETH costs, not the 300 asked for
  const c = await s.confirm(picked.id, 'k1')
  assert.equal(c.execution!.status, 'ACKNOWLEDGED', c.message)
  assert.equal(ex.leverage.ETHUSDT, 5)
  assert.equal(ex.calls.length, 1)
})

test('a read error at the moment a Once shortcut fires does not use it up', async () => {
  const open = tpl(13, d => {
    d.scope = { type: 'SYMBOL', symbol: 'ETHUSDT' }
    ;(d.conditions.items[0] as { threshold: string }).threshold = '3000'
    d.action = { type: 'OPEN_LONG', sizes: ['100'], leverages: ['10'] }
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
  assert.equal(s.state().card!.question, 'Open long 0.032 ETH · 97.6 USDT?') // what 0.032 ETH costs, not the 100 asked for
})

const ethOpen = (sizes: string[], leverages: string[]) => tpl(13, d => {
  d.scope = { type: 'SYMBOL', symbol: 'ETHUSDT' }
  ;(d.conditions.items[0] as { threshold: string }).threshold = '3000'
  d.action = { type: 'OPEN_LONG', sizes, leverages }
})
const cross = async (ex: FakeExchange, ticks: () => Promise<void>) => {
  ex.prices.ETHUSDT = 2950
  await ticks()
  ex.prices.ETHUSDT = 3050
  await ticks()
}

test('a failing rule cannot block a later near-liquidation rule', async () => {
  const { store, s, ticks } = setup([btc()], [tpl(7), tpl(7)])
  const [broken, healthy] = store.listShortcuts()
  const trigger = store.trigger.bind(store)
  store.trigger = key => {
    if (key.startsWith(`${broken.id}:`)) throw new Error('cannot read this trigger')
    return trigger(key)
  }
  await ticks(2)
  assert.equal(s.state().card?.shortcutId, healthy.id)
  assert.equal(store.auditLog(broken.id).filter(a => a.event === 'evaluation_failed').length, 1)
})

test('concurrent picks replace the original card at most once', async () => {
  const { ex, store, s, ticks } = setup([], [ethOpen(['100', '300'], ['5'])])
  await cross(ex, ticks)
  const card = s.state().card!
  const results = await Promise.all([s.pick(card.id, 100, 5), s.pick(card.id, 300, 5)])
  assert.equal(results.filter(r => r.ok).length, 1)
  assert.equal(results.find(r => !r.ok)?.message, 'Proposal is gone')
  assert.equal(store.pendingProposals().length, 1)
})

test('a pick in flight cannot resurrect a dismissed or expired card', async () => {
  for (const dismiss of [true, false]) {
    const { ex, store, s, ticks, advance } = setup([], [ethOpen(['100', '300'], ['5'])])
    await cross(ex, ticks)
    const card = s.state().card!
    let release!: () => void
    const delayed = new Promise<void>(done => { release = done })
    const slots = ex.slots.bind(ex)
    ex.slots = async symbol => { await delayed; return slots(symbol) }
    const pending = s.pick(card.id, 300, 5)
    if (dismiss) s.dismiss(card.id, 'glasses')
    else advance(card.expiresAt - START)
    release()
    assert.deepEqual(await pending, { ok: false, message: 'Proposal is gone' })
    assert.equal(s.state().pending, 0)
    if (dismiss) assert.equal(store.proposal(card.id)?.status, 'DISMISSED')
  }
})

test('confirm sets the leverage shown on an Open even if the slot changed since the alert', async () => {
  const { ex, s, ticks } = setup([], [ethOpen(['100'], ['10'])])
  ex.leverage.ETHUSDT = 10
  await cross(ex, ticks)
  const card = s.state().card!
  ex.leverage.ETHUSDT = 50
  const place = ex.placeOrder.bind(ex)
  ex.placeOrder = order => {
    assert.equal(ex.leverage.ETHUSDT, 10)
    return place(order)
  }
  assert.equal((await s.confirm(card.id, 'k1')).execution?.status, 'ACKNOWLEDGED')
})

test('a failed leverage write rejects an Open before sending an order', async () => {
  const { ex, s, ticks } = setup([], [ethOpen(['100'], ['10'])])
  ex.leverage.ETHUSDT = 10
  await cross(ex, ticks)
  ex.setLeverage = async () => { throw new Error('leverage denied') }
  const r = await s.confirm(s.state().card!.id, 'k1')
  assert.equal(r.execution?.status, 'REJECTED')
  assert.match(r.message, /could not set 10x leverage/)
  assert.equal(ex.calls.length, 0)
})

test('an ANY price-change match still authorizes a close when its loss branch is false', async () => {
  const rule = tpl(7, d => {
    d.action = { type: 'CLOSE_POSITION', percent: '50' }
    d.conditions = { logic: 'ANY', items: [
      { id: 'price', type: 'PRICE_CHANGE', source: 'LAST', direction: 'DOWN', percent: '1' },
      { id: 'loss', type: 'LOSS', unit: 'USDT', threshold: '1000' },
    ] }
  })
  const { ex, store, s, ticks } = setup([btc()], [rule])
  await ticks()
  ex.prices.BTCUSDT = 60_000
  await ticks()
  assert.deepEqual(last(store).matched, ['price'])
  const result = await s.confirm(s.state().card!.id, 'k1')
  assert.equal(result.execution?.status, 'ACKNOWLEDGED', result.message)
})

test('an Open with picks is offered when only some choices fit the balance', async () => {
  const { ex, s, ticks } = setup([], [ethOpen(['100', '300'], ['1', '10'])])
  ex.available = 50 // 100 at 1x needs 97.6, 100 at 10x needs 9.76
  await cross(ex, ticks)
  const card = s.state().card!
  assert.deepEqual(card.picks, { sizes: [100, 300], leverages: [1, 10] })
  assert.equal((await s.pick(card.id, 300, 1)).ok, false)
  assert.equal((await s.pick(card.id, 100, 10)).ok, true)
})

test('a skipped Once shortcut is not used up: a new crossing offers it again', async () => {
  const { ex, store, s, ticks, advance } = setup([], [ethOpen(['100'], ['10'])])
  ex.available = 5
  await cross(ex, ticks)
  assert.equal(s.state().card, null)
  assert.match(last(store).status, /^Skipped/)
  ex.available = 8_000
  advance(120_000)
  await cross(ex, ticks)
  assert.equal(s.state().card!.question, 'Open long 0.032 ETH · 97.6 USDT?')
})

test('a tap whose fresh read fails offers a Once shortcut again too', async () => {
  const { ex, s, ticks, advance } = setup([], [ethOpen(['100'], ['10'])])
  await cross(ex, ticks)
  const card = s.state().card!
  ex.failReads = 'Bybit HTTP 502'
  assert.match((await s.confirm(card.id, 'tap-1')).message, /could not check the position/)
  ex.failReads = null
  advance(120_000)
  await cross(ex, ticks)
  assert.notEqual(s.state().card?.id ?? card.id, card.id)
  assert.equal(ex.calls.length, 0)
})

test('closing a proposal does nothing once a tap has authorized it', async () => {
  const { store, s, ticks } = setup()
  await ticks()
  const p = s.state().card!
  store.saveProposal({ ...p, status: 'AUTHORIZED' })
  assert.equal(closeProposal(store, p, 'SUPERSEDED', 'Withdrawn · test'), false)
  assert.equal(store.proposal(p.id)!.status, 'AUTHORIZED')
})

// ---- Closes, order age, funding, volume ----

const slOrder = { orderId: 'sl1', orderLinkId: '', symbol: 'BTCUSDT', side: 'Sell' as const, orderType: 'Market', price: 0, qty: 0.05, leavesQty: 0.05, reduceOnly: true, stopOrderType: 'StopLoss', triggerBy: 'LastPrice', triggerPrice: 60000, positionIdx: 0, status: 'Untriggered' }

test('a position closed by its stop loss alerts once after it is gone, split fills included', async () => {
  const { ex, store, ticks, now } = setup([btc()], [tpl(17), tpl(18)])
  ex.orders = [slOrder]
  await ticks()
  ex.list = []
  ex.orders = []
  ex.fills.push(
    { id: 'e1', orderId: 'sl1', orderLinkId: '', symbol: 'BTCUSDT', side: 'Sell', qty: 0.03, price: 60000, leavesQty: 0.02, time: now(), closedBy: 'SL' },
    { id: 'e2', orderId: 'sl1', orderLinkId: '', symbol: 'BTCUSDT', side: 'Sell', qty: 0.02, price: 59990, leavesQty: 0, time: now(), closedBy: 'SL' },
  )
  await ticks(3)
  const h = store.history()
  assert.deepEqual(h.map(a => [a.target, a.reason]), [['BTC long', 'closed by stop loss at 59,990']]) // the take-profit shortcut stays quiet
})

test('a liquidation names the slot its side held, without a listed order', async () => {
  const { ex, store, ticks, now } = setup([btc()], [tpl(19)])
  await ticks()
  ex.list = []
  ex.fills.push({ id: 'e1', orderId: 'bust', orderLinkId: '', symbol: 'BTCUSDT', side: 'Sell', qty: 0.05, price: 59500, leavesQty: 0, time: now(), closedBy: 'LIQUIDATION' })
  await ticks()
  assert.equal(store.history()[0].reason, 'liquidated at 59,500')
})

test('All orders: an order open too long gets a cancel proposal; a fresh one does not', async () => {
  const limit = { ...slOrder, stopOrderType: '', orderType: 'Limit', price: 58000, side: 'Buy' as const, reduceOnly: false, status: 'New' }
  const { ex, s, ticks } = setup([], [tpl(24)])
  ex.orders = [{ ...limit, orderId: 'old', createdAt: START - 61 * 60_000 }, { ...limit, orderId: 'new', createdAt: START - 5 * 60_000 }]
  await ticks()
  assert.equal(s.state().pending, 1)
  assert.deepEqual(s.state().card!.terms, { type: 'cancel', symbol: 'BTCUSDT', orderId: 'old' })
  assert.equal(s.state().card!.why, 'order open 1 h 1 min')
})

test('All orders: a conditional entry order (Bybit "Stop") can be cancelled, a stop loss order cannot', async () => {
  const { ex, s, ticks } = setup([], [tpl(24)])
  const old = START - 61 * 60_000
  ex.orders = [{ ...slOrder, orderId: 'entry', stopOrderType: 'Stop', side: 'Buy', reduceOnly: false, triggerPrice: 63000, createdAt: old }, { ...slOrder, createdAt: old }]
  await ticks()
  assert.equal(s.state().pending, 1)
  const card = s.state().card!
  assert.deepEqual(card.terms, { type: 'cancel', symbol: 'BTCUSDT', orderId: 'entry' })
  await s.confirm(card.id, 'tap-1')
  assert.deepEqual(ex.calls, [{ type: 'cancel', symbol: 'BTCUSDT', orderId: 'entry' }])
})

test('a tap checks the condition at the price of the tap, not the last poll', async () => {
  const { ex, s, ticks } = setup([btc()], [tpl(27, d => { d.action = { type: 'CLOSE_POSITION', percent: '50' } })])
  ex.prices.BTCUSDT = 60300 // 0.5% from the stop at 60,000
  ex.setMark('BTCUSDT', 60300)
  await ticks()
  const card = s.state().card!
  ex.prices.BTCUSDT = 63000 // ran away before the next poll
  ex.setMark('BTCUSDT', 63000)
  assert.match((await s.confirm(card.id, 'tap-1')).message, /condition no longer holds/)
  assert.equal(ex.calls.length, 0)
})

test('funding: a long paying the next funding inside the window is told so', async () => {
  const { ex, store, ticks } = setup([btc()], [tpl(20)])
  ex.funding.BTCUSDT = { ratePct: 0.08, at: START + 20 * 60_000 }
  await ticks()
  assert.equal(store.history()[0].reason, 'funding 0.08% due within 30 min')
})

test('volume spike: the last 5 minutes against the hour before, read from last-price candles', async () => {
  const { ex, store, ticks } = setup([], [tpl(22, d => { d.scope = { type: 'SYMBOL', symbol: 'BTCUSDT' } })])
  const minute = Math.floor(START / 60_000) * 60_000
  ex.candles.BTCUSDT = Array.from({ length: 70 }, (_, i) => ({ start: minute - (70 - i) * 60_000, close: 61000, volume: i >= 65 ? 40 : 10 }))
  await ticks()
  assert.equal(store.history()[0].reason, 'volume 4.0× in 5 min')
})

// ── Receipts, starter rules ────────────────────────────────

test('a done write gets a receipt from the position Bybit shows after it, on the next poll, in History too', async () => {
  const { s, store, ticks } = setup() // template 7: add 50 USDT margin at liquidation distance 2.5%
  await ticks()
  const r = await s.confirm(s.state().card!.id, 'tap')
  assert.equal(r.execution!.status, 'APPLIED')
  assert.equal(r.execution!.receipt, undefined) // the poll before the tap cannot know the after side
  await ticks(2) // the first poll started in the same ms as the write, so only the next one is surely after it
  assert.equal(store.execution(r.execution!.id)!.receipt, 'liq 2.5% → 4.1%')
  assert.equal(last(store).status, 'Done · added 50 USDT margin · liq 2.5% → 4.1%')
  assert.equal((await s.confirm(r.execution!.proposalId, 'tap')).execution!.receipt, 'liq 2.5% → 4.1%') // a resend gets it as it is
})

test('a close gets its size receipt only once it is filled, and none for a rejection', async () => {
  const { s, store, ticks } = setup([btc()], [tpl(6)])
  await ticks()
  const r = await s.confirm(s.state().card!.id, 'tap')
  assert.equal(r.execution!.status, 'ACKNOWLEDGED')
  await ticks(3)
  assert.equal(store.execution(r.execution!.id)!.status, 'FILLED')
  assert.equal(store.execution(r.execution!.id)!.receipt, '0.05 → 0.025 BTC') // isolated: liquidation stays where it was

  const other = setup([btc()], [tpl(6)])
  await other.ticks()
  other.ex.failNext = 'Reduce-only order would not reduce the position (Bybit 110017)'
  const no = await other.s.confirm(other.s.state().card!.id, 'tap')
  assert.equal(no.execution!.status, 'REJECTED')
  await other.ticks(2)
  assert.equal(other.store.execution(no.execution!.id)!.receipt, undefined)
  assert.equal(last(other.store).status, 'Rejected · Reduce-only order would not reduce the position (Bybit 110017)')
})

test('History waits for the position to reflect partial and final fills', async () => {
  const { s, store, ex, ticks, now } = setup([btc()], [tpl(6)])
  await ticks()
  const r = await s.confirm(s.state().card!.id, 'tap')
  const id = r.execution!.id
  const fill = ex.fills[0]
  Object.assign(fill, { qty: 0.015, leavesQty: 0.01 })
  ex.list[0].size = 0.05 // the order fill arrives before the position read catches up
  await ticks(2)
  assert.equal(store.execution(id)!.status, 'PARTIALLY_FILLED')
  assert.equal(store.execution(id)!.receipt, undefined)
  Object.assign(ex.list[0], { size: 0.035, openedAt: now() }) // Bybit supplies its position update time here
  await ticks()
  assert.equal(store.execution(id)!.receipt, '0.05 → 0.035 BTC')
  ex.fills.push({ ...fill, id: 'remaining', qty: 0.01, leavesQty: 0, time: now() })
  await ticks(2)
  assert.equal(store.execution(id)!.status, 'FILLED')
  assert.equal(store.execution(id)!.receipt, undefined)
  Object.assign(ex.list[0], { size: 0.025, openedAt: now() })
  await ticks()
  assert.equal(store.execution(id)!.receipt, '0.05 → 0.025 BTC')
})

test('a partial fill has no position readback after its slot is reused by another position', async () => {
  const { s, store, ex, ticks } = setup([btc()], [tpl(6)])
  await ticks()
  const r = await s.confirm(s.state().card!.id, 'tap')
  const id = r.execution!.id
  Object.assign(ex.fills[0], { qty: 0.015, leavesQty: 0.01 })
  ex.list[0] = btc({ side: 'Sell', size: 0.09, liqPrice: 62500 })
  await ticks(2)
  assert.equal(store.execution(id)!.status, 'PARTIALLY_FILLED')
  assert.equal(store.execution(id)!.filledQty, 0.015)
  assert.equal(store.execution(id)!.receipt, undefined)
})

test('receipt lines: stops and take profits as Bybit shows them, an open from flat, a full close', () => {
  const p = btc({ stopLoss: 0 })
  assert.equal(receiptLine({ type: 'setStop', symbol: 'BTCUSDT', positionIdx: 0, price: 60760 }, p, { ...p, stopLoss: 60760 }), 'stop none → 60,760')
  assert.equal(receiptLine({ type: 'setStop', symbol: 'BTCUSDT', positionIdx: 0, price: 61500 }, btc(), btc({ stopLoss: 61000 })), 'stop 60,000 → 61,000') // what Bybit kept, not what was asked
  assert.equal(receiptLine({ type: 'setTakeProfit', symbol: 'BTCUSDT', positionIdx: 0, price: 65000 }, p, { ...p, takeProfit: 65000 }), 'take profit none → 65,000')
  const open = { type: 'order', symbol: 'XRPUSDT', side: 'Buy', qty: '40', positionIdx: 0, reduceOnly: false, orderLinkId: 'l' } as const
  assert.equal(receiptLine(open, undefined, btc({ symbol: 'XRPUSDT', size: 40, markPrice: 2.5, liqPrice: 2.25 })), '0 → 40 XRP · liq 10.0%')
  assert.equal(receiptLine(open, undefined, btc({ symbol: 'XRPUSDT', size: 40, liqPrice: 0 })), '0 → 40 XRP')
  const close = { ...open, symbol: 'BTCUSDT', side: 'Sell', qty: '0.05', reduceOnly: true } as const
  assert.equal(receiptLine(close, btc(), undefined), '0.05 → 0 BTC · position closed')
  assert.equal(receiptLine(close, btc(), btc({ size: 0.025, liqPrice: 55000 })), '0.05 → 0.025 BTC · liq 2.5% → 9.8%') // cross: it moved
  assert.equal(receiptLine({ type: 'cancel', symbol: 'BTCUSDT', orderId: 'o' }, btc(), btc()), undefined)
  assert.equal(receiptLine(open, undefined, undefined), undefined)
})

test('starter rules: on the demo account the lens has work at once, and the menu does not ask twice', async () => {
  const { ex, stop } = demoExchange(START)
  stop()
  const store = createStore(':memory:', () => START)
  store.seed([...STARTER_RULES, ...VOICE_SEEDS])
  assert.deepEqual(store.listShortcuts().map(r => [r.action.type, r.enabled]),
    [['CLOSE_POSITION', true], ['MOVE_SL', true], ['SET_SL', true], ['MOVE_SL', true]])
  let now = START
  const s = createSession(ex, store, () => now)
  await s.tick()
  now += 2000
  const cards = () => store.pendingProposals().map(p => p.question).sort()
  assert.deepEqual(cards(), ['Move SOL stop to entry 140?'])
  assert.deepEqual(await s.command('lock'), { ok: true, message: 'Heard "lock profits" · 1 proposal' }) // the card already up
  assert.equal(cards().length, 1)
  ex.setMark('BTCUSDT', 61200) // liquidation distance 2.8%: the third rule
  ex.prices.BTCUSDT = 61200
  await s.tick()
  assert.ok(cards().includes('Close 50% · 0.025 BTC?'))
  assert.equal(ex.calls.length, 0) // every one still waits for a tap
})

test('a tap whose fresh read fails sends nothing and offers the card again once reads recover', async () => {
  const { ex, s, ticks } = setup()
  await ticks()
  const card = s.state().card!
  ex.failReads = 'Bybit HTTP 502'
  const r = await s.confirm(card.id, 'tap-1')
  assert.match(r.message, /could not check the position/)
  assert.equal(ex.calls.length, 0)
  await ticks() // reads still failing: no card loop
  assert.equal(s.state().card, null)
  ex.failReads = null
  await ticks()
  assert.equal(s.state().card!.question, card.question)
  assert.notEqual(s.state().card!.id, card.id)
})

test('a once-only near-liquidation rule can fire again after a rejected fresh recheck', async () => {
  const { ex, s, ticks } = setup([btc()], [tpl(7, d => { d.trigger.mode = 'ONCE' })])
  await ticks()
  const original = s.state().card!
  ex.setMark('BTCUSDT', 63000)
  ex.prices.BTCUSDT = 63000
  const r = await s.confirm(original.id, 'tap-1')
  assert.equal(r.execution?.status, 'REJECTED')
  assert.equal(ex.calls.length, 0)

  ex.setMark('BTCUSDT', 61000)
  ex.prices.BTCUSDT = 61000
  await ticks()
  assert.equal(s.state().card?.question, original.question)
  assert.notEqual(s.state().card?.id, original.id)
})

test('a failed fills read does not blind the position rules', async () => {
  const { ex, s, ticks } = setup()
  ex.fillsSince = async () => { throw new Error('Bybit 10005') }
  await ticks()
  assert.equal(s.state().card!.question, 'Add 50 USDT margin to BTC?')
  assert.match(s.state().error ?? '', /10005/)
})

test('a close whose fills read failed on the tick the position went still alerts on the next tick', async () => {
  const { ex, store, ticks, now } = setup([btc()], [tpl(19)])
  await ticks()
  ex.list = []
  const fillsSince = ex.fillsSince.bind(ex)
  ex.fillsSince = async () => { throw new Error('Bybit HTTP 502') }
  await ticks()
  ex.fillsSince = fillsSince
  ex.fills.push({ id: 'e1', orderId: 'bust', orderLinkId: '', symbol: 'BTCUSDT', side: 'Sell', qty: 0.05, price: 59500, leavesQty: 0, time: now(), closedBy: 'LIQUIDATION' })
  await ticks()
  assert.equal(store.history()[0]?.reason, 'liquidated at 59,500')
})

test('chart: an open position\'s candles oldest first, read once a minute; nothing for other symbols', async () => {
  const { ex, s, ticks, advance } = setup()
  ex.candles.BTCUSDT = [{ start: 2, close: 61100 }, { start: 1, close: 61000 }]
  ex.candles.ETHUSDT = [{ start: 1, close: 3000 }, { start: 2, close: 3001 }]
  await ticks()
  const closes = async (sym: string) => (await s.chart(sym)).map(c => c.close)
  assert.deepEqual(await s.chart('BTCUSDT'), [{ start: 1, close: 61000 }, { start: 2, close: 61100 }])
  assert.deepEqual(await closes('ETHUSDT'), [])
  ex.candles.BTCUSDT.push({ start: 3, close: 61200 })
  assert.deepEqual(await closes('BTCUSDT'), [61000, 61100])
  advance(60_000)
  assert.deepEqual(await closes('BTCUSDT'), [61000, 61100, 61200])
})

test('the menu closes one position or all of them, each as a card to confirm', async () => {
  const eth: Position = { ...btc(), symbol: 'ETHUSDT', side: 'Sell', size: 1, entryPrice: 3100, markPrice: 3080, liqPrice: 3600, unrealisedPnl: 20, positionIM: 310 }
  const { ex, store, s, ticks } = setup([btc(), eth], [])
  ex.prices.ETHUSDT = 3080
  store.seed([CLOSE_SEED], 'seeded:close')
  await ticks()
  assert.deepEqual(await s.command('close', { symbol: 'ETHUSDT', positionIdx: 0 }), { ok: true, message: 'Heard "close position" · 1 proposal' })
  assert.deepEqual(store.pendingProposals().map(p => p.question), ['Close 100% · 1 ETH?'])
  assert.deepEqual(await s.command('close'), { ok: true, message: 'Heard "close all" · 2 proposals' }) // ETH's card already up
  assert.deepEqual(store.pendingProposals().map(p => p.question).sort(), ['Close 100% · 0.05 BTC?', 'Close 100% · 1 ETH?'])
  assert.equal((await s.command('close', { symbol: 'SOLUSDT', positionIdx: 0 })).ok, false)
  assert.equal(ex.calls.length, 0)
})
