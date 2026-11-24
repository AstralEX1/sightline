import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStorage } from '../src/storage.ts'

const fakeBridge = (data: Record<string, string> = {}) => ({
  data,
  getLocalStorage: async (k: string) => data[k] ?? '',
  setLocalStorage: async (k: string, v: string) => { data[k] = v; return true },
})
const fakeBrowser = (data: Record<string, string> = {}) => ({
  data,
  getItem: (k: string) => data[k] ?? null,
  setItem: (k: string, v: string) => { data[k] = v },
})

test('reads what the bridge kept, synchronously once loaded', async () => {
  const s = createStorage(['a', 'b'], null)
  await s.load(fakeBridge({ a: '1', b: '2' }))
  assert.equal(s.get('a'), '1')
  assert.equal(s.get('b'), '2')
})

test('the bridge wins over a stale browser value; the browser fills in what the bridge lacks', async () => {
  const s = createStorage(['a', 'b'], fakeBrowser({ a: 'old', b: 'dev' }))
  await s.load(fakeBridge({ a: 'new' }))
  assert.equal(s.get('a'), 'new')
  assert.equal(s.get('b'), 'dev')
})

test('writes through to the bridge and the browser, and an empty string clears', async () => {
  const bridge = fakeBridge({ a: '1' })
  const browser = fakeBrowser({ a: '1' })
  const s = createStorage(['a'], browser)
  await s.load(bridge)
  s.set('a', '')
  assert.equal(s.get('a'), '')
  assert.equal(bridge.data.a, '')
  assert.equal(browser.data.a, '')
  s.set('a', 'x')
  assert.equal(s.get('a'), 'x')
  assert.equal(bridge.data.a, 'x')
})

test('a failing bridge or a blocked browser never throws', async () => {
  const broken = { getLocalStorage: async () => { throw new Error('bridge') }, setLocalStorage: async () => { throw new Error('bridge') } }
  const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  const s = createStorage(['a'], blocked)
  await s.load(broken)
  assert.equal(s.get('a'), '')
  s.set('a', 'x')
  assert.equal(s.get('a'), 'x') // the cache still holds it
  await new Promise(r => setImmediate(r)) // an unhandled rejection from set() would fail the run here
})

test('before load it falls back to the browser alone', () => {
  const s = createStorage(['a'], fakeBrowser({ a: 'dev' }))
  assert.equal(s.get('a'), 'dev')
  s.set('a', 'y') // no bridge yet: nothing to write through to
  assert.equal(s.get('a'), 'y')
})
