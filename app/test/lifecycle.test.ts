import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OsEventTypeList as E } from '@evenrealities/even_hub_sdk'
import { createDedupe, exitStep } from '../src/lifecycle.ts'

test('outside the exit dialogue the events mean what they say', () => {
  assert.deepEqual(exitStep('none', E.FOREGROUND_ENTER_EVENT), { next: 'none', act: 'resume' }) // the contextual menu opening sends it: no rebuild under the menu
  assert.deepEqual(exitStep('none', E.FOREGROUND_EXIT_EVENT), { next: 'none', act: 'pass' })
  assert.deepEqual(exitStep('none', E.SYSTEM_EXIT_EVENT), { next: 'none', act: 'quit' })
})

test('the dialogue: ENTER is it appearing (no rebuild), EXIT is No (rebuild), SYSTEM_EXIT is Yes', () => {
  assert.deepEqual(exitStep('asked', E.FOREGROUND_ENTER_EVENT), { next: 'open', act: 'ignore' })
  assert.deepEqual(exitStep('open', E.FOREGROUND_EXIT_EVENT), { next: 'none', act: 'show' })
  assert.deepEqual(exitStep('open', E.SYSTEM_EXIT_EVENT), { next: 'none', act: 'quit' })
  assert.deepEqual(exitStep('asked', E.SYSTEM_EXIT_EVENT), { next: 'none', act: 'quit' })
})

test('a lost EXIT heals: the next ENTER is a real return', () => {
  assert.deepEqual(exitStep('open', E.FOREGROUND_ENTER_EVENT), { next: 'none', act: 'show' })
})

test('an EXIT before the dialogue showed is a real background, not a No', () => {
  assert.deepEqual(exitStep('asked', E.FOREGROUND_EXIT_EVENT), { next: 'asked', act: 'pass' })
})

test('dedupe drops a repeat inside the window, per type, and a repeat does not extend it', () => {
  const dup = createDedupe(600)
  assert.equal(dup(4, 1000), false)
  assert.equal(dup(4, 1080), true)
  assert.equal(dup(5, 1090), false) // another type
  assert.equal(dup(4, 1500), true) // 500 ms after the first pass
  assert.equal(dup(4, 1700), false) // 700 ms after the first pass: through again
})
