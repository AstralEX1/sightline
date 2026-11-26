import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keepExpired, screen, tipsShown, lensWhy, previewText, alignRight, fit, iconOf, pnlText, sizeText, INNER_PX, type Outcome, type Screen, type View } from '../src/view.ts'
import { getTextWidth } from '@evenrealities/pretext'
import type { Execution, ExecutionStatus, Position, Proposal, ServerState, Terms } from '../../server/src/types.ts'
import type { ConditionType } from '../../server/src/registry.ts'

function pos(o: Partial<Position> = {}): Position {
  return {
    symbol: 'BTCUSDT', side: 'Buy', size: 0.05, entryPrice: 62000, markPrice: 61240, liqPrice: 57623, unrealisedPnl: -13,
    stopLoss: 59600, takeProfit: 0, positionIM: 310, leverage: 10, isolated: true, positionIdx: 0, openedAt: 0, ...o,
  }
}

const CLOSE: Terms = { type: 'order', symbol: 'BTCUSDT', side: 'Sell', qty: '0.025', positionIdx: 0, reduceOnly: true, orderLinkId: 'l1' }
const OPEN: Terms = {
  type: 'order', symbol: 'BTCUSDT', side: 'Buy', qty: '0.0055', positionIdx: 0, reduceOnly: false, orderLinkId: 'l2',
  stopLoss: 88200, notionalUsdt: 500, leverage: 5, marginUsdt: 100,
}
const INCREASE: Terms = { type: 'order', symbol: 'ETHUSDT', side: 'Buy', qty: '0.06', positionIdx: 0, reduceOnly: false, orderLinkId: 'l3', notionalUsdt: 200, leverage: 10, marginUsdt: 20 }

function card(o: Partial<Proposal> = {}): Proposal {
  return {
    id: 'p1', key: 'liq:s1:pos:BTCUSDT:0:e1', title: 'BTC long · liquidation distance 3.2%', detail: 'Close position · market, reduce-only',
    question: 'Close 50% · 0.025 BTC?', createdAt: 0, expiresAt: 30_000, who: 'BTC long', why: 'liquidation distance 3.2%',
    reasonType: 'NEAR_LIQUIDATION', alertId: 'a1', shortcutId: 's1', version: 1, targetKey: 'pos:BTCUSDT:0:e1', terms: CLOSE,
    simulated: false, priority: 'CRITICAL', status: 'PENDING', ...o,
  }
}

function st(o: Partial<ServerState> = {}): ServerState {
  return { positions: [pos()], balance: null, card: null, pending: 0, toast: null, error: null, updatedAt: 1, source: 'Demo data', ...o } as ServerState
}

const exec = (status: ExecutionStatus, o: Partial<Execution> = {}): Execution =>
  ({ id: 'e1', proposalId: 'p1', idempotencyKey: 'lens:p1', terms: CLOSE, status, message: '', filledQty: 0, avgPrice: 0, createdAt: 0, updatedAt: 0, ...o })

/** Strip Main's `>` / indent so assertions read the position, not the focus mark. */
const bare = (s: string) => s.replace(/^(▶ | {5}|> | {3})/, '').trim()
/** "BTC long      0.05" → the name, then the size. A pager row has no side word, so it stays one cell. */
const nameAndSize = (s: string): [string, string] => {
  const m = bare(s).match(/^(.* (?:long|short))(?:\s+(\S+))?$/)
  return m ? [m[1], m[2] ?? ''] : [bare(s), '']
}
/** The table as the eye reads it: one line per row, empty cells left out. The selected name sits in `cur`. */
const rows = (sc: Screen) => {
  const cols = ['name', 'price', 'loss', 'gain', 'flag'].map(b => sc.text[b].split('\n'))
  const cur = (sc.text.cur ?? '').split('\n')
  cols[0] = Array.from({ length: Math.max(cols[0].length, cur.length) }, (_, i) => cur[i] || cols[0][i] || '')
  return cols[0].map((_, i) => {
    const [nm, sz] = nameAndSize(cols[0][i] ?? '')
    const rest = cols.slice(1).map(c => (c[i] ?? '').trim())
    return [nm, sz, ...rest].filter(Boolean)
  })
}
const lines = (sc: Screen) => Object.entries(sc.text).flatMap(([box, t]) => t.split('\n').map(l => [box, l] as const))
const alertOf = (c: Partial<Proposal> = {}, s: Partial<ServerState> = {}, v: View = {}) => screen(st({ card: card(c), pending: 1, ...s }), v)
const result = (o: Partial<Outcome>, c: Partial<Proposal> = {}) => screen(st({ card: card({ id: 'next' }), pending: 1 }), { outcome: { card: card(c), ...o } })

// ── Main ───────────────────────────────────────────────────

test('quiet mode shows only the nearest risk and hides stale numbers', () => {
  const eth = pos({ symbol: 'ETHUSDT', markPrice: 3000, liqPrice: 2940 })
  const state = st({ positions: [pos(), eth] })
  const sc = screen(state, { quiet: true })
  assert.equal(sc.layout, 'quiet')
  assert.match(previewText(sc), /Monitoring · Bybit Demo[\s\S]*ETH long · 2\.0% to liq/)
  assert.equal(screen(state, { quiet: true, positionsOpen: true }).layout, 'main')
  assert.equal(screen(st({ card: card() }), { quiet: true }).layout, 'alert')
  assert.match(previewText(screen({ ...state, toast: 'BTC price reached' }, { quiet: true })), /BTC price reached/)
  const stale = previewText(screen({ ...state, error: 'timeout' }, { quiet: true }))
  assert.match(stale, /Bybit data stale since/)
  assert.doesNotMatch(stale, /ETH long|Monitoring/)
})

