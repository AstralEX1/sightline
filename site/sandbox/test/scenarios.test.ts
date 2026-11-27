// Each sandbox tab must raise its alert on the real engine when Play moves the price, not a skip: a template
// or engine change that breaks a tab fails here instead of on the sandbox page. Build your own runs its two watches.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStore } from '../../../server/src/store.ts'
import { createSession } from '../../../server/src/session.ts'
import { Market } from '../src/market.ts'
import { BUILD_WATCHES, TABS, scenarioPhase } from '../src/scenarios.ts'

test('Take half uses a glasses gesture instead of voice confirmation', () => {
  const tab = TABS.find(item => item.id === 'half')!
  assert.equal('voice' in tab, false)
  assert.match(tab.steps[2], /Down.*Click/)
  assert.doesNotMatch(tab.steps.join(' '), /say|spoken|voice|microphone/i)
})

for (const tab of TABS) {
  const name = tab.on ? `${tab.template.title} · ${tab.template.sub}` : 'price up 0.5%'
  test(`${tab.title}: ${name}`, async () => {
    const m = new Market()
    await tab.before(m)
    const store = createStore(':memory:')
    store.seed(tab.on ? [structuredClone(tab.template.draft)] : BUILD_WATCHES.map(rule => structuredClone(rule)), 'sandbox')
    const session = createSession(m.ex, store, Date.now)
    await session.tick() // the market before it moves
    assert.equal(store.history().length, 0, 'no alert before the price move')
    const from = m.price
    for (let i = 1; i <= 8; i++) { m.setPrice(from + ((tab.to - from) * i) / 8); await session.tick() }
    const [alert] = store.history()
    assert.ok(alert, 'no alert')
    assert.equal(alert.title, tab.on ? tab.template.title : 'Price up 0.5%')
    assert.match(alert.status, /Waiting for a tap/)
    if (!tab.on || tab.template.draft.action.type === 'NOTIFY') {
      const card = session.state().card
      assert.equal(card?.terms.type, 'notify')
      assert.equal(scenarioPhase(true, alert.status), 'answer')
      assert.deepEqual(session.dismiss(card!.id, 'glasses'), { ok: true, message: 'OK' })
      assert.equal(scenarioPhase(true, store.history()[0].status), 'done')
    }
    store.close()
  })
}

test('a 5% BTC rise on normal closed volume stays quiet', async () => {
  const tab = TABS.find(t => t.id === 'volume')!
  const m = new Market()
  const store = createStore(':memory:')
  try {
    store.seed([structuredClone(tab.template.draft)], 'sandbox')
    const session = createSession(m.ex, store, Date.now)
    await session.tick()
    m.setPrice(tab.to)
    await session.tick()
    assert.equal(store.history().length, 0)
  } finally {
    store.close()
  }
})
