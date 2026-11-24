import { test } from 'node:test'
import assert from 'node:assert/strict'
import { screen, previewText, lossBar, alignRight, money, price, iconOf, cardClock, type View } from '../src/view.ts'
import { getTextWidth } from '@evenrealities/pretext'
import type { Card, Position, ServerState } from '../../server/src/types.ts'

function pos(o: Partial<Position> = {}): Position {
  return {
    symbol: 'BTCUSDT', side: 'Buy', size: 0.05, entryPrice: 62000, markPrice: 61000, liqPrice: 56000,
    unrealisedPnl: 42.1, stopLoss: 61000, isolated: true, positionIdx: 0, openedAt: 0, ...o,
  }
}

const card: Card = {
  id: 'c1', key: 'liq:BTCUSDT', title: 'BTC long · 2.1% from liquidation', detail: 'Liquidation at 59,500 · PnL -$310.20',
  question: 'Add $100 margin?', action: { type: 'addMargin', symbol: 'BTCUSDT', positionIdx: 0, usd: 100 }, createdAt: 0, expiresAt: 1,
}

function st(o: Partial<ServerState> = {}): ServerState {
  return { positions: [pos()], balance: null, dayPnl: 124.5, dailyLossLimitUsd: 200, locked: false, card: null, pending: 0, toast: null, error: null, updatedAt: 1, ...o }
}

const rows = (s: ServerState) => {
  const cols = screen(s).cols.map(c => c.split('\n'))
  return cols[0].map((_, i) => cols.map(c => c[i].trim())) // the PnL column is padded on the left
}
const footLines = (s: ServerState | null, v: View = {}) => screen(s, v).foot.split('\n')
/** The message line just above the hint, or the last line when there is no hint. */
const message = (s: ServerState | null, v: View = {}) => footLines(s, v).filter(Boolean).at(screen(s, v).items.length || v.hints ? -2 : -1)

test('calm header: just today\'s result while you are up', () => {
  assert.equal(screen(st()).head, 'Today  +$124.50')
})

test('losing: a meter to the daily limit and what is left of it', () => {
  assert.equal(screen(st({ dayPnl: -100 })).head, 'Today  -$100.00   ━━━━━─────   $100 left')
  assert.equal(screen(st({ dayPnl: -100.4 })).head.endsWith('$99 left'), true) // rounded down: never overstate it
})

test('loss bar is full at the limit and never overflows', () => {
  assert.equal(lossBar(-500, 200), '━'.repeat(10))
  assert.equal(lossBar(50, 200), '─'.repeat(10))
  assert.equal(lossBar(-10, 0), '─'.repeat(10))
})

test('position row in four columns', () => {
  assert.deepEqual(rows(st()), [['↗ BTC long', '+$42.10', 'liq 8.2%', 'stop 61,000']])
})

test('PnL is right-aligned in its column, within a space', () => {
  const pnl = screen(st({ positions: [pos(), pos({ symbol: 'ETHUSDT', unrealisedPnl: -1111.11 })] })).cols[1].split('\n')
  for (const l of pnl) assert.ok(Math.abs(getTextWidth(l) - 126) <= getTextWidth(' '), `${l}: ${getTextWidth(l)} px`)
  assert.equal(alignRight('x'.repeat(80), 50).trimStart().endsWith('...'), true)
})

test('losing position without stop or liquidation price', () => {
  const p = pos({ symbol: 'ETHUSDT', side: 'Sell', stopLoss: 0, liqPrice: 0, unrealisedPnl: -18.3 })
  assert.deepEqual(rows(st({ positions: [p] })), [['↘ ETH short', '-$18.30', '', '▲ no stop']])
})

test('closest to liquidation first', () => {
  const far = pos({ symbol: 'SOLUSDT', liqPrice: 30000 })
  const none = pos({ symbol: 'ETHUSDT', liqPrice: 0 })
  const near = pos({ symbol: 'BTCUSDT', liqPrice: 59000 })
  assert.deepEqual(rows(st({ positions: [none, far, near] })).map(r => r[0]), ['↗ BTC long', '↗ SOL long', '↗ ETH long'])
})