test('connection check has its own OK and never displaces an actionable alert', () => {
  const glassesTestId = 'connection-1'
  const sc = screen(st({ glassesTestId }))
  assert.match(previewText(sc), /Connection check\s+TEST/)
  assert.deepEqual(sc.choices, ['ack-glasses-test'])
  assert.equal(sc.card, null)
  assert.equal(screen(st({ glassesTestId, card: card() })).card?.id, 'p1')
  assert.equal(screen(st({ glassesTestId }), { offline: true }).layout, 'main')
})

test('main: header-less rows of position, size, price, ROI and a flag only near liquidation', () => {
  assert.deepEqual(rows(screen(st())), [['BTC long', '0.05', '61,240', '▼ 4.2%', 'liq 5.9%']])
  const calm = pos({ symbol: 'ETHUSDT', side: 'Sell', markPrice: 3198.4, liqPrice: 4000, unrealisedPnl: 89.28, positionIM: 372, size: 1.25 })
  assert.deepEqual(rows(screen(st({ positions: [calm] }))), [['ETH short', '1.25', '3,198', '▲ 24.0%']])
  assert.deepEqual(rows(screen(st({ positions: [pos({ symbol: 'SOLUSDT', markPrice: 182.65, liqPrice: 120, stopLoss: 0, unrealisedPnl: 4.3, positionIM: 140, size: 12.5 })] }))),
    [['SOL long', '12.5', '182.65', '▲ 3.1%']]) // a missing stop is not trouble
  assert.equal(rows(screen(st({ positions: [pos({ size: 81_300_000, symbol: '1000PEPEUSDT', side: 'Sell' })] })))[0][1], '81.3M')
  assert.equal(rows(screen(st({ positions: [pos({ size: 0.00001234 })] })))[0][1], '0.000012')
  assert.equal(sizeText(0, 84), '')
  const two = screen(st({ positions: [pos(), pos({ symbol: 'ETHUSDT', side: 'Sell', size: 12.5, liqPrice: 9000 })] }))
  const ends = [two.text.cur.split('\n')[0], two.text.name.split('\n')[1]].map(l => getTextWidth(l))
  assert.ok(Math.abs(ends[0] - ends[1]) < getTextWidth(' '), `sizes share a right edge (${ends.join(', ')})`)
})

test('main: a loss sits in the bright box, a gain in the quieter one', () => {
  const sc = screen(st({ positions: [pos(), pos({ symbol: 'ETHUSDT', unrealisedPnl: 50 })] }))
  assert.deepEqual(sc.text.loss.split('\n').map(l => l.trim()), ['▼ 4.2%'])
  assert.deepEqual(sc.text.gain.split('\n').map(l => l.trim()), ['', '▲ 16.1%'])
  assert.equal(sc.tone.loss, 4)
  assert.equal(sc.tone.gain, 2) // a loss is news, a gain steps back
  assert.equal(sc.tone.flag, 4)
})

test('main: no ROI without initial margin; a position without a stop still flags only liquidation', () => {
  assert.deepEqual(rows(screen(st({ positions: [pos({ positionIM: 0, stopLoss: 0 })] }))), [['BTC long', '0.05', '61,240', 'liq 5.9%']])
})

test('main: prices and ROI are left-aligned, flags right-aligned within a space', () => {
  const sc = screen(st({ positions: [pos(), pos({ symbol: 'SOLUSDT', markPrice: 1.2345, liqPrice: 1.2, unrealisedPnl: 1 })] }))
  for (const box of ['price', 'loss', 'gain'] as const) for (const l of sc.text[box].split('\n')) assert.ok(!l.startsWith(' '), `${box} ${l}`)
  for (const box of ['flag'] as const) {
    for (const l of sc.text[box].split('\n')) assert.ok(INNER_PX[box] - getTextWidth(l) < getTextWidth(' '), `${box} ${l}`)
  }
  assert.equal(alignRight('x'.repeat(80), 50).trimStart().endsWith('…'), true)
})

test('main: closest to liquidation first', () => {
  const far = pos({ symbol: 'SOLUSDT', liqPrice: 30000 })
  const none = pos({ symbol: 'ETHUSDT', liqPrice: 0 })
  const near = pos({ symbol: 'BTCUSDT', liqPrice: 59000 })
  assert.deepEqual(rows(screen(st({ positions: [none, far, near] }))).map(r => r[0]), ['BTC long', 'SOL long', 'ETH long'])
})

test('main: more than five, pages of four; focus picks the page and wraps', () => {
  const many = st({ positions: Array.from({ length: 7 }, (_, i) => pos({ symbol: `C${i}USDT` })) })
  const at = (n: number) => rows(screen(many, { focus: n })).map(r => r[0])
  assert.deepEqual(at(0), ['C0 long', 'C1 long', 'C2 long', 'C3 long', '▼ 1–4 of 7'])
  assert.deepEqual(at(4), ['C4 long', 'C5 long', 'C6 long', '▼ 5–7 of 7'])
  assert.deepEqual(at(7), at(0))
  assert.deepEqual(at(-1), at(6))
})

