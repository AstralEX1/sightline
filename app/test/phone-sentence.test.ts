import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TEMPLATES, type Condition } from '../../server/src/registry.ts'
import { actionParts, conditionParts, fmt, optionsSummary, parseDec, tileSub, type Part } from '../src/phone/sentence.ts'

/** Tokens in [brackets], plain words as they are: the sentence as a reader sees it. */
const read = (parts: Part[]) => parts.map(p => (typeof p === 'string' ? p : `[${p.text}]`)).join(' ')
type NoId<T> = T extends unknown ? Omit<T, 'id'> : never
const c = (x: NoId<Condition>) => ({ id: 'c1', ...x }) as Condition

test('condition sentences read as drawn', () => {
  assert.equal(read(conditionParts(c({ type: 'PROFIT', unit: 'ROI_PERCENT', threshold: '30' }))), '[ROI] is [above] [30%]')
  assert.equal(read(conditionParts(c({ type: 'LOSS', unit: 'ROI_PERCENT', threshold: '20' }))), '[ROI] is [below] [−20%]')
  assert.equal(read(conditionParts(c({ type: 'PRICE_CHANGE', source: 'LAST', direction: 'UP', percent: '5', windowSec: 300 }))), '[price change] [rises] by [5%] within [5 min]')
  assert.equal(read(conditionParts(c({ type: 'PRICE', source: 'LAST', operator: 'UP_CROSS', threshold: '90000' }))), '[price] [crosses above] [90,000 USDT]')
  assert.equal(read(conditionParts(c({ type: 'PRICE', source: 'LAST', operator: 'GTE', threshold: '90000' }))), '[price] is [above] [90,000 USDT]')
  assert.equal(read(conditionParts(c({ type: 'NEAR_LIQUIDATION', distancePct: '5' }))), '[liquidation distance] is below [5%]')
  assert.equal(read(conditionParts(c({ type: 'SL_MISSING' }))), '[stop loss is missing]')
  assert.equal(read(conditionParts(c({ type: 'ORDER_PARTIAL' }))), '[order] is [partly filled]')
})

test('action sentences read as drawn', () => {
  assert.equal(read(actionParts({ type: 'MOVE_SL', target: { kind: 'ENTRY_OFFSET', percent: '0' } })), '[move stop loss] to [entry price]')
  assert.equal(read(actionParts({ type: 'SET_SL', target: { kind: 'ENTRY_OFFSET', percent: '-2' } })), '[set stop loss] to [2% adverse from entry]')
  assert.equal(read(actionParts({ type: 'CLOSE_POSITION', percent: '50' })), '[close position] by [50%]')
  assert.equal(read(actionParts({ type: 'INCREASE_POSITION', notionalUsdt: '100' })), '[increase position] by [100 USDT]')
  assert.equal(read(actionParts({ type: 'NOTIFY' })), '[notify]')
})

test('a token says its field, value and edit to a screen reader (P23)', () => {
  const [, , , roi] = conditionParts(c({ type: 'PROFIT', unit: 'ROI_PERCENT', threshold: '30' }))
  assert.equal(typeof roi !== 'string' && roi.aria, 'ROI threshold, 30 percent, edit')
  const above = conditionParts(c({ type: 'PROFIT', unit: 'ROI_PERCENT', threshold: '30' }))[2]
  assert.equal(typeof above !== 'string' && above.aria, undefined) // its text is its label
})

test('a template value still to enter is a placeholder token (P04)', () => {
  const t10 = TEMPLATES[9].draft
  const level = conditionParts(t10.conditions.items[0]).at(-1)!
  assert.deepEqual(level, { key: 'threshold', text: 'set price', aria: 'Price level, not set, edit', empty: true })
})

test('numbers: thousands, minus sign, decimals as typed', () => {
  assert.equal(fmt('90000'), '90,000')
  assert.equal(fmt('-2.5'), '−2.5')
  assert.equal(fmt('1234567.125'), '1,234,567.125')
  assert.equal(parseDec(' 30.50 '), '30.5')
  assert.equal(parseDec('30.'), '30')
  assert.equal(parseDec('007'), '7')
  assert.equal(parseDec('0,25'), '0.25')
  assert.equal(parseDec('1e3'), null)
  assert.equal(parseDec(''), null)
})

test('tile subtitle and Options summary', () => {
  assert.equal(tileSub({ enabled: false, summary: 'ROI > 30%' }), 'Off · ROI > 30%')
  assert.equal(tileSub({ enabled: true, summary: 'Say "protect all"' }), 'Say "protect all"')
  assert.equal(optionsSummary({ trigger: { mode: 'ON_ENTRY' }, delivery: { glasses: true, phone: true } }), 'On entry · Glasses + phone')
  assert.equal(optionsSummary({ trigger: { mode: 'REPEAT', intervalSec: 300 }, delivery: { glasses: true, phone: false }, voicePhrase: 'protect all' }), 'Every 5 min · Glasses · Voice')
})
