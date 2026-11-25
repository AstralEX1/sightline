import { test } from 'node:test'
import assert from 'node:assert/strict'
import { actionSummary, conditionSummary, resolve, type Market } from '../src/proposals.ts'
import { ACTION_TYPES, CONDITION_TYPES, type Action, type Condition } from '../src/registry.ts'

const market: Market = {
  ticker: { last: 100, mark: 100, index: 100 },
  instrument: { tickSize: '0.1', qtyStep: '0.001', minOrderQty: 0.001, maxMktOrderQty: 100, minNotionalValue: 5 },
  orders: [], positions: [], balance: { equity: 10_000, available: 8_000 }, slots: [{ positionIdx: 0, leverage: 10, size: 0 }],
}
const sym = { key: 'sym:SOLUSDT', symbol: 'SOLUSDT', label: 'SOL' }
type Open = Extract<Action, { type: 'OPEN_LONG' | 'OPEN_SHORT' }>
const open = (o: Partial<Open> = {}): Open => ({ type: 'OPEN_SHORT', sizes: ['100'], leverages: ['10'], ...o })

test('a short take profit at or past zero is skipped, never a card that says tp 0', () => {
  for (const percent of ['100', '150']) {
    const r = resolve(open({ tp: { kind: 'ENTRY_OFFSET', percent } }), sym, market)
    assert.deepEqual(r.ok ? r : [r.code], ['past_price'], percent)
  }
  const ok = resolve(open({ tp: { kind: 'ENTRY_OFFSET', percent: '50' } }), sym, market)
  assert.ok(ok.ok && ok.terms.type === 'order' && ok.terms.takeProfit === 50)
})

test('a long stop at or under zero is skipped', () => {
  const r = resolve(open({ type: 'OPEN_LONG', sl: { kind: 'ENTRY_OFFSET', percent: '-100' } }), sym, market)
  assert.equal(!r.ok && r.code, 'past_price')
})

test('Open: the first size and leverage until a pick; another leverage is set before the order, never skipped', () => {
  const a = open({ type: 'OPEN_LONG', sizes: ['100', '250'], leverages: ['5', '10'] })
  const first = resolve(a, sym, market)
  assert.ok(first.ok && first.terms.type === 'order')
  assert.deepEqual([first.terms.side, first.terms.qty, first.terms.notionalUsdt, first.terms.leverage], ['Buy', '1', 100, 5])
  const picked = resolve(a, sym, market, undefined, undefined, { size: 250, leverage: 10 })
  assert.ok(picked.ok && picked.terms.type === 'order')
  assert.deepEqual([picked.terms.qty, picked.terms.marginUsdt], ['2.5', 25])
  const broke = resolve(a, sym, { ...market, balance: { equity: 100, available: 40 } }, undefined, undefined, { size: 250, leverage: 5 })
  assert.equal(!broke.ok && broke.code, 'insufficient') // 50 USDT margin, 40 free
})

test('Set TP: a no-op is skipped before the tap, a replacement says what it replaces', () => {
  const pos = { key: 'pos:SOLUSDT:0:e1', symbol: 'SOLUSDT', label: 'SOL long', position: {
    symbol: 'SOLUSDT', side: 'Buy' as const, size: 1, entryPrice: 100, markPrice: 100, liqPrice: 0, unrealisedPnl: 0, stopLoss: 0,
    takeProfit: 103, positionIM: 10, leverage: 10, isolated: true, positionIdx: 0, openedAt: 0 } }
  const at = (percent: string) => resolve({ type: 'SET_TP', target: { kind: 'ENTRY_OFFSET', percent } }, pos, market)
  const same = at('3')
  assert.equal(!same.ok && same.code, 'not_modified')
  const moved = at('5')
  assert.ok(moved.ok)
  assert.equal(moved.note, 'replaces 103')
})

const solLong = (size: number) => ({ key: 'pos:SOLUSDT:0:e1', symbol: 'SOLUSDT', label: 'SOL long', position: {
  symbol: 'SOLUSDT', side: 'Buy' as const, size, entryPrice: 100, markPrice: 100, liqPrice: 0, unrealisedPnl: 0, stopLoss: 0,
  takeProfit: 0, positionIM: 10, leverage: 10, isolated: true, positionIdx: 0, openedAt: 0 } })

