import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BAND_LEVEL_PCT, BAND_POINTS, PriceWindow, decide, evaluateCondition, evaluateGroup, initialTriggerState, rearm } from '../src/engine.ts'
import type { EvalOpts, Facts, GroupResult, PositionFacts, TriggerState } from '../src/engine.ts'
import { LIMITS } from '../src/registry.ts'
import type { Condition, ShortcutRule, TriggerMode } from '../src/registry.ts'

const NOW = 1_800_000_000_000
const STALE = 10_000
const OPTS: EvalOpts = { now: NOW, staleMs: STALE }
const q = (price: number, ts = NOW) => ({ price, ts })

function pos(o: Partial<PositionFacts> = {}): PositionFacts {
  return {
    side: 'Buy', size: 1, entry: 100, mark: 100, liqPrice: 80, unrealisedPnl: 0, positionIM: 100,
    stopLoss: { state: 'none' }, takeProfit: { state: 'none' }, epoch: 'e1', ts: NOW, ...o,
  }
}

function facts(o: Partial<Facts> = {}): Facts {
  return { prices: { LAST: q(100), MARK: q(100), INDEX: q(100) }, prev: {}, windowAgo: () => null, ...o }
}

type NoId<T> = T extends unknown ? Omit<T, 'id'> : never
const cond = (c: NoId<Condition>, id = 'c1') => ({ id, ...c }) as Condition
const ev = (c: NoId<Condition>, f: Facts, o: Partial<EvalOpts> = {}) => evaluateCondition(cond(c), f, { ...OPTS, ...o })
const close = (a: number | undefined, b: number) => assert.ok(a !== undefined && Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`)

type Rule = Pick<ShortcutRule, 'version' | 'enabled' | 'conditions' | 'trigger'>
const rule = (mode: TriggerMode, items: Condition[], intervalSec?: number): Rule =>
  ({ version: 1, enabled: true, conditions: { logic: 'ALL', items }, trigger: { mode, intervalSec } })
const G = (verdict: GroupResult['verdict'], events: string[] = []): GroupResult => ({ verdict, matched: [], events })

/** Feeds results through decide in order; returns the indexes that fired and the last state. */
function feed(r: Rule, steps: { t: number; g: GroupResult; pending?: boolean }[], s: TriggerState = initialTriggerState(r.version), cooldownSec?: number) {
  const fired: number[] = []
  steps.forEach(({ t, g, pending }, i) => {
    const d = decide(r, g, s, t, { pending, cooldownSec })
    if (d.fire) fired.push(i)
    s = d.next
  })
  return { fired, state: s }
}

const LIQ5 = { type: 'NEAR_LIQUIDATION', distancePct: '5' } as const
const UP100 = { type: 'PRICE', source: 'LAST', operator: 'UP_CROSS', threshold: '100' } as const

test('price level on the chosen source', () => {
  const f = facts({ prices: { LAST: q(101), MARK: q(99) } })
  assert.deepEqual(ev({ type: 'PRICE', source: 'LAST', operator: 'GTE', threshold: '100' }, f), { verdict: 'TRUE', value: 101 })
  assert.equal(ev({ type: 'PRICE', source: 'MARK', operator: 'GTE', threshold: '100' }, f).verdict, 'FALSE')
  assert.equal(ev({ type: 'PRICE', source: 'MARK', operator: 'LTE', threshold: '100' }, f).verdict, 'TRUE')
  assert.equal(ev({ type: 'PRICE', source: 'INDEX', operator: 'LTE', threshold: '100' }, f).verdict, 'UNKNOWN')
})

test('price change = 100·(now / window ago − 1) on the same source', () => {
  const up = { type: 'PRICE_CHANGE', source: 'MARK', direction: 'UP', percent: '3', windowSec: 300 } as const
  const down = { ...up, direction: 'DOWN' } as const
  const at = (now: number) => facts({ prices: { MARK: q(now) }, windowAgo: (s, w) => (s === 'MARK' && w === 300 ? 100 : null) })
  const r = ev(up, at(104))
  assert.equal(r.verdict, 'TRUE')
  close(r.value, 4)
  assert.equal(ev(up, at(102)).verdict, 'FALSE')
  assert.equal(ev(down, at(104)).verdict, 'FALSE')
  const d = ev(down, at(96))
  assert.equal(d.verdict, 'TRUE')
  close(d.value, -4)
  assert.equal(ev({ ...up, source: 'LAST' }, facts({ prices: { LAST: q(104) }, windowAgo: () => null })).verdict, 'UNKNOWN') // no history
})

test('profit and loss in USDT and ROI, long and short', () => {
  const roi = (type: 'PROFIT' | 'LOSS', threshold: string) => ({ type, unit: 'ROI_PERCENT', threshold }) as const
  const usdt = (type: 'PROFIT' | 'LOSS', threshold: string) => ({ type, unit: 'USDT', threshold }) as const
  for (const side of ['Buy', 'Sell'] as const) {
    const win = facts({ position: pos({ side, unrealisedPnl: 30, positionIM: 75 }) }) // ROI 40%
    const lose = facts({ position: pos({ side, unrealisedPnl: -30, positionIM: 75 }) })
    assert.deepEqual(ev(roi('PROFIT', '30'), win), { verdict: 'TRUE', value: 40 })
    assert.equal(ev(roi('PROFIT', '50'), win).verdict, 'FALSE')
    assert.deepEqual(ev(roi('LOSS', '20'), lose), { verdict: 'TRUE', value: -40 })
    assert.equal(ev(roi('LOSS', '20'), win).verdict, 'FALSE')
    assert.deepEqual(ev(usdt('PROFIT', '30'), win), { verdict: 'TRUE', value: 30 })
    assert.equal(ev(usdt('LOSS', '30'), lose).verdict, 'TRUE')
    assert.equal(ev(usdt('LOSS', '31'), lose).verdict, 'FALSE')
  }
  const noIM = facts({ position: pos({ unrealisedPnl: 30, positionIM: null }) })
  assert.equal(ev(roi('PROFIT', '10'), noIM).verdict, 'UNKNOWN')
  assert.equal(ev(usdt('PROFIT', '10'), noIM).verdict, 'TRUE') // USDT PnL still works
})

test('liquidation distance uses mark, long and short', () => {
  const at = (side: 'Buy' | 'Sell', liqPrice: number | null) => ev(LIQ5, facts({ position: pos({ side, mark: 1000, liqPrice }) }))
  assert.deepEqual(at('Buy', 960), { verdict: 'TRUE', value: 4 })
  assert.deepEqual(at('Buy', 900), { verdict: 'FALSE', value: 10 })
  assert.deepEqual(at('Sell', 1040), { verdict: 'TRUE', value: 4 })
  assert.deepEqual(at('Sell', 1100), { verdict: 'FALSE', value: 10 })
  assert.equal(at('Buy', null).verdict, 'NOT_APPLICABLE')
})

test('stop loss and take profit distance on the trigger source, long and short', () => {
  const sl = { type: 'NEAR_SL', distancePct: '1' } as const
  const tp = { type: 'NEAR_TP', distancePct: '1' } as const
  const at = (o: Partial<PositionFacts>) => facts({ prices: { LAST: q(1000), MARK: q(1020) }, position: pos(o) })
  const set = (price: number, triggerBy: 'LAST' | 'MARK' = 'LAST') => ({ state: 'set', price, triggerBy }) as const
  assert.deepEqual(ev(sl, at({ side: 'Buy', stopLoss: set(995) })), { verdict: 'TRUE', value: 0.5 })
  assert.deepEqual(ev(sl, at({ side: 'Sell', stopLoss: set(1005) })), { verdict: 'TRUE', value: 0.5 })
  assert.equal(ev(sl, at({ side: 'Buy', stopLoss: set(995, 'MARK') })).verdict, 'FALSE') // 2.45% from the mark it triggers on
  assert.deepEqual(ev(tp, at({ side: 'Buy', takeProfit: set(1005) })), { verdict: 'TRUE', value: 0.5 })
  assert.deepEqual(ev(tp, at({ side: 'Sell', takeProfit: set(995) })), { verdict: 'TRUE', value: 0.5 })
  assert.deepEqual(ev(tp, at({ side: 'Sell', takeProfit: set(950) })), { verdict: 'FALSE', value: 5 })
  assert.equal(ev(sl, at({ stopLoss: { state: 'none' } })).verdict, 'NOT_APPLICABLE')
  assert.equal(ev(sl, at({ stopLoss: { state: 'unknown' } })).verdict, 'UNKNOWN')
  assert.equal(ev(tp, at({ takeProfit: { state: 'partial' } })).verdict, 'UNKNOWN')
  assert.equal(ev(sl, facts({ prices: { LAST: q(1000) }, position: pos({ stopLoss: set(995, 'MARK') }) })).verdict, 'UNKNOWN') // no mark quote
})

test('missing stop loss is TRUE only when absence is verified', () => {
  const at = (stopLoss: PositionFacts['stopLoss']) => ev({ type: 'SL_MISSING' }, facts({ position: pos({ stopLoss }) })).verdict
  assert.equal(at({ state: 'none' }), 'TRUE')
  assert.equal(at({ state: 'set', price: 90, triggerBy: 'LAST' }), 'FALSE')
  assert.equal(at({ state: 'unknown' }), 'UNKNOWN')
  assert.equal(at({ state: 'partial' }), 'UNKNOWN')
})

test('order events are TRUE only for a matching event in this evaluation', () => {
  const filled = facts({ event: { kind: 'FILLED', orderId: 'o1', execId: 'x1' } })
  assert.equal(ev({ type: 'ORDER_FILLED' }, filled).verdict, 'TRUE')
  assert.equal(ev({ type: 'ORDER_PARTIAL' }, filled).verdict, 'FALSE')
  assert.equal(ev({ type: 'ORDER_PARTIAL' }, facts({ event: { kind: 'PARTIAL', orderId: 'o1', execId: 'x2' } })).verdict, 'TRUE')
  assert.equal(ev({ type: 'ORDER_FILLED' }, facts()).verdict, 'FALSE')
})

test('crossing vs level, and no crossing from the first sample', () => {
  const at = (prev: number | null, cur: number) => facts({ prices: { LAST: q(cur) }, prev: prev === null ? {} : { LAST: q(prev, NOW - 5000) } })
  const gte = { ...UP100, operator: 'GTE' } as const
  const down = { ...UP100, operator: 'DOWN_CROSS' } as const
  assert.equal(ev(UP100, at(99, 101)).verdict, 'TRUE')
  assert.equal(ev(UP100, at(99, 100)).verdict, 'TRUE') // reaching the line counts
  assert.equal(ev(UP100, at(100, 101)).verdict, 'FALSE') // already on it
  assert.equal(ev(UP100, at(101, 102)).verdict, 'FALSE')
  assert.equal(ev(gte, at(101, 102)).verdict, 'TRUE') // the level holds, nothing crossed
  assert.equal(ev(down, at(101, 99)).verdict, 'TRUE')
  assert.equal(ev(down, at(99, 98)).verdict, 'FALSE')
  assert.equal(ev(UP100, at(null, 101)).verdict, 'UNKNOWN')
  assert.equal(ev(gte, at(null, 101)).verdict, 'TRUE')
})

test('stale or missing inputs are UNKNOWN', () => {
  const old = NOW - STALE - 1
  const gte = { type: 'PRICE', source: 'LAST', operator: 'GTE', threshold: '100' } as const
  assert.equal(ev(gte, facts({ prices: { LAST: q(150, old) } })).verdict, 'UNKNOWN')
  assert.equal(ev(LIQ5, facts({ position: pos({ mark: 1000, liqPrice: 990, ts: old }) })).verdict, 'UNKNOWN')
  assert.equal(ev(LIQ5, facts()).verdict, 'UNKNOWN') // no position
  assert.equal(ev(LIQ5, facts({ position: pos({ size: 0, mark: 1000, liqPrice: 990 }) })).verdict, 'UNKNOWN') // closed
  assert.equal(ev(UP100, facts({ prices: { LAST: q(101) }, prev: { LAST: q(99, NOW - 60_000) } })).verdict, 'UNKNOWN') // gap since the last sample
  const g = evaluateGroup({ logic: 'ALL', items: [cond(gte)] }, facts({ prices: { LAST: q(150, old) } }), OPTS)
  assert.equal(g.verdict, 'UNKNOWN')
})

test('ALL and ANY four-valued truth tables', () => {
  const f = facts({ prices: { LAST: q(100) }, position: pos() })
  const by = {
    T: cond({ type: 'PRICE', source: 'LAST', operator: 'GTE', threshold: '50' }),
    F: cond({ type: 'PRICE', source: 'LAST', operator: 'GTE', threshold: '200' }),
    U: cond({ type: 'PRICE', source: 'INDEX', operator: 'GTE', threshold: '50' }),
    N: cond({ type: 'NEAR_SL', distancePct: '1' }),
  }
  const rows = [ // pair, ALL, ANY
    ['TT', 'TRUE', 'TRUE'], ['TF', 'FALSE', 'TRUE'], ['TU', 'UNKNOWN', 'TRUE'], ['TN', 'FALSE', 'TRUE'],
    ['FF', 'FALSE', 'FALSE'], ['FU', 'FALSE', 'UNKNOWN'], ['FN', 'FALSE', 'FALSE'],
    ['UU', 'UNKNOWN', 'UNKNOWN'], ['UN', 'FALSE', 'UNKNOWN'], ['NN', 'FALSE', 'FALSE'],
  ] as const
  for (const [pair, all, any] of rows) {
    for (const [a, b] of [[pair[0], pair[1]], [pair[1], pair[0]]] as const) {
      const items = [by[a as keyof typeof by], by[b as keyof typeof by]]
      assert.equal(evaluateGroup({ logic: 'ALL', items }, f, OPTS).verdict, all, `ALL ${a}${b}`)
      assert.equal(evaluateGroup({ logic: 'ANY', items }, f, OPTS).verdict, any, `ANY ${a}${b}`)
    }
  }
})

test('NOT_APPLICABLE never becomes zero', () => {
  const f = facts({ position: pos({ stopLoss: { state: 'none' } }) })
  const r = ev({ type: 'NEAR_SL', distancePct: '1' }, f)
  assert.equal(r.verdict, 'NOT_APPLICABLE')
  assert.equal(r.value, undefined)
  // a zero distance would be "below 1%" and make this TRUE
  const g = evaluateGroup({ logic: 'ANY', items: [cond({ type: 'NEAR_SL', distancePct: '1' })] }, f, OPTS)
  assert.equal(g.verdict, 'FALSE')
  assert.deepEqual(g.matched, [])
})

test('the strongest reason picks liquidation over ROI, whatever the order', () => {
  const f = facts({ position: pos({ mark: 1000, liqPrice: 970, unrealisedPnl: -30, positionIM: 100 }) })
  const items = [cond({ type: 'LOSS', unit: 'ROI_PERCENT', threshold: '20' }, 'roi'), cond(LIQ5, 'liq'), cond({ type: 'SL_MISSING' }, 'sl')]
  const g = evaluateGroup({ logic: 'ANY', items }, f, OPTS)
  assert.equal(g.verdict, 'TRUE')
  assert.deepEqual(g.matched, ['roi', 'liq', 'sl'])
  assert.deepEqual(g.reason, { id: 'liq', type: 'NEAR_LIQUIDATION', value: 3 })
})

test('a voice-only shortcut is never evaluated and never fires', () => {
  const g = evaluateGroup({ logic: 'ALL', items: [] }, facts(), OPTS)
  assert.equal(g.verdict, 'UNKNOWN')
  assert.equal(decide(rule('ON_ENTRY', []), G('TRUE'), initialTriggerState(1), NOW).fire, false)
})

test('relaxed thresholds give way by the band', () => {
  assert.equal(BAND_POINTS, 0.5)
  assert.equal(BAND_LEVEL_PCT, 0.5)
  const both = (c: NoId<Condition>, f: Facts) => [ev(c, f).verdict, ev(c, f, { relaxed: true }).verdict].join(' ')
  const pnl = (usdt: number) => facts({ position: pos({ unrealisedPnl: usdt, positionIM: 100 }) })
  assert.equal(both({ type: 'PROFIT', unit: 'ROI_PERCENT', threshold: '20' }, pnl(19.6)), 'FALSE TRUE') // 0.5 points
  assert.equal(both({ type: 'PROFIT', unit: 'ROI_PERCENT', threshold: '20' }, pnl(19.4)), 'FALSE FALSE')
  assert.equal(both({ type: 'LOSS', unit: 'ROI_PERCENT', threshold: '20' }, pnl(-19.6)), 'FALSE TRUE')
  assert.equal(both({ type: 'PROFIT', unit: 'USDT', threshold: '1000' }, pnl(996)), 'FALSE TRUE') // 0.5% of 1000 = 5
  assert.equal(both({ type: 'PROFIT', unit: 'USDT', threshold: '1000' }, pnl(994)), 'FALSE FALSE')
  const px = (p: number) => facts({ prices: { LAST: q(p) } })
  assert.equal(both({ type: 'PRICE', source: 'LAST', operator: 'GTE', threshold: '1000' }, px(996)), 'FALSE TRUE')
  assert.equal(both({ type: 'PRICE', source: 'LAST', operator: 'LTE', threshold: '1000' }, px(1004)), 'FALSE TRUE')
  assert.equal(both({ type: 'PRICE', source: 'LAST', operator: 'LTE', threshold: '1000' }, px(1006)), 'FALSE FALSE')
  const change = facts({ prices: { LAST: q(102.7) }, windowAgo: () => 100 })
  assert.equal(both({ type: 'PRICE_CHANGE', source: 'LAST', direction: 'UP', percent: '3', windowSec: 300 }, change), 'FALSE TRUE')
  assert.equal(both(LIQ5, facts({ position: pos({ mark: 1000, liqPrice: 948 }) })), 'FALSE TRUE') // 5.2% ≤ 5.5
})

test('hysteresis: a wobble inside the band fires once, a clear exit rearms', () => {
  const r = rule('ON_ENTRY', [cond(LIQ5)])
  let s = initialTriggerState(1)
  const fired: number[] = []
  // distance = (1000 − liq) / 10: 4.9, 5.2, 4.9, 5.2, then 5.6 clears the band, then 4.9 again
  ;[951, 948, 951, 948, 944, 951].forEach((liqPrice, i) => {
    const t = NOW + i * 120_000 // every step is past the cooldown
    const g = evaluateGroup(r.conditions, facts({ position: pos({ mark: 1000, liqPrice, ts: t }) }), { now: t, staleMs: STALE, relaxed: s.phase === 'fired' })
    const d = decide(r, g, s, t)
    if (d.fire) fired.push(i)
    s = d.next
  })
  assert.deepEqual(fired, [0, 5])
})

test('ON_ENTRY: the first TRUE after start currently matches; UNKNOWN never rearms; state is plain JSON', () => {
  const r = rule('ON_ENTRY', [cond(LIQ5)])
  let s = initialTriggerState(1)
  let d = decide(r, G('UNKNOWN'), s, NOW)
  assert.equal(d.fire, false)
  d = decide(r, G('TRUE'), d.next, NOW + 1000)
  assert.deepEqual([d.fire, d.currentlyMatches], [true, true])
  s = decide(r, G('UNKNOWN'), d.next, NOW + 100_000).next
  d = decide(r, G('TRUE'), s, NOW + 200_000)
  assert.equal(d.fire, false) // no definite FALSE in between
  s = decide(r, G('FALSE'), d.next, NOW + 300_000).next
  d = decide(r, G('TRUE'), s, NOW + 400_000)
  assert.deepEqual([d.fire, d.currentlyMatches], [true, false])
  assert.deepEqual(JSON.parse(JSON.stringify(d.next)), d.next)
})

test('cooldown between alerts for the same rule and target', () => {
  const r = rule('ON_ENTRY', [cond(LIQ5)])
  const steps = [{ t: NOW, g: G('TRUE') }, { t: NOW + 10_000, g: G('FALSE') }, { t: NOW + 30_000, g: G('TRUE') }, { t: NOW + 61_000, g: G('TRUE') }]
  assert.deepEqual(feed(r, steps).fired, [0, 3]) // the re-entry waits out the 60 s default, then fires while it still matches
  assert.deepEqual(feed(r, steps, undefined, 20).fired, [0, 2])
})

test('ON_EVENT: one alert per execId, a repeat is dropped, the cooldown does not apply', () => {
  const r = rule('ON_EVENT', [cond({ type: 'ORDER_FILLED' })])
  const at = (t: number, execId?: string) =>
    ({ t, g: evaluateGroup(r.conditions, facts({ event: execId ? { kind: 'FILLED', orderId: 'o1', execId } : undefined }), OPTS) })
  const { fired, state } = feed(r, [at(NOW, 'x1'), at(NOW + 1000, 'x1'), at(NOW + 2000), at(NOW + 3000, 'x1'), at(NOW + 4000, 'x2')])
  assert.deepEqual(fired, [0, 4])
  assert.deepEqual(state.seen, ['exec:x1', 'exec:x2'])
})

test('ON_EVENT crossing: none from the first sample, one per crossing timestamp', () => {
  const r = rule('ON_EVENT', [cond(UP100)])
  const at = (now: number, prev: number | null, cur: number, curTs = now) => ({
    t: now,
    g: evaluateGroup(r.conditions, facts({ prices: { LAST: q(cur, curTs) }, prev: prev === null ? {} : { LAST: q(prev, curTs - 5000) } }), { now, staleMs: STALE }),
  })
  const t = (s: number) => NOW + s * 1000
  const { fired } = feed(r, [
    at(t(0), null, 105), // bootstrap above the line: nothing crossed
    at(t(5), 105, 106),
    at(t(10), 99, 101), // crossed
    at(t(11), 99, 101, t(10)), // the same sample evaluated again
    at(t(15), 101, 99),
    at(t(20), 99, 101), // crossed again
  ])
  assert.deepEqual(fired, [2, 5])
})

test('ONCE latches per rule version and target until rearmed', () => {
  const r = rule('ONCE', [cond(UP100)])
  const a = feed(r, [{ t: NOW, g: G('TRUE', ['LAST@1']) }, { t: NOW + 1000, g: G('FALSE') }, { t: NOW + 2000, g: G('TRUE', ['LAST@2']) }])
  assert.deepEqual(a.fired, [0])
  assert.equal(a.state.latched, true)
  const b = feed(r, [{ t: NOW + 3000, g: G('TRUE', ['LAST@2']) }, { t: NOW + 4000, g: G('TRUE', ['LAST@3']) }], rearm(a.state))
  assert.deepEqual(b.fired, [1]) // after the rearm: not the event it already saw, the next new one
  assert.equal(decide({ ...r, version: 2 }, G('TRUE', ['LAST@9']), b.state, NOW + 5000).fire, true) // a new version starts over

  const state = rule('ONCE', [cond(LIQ5)])
  assert.deepEqual(feed(state, [{ t: NOW, g: G('TRUE') }, { t: NOW + 100_000, g: G('FALSE') }, { t: NOW + 200_000, g: G('TRUE') }]).fired, [0])
})

test('REPEAT fires every intervalSec while TRUE, and waits for the pending proposal', () => {
  const r = rule('REPEAT', [cond(LIQ5)], 300)
  const s = (sec: number, verdict: GroupResult['verdict'] = 'TRUE', pending = false) => ({ t: NOW + sec * 1000, g: G(verdict), pending })
  assert.deepEqual(feed(r, [s(0), s(100), s(300, 'TRUE', true), s(310), s(400), s(500, 'UNKNOWN'), s(610)]).fired, [0, 3, 6])
  assert.deepEqual(feed(rule('REPEAT', [cond(LIQ5)]), [s(0), s(299), s(300)]).fired, [0, 2]) // default 5 min
})

test('price window: the price at or just before now − window, null before the history', () => {
  const w = new PriceWindow()
  for (let s = 0; s <= 600; s += 10) w.push(NOW + s * 1000, 100 + s)
  const now = NOW + 600_000
  assert.equal(w.ago(300, now), 400) // exactly on a sample
  assert.equal(w.ago(305, now), 390) // between samples: the one before
  assert.equal(w.ago(600, now), 100)
  assert.equal(w.ago(660, now), null)
})

test('price window: a gap over 2 minutes around the target is null', () => {
  const w = new PriceWindow()
  for (let s = 0; s <= 120; s += 10) w.push(NOW + s * 1000, 1)
  for (let s = 300; s <= 600; s += 10) w.push(NOW + s * 1000, 2) // 120 s → 300 s missing
  const now = NOW + 600_000
  assert.equal(w.ago(500, now), 1) // target 100 s
  assert.equal(w.ago(400, now), null) // target 200 s, inside the gap
  assert.equal(w.ago(60, now + 180_000), null) // nothing pushed for 3 minutes
})

test('price window: warms from 1-minute candles, skips the open one, keeps only the largest window', () => {
  const w = new PriceWindow()
  const now = NOW + 30_000 // 30 s into the minute that starts at NOW
  const candles = [0, -60, -120, -180, -240, -300, -360].map((s, i) => ({ start: NOW + s * 1000, close: 99 - i })) // newest first, as Bybit sends
  w.warm(candles, now)
  w.push(now, 100)
  assert.equal(w.ago(60, now), 97) // target NOW − 30 s: the candle that ended at NOW − 60 s
  assert.equal(w.ago(300, now), 93) // target NOW − 270 s: the candle that ended at NOW − 300 s
  assert.equal(w.ago(400, now), null) // before the first close
  assert.equal(w.ago(60, NOW + 120_000), 100) // the open candle's close is not taken as the price at its end

  const b = new PriceWindow()
  const max = LIMITS.windowSec.max
  const minutes = max / 60 + 60
  for (let m = 0; m <= minutes; m++) b.push(NOW + m * 60_000, m)
  const end = NOW + minutes * 60_000
  assert.equal(b.ago(max, end), 60)
  assert.equal(b.ago(max + 600, end), null) // older than the largest window: dropped
})
