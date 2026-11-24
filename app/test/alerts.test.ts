import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alertLine, describeAlert, parseAlerts } from '../src/alerts.ts'

test('parses alerts with and without an order', () => {
  assert.deepEqual(parseAlerts('btcusdt above 60000 buy 200\n\n  ETHUSDT below 3000.5  '), [
    { id: 'BTCUSDT-above-60000', symbol: 'BTCUSDT', when: 'above', price: 60000, side: 'Buy', orderUsd: 200 },
    { id: 'ETHUSDT-below-3000.5', symbol: 'ETHUSDT', when: 'below', price: 3000.5 },
  ])
})

test('names the line it cannot read', () => {
  assert.throws(() => parseAlerts('BTCUSDT sideways 1'), /BTCUSDT sideways 1/)
})

test('alertLine round-trips', () => {
  const text = 'BTCUSDT above 60000 buy 200\nETHUSDT below 3000'
  assert.equal(parseAlerts(text).map(alertLine).join('\n'), text)
})

test('an alert reads back in words', () => {
  const [buy, note] = parseAlerts('BTCUSDT above 60000 buy 200\nETHUSDT below 3000')
  assert.equal(describeAlert(buy), 'When BTC goes above 60,000: offer to buy $200 at market')
  assert.equal(describeAlert(note), 'When ETH goes below 3,000: let me know')
})
