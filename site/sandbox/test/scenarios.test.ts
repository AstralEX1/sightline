// Each sandbox tab must raise its template's alert on the real engine when Play moves the price, not a skip: a template
// or engine change that breaks a tab fails here instead of on the sandbox page. The build-your-own tab is checked with its
// template added as is.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStore } from '../../../server/src/store.ts'
import { createSession } from '../../../server/src/session.ts'
import { Market } from '../src/market.ts'
import { TABS } from '../src/scenarios.ts'

for (const tab of TABS) {
  test(`${tab.title}: ${tab.template.title} · ${tab.template.sub}`, async () => {
    const m = new Market()
    await tab.before(m)
    const store = createStore(':memory:')
    store.seed([structuredClone(tab.template.draft)], 'sandbox')
    const session = createSession(m.ex, store, Date.now)
    await session.tick() // the market before it moves
    const from = m.price
    for (let i = 1; i <= 8; i++) { m.setPrice(from + ((tab.to - from) * i) / 8); await session.tick() }
    const [alert] = store.history()
    assert.ok(alert, 'no alert')
    assert.equal(alert.title, tab.template.title)
    assert.match(alert.status, /Waiting for a tap/)
    store.close()
  })
}
