import { CLOSE_SEED, DEFAULT_DELIVERY, TEMPLATES, VOICE_SEEDS, type Draft } from '../../../server/src/registry.ts'
import { liqOf, START_PRICE, SYMBOL, type Market } from './market.ts'

const QTY = 0.05
const LEVERAGE = 10
const liquidationDraft = TEMPLATES.find(t => t.id === 'tpl_6')!.draft
const profitDraft = TEMPLATES.find(t => t.id === 'tpl_1')!.draft

export type Tab = {
  id: string
  title: string
  draft: Draft
  /** A null target is the free sandbox, where visitors move the price themselves. */
  target: number | null
  stop?: number
}

export const TABS: readonly Tab[] = [
  {
    id: 'btc',
    title: 'BTC +10%',
    target: Math.round(START_PRICE * 1.1),
    draft: {
      scope: { type: 'SYMBOL', symbol: SYMBOL },
      conditions: { logic: 'ALL', items: [{ id: 'c1', type: 'PRICE_CHANGE', source: 'LAST', direction: 'UP', percent: '10' }] },
      action: { type: 'NOTIFY' },
      trigger: { mode: 'ON_ENTRY' },
      delivery: { ...DEFAULT_DELIVERY },
    },
  },
  {
    id: 'liquidation', title: 'Liquidation', draft: liquidationDraft,
    target: liqOf('Buy', START_PRICE, LEVERAGE) * 1.025,
  },
  {
    id: 'profit', title: 'Lock profit', draft: profitDraft, target: START_PRICE * 1.024,
    stop: START_PRICE * .98,
  },
  { id: 'sandbox', title: 'Free sandbox', draft: liquidationDraft, target: null },
]

export function scenarioDrafts(tab: Tab): Draft[] {
  return structuredClone(tab.target === null ? [tab.draft, ...VOICE_SEEDS, CLOSE_SEED] : [tab.draft])
}

export function openScenarioPosition(tab: Tab, market: Market) {
  return market.open('Buy', QTY, LEVERAGE, 0, tab.stop)
}