test('more than five: pages of four, a swipe turns them, both ends wrap', () => {
  const many = st({ positions: Array.from({ length: 7 }, (_, i) => pos({ symbol: `C${i}USDT` })) })
  const page = (n: number) => screen(many, { page: n }).cols[0].split('\n')
  assert.deepEqual(page(0).slice(0, 4).map(c => c.split(' ')[1]), ['C0', 'C1', 'C2', 'C3'])
  assert.equal(page(0)[4], '1–4 of 7')
  assert.deepEqual(page(1), ['↗ C4 long', '↗ C5 long', '↗ C6 long', '5–7 of 7'])
  assert.deepEqual(page(2), page(0))
  assert.deepEqual(page(-1), page(1))
  assert.equal(footLines(many, { hints: true }).at(-1), 'Swipe for more  ·  Tap to speak  ·  Tap then long press: menu')
})

test('gesture hints teach for a moment, then the calm screen is quiet', () => {
  assert.equal(footLines(st(), { hints: true }).at(-1), 'Tap to speak  ·  Tap then long press: menu')
  assert.deepEqual(footLines(st()), ['', '', ''])
  assert.deepEqual(footLines(null, { hints: true }), ['', '', '']) // nothing to gesture at yet
})

test('a card always says how to answer it', () => {
  assert.equal(footLines(st({ card, pending: 1 })).at(-1), 'Swipe to choose  ·  Tap to confirm')
})

test('a card names the rule that raised it', () => {
  assert.equal(message(st({ card, pending: 1 })), 'Your rule: warn near liquidation')
  assert.equal(message(st({ card: { ...card, key: 'alert:a1' }, pending: 1 })), 'Your price alert')
  assert.equal(message(st({ card: { ...card, key: 'voice:stop:BTCUSDT' }, pending: 1 })), 'You asked for this')
})

test('without a token the lens says where to set it', () => {
  const sc = screen(null, { needToken: true })
  assert.equal(sc.main, 'Open Sightline on your phone\nand enter the server token.')
  assert.equal(message(null, { needToken: true }), 'Server token missing or wrong')
})

test('empty', () => {
  const sc = screen(st({ positions: [] }))
  assert.equal(sc.main, 'No open positions')
  assert.deepEqual(sc.cols, ['', '', '', ''])
})

test('card replaces the table: the safe choice first, the action named by its outcome', () => {
  const sc = screen(st({ card, pending: 1 }))
  assert.equal(sc.head, 'BTC long · 2.1% from liquidation')
  assert.equal(sc.main.split('\n')[0], 'Liquidation at 59,500 · PnL -$310.20')
  assert.equal(sc.icon, 'warn')
  assert.deepEqual(sc.items, ['Not now', 'Add $100 margin'])
  assert.deepEqual(sc.cols, ['', '', '', ''])
})

test('no list on the session screen', () => {
  assert.deepEqual(screen(st()).items, [])
})

test('paused cards: the table stays, the foot says how long and how many wait', () => {
  const sc = screen(st({ card, pending: 2 }), { pausedMin: 14 })
  assert.deepEqual(sc.items, [])
  assert.equal(screen(st({ card, pending: 2 })).items.length, 2) // not paused: the card is up
  assert.equal(sc.cols[0].trim(), '↗ BTC long')
  assert.equal(message(st({ card, pending: 2 }), { pausedMin: 14 }), 'Cards paused · 14 min left · 2 waiting')
})

test('queue position in the card header', () => {
  assert.match(screen(st({ card, pending: 3 })).head, / {4}1 of 3$/)
  assert.doesNotMatch(screen(st({ card, pending: 1 })).head, /of/)
})

test('foot: message above the hint, kept at the bottom edge', () => {
  assert.deepEqual(footLines(st({ toast: 'Done: Add $100 margin' })), ['', '', 'Done: Add $100 margin'])
  assert.deepEqual(footLines(st({ toast: 'Done: Add $100 margin' }), { hints: true }), ['', 'Done: Add $100 margin', 'Tap to speak  ·  Tap then long press: menu'])
})