test('main: ▶ marks the focused row, drawn brighter in its own box; a swipe moves it', () => {
  const two = st({ positions: [pos(), pos({ symbol: 'ETHUSDT', liqPrice: 4000, unrealisedPnl: 10 })] })
  const sc = screen(two)
  assert.match(sc.text.cur.split('\n')[0], /^▶ BTC/)
  assert.equal(sc.text.name.split('\n')[0], '')
  assert.match(sc.text.name.split('\n')[1], /^ {5}ETH/)
  assert.equal(sc.tone.cur, 4)
  assert.equal(sc.tone.name, 3)
  const moved = screen(two, { focus: 1 })
  assert.match(moved.text.name.split('\n')[0], /^ {5}BTC/)
  assert.match(moved.text.cur.split('\n')[1], /^▶ ETH/)
})

test('main: the top line names the account and the count, the time sits at its right edge', () => {
  assert.equal(screen(st()).text.top, 'Bybit Demo · 1 position')
  assert.equal(screen(st({ positions: [pos(), pos({ symbol: 'ETHUSDT' })] })).text.top, 'Bybit Demo · 2 positions')
  const top = screen(st(), { now: new Date(2026, 10, 24, 14, 5).getTime() }).text.top
  assert.match(top, /^Bybit Demo · 1 position +14:05$/)
  assert.ok(getTextWidth(top) <= INNER_PX.top && INNER_PX.top - getTextWidth(top) < getTextWidth(' '), `${getTextWidth(top)} px`)
  assert.equal(screen(st()).tone.top, 3)
})

test('main: no positions, an empty table', () => {
  const sc = screen(st({ positions: [] }))
  assert.equal(sc.text.top, 'Bybit Demo · no open positions')
  assert.deepEqual([sc.text.name, sc.text.price, sc.text.loss, sc.text.gain, sc.text.flag], ['', '', '', '', ''])
})

test('main: stale exchange data, the top line says since when and the table steps back', () => {
  const at = new Date(2026, 10, 24, 14, 2).getTime()
  const sc = screen(st({ error: 'No fresh data for 20s', updatedAt: at }))
  assert.equal(sc.text.top, 'Bybit data stale since 14:02 · retrying')
  assert.equal(sc.tone.top, 4)
  for (const box of ['name', 'price', 'loss', 'gain', 'flag']) assert.equal(sc.tone[box], 2, box)
  assert.equal(rows(sc)[0][0], 'BTC long') // the table stays
  assert.equal(screen(st({ error: 'Bybit 10003: invalid key', updatedAt: 0, positions: [] })).text.top, 'Bybit: Bybit 10003: invalid key')
})

test('main: server unreachable, the table is hidden and no alert is drawn', () => {
  const sc = screen(st({ card: card(), pending: 1 }), { offline: true })
  assert.equal(sc.layout, 'main')
  assert.equal(sc.text.top, 'No connection to your server · retrying')
  assert.equal(sc.tone.top, 4)
  assert.deepEqual(rows(sc), [[]])
  assert.equal(screen(null, { offline: true }).text.top, 'No connection to your server · retrying')
})

test('main: a refused token says where to set it, and draws no alert either', () => {
  const sc = screen(st({ card: card(), pending: 1 }), { needToken: true })
  assert.equal(sc.layout, 'main')
  assert.equal(sc.text.top, 'Server token missing · enter it on the phone')
  assert.equal(screen(null).text.top, 'Connecting…')
})

test('main: news in the top line, bright; a voice note wins over it', () => {
  assert.equal(screen(st({ toast: 'Dismissed, nothing sent' })).text.top, 'Dismissed, nothing sent')
  assert.equal(screen(st({ toast: 'x' })).tone.top, 4)
  assert.equal(screen(st({ toast: 'x' }), { voice: '● Listening' }).text.top, '● Listening')
})

test('main: paused, alerts wait and the table stays', () => {
  const sc = screen(st({ card: card(), pending: 2 }), { pausedMin: 14 })
  assert.equal(sc.layout, 'main')
  assert.equal(sc.text.top, 'Cards paused · 14 min left · 2 waiting')
  assert.equal(rows(sc)[0][0], 'BTC long')
})

test('main: optional tips go with the switch, double tap always stays', () => {
  assert.equal(screen(st(), { hints: true }).text.hint, 'tap: details · tap, hold: menu · double tap: exit')
  assert.equal(screen(st()).text.hint, 'tap, hold: menu · double tap: exit')
  assert.equal(screen(st({ positions: [] }), { hints: true }).text.hint, 'tap, hold: menu · double tap: exit')
  const many = st({ positions: Array.from({ length: 7 }, (_, i) => pos({ symbol: `C${i}USDT` })) })
  assert.equal(screen(many, { hints: true }).text.hint, 'tap: details · tap, hold: menu · double tap: exit') // `>` shows the swipe
  assert.equal(screen(null, { hints: true }).text.hint, 'double tap: exit') // connecting: only the way out
  assert.equal(screen(st(), { offline: true, hints: true }).text.hint, 'double tap: exit')
  assert.equal(screen(st(), { hints: true }).tone.hint, 2)
})

test('tips: on for the first launches until the switch is set', () => {
  assert.equal(tipsShown('', 0), true)
  assert.equal(tipsShown('', 2), true)
  assert.equal(tipsShown('', 3), false)
  assert.equal(tipsShown('on', 50), true)
  assert.equal(tipsShown('off', 0), false)
})

test('detail: swipe tip only with tips on; tap close and double tap always', () => {
  const two = st({ positions: [pos(), pos({ symbol: 'ETHUSDT' })] })
  assert.match(screen(two, { detail: true }).text.hint, /^tap: close · double tap: back +1\/2$/)
  assert.match(screen(two, { detail: true, hints: true }).text.hint, /^swipe: next position · tap: close · double tap: back +1\/2$/)
})

