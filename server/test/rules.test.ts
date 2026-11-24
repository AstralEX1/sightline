import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluate, matchShortcut, voiceCards, DEFAULT_CONFIG } from '../src/rules.ts'
import type { Config, Position, Shortcut, Snapshot } from '../src/types.ts'

const NOW = 1_800_000_000_000

function pos(o: Partial<Position> = {}): Position {
  return {
    symbol: 'BTCUSDT', side: 'Buy', size: 0.05, entryPrice: 62000, markPrice: 61000,
    liqPrice: 59500, unrealisedPnl: -50, stopLoss: 61000, isolated: true, positionIdx: 0,
    openedAt: NOW - 3_600_000, ...o,
  }
}

function snap(positions: Position[], o: Partial<Snapshot> = {}): Snapshot {
  return { positions, dayPnl: 0, prices: {}, now: NOW, ...o }
}

const cfg = (o: Partial<Config> = {}): Config => ({ ...DEFAULT_CONFIG, ...o })

test('liq card for isolated long', () => {
  const r = evaluate(snap([pos()]), cfg(), new Set())
  assert.equal(r.cards.length, 1)
  assert.equal(r.cards[0].key, 'liq:BTCUSDT')
  assert.deepEqual(r.cards[0].action, { type: 'addMargin', symbol: 'BTCUSDT', positionIdx: 0, usd: 100 })
  assert.equal(r.cards[0].title, 'BTC long · 2.5% from liquidation')
  assert.equal(r.cards[0].question, 'Add $100 margin to BTC?')
  assert.equal(r.cards[0].expiresAt, NOW + 60_000)
})

test('liq card for cross uses transfer', () => {
  const r = evaluate(snap([pos({ isolated: false })]), cfg(), new Set())
  assert.deepEqual(r.cards[0].action, { type: 'transfer', usd: 100 })
  assert.equal(r.cards[0].question, 'Move $100 Funding → Trading?')
})

test('no duplicate while fired', () => {
  const first = evaluate(snap([pos()]), cfg(), new Set())
  const second = evaluate(snap([pos()]), cfg(), first.fired)
  assert.equal(second.cards.length, 0)
})

test('re-arms after condition clears', () => {
  const a = evaluate(snap([pos()]), cfg(), new Set())
  const b = evaluate(snap([pos({ markPrice: 62000 })]), cfg(), a.fired)
  assert.equal(b.cards.length, 0)
  assert.equal(b.fired.has('liq:BTCUSDT'), false)
  const c = evaluate(snap([pos()]), cfg(), b.fired)
  assert.equal(c.cards.length, 1)
})

test('a fired liq key re-arms only after clearing the band', () => {
  const at = (markPrice: number, fired: Set<string>) => evaluate(snap([pos({ markPrice })]), cfg(), fired)
  const a = at(61000, new Set()) // 2.5% from liq, under the 3% line
  assert.equal(a.cards.length, 1)
  const b = at(61400, a.fired) // 3.1%: past the line, inside the band
  assert.equal(b.fired.has('liq:BTCUSDT'), true)
  assert.equal(at(61000, b.fired).cards.length, 0)
  const c = at(62000, b.fired) // 4.0%: clears the band
  assert.equal(c.fired.has('liq:BTCUSDT'), false)
  assert.equal(at(61000, c.fired).cards.length, 1)
})

test('a fired alert and profit lock hold inside the band', () => {
  const alerts = [{ id: 'a1', symbol: 'BTCUSDT', when: 'above' as const, price: 60000, orderUsd: 200, side: 'Buy' as const }]
  const alert = (px: number, fired: Set<string>) => evaluate(snap([], { prices: { BTCUSDT: px } }), cfg({ alerts }), fired)
  const a = alert(60010, new Set())
  assert.equal(alert(59800, a.fired).fired.has('alert:a1'), true) // band is 0.5% of 60,000 = 300
  assert.equal(alert(59600, a.fired).fired.has('alert:a1'), false)

  const lock = (markPrice: number, fired: Set<string>) =>
    evaluate(snap([pos({ symbol: 'SOLUSDT', entryPrice: 100, markPrice, liqPrice: 0, stopLoss: 95 })]), cfg(), fired)
  const l = lock(103, new Set()) // +3%, the lock line
  assert.equal(l.cards.length, 1)
  assert.equal(lock(102.6, l.fired).fired.has('lock:SOLUSDT'), true)
  assert.equal(lock(102.4, l.fired).fired.has('lock:SOLUSDT'), false)
})

