import { test } from 'node:test'
import assert from 'node:assert/strict'
import { screen } from '../../../app/src/view.ts'
import { createStore } from '../../../server/src/store.ts'
import { createSession } from '../../../server/src/session.ts'
import { Market } from '../src/market.ts'
import { openScenarioPosition, scenarioDrafts, TABS } from '../src/scenarios.ts'

test('three guided scenarios come before the independent Free sandbox', () => {
  assert.deepEqual(TABS.map(tab => tab.id), ['btc', 'liquidation', 'profit', 'sandbox'])
  assert.equal(TABS.at(-1)?.target, null)
  assert.ok(scenarioDrafts(TABS.at(-1)!).some(rule => rule.voicePhrase === 'close all'))
})

for (const tab of TABS) {
  test(`${tab.title}: the real rule reaches the glasses at the target price`, async () => {
    const target = tab.target ?? TABS[1].target!
    const market = new Market()
    await openScenarioPosition(tab, market)
    const store = createStore(':memory:')
    try {
      store.seed(scenarioDrafts(tab), 'sandbox')
      if (tab.target !== null) assert.equal(store.listShortcuts().filter(rule => rule.enabled).length, 1)
      const session = createSession(market.ex, store, Date.now)
      await session.tick()
      const from = market.price
      for (let i = 1; i <= 8; i++) {
        market.setPrice(from + (target - from) * i / 8)
        await session.tick()
      }
      const [alert] = store.history()
      assert.ok(alert)
      assert.deepEqual(alert.channels, ['glasses'])
      if (tab.draft.action.type === 'NOTIFY') {
        assert.equal(alert.status, 'Shown on Even G2')
        assert.equal(session.state().toast, 'Notify · BTC · price up 10.0%')
        assert.equal(session.state().card, null)
        assert.equal(screen(session.state()).toastAlertId, alert.id)
        assert.equal(screen(session.state(), { quiet: true }).toastAlertId, alert.id)
        assert.equal(screen(session.state(), { voice: 'Microphone open' }).toastAlertId, undefined)
      } else {
        assert.match(alert.status, /Waiting for a tap/)
        assert.equal(session.state().card?.alertId, alert.id)
      }
    } finally {
      store.close()
    }
  })
}
