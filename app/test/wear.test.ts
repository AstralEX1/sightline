import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WearTracker, type GlassesStatus } from '../src/wear.ts'

const worn: GlassesStatus = { connectType: 'connected', isWearing: true, isInCase: false }
const off: GlassesStatus = { connectType: 'connected', isWearing: false, isInCase: false }
const after = (...ss: GlassesStatus[]) => { const t = new WearTracker(); for (const s of ss) t.update(s); return t.inUse }

test('wear: in use until told otherwise; off once worn glasses come off, back when put on', () => {
  assert.equal(new WearTracker().inUse, true)
  assert.equal(after(worn, off), false)
  assert.equal(after(worn, off, worn), true)
})

test('wear: isWearing false is not believed before a true, since the SDK defaults it', () => {
  assert.equal(after(off, off), true)
})

test('wear: in the case or not connected is out of use', () => {
  assert.equal(after({ ...off, isInCase: true }), false)
  for (const connectType of ['connecting', 'disconnected', 'connectionFailed']) assert.equal(after({ ...worn, connectType }), false, connectType)
})

test('wear: a status without a connection says nothing', () => {
  assert.equal(after(worn, off, { connectType: 'none', isWearing: true }), false)
  assert.equal(after(worn, {}), true)
})