test('a long message breaks at a space into two lines', () => {
  const [, a, b] = footLines(st({ toast: 'Unknown result: timed out after the exchange call. Check the exchange.' }))
  assert.equal(a, 'Unknown result: timed out after the exchange')
  assert.equal(b, 'call. Check the exchange.')
})

test('voice note wins over a toast, offline over the rest', () => {
  assert.equal(message(st({ toast: 'x' }), { voice: '● Listening' }), '● Listening')
  assert.equal(message(st({ toast: 'x' }), { offline: true }), 'Server offline. Retrying…')
})

test('locked: the header says so, the bar would only repeat it', () => {
  const sc = screen(st({ locked: true, dayPnl: -230 }))
  assert.equal(sc.head, 'Today  -$230.00   Locked for today')
  assert.equal(message(st({ locked: true, dayPnl: -230 })), 'Daily loss limit reached. Stops only.')
})

test('offline keeps the last state', () => {
  const sc = screen(st(), { offline: true })
  assert.equal(sc.cols[0], '↗ BTC long')
  assert.equal(screen(null, { offline: true }).main, '')
  assert.equal(message(null, { offline: true }), 'Server offline. Retrying…')
})

test('offline or a refused token: the last card is not drawn, so a tap has nothing to confirm', () => {
  const s = st({ card, pending: 1 })
  assert.deepEqual(screen(s, { offline: true }).items, [])
  assert.deepEqual(screen(s, { needToken: true }).items, [])
  assert.deepEqual(footLines(s, { offline: true }), ['', '', 'Server offline. Retrying…'])
  assert.equal(screen(s).items.length, 2) // online with a token: the card is up
})

test('connecting before first state', () => {
  assert.equal(screen(null).main, 'Connecting…')
})

test('exchange error is shown', () => {
  assert.equal(message(st({ error: 'Bybit 10003: invalid key' })), 'Exchange: Bybit 10003: invalid key')
})

test('big numbers stay short enough for their column', () => {
  const p = pos({ symbol: 'VERYLONGNAME1000USDT', unrealisedPnl: -123456.78, stopLoss: 123456.7, liqPrice: 1, markPrice: 2000 })
  assert.deepEqual(rows(st({ positions: [p] })), [['↘ VERYL... long', '-$123,457', 'liq 100.0%', 'stop 123,457']])
})

test('every table cell fits its column on the lens', () => {
  const p = pos({ symbol: 'VERYLONGNAME1000USDT', unrealisedPnl: -123456.78, stopLoss: 123456.7, liqPrice: 1, markPrice: 2000 })
  const cols = screen(st({ positions: [p, pos()] })).cols
  const px = [136, 126, 116, 140]
  cols.forEach((c, i) => c.split('\n').forEach(l => assert.ok(getTextWidth(l) <= px[i], `${l}: ${getTextWidth(l)} > ${px[i]}`)))
})

test('nothing outgrows its box', () => {
  const long = { ...card, title: 'X'.repeat(80), detail: 'Y'.repeat(80), question: 'Z'.repeat(80) }
  const states = [st(), st({ card: long, pending: 9 }), st({ locked: true, dayPnl: -10234.56 }), st({ dayPnl: -123456.78, dailyLossLimitUsd: 1e6 }),
    st({ toast: 'T'.repeat(90) }), st({ error: 'E'.repeat(90) }), st({ positions: Array.from({ length: 7 }, () => pos()) })]
  for (const s of states) for (const v of [{}, { offline: true }, { hints: true }]) {
    const sc = screen(s, v)
    for (const l of [sc.head, ...sc.main.split('\n'), ...sc.foot.split('\n')]) assert.ok(getTextWidth(l) <= 540, `too wide: ${l}`)
    if (sc.items.length) for (const l of [sc.head, ...sc.main.split('\n')]) assert.ok(getTextWidth(l) <= 480, `too wide beside the icon: ${l}`)
    assert.ok(sc.foot.split('\n').length === 3 && sc.main.split('\n').length <= 5)
  }
})