test('no stop after grace', () => {
  const short = pos({ symbol: 'ETHUSDT', side: 'Sell', entryPrice: 3100, markPrice: 3090, liqPrice: 0, stopLoss: 0, openedAt: NOW - 61_000 })
  const r = evaluate(snap([short]), cfg(), new Set())
  assert.equal(r.cards.length, 1)
  assert.equal(r.cards[0].key, 'nostop:ETHUSDT')
  assert.deepEqual(r.cards[0].action, { type: 'setStop', symbol: 'ETHUSDT', positionIdx: 0, price: 3162 })
})

test('no stop on a long already below -2% puts the stop under the mark', () => {
  const p = pos({ entryPrice: 62000, markPrice: 60240, liqPrice: 0, stopLoss: 0, openedAt: NOW - 61_000 })
  const r = evaluate(snap([p]), cfg(), new Set())
  const a = r.cards[0].action
  assert.equal(a.type, 'setStop')
  assert.ok(a.type === 'setStop' && a.price < 60240, `stop ${JSON.stringify(a)} must be below the mark`)
  assert.equal(a.type === 'setStop' && a.price, 59035.2)
})

test('no stop on a short already above +2% puts the stop over the mark', () => {
  const p = pos({ side: 'Sell', entryPrice: 3100, markPrice: 3200, liqPrice: 0, stopLoss: 0, openedAt: NOW - 61_000 })
  const a = evaluate(snap([p]), cfg(), new Set()).cards[0].action
  assert.equal(a.type === 'setStop' && a.price, 3264)
})

test('a stop never lands past liquidation: halfway between mark and liq instead', () => {
  // 2% would be 58,800 under a liq of 59,500, and 3,162 over a liq of 3,150: neither would ever fire
  const long = pos({ entryPrice: 62000, markPrice: 60000, liqPrice: 59500, stopLoss: 0, openedAt: NOW - 61_000 })
  const short = pos({ symbol: 'ETHUSDT', side: 'Sell', entryPrice: 3100, markPrice: 3100, liqPrice: 3150, stopLoss: 0, openedAt: NOW - 61_000 })
  const stops = evaluate(snap([long, short]), cfg(), new Set()).cards.filter(c => c.key.startsWith('nostop:')).map(c => c.action)
  assert.deepEqual(stops.map(a => a.type === 'setStop' && a.price), [59750, 3125])
  const voice = voiceCards('protect all', [long], cfg(), false, NOW).cards[0].action
  assert.equal(voice.type === 'setStop' && voice.price, 59750)
})

test('no stop inside grace', () => {
  const p = pos({ liqPrice: 0, stopLoss: 0, openedAt: NOW - 10_000 })
  assert.equal(evaluate(snap([p]), cfg(), new Set()).cards.length, 0)
})

test('lock profit moves stop to entry', () => {
  const sol = pos({ symbol: 'SOLUSDT', size: 10, entryPrice: 140, markPrice: 145, liqPrice: 0, stopLoss: 135 })
  const r = evaluate(snap([sol]), cfg(), new Set())
  assert.equal(r.cards.length, 1)
  assert.equal(r.cards[0].key, 'lock:SOLUSDT')
  assert.deepEqual(r.cards[0].action, { type: 'setStop', symbol: 'SOLUSDT', positionIdx: 0, price: 140 })
})

test('lock profit skipped when stop already above entry', () => {
  const sol = pos({ symbol: 'SOLUSDT', size: 10, entryPrice: 140, markPrice: 145, liqPrice: 0, stopLoss: 141 })
  assert.equal(evaluate(snap([sol]), cfg(), new Set()).cards.length, 0)
})

