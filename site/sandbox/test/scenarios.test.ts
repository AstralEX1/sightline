// Every template's sandbox scenario must raise its own alert on the real engine, not a skip: a template or engine change
// that breaks a scenario fails here instead of on the sandbox page.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStore } from '../../../server/src/store.ts'
import { createSession } from '../../../server/src/session.ts'
import { Market } from '../src/market.ts'
import { draftOf, SCENARIOS } from '../src/scenarios.ts'

for (const s of SCENARIOS) {
  test(`${s.id} ${s.title} · ${s.sub}`, async () => {
    const m = new Market()
    await s.before(m)
    const store = createStore(':memory:')
    store.seed([draftOf(s, m)], 'sandbox')
    const session = createSession(m.ex, store, Date.now)
    await session.tick() // the market before it moves
    if (s.to) {
      const from = m.price
      const to = s.to(m)
      for (let i = 1; i <= 8; i++) { m.setPrice(from + ((to - from) * i) / 8); await session.tick() }
    }
    await session.tick()
    const [alert] = store.history()
    assert.ok(alert, 'no alert')
    assert.equal(alert.title, s.title)
    assert.doesNotMatch(alert.status, /Skipped/)
    store.close()
  })
}
