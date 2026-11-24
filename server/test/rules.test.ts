import { test } from 'node:test'
import assert from 'node:assert/strict'
import { liqDistancePct, matchShortcut, normalizePhrase } from '../src/rules.ts'

test('matchShortcut takes the longest whole-word phrase', () => {
  const list = [{ voicePhrase: 'protect' }, { voicePhrase: 'protect all' }, {}, { voicePhrase: 'buy eth' }]
  assert.equal(matchShortcut('Please, PROTECT ALL now', list)?.voicePhrase, 'protect all')
  assert.equal(matchShortcut('protection', list), null) // whole words only
  assert.equal(matchShortcut('buy ethereum', list), null)
})

test('normalizePhrase keeps lowercase words and digits', () => {
  assert.equal(normalizePhrase('  Buy  ETH-2!! '), 'buy eth 2')
})

test('liquidation distance is Infinity without a liquidation price', () => {
  const p = { liqPrice: 0, markPrice: 100 } as Parameters<typeof liqDistancePct>[0]
  assert.equal(liqDistancePct(p), Infinity)
  assert.equal(liqDistancePct({ ...p, liqPrice: 95 }), 5)
})
