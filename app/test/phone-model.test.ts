import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalog, type Condition } from '../../server/src/registry.ts'
import {
  actionChoices, conditionChoices, emptyDraft, fitTrigger, leaveDecision, numField, scopeChoices, setCompare, setMetric, triggerChoices, type Draft,
} from '../src/phone/model.ts'

const cat = catalog()
const roi30: Condition = { id: 'c1', type: 'PROFIT', unit: 'ROI_PERCENT', threshold: '30' }
const liq5: Condition = { id: 'c2', type: 'NEAR_LIQUIDATION', distancePct: '5' }
const draft = (over: Partial<Draft>): Draft => ({ ...emptyDraft(), ...over })

test('save or discard on back (spec §7.1, P05, P13)', () => {
  assert.equal(leaveDecision(false, false), 'leave') // + then back at once: nothing is created
  assert.equal(leaveDecision(true, true), 'save')
  assert.equal(leaveDecision(true, false), 'ask')
  assert.equal(leaveDecision(false, true), 'leave')
})

test('ROI above ↔ below drops the old value (P08, arch §4)', () => {
  const below = setCompare(roi30, 'below')
  assert.deepEqual(below, { id: 'c1', type: 'LOSS', unit: 'ROI_PERCENT', threshold: '' })
  assert.equal(setCompare(roi30, 'above'), roi30) // same word: untouched
})

test('a new metric or unit clears the number, the same one keeps it (P08)', () => {
  assert.deepEqual(setMetric(roi30, 'PRICE_CHANGE'), { id: 'c1', type: 'PRICE_CHANGE', source: 'LAST', direction: 'UP', percent: '', windowSec: 300 })
  assert.deepEqual(setMetric(roi30, 'PROFIT', 'USDT'), { id: 'c1', type: 'PROFIT', unit: 'USDT', threshold: '' })
  assert.equal(setMetric(roi30, 'PROFIT', 'ROI_PERCENT'), roi30)
  const price: Condition = { id: 'c3', type: 'PRICE', source: 'LAST', operator: 'GTE', threshold: '90000' }
  assert.equal((setCompare(price, 'crosses above') as { threshold: string }).threshold, '90000') // same unit: the level stays
})

test('condition sheet offers only what fits the scope, the action and the other rows (spec §7.3)', () => {
  const types = (d: Draft, replacing?: string) => conditionChoices(cat, d, replacing).map(c => c.label)
  // All positions has no absolute price, nor order events
  assert.ok(!types(draft({})).includes('Price'))
  assert.ok(!types(draft({})).includes('Order filled'))
  // Increase Position is N with liquidation distance
  assert.ok(!types(draft({ action: { type: 'INCREASE_POSITION', notionalUsdt: '100' } })).includes('Liquidation distance'))
  // Profit and Loss stay offered (O, not -): validate marks the AND (P14)
  assert.ok(types(draft({ conditions: { logic: 'ALL', items: [roi30] } })).includes('Loss in USDT'))
  // One order: order events, never position metrics next to them (-)
  const order = draft({ scope: { type: 'ORDER', symbol: 'BTCUSDT', orderId: 'o1' }, conditions: { logic: 'ALL', items: [{ id: 'c1', type: 'ORDER_FILLED' }] } })
  assert.deepEqual(types(order), ['Price', 'Price change', 'Order filled', 'Order partly filled'])
  // the row being replaced does not count against itself
  assert.ok(types(order, 'c1').includes('Order partly filled'))
})

test('action sheet: forbidden by scope hidden, ruled out by a condition under Needs changes (P13, P15)', () => {
  const { ok, needs } = actionChoices(cat, draft({ conditions: { logic: 'ANY', items: [roi30, liq5] } }))
  assert.ok(!ok.some(a => a.type === 'OPEN_POSITION') && !needs.some(a => a.type === 'OPEN_POSITION'))
  assert.deepEqual(needs.find(a => a.type === 'INCREASE_POSITION'), { type: 'INCREASE_POSITION', title: 'Increase Position', reason: 'Not with liquidation distance' })
  assert.ok(ok.some(a => a.type === 'CLOSE_POSITION'))
  const symbol = actionChoices(cat, draft({ scope: { type: 'SYMBOL', symbol: 'BTCUSDT' } }))
  assert.deepEqual(symbol.ok.map(a => a.type), ['OPEN_POSITION', 'NOTIFY'])
})

test('Apply to hides scopes that cannot hold the action (P15)', () => {
  const open = draft({ action: { type: 'OPEN_POSITION', side: 'LONG', notionalUsdt: '100', leverage: '10' } })
  assert.deepEqual(scopeChoices(cat, open).map(s => s.type), ['SYMBOL'])
  assert.deepEqual(scopeChoices(cat, draft({ action: { type: 'CANCEL_ORDER' } })).map(s => s.type), ['ORDER', 'ALL_ORDERS'])
  assert.equal(scopeChoices(cat, draft({})).length, 5)
})

test('Options: Increase Position fires Once only; crossings fire on event (P16)', () => {
  const inc = draft({ conditions: { logic: 'ALL', items: [roi30] }, action: { type: 'INCREASE_POSITION', notionalUsdt: '100' } })
  assert.deepEqual(triggerChoices(inc).filter(c => !c.why).map(c => c.mode), ['ONCE'])
  fitTrigger(inc)
  assert.deepEqual(inc.trigger, { mode: 'ONCE' })
  const cross = draft({ scope: { type: 'SYMBOL', symbol: 'BTCUSDT' }, conditions: { logic: 'ALL', items: [{ id: 'c1', type: 'PRICE', source: 'LAST', operator: 'UP_CROSS', threshold: '1' }] } })
  assert.deepEqual(triggerChoices(cross).filter(c => !c.why).map(c => c.mode), ['ON_EVENT', 'ONCE'])
  fitTrigger(cross)
  assert.equal(cross.trigger.mode, 'ON_EVENT')
})

test('numeric sheet bounds come from the catalog', () => {
  const d = draft({ conditions: { logic: 'ALL', items: [roi30, liq5] }, action: { type: 'CLOSE_POSITION', percent: '50' } })
  assert.deepEqual(numField(cat, d, 'distance', 'c2')?.range, { gt: 0, le: 100 })
  assert.equal(numField(cat, d, 'threshold', 'c1')?.value, '30')
  assert.deepEqual(numField(cat, d, 'close')?.range, { gt: 0, le: 100 })
})