test('profit without stop offers only the entry stop', () => {
  const sol = pos({ symbol: 'SOLUSDT', size: 10, entryPrice: 140, markPrice: 145, liqPrice: 0, stopLoss: 0, openedAt: NOW - 61_000 })
  const r = evaluate(snap([sol]), cfg(), new Set())
  assert.deepEqual(r.cards.map(c => c.key), ['lock:SOLUSDT'])
})

test('alert with order', () => {
  const alerts = [{ id: 'a1', symbol: 'BTCUSDT', when: 'above' as const, price: 60000, orderUsd: 200, side: 'Buy' as const }]
  const r = evaluate(snap([], { prices: { BTCUSDT: 60010 } }), cfg({ alerts }), new Set())
  assert.equal(r.cards.length, 1)
  assert.equal(r.cards[0].key, 'alert:a1')
  assert.deepEqual(r.cards[0].action, { type: 'order', symbol: 'BTCUSDT', side: 'Buy', usd: 200 })
})

test('alert without order is a toast', () => {
  const alerts = [{ id: 'a2', symbol: 'ETHUSDT', when: 'below' as const, price: 3000 }]
  const r = evaluate(snap([], { prices: { ETHUSDT: 2990 } }), cfg({ alerts }), new Set())
  assert.equal(r.cards.length, 0)
  assert.equal(r.toasts.length, 1)
  assert.match(r.toasts[0], /ETH below 3,000/)
})

test('locked blocks exposure but keeps stops', () => {
  const noStop = pos({ symbol: 'ETHUSDT', side: 'Sell', entryPrice: 3100, markPrice: 3090, liqPrice: 0, stopLoss: 0, openedAt: NOW - 61_000 })
  const r = evaluate(snap([pos(), noStop], { dayPnl: -200 }), cfg(), new Set())
  assert.equal(r.locked, true)
  assert.deepEqual(r.cards.map(c => c.action.type), ['setStop'])
})

test('locked turns a liquidation card into a warning, shown once', () => {
  const near = pos({ markPrice: 60100, stopLoss: 0, openedAt: NOW - 10_000 })
  const locked = snap([near], { dayPnl: -250 })
  const r = evaluate(locked, cfg(), new Set())
  assert.equal(r.cards.length, 0)
  assert.deepEqual(r.toasts, ['BTC long · 1.0% from liquidation. Locked: stops only'])
  assert.equal(evaluate(locked, cfg(), r.fired).toasts.length, 0)
  // the card was already on screen when the lock tripped: the warning still shows
  assert.equal(evaluate(locked, cfg(), new Set(['liq:BTCUSDT'])).toasts.length, 1)
})

test('cap blocks big action', () => {
  const r = evaluate(snap([pos()]), cfg({ marginTopUpUsd: 600 }), new Set())
  assert.equal(r.cards.length, 0)
  assert.equal(r.toasts.length, 1)
  assert.match(r.toasts[0], /\$600/)
})

const sc = (o: Partial<Shortcut> = {}): Shortcut => ({ phrase: 'buy eth', command: 'buy', symbol: 'ETHUSDT', usd: 100, ...o })
const protect = sc({ phrase: 'protect all', command: 'stop', symbol: 'ALL', usd: undefined })
const lockAll = sc({ phrase: 'lock all', command: 'lock', symbol: 'ALL', usd: undefined })

test('matchShortcut takes the longest whole-word phrase', () => {
  const list = [sc(), sc({ phrase: 'buy eth big', usd: 400 }), sc({ phrase: 'lock', command: 'lock', symbol: 'ALL' })]
  assert.equal(matchShortcut('Buy ETH big, please.', list)?.usd, 400)
  assert.equal(matchShortcut('ok buy eth', list)?.usd, 100)
  assert.equal(matchShortcut('unlock', list), null)
})

test('voice buy is an order card', () => {
  const r = voiceCards('Buy ETH.', [], cfg({ shortcuts: [sc()] }), false, NOW)
  assert.deepEqual(r.cards.map(c => c.action), [{ type: 'order', symbol: 'ETHUSDT', side: 'Buy', usd: 100 }])
  assert.equal(r.cards[0].question, 'Buy $100 ETH at market?')
  assert.equal(r.message, 'Voice: buy eth')
})