test('main: no loss meter and no dollars on the lens', () => {
  const sc = screen(st({ positions: [pos({ unrealisedPnl: -150 })] }), { hints: true })
  for (const [box, l] of lines(sc)) assert.doesNotMatch(l, /[█▒$]|limit/i, `${box}: ${l}`)
})

// ── Detail ─────────────────────────────────────────────────

test('detail: big coin and side, leverage under it, PnL with stop and liq distances, the hour', () => {
  const sc = screen(st({ balance: { equity: 5000, available: 2140 } }), { detail: true })
  assert.equal(sc.layout, 'detail')
  assert.equal(sc.key, 'detail') // one key for every position: a swipe updates the text, never rebuilds
  assert.equal(sc.title, 'BTC long')
  assert.equal(sc.text.lev, '0.05 BTC · 10×')
  assert.equal(sc.pnl, 'PNL: −$13')
  assert.equal(sc.text.table, 'stop −2.7% · liq −5.9%')
  assert.deepEqual(sc.chart, { symbol: 'BTCUSDT', entry: 62000, stop: 59600, tp: 0, liq: 57623 })
  assert.equal(sc.text.hint, 'tap: close · double tap: back')
  assert.equal(sc.icon, '')
})

test('detail: distances under 1% keep two decimals, and zero has no sign', () => {
  assert.equal(screen(st({ positions: [pos({ stopLoss: 61240 * 0.995, liqPrice: 61240 })] }), { detail: true }).text.table, 'stop −0.50% · liq 0%') // both two decimals
})

test('detail: no stop says nothing; place in the queue; swipe hint with several', () => {
  const eth = pos({ symbol: 'ETHUSDT', side: 'Sell', stopLoss: 0, markPrice: 3198, liqPrice: 4000, unrealisedPnl: 89.28, positionIM: 372, leverage: 15 })
  const sc = screen(st({ positions: [pos(), eth] }), { detail: true, focus: 1, hints: true })
  assert.equal(sc.title, 'ETH short')
  assert.equal(sc.text.lev, '0.05 ETH · 15×')
  assert.equal(sc.text.table, 'liq +25.1%')
  assert.match(sc.text.hint, /^swipe: next position · tap: close · double tap: back +2\/2$/)
  assert.equal(sc.pnl, 'PNL: +$89')
})

test('detail: a voice note takes the hint line', () => {
  assert.equal(screen(st(), { detail: true, voice: '● Say close' }).text.hint, '● Say close')
})

test('detail: an alert still wins over an open Detail', () => {
  assert.equal(screen(st({ card: card(), pending: 1 }), { detail: true }).layout, 'alert')
})

test('pnlText: tenths, whole dollars, thousands', () => {
  assert.equal(pnlText(-8.6), 'PNL: −$8.6')
  assert.equal(pnlText(12.49), 'PNL: +$12')
  assert.equal(pnlText(1234.5), 'PNL: +$1,235')
  assert.equal(pnlText(-12_300), 'PNL: −$12.3k')
})

// ── Alert ──────────────────────────────────────────────────

// docs/glasses-shortcuts.md §5: every condition with its action, as the server words them.
const ALERTS: [ConditionType, string, string, string, string][] = [
  ['NEAR_LIQUIDATION', 'liquidation distance 3.2%', 'Close 50% · 0.025 BTC?', 'warn', 'Close 50% · 0.025 BTC'],
  ['LOSS', 'ROI −18.2%', 'Add 100 USDT margin to BTC?', 'trendDown', 'Add 100 USDT margin to BTC'],
  ['NEAR_SL', 'stop loss distance 0.9%', 'Close 100% · 120 XRP?', 'shield', 'Close 100% · 120 XRP'],
  ['PROFIT', 'ROI +31.4%', 'Move ETH stop to entry 3,412?', 'trendUp', 'Move ETH stop to entry 3,412'],
  ['NEAR_TP', 'take profit distance 0.8%', 'Close 50% · 0.6 ETH?', 'target', 'Close 50% · 0.6 ETH'],
  ['PRICE', 'price 90,012', 'Set BTC take profit at 95,000?', 'bell', 'Set BTC take profit at 95,000'],
  ['ORDER_FILLED', 'order filled', 'Set SOL take profit at 191.52?', 'check', 'Set SOL take profit at 191.52'],
  ['ORDER_PARTIAL', 'order partly filled', 'Cancel the rest · 0.015 BTC?', 'half', 'Cancel the rest · 0.015 BTC'],
]

test('alert: every condition wears its icon, names the position and the reason, and the action by its outcome', () => {
  for (const [reasonType, why, question, icon, opt2] of ALERTS) {
    const sc = alertOf({ reasonType, why, question })
    assert.equal(sc.layout, 'alert')
    assert.equal(sc.icon, icon, reasonType)
    assert.equal(sc.text.who, 'BTC long')
    const lens: Partial<Record<ConditionType, string>> = { NEAR_LIQUIDATION: '3.2% to liquidation', NEAR_SL: '0.9% to stop', NEAR_TP: '0.8% to take profit' }
    assert.equal(sc.text.why, lens[reasonType] ?? why.charAt(0).toUpperCase() + why.slice(1))
    assert.equal(sc.text.opt1, '> Dismiss')
    assert.equal(sc.text.opt2, `   ${opt2}`)
    assert.deepEqual(sc.choices, ['dismiss', 'confirm'])
    assert.equal(sc.text.hint, 'swipe: choose · tap: dismiss') // the hint says what a tap does on the choice under `>`
    assert.equal(alertOf({ reasonType, why, question }, {}, { cursor: { key: sc.key, at: 1 } }).text.hint, 'swipe: choose · tap: confirm')
  }
  assert.equal(lensWhy('closed by stop loss at 59,600'), 'Closed by stop at 59,600')
  assert.equal(alertOf({ simulated: true }).tone.queue, 4) // TEST is a warning, not a counter
  assert.equal(alertOf({}, { pending: 2 }).tone.queue, 2)
  assert.equal(iconOf(card({ reasonType: undefined, voice: true, why: 'Voice: protect all' })), 'mic')
  assert.equal(iconOf(card({ reasonType: undefined, simulated: true, why: 'Test alert' })), 'bell')
})

