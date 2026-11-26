import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createNotifier } from '../src/notify.ts'
import { DEFAULT_SETTINGS, type AlertRecord, type Settings } from '../src/types.ts'

function setup(notifications: Settings['notifications'] = DEFAULT_SETTINGS.notifications) {
  const clock = { now: 1_000_000 }
  const store = { settings: () => ({ ...DEFAULT_SETTINGS, notifications }) }
  return { n: createNotifier({ store, clock: () => clock.now }), clock }
}

const alert = (o: Partial<AlertRecord> = {}): AlertRecord => ({
  id: 'a1', shortcutId: 's1', version: 1, targetKey: 'pos:BTCUSDT:0:1', target: 'BTCUSDT long', title: 'Close position',
  reason: 'liquidation distance 3.2%', matched: ['c1'], priority: 'CRITICAL', simulated: false,
  delivery: { glasses: true, phone: true }, channels: [], status: '', createdAt: 0, ...o,
})

test('glasses and app receive alerts while their clients are active', () => {
  const { n, clock } = setup()
  assert.deepEqual(n.route(alert()), [])
  n.seen('lens')
  assert.deepEqual(n.route(alert()), ['glasses'])
  n.seen('app')
  clock.now += 9_000
  assert.deepEqual(n.route(alert()), ['glasses', 'app'])
  clock.now += 1_000
  assert.deepEqual(n.route(alert()), [])
})

test('per-shortcut delivery and Settings switches each control their channel', () => {
  const { n } = setup()
  n.seen('lens')
  n.seen('app')
  assert.deepEqual(n.route(alert({ delivery: { glasses: true, phone: false } })), ['glasses'])
  assert.deepEqual(n.route(alert({ delivery: { glasses: false, phone: true } })), ['app'])

  const glassesOff = setup({ glasses: false, app: true }).n
  glassesOff.seen('lens')
  glassesOff.seen('app')
  assert.deepEqual(glassesOff.route(alert()), ['app'])

  const appOff = setup({ glasses: true, app: false }).n
  appOff.seen('lens')
  appOff.seen('app')
  assert.deepEqual(appOff.route(alert()), ['glasses'])
})