test('Close says the percent it sends when the qty step rounds it down', () => {
  const close = (size: number) => resolve({ type: 'CLOSE_POSITION', percent: '50' }, solLong(size), market)
  const even = close(0.004)
  assert.ok(even.ok)
  assert.deepEqual([even.question, even.note], ['Close 50% · 0.002 SOL?', 'market, reduce-only'])
  const odd = close(0.003)
  assert.ok(odd.ok)
  assert.deepEqual([odd.question, odd.note], ['Close 33% · 0.001 SOL?', 'market, reduce-only · 50% rounds down to 0.001 SOL'])
})

test('Open: a stop past where the margin is gone is skipped, long and short', () => {
  const code = (type: Open['type'], percent: string) => {
    const r = resolve(open({ type, sl: { kind: 'ENTRY_OFFSET', percent } }), sym, market)
    return r.ok ? 'ok' : r.code
  }
  // 10x: the margin is gone 10% from the price
  assert.deepEqual([code('OPEN_LONG', '-5'), code('OPEN_LONG', '-15'), code('OPEN_SHORT', '-5'), code('OPEN_SHORT', '-15')], ['ok', 'past_liquidation', 'ok', 'past_liquidation'])
})

test('Add margin as a percent of the position margin, down to the cent', () => {
  const p = { symbol: 'SOLUSDT', side: 'Buy' as const, size: 10, entryPrice: 100, markPrice: 100, liqPrice: 80, unrealisedPnl: 0, stopLoss: 0, takeProfit: 0, positionIM: 123.45, leverage: 10, isolated: true, positionIdx: 0, openedAt: 0 }
  const t = { key: 'pos:SOLUSDT:0:e', symbol: 'SOLUSDT', label: 'SOL long', position: p }
  const r = resolve({ type: 'ADD_MARGIN', amount: '20', unit: 'MARGIN_PERCENT' }, t, market)
  assert.ok(r.ok && r.terms.type === 'addMargin')
  assert.equal(r.terms.usd, 24.69) // 20% of 123.45 = 24.69
  assert.equal(r.note, '20% of its $123.45 margin')
  const none = resolve({ type: 'ADD_MARGIN', amount: '20', unit: 'MARGIN_PERCENT' }, { ...t, position: { ...p, positionIM: 0 } }, market)
  assert.equal(!none.ok && none.code, 'no_margin')
  const fixed = resolve({ type: 'ADD_MARGIN', amount: '50', unit: 'USDT' }, t, market)
  assert.ok(fixed.ok && fixed.terms.type === 'addMargin' && fixed.terms.usd === 50)
})

type NoId<T> = T extends unknown ? Omit<T, 'id'> : never
const when = (items: NoId<Condition>[], logic: 'ALL' | 'ANY' = 'ALL') =>
  conditionSummary({ conditions: { logic, items: items.map((c, i) => ({ id: `c${i}`, ...c }) as Condition) } })

test('a tile’s When line: ≤ and ≥ as the engine compares, numbers grouped, a blank as …', () => {
  const cases: [NoId<Condition>, string][] = [
    [{ type: 'PRICE', source: 'LAST', operator: 'GTE', threshold: '90000' }, 'Price ≥ 90,000'],
    [{ type: 'PRICE', source: 'MARK', operator: 'LTE', threshold: '0.25' }, 'Mark ≤ 0.25'],
    [{ type: 'PRICE', source: 'INDEX', operator: 'DOWN_CROSS', threshold: '3000' }, 'Index crosses below 3,000'],
    [{ type: 'PRICE', source: 'LAST', operator: 'UP_CROSS', threshold: '' }, 'Price crosses above …'],
    [{ type: 'PRICE_CHANGE', source: 'LAST', direction: 'DOWN', percent: '2' }, 'Price −2%'],
    [{ type: 'PRICE_CHANGE', source: 'LAST', direction: 'UP', percent: '5' }, 'Price +5%'],
    [{ type: 'PROFIT', unit: 'ROI_PERCENT', threshold: '20' }, 'ROI ≥ 20%'],
    [{ type: 'PROFIT', unit: 'USDT', threshold: '1500' }, 'Profit ≥ 1,500 USDT'],
    [{ type: 'LOSS', unit: 'ROI_PERCENT', threshold: '30' }, 'ROI ≤ −30%'],
    [{ type: 'LOSS', unit: 'USDT', threshold: '50' }, 'Loss ≥ 50 USDT'],
    [{ type: 'NEAR_LIQUIDATION', distancePct: '3' }, 'Liq ≤ 3%'],
    [{ type: 'NEAR_SL', distancePct: '0.5' }, 'SL ≤ 0.5%'],
    [{ type: 'NEAR_TP', distancePct: '0.5' }, 'TP ≤ 0.5%'],
    [{ type: 'ORDER_FILLED' }, 'Order filled'],
    [{ type: 'ORDER_PARTIAL' }, 'Order partly filled'],
    [{ type: 'VOLUME_SPIKE', multiplier: '3', windowSec: 300 }, 'Volume 3× in 5\u00a0min'],
    [{ type: 'FUNDING', ratePct: '0.05', minutesBefore: 30 }, 'Funding ≥ 0.05% in 30\u00a0min'],
    [{ type: 'ORDER_STALE', minutes: 60 }, 'Order open ≥ 1\u00a0h'],
    [{ type: 'ORDER_STALE', minutes: 90 }, 'Order open ≥ 1\u00a0h 30\u00a0min'],
    [{ type: 'POSITION_CLOSED', by: 'SL' }, 'Closed by stop loss'],
    [{ type: 'POSITION_CLOSED', by: 'TP' }, 'Closed by take profit'],
    [{ type: 'POSITION_CLOSED', by: 'LIQUIDATION' }, 'Liquidated'],
  ]
  for (const [c, text] of cases) assert.equal(when([c]), text)
  assert.deepEqual(new Set(cases.map(([c]) => c.type)), new Set(CONDITION_TYPES))
  assert.equal(conditionSummary({ conditions: { logic: 'ALL', items: [] }, voicePhrase: 'protect all' }), '“protect all”')
})