test('notify: one OK, no second choice, and a tap does not confirm', () => {
  const sc = alertOf({ terms: { type: 'notify' }, question: '', why: 'price crossed above 90,000', reasonType: 'PRICE', who: 'BTC' })
  assert.equal(sc.text.who, 'BTC')
  assert.equal(sc.text.why, 'Price crossed above 90,000')
  assert.equal(sc.text.opt1, '> OK')
  assert.equal(sc.text.opt2, '')
  assert.deepEqual(sc.choices, ['ok'])
  assert.equal(sc.text.hint, 'tap: OK')
})

test('notify keeps the recorded reason when exchange data becomes stale', () => {
  const sc = alertOf({
    terms: { type: 'notify' }, question: '', why: 'price crossed above 90,000', reasonType: 'PRICE', who: 'BTC',
  }, { error: 'No fresh market data' })
  assert.equal(sc.text.why, 'Price crossed above 90,000')
  assert.deepEqual(sc.choices, ['ok'])
})

test('alert: Dismiss comes first and carries >, a swipe moves it and swaps the brightness', () => {
  const sc = alertOf()
  assert.equal(sc.at, 0)
  assert.deepEqual([sc.tone.opt1, sc.tone.opt2], [4, 3])
  const moved = alertOf({}, {}, { cursor: { key: sc.key, at: 1 } })
  assert.deepEqual([moved.text.opt1, moved.text.opt2], ['   Dismiss', '> Close 50% · 0.025 BTC'])
  assert.deepEqual([moved.tone.opt1, moved.tone.opt2], [3, 4])
  assert.equal(getTextWidth('> '), getTextWidth('   ')) // the labels line up
  // A new alert (or a refreshed one, with a new id) starts on Dismiss again.
  assert.equal(alertOf({ id: 'p2', supersedes: 'p1' }, {}, { cursor: { key: sc.key, at: 1 } }).at, 0)
})

test('alert: its place in the queue, NEW when refreshed, TEST for a test', () => {
  assert.equal(alertOf({}, { pending: 3 }).text.queue.trim(), '1/3')
  assert.equal(alertOf().text.queue, '')
  assert.equal(alertOf({ id: 'p2', supersedes: 'p1', question: 'Close 50% · 0.03 BTC?' }, { pending: 2 }).text.queue.trim(), 'NEW')
  assert.equal(alertOf({ id: 'p2', supersedes: 'p1', question: 'Close 50% · 0.03 BTC?' }).text.opt2, '   Close 50% · 0.03 BTC')
  assert.equal(alertOf({ simulated: true, reasonType: undefined, why: 'Test alert' }, { pending: 2 }).text.queue.trim(), 'TEST')
  assert.equal(alertOf({}, { pending: 2 }).tone.queue, 2)
})

test('alert: no countdown, the lens is the same at any point of its life', () => {
  const early = alertOf({}, { updatedAt: 1 })
  const late = alertOf({}, { updatedAt: 29_000 })
  assert.deepEqual(late.text, early.text)
  for (const [box, l] of lines(late)) assert.doesNotMatch(l, /[━─]|\d+ ?s\b/, `${box}: ${l}`)
})

test('alert: stale exchange data, only Dismiss', () => {
  const sc = alertOf({}, { error: 'No fresh data for 20s' })
  assert.equal(sc.icon, 'hourglass')
  assert.equal(sc.text.why, 'Bybit data is stale')
  assert.deepEqual(sc.choices, ['dismiss'])
  assert.equal(sc.text.opt2, '')
  assert.equal(sc.text.hint, 'tap: dismiss')
})

test('alert: a card being dismissed leaves the lens at once', () => {
  assert.equal(alertOf({}, {}, { hide: 'p1' }).layout, 'main')
})

test('alert: Open and Increase add exposure, so their action opens Review', () => {
  const open = alertOf({ who: 'BTC', why: 'price 90,012', reasonType: 'PRICE', terms: OPEN, question: 'Open long 0.0055 BTC · 500 USDT?' }, { positions: [] })
  assert.equal(open.text.opt2, '   Review long · 500 USDT')
  assert.deepEqual(open.choices, ['dismiss', 'review'])
  const eth = pos({ symbol: 'ETHUSDT', markPrice: 3412, liqPrice: 2000, stopLoss: 3280 })
  const add = alertOf({ who: 'ETH long', why: 'price up 5.1% in 15 min', reasonType: 'PRICE_CHANGE', terms: INCREASE, question: 'Add 0.06 ETH to ETH long?' }, { positions: [eth] })
  assert.equal(add.text.opt2, '   Review add · 200 USDT')
  assert.equal(add.icon, 'pulse')
})

// ── Review ─────────────────────────────────────────────────

