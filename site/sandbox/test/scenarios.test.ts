// Each sandbox tab must raise its alert on the real engine when Play moves the price, not a skip: a template
// or engine change that breaks a tab fails here instead of on the sandbox page. Build your own runs its two watches.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStore } from '../../../server/src/store.ts'
import { createSession } from '../../../server/src/session.ts'
import { Market } from '../src/market.ts'
import { BUILD_WATCHES, TABS } from '../src/scenarios.ts'

for (const tab of TABS) {
  const name = tab.on ? `${tab.template.title} · ${tab.template.sub}` : 'price up 0.5%'
  test(`${tab.title}: ${name}`, async () => {
    const m = new Market()
    await tab.before(m)
    const store = createStore(':memory:')
    store.seed(tab.on ? [structuredClone(tab.template.draft)] : BUILD_WATCHES.map(rule => structuredClone(rule)), 'sandbox')
    const session = createSession(m.ex, store, Date.now)
    await session.tick() // the market before it moves
    const from = m.price
    for (let i = 1; i <= 8; i++) { m.setPrice(from + ((tab.to - from) * i) / 8); await session.tick() }
    const [alert] = store.history()
    assert.ok(alert, 'no alert')
    assert.equal(alert.title, tab.on ? tab.template.title : 'Price up 0.5%')
    assert.match(alert.status, tab.on ? /Waiting for a tap/ : /^Shown/)
    store.close()
  })
}
