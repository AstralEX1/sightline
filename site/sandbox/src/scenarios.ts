/**
 * One scenario per Template: set the market up, switch on that template's shortcut, then move the price until it
 * fires. Numbers come from the template itself (registry.ts), so the alert on the lens is the one the app would raise.
 */
import { TEMPLATES, type Draft, type Template } from '../../../server/src/registry.ts'
import { liqOf, START_PRICE as P, SYMBOL, type Market } from './market.ts'

const QTY = 0.05 // 4,800 USDT at 96,000; 480 USDT margin at 10×
const LEV = 10
const MIN = 60_000

type Setup = {
  /** Positions, orders and exchange facts before the shortcut starts. */
  before(m: Market): Promise<void> | void
  /** Where the price goes to fire the shortcut; none when the setup alone fires it. */
  to?: (m: Market) => number
  /** What the visitor watches for, in a few words. */
  watch: string
}

const long = (tp = 0, sl = 0) => (m: Market) => m.open('Buy', QTY, LEV, tp, sl)
const liq = liqOf('Buy', P, LEV)

const SETUPS: Record<string, Setup> = {
  tpl_1: { before: long(0, P * 0.98), to: () => P * 1.024, watch: 'BTC rallies to +24% ROI' }, // a stop to move
  tpl_2: { before: long(), to: () => P * 1.054, watch: 'BTC rallies to +54% ROI' },
  tpl_3: { before: long(), to: () => P + 2300, watch: 'Profit passes 100 USDT' },
  tpl_4: { before: long(P * 1.03), to: () => P * 1.03 * 0.997, watch: 'Price runs up to the take profit' },
  tpl_5: { before: long(), to: () => P * 0.966, watch: 'BTC drops to −34% ROI' },
  tpl_6: { before: long(), to: () => liq * 1.025, watch: 'Price slides towards liquidation' },
  tpl_7: { before: long(), to: () => liq * 1.045, watch: 'Price slides towards liquidation' },
  tpl_8: { before: long(), watch: 'A long opens without a stop loss' },
  tpl_9: { before: long(0, P * 0.98), to: () => P * 0.98 * 1.003, watch: 'Price sinks to the stop loss' },
  tpl_16: { before: long(), to: () => P - 1200, watch: 'Loss passes 50 USDT' },
  tpl_17: { before: long(0, P * 0.99), to: () => P * 0.985, watch: 'Price breaks the stop loss' },
  tpl_18: { before: long(P * 1.01), to: () => P * 1.015, watch: 'Price reaches the take profit' },
  tpl_19: { before: long(), to: () => liq * 0.995, watch: 'Price crashes through liquidation' },
  tpl_20: {
    before: async m => { await long()(m); m.ex.funding[SYMBOL] = { ratePct: 0.06, at: Date.now() + 20 * MIN } },
    watch: 'Longs pay 0.06% funding in 20 min',
  },
  tpl_21: {
    before: async m => { await long()(m); m.ex.funding[SYMBOL] = { ratePct: 0.12, at: Date.now() + 8 * MIN } },
    watch: 'Longs pay 0.12% funding in 8 min',
  },
  tpl_22: { before: m => m.spikeVolume(4), to: () => P * 1.006, watch: 'BTC trades 4× its usual volume' },
  // in profit first: the spike fires on the first poll, and a stop moved to entry must stay below the price
  tpl_23: { before: async m => { await long(0, P * 0.98)(m); m.setPrice(P * 1.01); m.spikeVolume(6) }, watch: 'BTC trades 6× its usual volume' },
  tpl_10: { before: () => {}, to: () => P * 1.014, watch: 'Price crosses 96,960' },
  tpl_11: { before: () => {}, to: () => P * 0.974, watch: 'BTC falls 2.6% in a minute' },
  tpl_12: { before: () => {}, to: () => P * 1.026, watch: 'BTC rises 2.6% in a minute' },
  tpl_13: { before: m => { m.ex.leverage[SYMBOL] = 5 }, to: () => P * 1.014, watch: 'Price crosses 96,960' }, // the template opens at 5×
  tpl_14: { before: m => { m.limit('Buy', QTY, P * 0.99) }, to: () => P * 0.988, watch: 'Price dips into the buy limit' },
  tpl_15: { before: m => { m.partial.add(m.limit('Buy', QTY * 2, P * 0.99).orderId) }, to: () => P * 0.988, watch: 'Half the buy limit fills' },
  tpl_24: { before: m => { m.limit('Buy', QTY, P * 0.97, Date.now() - 61 * MIN) }, watch: 'A buy limit has waited 61 min' },
  tpl_25: { before: m => { m.limit('Buy', QTY, P * 0.97, Date.now() - 16 * MIN) }, watch: 'A buy limit has waited 16 min' },
}

export type Scenario = Template & Setup & { group: string }

const GROUPS: [string, string[]][] = [
  ['Profit', ['tpl_1', 'tpl_2', 'tpl_3', 'tpl_4']],
  ['Risk', ['tpl_5', 'tpl_6', 'tpl_7', 'tpl_8', 'tpl_9', 'tpl_16']],
  ['Closed by the exchange', ['tpl_17', 'tpl_18', 'tpl_19']],
  ['Funding', ['tpl_20', 'tpl_21']],
  ['Market', ['tpl_22', 'tpl_23', 'tpl_10', 'tpl_11', 'tpl_12', 'tpl_13']],
  ['Orders', ['tpl_14', 'tpl_15', 'tpl_24', 'tpl_25']],
]

export const SCENARIOS: Scenario[] = GROUPS.flatMap(([group, ids]) => ids.map(id => {
  const t = TEMPLATES.find(x => x.id === id)
  if (!t || !SETUPS[id]) throw new Error(`No scenario for ${id}`)
  return { ...t, ...SETUPS[id], group }
}))

// Every template has its scenario: a template added to the registry must get one here.
const missing = TEMPLATES.filter(t => !SETUPS[t.id]).map(t => t.id)
if (missing.length) throw new Error(`Templates without a scenario: ${missing.join(', ')}`)

/** The template's draft with what the phone editor would fill in: the symbol, the level, the order. */
export function draftOf(s: Scenario, m: Market): Draft {
  const d = structuredClone(s.draft)
  if (d.scope.type === 'SYMBOL') d.scope = { type: 'SYMBOL', symbol: SYMBOL }
  if (d.scope.type === 'ORDER') d.scope = { type: 'ORDER', symbol: SYMBOL, orderId: m.orders[0].orderId }
  for (const c of d.conditions.items) if (c.type === 'PRICE' && !c.threshold) c.threshold = String(Math.round(P * 1.01))
  return d
}
