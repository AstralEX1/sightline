import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { build } from 'esbuild'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

const scenario = process.argv[2]
const windows = Object.assign(new EventTarget(), { setTimeout, clearTimeout, setInterval, clearInterval })
const dom = new EventTarget()
const elements = new Map()
globalThis.window = windows
globalThis.document = Object.assign(dom, {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, { dataset: {}, textContent: '', innerHTML: '' })
    return elements.get(id)
  },
  hidden: false,
})
const methodCount = {}
const status = { sn: 'HARDWARE-FIXTURE', connectType: 'connected', isWearing: true, isInCase: false }
let reportedStatus = scenario === 'recover' ? { ...status, connectType: 'disconnected' } : status
let statusReadBetweenStartupAttempts = false
const push = (method, data) => windows._listenEvenAppMessage({ type: 'listen_even_app_data', method, data })
windows.flutter_inappwebview = {
  async callHandler(name, json) {
    assert.equal(name, 'evenAppMessage')
    const { method, data } = JSON.parse(json)
    methodCount[method] = (methodCount[method] ?? 0) + 1
    switch (method) {
      case 'createStartUpPageContainer':
        assert.equal(data.textObject.filter(t => t.isEventCapture === 1).length, 1)
        if (scenario === 'recover' && methodCount[method] === 1) {
          throw new Error('synthetic transient connection failure on startup')
        }
        if (scenario === 'race' && methodCount[method] === 1) {
          await sleep(40)
          push('deviceStatusChanged', { ...status, connectType: 'connected' })
          throw new Error('synthetic startup failure after a connection event')
        }
        if (scenario === 'snapshot' && methodCount[method] === 1) {
          throw new Error('synthetic transient connection failure on startup')
        }
        return 0
      case 'getGlassesInfo':
        if ((methodCount.createStartUpPageContainer ?? 0) === 1) statusReadBetweenStartupAttempts = true
        return { model: 'g2', sn: status.sn, status: reportedStatus }
      case 'getLocalStorage':
        return ''
      case 'setLocalStorage':
      case 'rebuildPageContainer':
      case 'textContainerUpgrade':
        return true
      default:
        return null
    }
  },
}
const state = {
  positions: [], balance: null, card: null, pending: 0,
  toast: null, error: null, updatedAt: Date.now(), source: 'Paper', voice: false,
}
let stateReads = 0
globalThis.fetch = async (url) => {
  assert.match(String(url), /^\/api\/state(?:\?|$)/)
  stateReads++
  return Response.json(state)
}

const dir = await mkdtemp(join(tmpdir(), 'trade-shortcuts-g2-startup-'))
try {
  const outfile = join(dir, 'app.mjs')
  await build({
    entryPoints: [resolve('app/src/main.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    define: { 'import.meta.env': JSON.stringify({ DEV: false, MODE: 'production' }) },
    plugins: [{
      name: 'phone-dom-fixture',
      setup(b) {
        b.onResolve({ filter: /\.\/phone\/(index|settings)\.ts$/ }, a => ({ path: a.path, namespace: 'phone-fixture' }))
        b.onLoad({ filter: /.*/, namespace: 'phone-fixture' }, () => ({
          contents: 'export const startPhonePage = () => {}; export const enableGlassesTest = () => {};',
        }))
      },
    }],
  })
  await import(pathToFileURL(outfile).href)
  await sleep(1300)
  if (scenario === 'recover') {
    push('deviceStatusChanged', { ...status, connectType: 'disconnected' })
    push('deviceStatusChanged', status)
    push('evenHubEvent', { type: 'sysEvent', jsonData: { eventType: 4 } })
    await sleep(2200)
  }
  const lens = elements.get('glasses')?.textContent
  console.log(JSON.stringify({ scenario, startup: methodCount.createStartUpPageContainer ?? 0,
    rebuild: methodCount.rebuildPageContainer ?? 0, textUpdates: methodCount.textContainerUpgrade ?? 0,
    stateReads, lens }))
  if (scenario === 'recover') {
    assert.ok((methodCount.createStartUpPageContainer ?? 0) + (methodCount.rebuildPageContainer ?? 0) >= 2 && lens === 'Glasses connected',
      'Expected the native page to recover after the SDK becomes reachable again')
  } else if (scenario === 'race') {
    assert.equal(methodCount.createStartUpPageContainer, 2, 'Expected a connection event during the failed initial call to trigger one retry')
    assert.equal(statusReadBetweenStartupAttempts, false, 'Expected the connection event, not a later status query, to trigger the retry')
    assert.equal(lens, 'Glasses connected')
  } else if (scenario === 'snapshot') {
    assert.equal(methodCount.createStartUpPageContainer, 2, 'Expected the connected current status to trigger one retry')
    assert.equal(statusReadBetweenStartupAttempts, true)
    assert.equal(lens, 'Glasses connected')
  } else {
    assert.equal(lens, 'Glasses connected')
    assert.ok(stateReads >= 1)
  }
} finally {
  await rm(dir, { recursive: true, force: true })
}
process.exit(0)
