import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve, type Market } from '../src/proposals.ts'
import type { Action } from '../src/registry.ts'

const market: Market = {
  ticker: { last: 100, mark: 100, index: 100 },
  instrument: { tickSize: '0.1', qtyStep: '0.001', minOrderQty: 0.001, maxMktOrderQty: 100, minNotionalValue: 5 },
  orders: [], positions: [], balance: { equity: 10_000, available: 8_000 }, slots: [{ positionIdx: 0, leverage: 10, size: 0 }],
}
const sym = { key: 'sym:SOLUSDT', symbol: 'SOLUSDT', label: 'SOL' }
const open = (o: Partial<Extract<Action, { type: 'OPEN_POSITION' }>>): Action => ({ type: 'OPEN_POSITION', side: 'SHORT', notionalUsdt: '100', leverage: '10', ...o })

test('a short take profit at or past zero is skipped, never a card that says tp 0', () => {
  for (const percent of ['100', '150']) {
    const r = resolve(open({ tp: { kind: 'ENTRY_OFFSET', percent } }), sym, market)
    assert.deepEqual(r.ok ? r : [r.code], ['past_price'], percent)
  }
  const ok = resolve(open({ tp: { kind: 'ENTRY_OFFSET', percent: '50' } }), sym, market)
  assert.ok(ok.ok && ok.terms.type === 'order' && ok.terms.takeProfit === 50)
})

test('a long stop at or under zero is skipped', () => {
  const r = resolve(open({ side: 'LONG', sl: { kind: 'ENTRY_OFFSET', percent: '-100' } }), sym, market)
  assert.equal(!r.ok && r.code, 'past_price')
})