test('two conditions read joined; a rise or a fall of one size reads as ±', () => {
  const move = (direction: 'UP' | 'DOWN', percent = '15') => ({ type: 'PRICE_CHANGE', source: 'LAST', direction, percent }) as const
  assert.equal(when([move('UP'), move('DOWN')], 'ANY'), 'Price ±15%')
  assert.equal(when([move('UP'), move('DOWN', '10')], 'ANY'), 'Price +15% or Price −10%')
  assert.equal(when([move('UP'), move('UP')], 'ANY'), 'Price +15% or Price +15%')
  assert.equal(when([move('UP'), move('DOWN')]), 'Price +15% and Price −15%')
  assert.equal(when([{ type: 'PROFIT', unit: 'ROI_PERCENT', threshold: '20' }, { type: 'NEAR_LIQUIDATION', distancePct: '3' }], 'ANY'), 'ROI ≥ 20% or Liq ≤ 3%')
})

test('a tile’s Do line for every action, a blank value as …', () => {
  const entry = (percent: string) => ({ kind: 'ENTRY_OFFSET', percent }) as const
  const cases: [Action, string][] = [
    [{ type: 'CLOSE_POSITION', percent: '50' }, 'Close 50%'],
    [{ type: 'CLOSE_POSITION', percent: '' }, 'Close …%'],
    [{ type: 'MOVE_SL', target: entry('0') }, 'SL to entry'],
    [{ type: 'MOVE_SL', target: entry('1') }, 'SL at +1%'],
    [{ type: 'MOVE_SL', target: { kind: 'PRICE', price: '64250' } }, 'SL at 64,250'],
    [{ type: 'SET_SL', target: entry('-2') }, 'SL at −2%'],
    [{ type: 'SET_SL', target: entry('') }, 'SL at …%'],
    [{ type: 'SET_TP', target: entry('3') }, 'TP at +3%'],
    [{ type: 'SET_TP', target: { kind: 'PRICE', price: '' } }, 'TP at …'],
    [{ type: 'ADD_MARGIN', amount: '50', unit: 'USDT' }, 'Add 50 USDT margin'],
    [{ type: 'ADD_MARGIN', amount: '20', unit: 'MARGIN_PERCENT' }, 'Add 20% margin'],
    [{ type: 'OPEN_LONG', sizes: ['100'], leverages: ['10'] }, 'Long 100 USDT ×10'],
    [{ type: 'OPEN_LONG', sizes: ['1000'], leverages: ['1', '5'] }, 'Long 1,000 USDT'],
    [{ type: 'OPEN_SHORT', sizes: ['100', '250'], leverages: ['2'] }, 'Open short'],
    [{ type: 'OPEN_SHORT', sizes: [], leverages: [] }, 'Short … USDT ×…'],
    [{ type: 'INCREASE_POSITION', notionalUsdt: '100' }, 'Add 100 USDT'],
    [{ type: 'CANCEL_ORDER' }, 'Cancel order'],
    [{ type: 'NOTIFY' }, 'Notify me'],
  ]
  for (const [action, text] of cases) assert.equal(actionSummary(action), text)
  assert.deepEqual(new Set(cases.map(([a]) => a.type)), new Set(ACTION_TYPES))
})