test('review: Open shows qty, notional, leverage, margin and stop, Dismiss first', () => {
  const sc = alertOf({ id: 'o1', who: 'BTC', terms: OPEN }, { positions: [] }, { review: 'o1' })
  assert.equal(sc.layout, 'review')
  assert.equal(sc.key, 'review:o1')
  assert.equal(sc.icon, 'grow')
  assert.equal(sc.text.ask, 'Open BTC long?')
  assert.deepEqual(sc.text.terms.split('\n'), ['0.0055 BTC · 500 USDT · 5×', 'Margin ≈ 100 USDT · stop 88,200'])
  assert.deepEqual([sc.text.opt1, sc.text.opt2], ['> Dismiss', '   Open long · 0.0055 BTC'])
  assert.deepEqual(sc.choices, ['dismiss', 'confirm'])
  assert.equal(sc.text.hint, 'swipe: choose · tap: dismiss · double tap: back')
  assert.equal(alertOf({ id: 'o1', who: 'BTC', terms: OPEN }, { positions: [] }, { review: 'o1', cursor: { key: 'review:o1', at: 1 } }).text.hint, 'swipe: choose · tap: confirm · double tap: back')
  assert.equal(alertOf({ id: 'o1', terms: { ...OPEN, stopLoss: undefined } }, { positions: [] }, { review: 'o1' }).text.terms.split('\n')[1], 'Margin ≈ 100 USDT')
})

test('Open with picks: the alert names no size, then a size page and a leverage page that scroll two rows at a time', () => {
  const picks = { sizes: [100, 250, 500], leverages: [1, 1.5, 2, 5, 10] }
  const c = { id: 'o2', who: 'BTC', terms: OPEN, picks }
  assert.equal(alertOf(c, { positions: [] }).text.opt2, '   Review long')
  const size = alertOf(c, { positions: [] }, { review: 'o2' })
  assert.equal(size.layout, 'review')
  assert.equal(size.key, 'pick:o2:size')
  assert.equal(size.text.ask, 'Open BTC long · size?')
  assert.equal(size.text.terms, 'Leverage next')
  assert.deepEqual([size.text.opt1, size.text.opt2], ['> 100 USDT', '   250 USDT'])
  assert.deepEqual(size.choices, ['pick', 'pick', 'pick'])
  assert.equal(size.text.hint, 'swipe: choose · tap: pick · double tap: back · 1/3')
  const third = alertOf(c, { positions: [] }, { review: 'o2', cursor: { key: 'pick:o2:size', at: 2 } })
  assert.deepEqual([third.text.opt1, third.text.opt2, third.at], ['   250 USDT', '> 500 USDT', 2])
  const lev = alertOf(c, { positions: [] }, { review: 'o2', pick: { id: 'o2', size: 250 }, cursor: { key: 'pick:o2:leverage', at: 3 } })
  assert.equal(lev.key, 'pick:o2:leverage')
  assert.equal(lev.text.ask, 'Open BTC long · leverage?')
  assert.deepEqual(lev.text.terms.split('\n'), ['Size 250 USDT', 'Margin ≈ 50 USDT'])
  assert.deepEqual([lev.text.opt1, lev.text.opt2], ['   2×', '> 5×'])
  // one size: straight to the leverage page; a pick for another card does not count
  const one = alertOf({ ...c, picks: { sizes: [100], leverages: [2, 5] } }, { positions: [] }, { review: 'o2', pick: { id: 'x', size: 999 } })
  assert.deepEqual([one.key, one.text.terms.split('\n')[0]], ['pick:o2:leverage', 'Size 100 USDT'])
  // without picks Review shows the terms as before
  assert.equal(alertOf({ id: 'o2', terms: OPEN }, { positions: [] }, { review: 'o2' }).key, 'review:o2')
})

test('review: Increase names the position and the stop that stays', () => {
  const eth = pos({ symbol: 'ETHUSDT', markPrice: 3412, liqPrice: 2000, stopLoss: 3280 })
  const sc = alertOf({ id: 'i1', who: 'ETH long', terms: INCREASE }, { positions: [eth] }, { review: 'i1' })
  assert.equal(sc.text.ask, 'Add to ETH long?')
  assert.deepEqual(sc.text.terms.split('\n'), ['0.06 ETH · 200 USDT', 'Stop 3,280 stays'])
  assert.equal(sc.text.opt2, '   Add · 0.06 ETH')
})

test('review: only for Open and Increase, and only for its own card', () => {
  assert.equal(alertOf({}, {}, { review: 'p1' }).layout, 'alert') // a close never has a Review
  assert.equal(alertOf({ id: 'o2', terms: OPEN }, { positions: [] }, { review: 'o1' }).layout, 'alert')
})

// ── Results ────────────────────────────────────────────────

test('result: Sent while the server works, no choice and taps ignored', () => {
  for (const o of [{}, { execution: exec('SUBMITTING') }]) {
    const sc = result(o)
    assert.equal(sc.text.why, 'Sent')
    assert.equal(sc.icon, 'clock')
    assert.deepEqual(sc.choices, [])
    assert.equal(sc.text.opt1, '')
    assert.equal(sc.text.hint, 'waiting for Bybit · double tap: hide')
  }
  assert.equal(result({ execution: exec('ACKNOWLEDGED') }).text.why, 'Sent · waiting for the fill')
})