test('voice orders respect the lock and the cap', () => {
  assert.match(voiceCards('buy eth', [], cfg({ shortcuts: [sc({ usd: 900 })] }), false, NOW).message, /over your \$500 cap/)
  assert.equal(voiceCards('buy eth', [], cfg({ shortcuts: [sc()] }), true, NOW).message, 'Locked: daily loss limit')
})

test('voice stop never loosens a stop, voice lock needs profit', () => {
  const naked = pos({ symbol: 'ETHUSDT', side: 'Sell', entryPrice: 3100, markPrice: 3100, stopLoss: 0 })
  const tight = pos() // long, stop 61000 is already tighter than 2% below
  const winner = pos({ symbol: 'SOLUSDT', entryPrice: 140, markPrice: 150, liqPrice: 0, stopLoss: 0 })
  const shortcuts = [protect, lockAll]
  const stops = voiceCards('protect all', [naked, tight, winner], cfg({ shortcuts }), true, NOW) // stops work while locked
  assert.deepEqual(stops.cards.map(c => c.action), [
    { type: 'setStop', symbol: 'ETHUSDT', positionIdx: 0, price: 3162 },
    { type: 'setStop', symbol: 'SOLUSDT', positionIdx: 0, price: 137.2 },
  ])
  const locks = voiceCards('lock all', [naked, tight, winner], cfg({ shortcuts }), false, NOW)
  assert.deepEqual(locks.cards.map(c => c.action), [{ type: 'setStop', symbol: 'SOLUSDT', positionIdx: 0, price: 140 }])
  assert.match(locks.cards[0].question, /^Move SOL stop to entry/)
})

test('voice says why nothing happened', () => {
  const c = cfg({ shortcuts: [sc(), lockAll] })
  assert.equal(voiceCards(' ... ', [], c, false, NOW).message, 'Heard nothing')
  assert.equal(voiceCards('sell everything', [], c, false, NOW).message, 'No shortcut for "sell everything"')
  assert.equal(voiceCards('lock all', [pos()], c, false, NOW).message, 'Voice: lock all · nothing to change')
})

test('default shortcuts work out of the box and never trade', () => {
  assert.ok(DEFAULT_CONFIG.shortcuts.length > 0)
  assert.ok(DEFAULT_CONFIG.shortcuts.every(s => s.command === 'stop' || s.command === 'lock'))
  const naked = pos({ liqPrice: 0, stopLoss: 0 })
  const winner = pos({ symbol: 'SOLUSDT', entryPrice: 140, markPrice: 145, liqPrice: 0, stopLoss: 135 })
  assert.deepEqual(voiceCards('Protect all.', [naked, winner], DEFAULT_CONFIG, false, NOW).cards.map(c => c.action.type), ['setStop', 'setStop'])
  assert.deepEqual(voiceCards('lock profits', [naked, winner], DEFAULT_CONFIG, false, NOW).cards.map(c => c.key), ['voice:lock:SOLUSDT'])
})

test('a stop card says what the position is worth if the stop fills', () => {
  const short = pos({ symbol: 'ETHUSDT', side: 'Sell', entryPrice: 3100, markPrice: 3090, liqPrice: 0, stopLoss: 0, openedAt: NOW - 61_000 })
  assert.equal(evaluate(snap([short]), cfg(), new Set()).cards[0].detail, 'Entry 3,100 · if stopped: -$3.10') // (3162 - 3100) × 0.05, short
  const sol = pos({ symbol: 'SOLUSDT', size: 10, entryPrice: 140, markPrice: 145, liqPrice: 0, stopLoss: 135 })
  assert.match(evaluate(snap([sol]), cfg(), new Set()).cards[0].detail, /· if stopped: \+\$0\.00$/) // a stop at entry: nothing lost
  const voice = voiceCards('protect all', [short], cfg({ shortcuts: [protect] }), false, NOW).cards[0]
  assert.equal(voice.detail, 'ETH short · if stopped: -$3.10')
})