test('phone preview lists the same lines', () => {
  assert.equal(previewText(screen(st(), { hints: true })), 'Today  +$124.50\n↗ BTC long  +$42.10  liq 8.2%  stop 61,000\n\nTap to speak  ·  Tap then long press: menu')
})

test('money and price formats', () => {
  assert.equal(money(1234.5), '+$1,234.50')
  assert.equal(money(-18.3), '-$18.30')
  assert.equal(price(61000.4), '61,000')
  assert.equal(price(145.5), '145.50')
  assert.equal(price(0.123456), '0.1235')
})

test('with nothing else to say the quiet line shows equity and free balance', () => {
  const balance = { equity: 99.8736, available: 97.2 }
  assert.equal(message(st({ balance })), 'Equity $99.87 · Free $97.20')
  assert.equal(message(st({ balance, toast: 'Done: Set stop at 1,677' })), 'Done: Set stop at 1,677') // a message wins
  assert.equal(message(st({ balance, card, pending: 1 })), 'Your rule: warn near liquidation') // so does a card's rule
  assert.ok(getTextWidth(message(st({ balance: { equity: 1234567.5, available: 1234567.5 } }))!) <= 540)
})

test('no speech key on the server: no invitation to tap and speak', () => {
  assert.equal(footLines(st({ voice: false }), { hints: true }).at(-1), 'Tap then long press: menu')
  assert.equal(footLines(st({ voice: true }), { hints: true }).at(-1), 'Tap to speak  ·  Tap then long press: menu')
  const many = st({ voice: false, positions: Array.from({ length: 7 }, (_, i) => pos({ symbol: `C${i}USDT` })) })
  assert.equal(footLines(many, { hints: true }).at(-1), 'Swipe for more  ·  Tap then long press: menu')
})

test('a big loss still fits the header with what is left', () => {
  const s = { positions: [], dayPnl: -9234.56, dailyLossLimitUsd: 10000, locked: false, pending: 0 } as unknown as ServerState
  const head = screen(s).head
  assert.ok(head.endsWith('$765 left'), head)
  assert.ok(getTextWidth(head) <= 540)
})

test('each kind of card wears its icon', () => {
  assert.deepEqual(['liq:BTCUSDT', 'lock:SOLUSDT', 'nostop:ETHUSDT', 'alert:a1', 'voice:stop:BTCUSDT', 'voice:lock:SOLUSDT', 'voice:buy eth'].map(iconOf),
    ['warn', 'lock', 'shield', 'bell', 'shield', 'lock', 'mic'])
  assert.equal(screen(st()).icon, '')
})

test('a card shows how long it still waits, on the server clock', () => {
  const c = { createdAt: 0, expiresAt: 60_000 }
  assert.equal(cardClock(c, 0), '━'.repeat(12))
  assert.equal(cardClock(c, 30_000), '━'.repeat(6) + '─'.repeat(6))
  assert.equal(cardClock(c, 90_000), '─'.repeat(12))
  assert.equal(screen(st({ card: { ...card, createdAt: 0, expiresAt: 60_000 }, pending: 1, updatedAt: 55_000 })).main.split('\n')[1], '━' + '─'.repeat(11))
})

test('supporting text is dim, warnings never are', () => {
  assert.deepEqual(screen(st()).dim, ['c2', 'c3', 'foot'])
  assert.deepEqual(screen(st({ positions: [pos({ stopLoss: 0 })] })).dim, ['c2', 'foot']) // a missing stop stays bright
  assert.deepEqual(screen(st({ toast: 'Done: Set BTC stop at 59,600' })).dim, ['c2', 'c3']) // news is bright
  assert.deepEqual(screen(st({ card, pending: 1 })).dim, ['foot']) // the rule line under a card
  assert.deepEqual(screen(st({ card, pending: 1 }), { offline: true }).dim, ['c2', 'c3'])
})