test('result: the exchange status, then OK', () => {
  const cases: [Partial<Outcome>, string, string][] = [
    [{ execution: exec('FILLED', { filledQty: 0.025, avgPrice: 61180 }) }, 'check', 'Closed 0.025 BTC · avg 61,180'],
    [{ execution: exec('FILLED', { terms: OPEN, filledQty: 0.0055, avgPrice: 90100 }) }, 'check', 'Filled 0.0055 BTC · avg 90,100'],
    [{ execution: exec('PARTIALLY_FILLED', { filledQty: 0.015 }) }, 'half', 'Partly filled · 0.015 of 0.025 BTC'],
    [{ execution: exec('REJECTED', { message: 'below 0.001 BTC' }) }, 'reject', 'Rejected by Bybit'],
    [{ execution: exec('UNKNOWN', { message: 'timed out' }) }, 'question', 'No answer from Bybit yet'],
    [{ execution: exec('APPLIED', { terms: { type: 'setStop', symbol: 'BTCUSDT', positionIdx: 0, price: 59600 } }) }, 'check', 'Stop at 59,600'],
    [{ execution: exec('APPLIED', { terms: { type: 'setTakeProfit', symbol: 'SOLUSDT', positionIdx: 0, price: 191.52 } }) }, 'check', 'Take profit at 191.52'],
    [{ execution: exec('APPLIED', { terms: { type: 'addMargin', symbol: 'BTCUSDT', positionIdx: 0, usd: 100 } }) }, 'check', 'Added 100 USDT margin'],
    [{ execution: exec('APPLIED', { terms: { type: 'cancel', symbol: 'BTCUSDT', orderId: 'o1' } }) }, 'check', 'Order cancelled'],
    [{ execution: exec('SIMULATED') }, 'warn', 'Test only · nothing was sent'],
    [{ message: 'Replaced by a newer proposal, nothing sent' }, 'hourglass', 'Replaced by a newer proposal, nothing sent'],
    [{ lost: true }, 'question', 'No reply from the server · check Bybit'],
  ]
  for (const [o, icon, why] of cases) {
    const sc = result(o)
    const framedLines = sc.layout === 'review' ? [sc.text.ask, sc.text.terms.split('\n')[0]] : [sc.text.who, sc.text.why]
    assert.deepEqual(framedLines, ['BTC long', why])
    assert.equal(sc.icon, icon, why)
    assert.equal(sc.text.opt1, '> OK')
    assert.deepEqual(sc.choices, ['close'])
    assert.equal(sc.text.hint, 'tap: OK')
    assert.equal(sc.card, null) // a tap on a result answers no proposal
  }
  const rejected = result({ execution: exec('REJECTED', { message: 'below 0.001 BTC' }) })
  assert.deepEqual([rejected.layout, rejected.text.terms, rejected.text.opt2], ['review', 'Rejected by Bybit\nbelow 0.001 BTC', '']) // the reason in the frame
})

test('an expired card stays up only while nothing newer is waiting', () => {
  const was = { id: 'old', expiresAt: 1_000 }
  assert.equal(keepExpired(was, null, 1_000, 0, ''), true)
  assert.equal(keepExpired(was, { id: 'new' }, 1_000, 0, ''), false)
  assert.equal(keepExpired(was, null, 1_000, 0, 'old'), false)
  assert.equal(keepExpired(was, null, 999, 0, ''), false)
})

test('result: Expired, nothing sent, and Dismiss is the only choice', () => {
  const sc = result({ expired: true })
  assert.equal(sc.text.why, 'Expired · nothing sent')
  assert.equal(sc.icon, 'hourglass')
  assert.deepEqual([sc.text.opt1, sc.text.opt2], ['> Dismiss', ''])
  assert.deepEqual(sc.choices, ['close'])
  assert.equal(sc.text.hint, 'tap: dismiss')
})

test('result: stays on the same page as its alert, so the lens only updates text; `>` falls back to the one choice', () => {
  const alert = alertOf()
  const sc = screen(st({ card: card(), pending: 1 }), { outcome: { card: card(), execution: exec('FILLED', { filledQty: 0.025, avgPrice: 61180 }) }, cursor: { key: alert.key, at: 1 } })
  assert.equal(sc.key, alert.key)
  assert.equal(sc.at, 0)
})

test('result: the receipt joins the frame once the server has it; under the frame only OK', () => {
  const filled = { filledQty: 0.025, avgPrice: 61180 }
  const sc = result({ execution: exec('FILLED', { ...filled, receipt: '0.05 → 0.025 BTC · liq 2.5% → 4.1%' }) })
  assert.deepEqual([sc.layout, sc.text.ask, sc.text.terms], ['review', 'BTC long', 'Closed 0.025 BTC · avg 61,180\n0.05 → 0.025 BTC · liq 2.5% → 4.1%'])
  assert.deepEqual([sc.text.opt1, sc.text.opt2], ['> OK', ''])
  assert.deepEqual(sc.choices, ['close']) // a line, not a second choice
  assert.equal(sc.key, result({ execution: exec('FILLED', filled) }).key) // same key: the cursor stays on OK
  assert.equal(result({ execution: exec('FILLED', filled) }).layout, 'alert')
  assert.equal(result({ execution: exec('SUBMITTING', { receipt: 'x' }) }).text.opt2, '') // Sent has no row at all
  const long = result({ execution: exec('FILLED', { ...filled, receipt: `123,456,789 → 0 1000PEPE${'X'.repeat(60)} · position closed` }) })
  assert.ok(getTextWidth(long.text.opt2) <= INNER_PX.opt2)
})

