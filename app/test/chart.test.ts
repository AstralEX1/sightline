import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chartRange, spread } from '../src/icons.ts'
import { price } from '../../server/src/format.ts'

const none = { entry: 0, stop: 0, tp: 0, liq: 0 }

test('chartRange: entry and stop near the hour stretch the scale to take them', () => {
  const r = chartRange([100, 102, 101], { ...none, entry: 103, stop: 98 })
  assert.ok(r.lo < 98 && r.hi > 103)
  assert.deepEqual(r.pinned, [])
})

test('chartRange: a stop more than 1.5 hour-ranges away is pinned, so the hour keeps its height', () => {
  const r = chartRange([100, 102, 101], { ...none, entry: 101, stop: 90 })
  assert.deepEqual(r.pinned, ['stop'])
  assert.ok(r.lo > 99 && r.lo < 100 && r.hi < 103)
})

test('chartRange: liq only within 1% of the last price; a far one is neither on the scale nor pinned', () => {
  assert.ok(chartRange([102, 101], { ...none, liq: 100.2 }).lo < 100.2)
  assert.deepEqual(chartRange([102, 101], { ...none, liq: 60 }).pinned, [])
})

test('chartRange: a flat hour still has a span', () => {
  const r = chartRange([100, 100], none)
  assert.ok(r.hi > 100 && r.lo < 100)
})

test('spread: labels closer than the gap are pushed apart and kept inside', () => {
  assert.deepEqual(spread([10, 12, 100], 14, 120), [7, 21, 100])
  assert.deepEqual(spread([60, 60, 60], 10, 120), [50, 60, 70]) // a pile stays centred on its lines
  assert.deepEqual(spread([115, 118], 14, 120), [99, 113])
  assert.deepEqual(spread([0], 14, 120), [7])
})

test('chartRange: a level within 1% is drawn even when the hour is narrow', () => {
  assert.deepEqual(chartRange([999.9, 999.95], { ...none, liq: 1005, stop: 1000.1 }).pinned, [])
})

test('price: small coins keep 4 significant digits instead of rounding to 0.0000', () => {
  assert.deepEqual([price(0.5), price(0.01234567), price(0.00001234), price(1.5), price(61960)], ['0.5000', '0.01235', '0.00001234', '1.50', '61,960'])
})
