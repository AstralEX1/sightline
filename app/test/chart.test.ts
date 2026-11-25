import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chartRange, spread } from '../src/icons.ts'

test('chartRange: entry and stop are always on the scale; a far liq is not', () => {
  const r = chartRange([100, 102, 101], { entry: 103, stop: 95, tp: 0, liq: 60 })
  assert.ok(r.lo < 95 && r.lo > 60 && r.hi > 103)
})

test('chartRange: a liq within 1% of the last price joins the scale', () => {
  assert.ok(chartRange([102, 101], { entry: 0, stop: 0, tp: 0, liq: 100.2 }).lo < 100.2)
})

test('chartRange: a flat hour still has a span', () => {
  const r = chartRange([100, 100], { entry: 0, stop: 0, tp: 0, liq: 0 })
  assert.ok(r.hi > 100 && r.lo < 100)
})

test('spread: labels closer than the gap are pushed apart and kept inside', () => {
  assert.deepEqual(spread([10, 12, 100], 14, 120), [10, 24, 100])
  assert.deepEqual(spread([115, 118], 14, 120), [99, 113])
  assert.deepEqual(spread([0], 14, 120), [7])
})