test('result: holds the lens over the next alert until OK, and the next alert waits', () => {
  assert.equal(result({ execution: exec('FILLED', { filledQty: 0.025, avgPrice: 61180 }) }).text.why, 'Closed 0.025 BTC · avg 61,180')
  assert.equal(screen(st(), { outcome: { card: card() }, offline: true }).layout, 'main') // offline: nothing to answer
})

// ── Fit ────────────────────────────────────────────────────

test('every line fits its box with long tickers and 6-digit prices', () => {
  const pepe = pos({ symbol: '1000PEPEUSDT', side: 'Sell', markPrice: 0.0123, liqPrice: 0.0125, stopLoss: 0, unrealisedPnl: -9876.5, positionIM: 1 })
  const big = pos({ symbol: 'VERYLONGNAME1000USDT', markPrice: 123456.7, liqPrice: 1, unrealisedPnl: 123456, positionIM: 100 })
  const longCard = card({ who: '1000PEPE short', why: 'liquidation distance 3.2% and a lot more words than fit', question: `Close 100% · 123,456,789 1000PEPE${'X'.repeat(40)}?` })
  const pepeOpen: Terms = { ...OPEN, symbol: '1000PEPEUSDT', qty: '81300000', notionalUsdt: 1_000_000, marginUsdt: 123_456.78, leverage: 100, stopLoss: 0.012345 }
  const now = new Date(2026, 10, 25, 9, 2).getTime()
  const states: [ServerState | null, View][] = [
    [st({ positions: [pepe, big, pos()] }), { hints: true, now }],
    [st({ positions: Array.from({ length: 7 }, () => pepe) }), { hints: true, now }],
    [st({ toast: 'T'.repeat(90) }), { now }],
    [st({ error: 'E'.repeat(90), updatedAt: 0, positions: [] }), {}],
    [st({ card: longCard, pending: 12 }), {}],
    [st({ card: longCard, pending: 2, error: 'x' }), {}],
    [st({ card: card({ id: 'o', who: '1000PEPE', terms: pepeOpen }), positions: [] }), {}],
    [st({ card: card({ id: 'o', who: '1000PEPE', terms: pepeOpen }), positions: [] }), { review: 'o' }],
    [st(), { outcome: { card: longCard, execution: exec('REJECTED', { message: 'R'.repeat(90) }) } }],
    [st(), { outcome: { card: longCard, execution: exec('PARTIALLY_FILLED', { terms: { ...CLOSE, symbol: '1000PEPEUSDT', qty: '123456789' }, filledQty: 12345678 }) } }],
  ]
  for (const [s, v] of states) {
    const sc = screen(s, v)
    for (const [box, l] of lines(sc)) if (box !== 'frame') assert.ok(getTextWidth(l) <= INNER_PX[box], `${box} too wide: ${l} (${getTextWidth(l)} > ${INNER_PX[box]})`)
  }
  // `>` takes a few characters of the name column; the side word is never cut.
  assert.match(rows(screen(st({ positions: [pepe] })))[0][0], /… short$/) // the side stays; the coin gives up the width the size took
  assert.equal(rows(screen(st({ positions: [pepe] })))[0][1], '0.05')
  assert.match(rows(screen(st({ positions: [pos({ symbol: '1000000MOGUSDT', side: 'Sell' })] })))[0][0], /… short$/)
  const wide = screen(st({ positions: [pos({ symbol: '1000PEPEUSDT', side: 'Sell', size: 81_300_000, leverage: 100 })] }), { detail: true })
  assert.equal(wide.text.lev, '81,300,000 1000PEPE · 100×')
  const longer = screen(st({ positions: [pos({ symbol: '1000000MOGUSDT', side: 'Sell', size: 81_300_000, leverage: 100 })] }), { detail: true })
  assert.equal(longer.text.lev, '81,300,000 · 100×') // the coin is already the title; leverage stays
})

test('every string of spec §5 and §6 fits its box', () => {
  const at: [string, string[]][] = [
    ['why', ['Sent · waiting for the fill', 'Closed 0.025 BTC · avg 61,180', 'Partly filled · 0.015 of 0.025 BTC', 'Rejected: below 0.001 BTC',
      'No answer from Bybit yet', 'Expired · nothing sent', 'Bybit data is stale', 'Test only · nothing was sent', '3.2% to liquidation']],
    ['opt2', ['   Close 50% · 0.025 BTC', '   Move ETH stop to entry 3,412', '   Cancel the rest · 0.015 BTC', '   Review long · 500 USDT']],
    ['terms', ['0.0055 BTC · 500 USDT · 5×', 'Margin ≈ 100 USDT · stop 88,200', 'Stop 3,280 stays']],
    ['top', ['Bybit data stale since 14:02 · retrying', 'No connection to your server · retrying', 'Bybit demo · no open positions']],
  ]
  for (const [box, all] of at) for (const s of all) assert.equal(fit(s, INNER_PX[box]), s, `${box}: ${s}`)
})

// ── Phone preview ──────────────────────────────────────────

test('phone preview lists the same lines', () => {
  assert.equal(previewText(screen(st(), { hints: true })), 'Bybit Demo · 1 position\n▶ BTC long               0.05  61,240  ▼ 4.2%  liq 5.9%\n\ntap: details · tap, hold: menu · double tap: exit')
  assert.equal(previewText(alertOf({}, { pending: 2 })), 'BTC long   1/2\n3.2% to liquidation\n\n> Dismiss\n   Close 50% · 0.025 BTC\n\nswipe: choose · tap: dismiss')
  assert.equal(previewText(result({})), 'BTC long\nSent\n\nwaiting for Bybit · double tap: hide')
})
