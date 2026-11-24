import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeShortcut, parseShortcuts, shortcutLine } from '../src/shortcuts.ts'

test('parses shortcuts', () => {
  assert.deepEqual(parseShortcuts('Buy ETH! -> buy ethusdt 100\n\n  protect all->stop all  '), [
    { phrase: 'buy eth', command: 'buy', symbol: 'ETHUSDT', usd: 100 },
    { phrase: 'protect all', command: 'stop', symbol: 'ALL' },
  ])
})

test('names the line it cannot read', () => {
  assert.throws(() => parseShortcuts('buy eth'), /"buy eth"/)
  assert.throws(() => parseShortcuts('!! -> stop all'), /"!! -> stop all"/)
})

test('shortcutLine round-trips', () => {
  const text = 'buy eth -> buy ETHUSDT 100\nprotect all -> stop all'
  assert.equal(parseShortcuts(text).map(shortcutLine).join('\n'), text)
})

test('a shortcut reads back in words', () => {
  const [buy, all, sol] = parseShortcuts('buy eth -> buy ETHUSDT 100\nlock profits -> lock all\nprotect sol -> stop SOLUSDT')
  assert.equal(describeShortcut(buy), 'Say “buy eth”: buy $100 of ETH at market')
  assert.equal(describeShortcut(all), 'Say “lock profits”: stop to entry on every winner')
  assert.equal(describeShortcut(sol), 'Say “protect sol”: a stop on SOL')
})
