/**
 * The sandbox's tabs, one scenario each. Their numbers are the templates' own (registry.ts), so the lens shows the
 * alert the app would raise. Guided trade alerts are confirmed with the Down and Click gestures.
 */
import { DEFAULT_DELIVERY, TEMPLATES, type Draft, type Template } from '../../../server/src/registry.ts'
import { liqOf, START_PRICE as P, SYMBOL, type Market } from './market.ts'

const QTY = 0.05 // 4,800 USDT at 96,000; 480 USDT margin at 10×
const LEV = 10

export type Phase = 'add' | 'move' | 'answer' | 'executing' | 'done' | 'missed'

export function scenarioPhase(enabled: boolean, status?: string): Phase {
  if (status === undefined) return enabled ? 'move' : 'add'
  if (/^Waiting/.test(status)) return 'answer'
  if (/^(Sending|Submitted|Partly filled)/.test(status)) return 'executing'
  if (/^(Filled|Done|Shown|Logged|OK on )/.test(status)) return 'done'
  return 'missed'
}

export type Tab = {
  /** The URL hash that opens it */
  id: string
  title: string
  sub: string
  template: Template
  /** A guided story; otherwise the phone opens the template in the editor and the visitor adds it. */
  on: boolean
  /** The account before anything moves. */
  before(m: Market): Promise<void>
  /** Where Play moves the price so the shortcut fires. */
  to: number
  /** What to do, in order. Play, under the glasses, runs the guided ones. */
  steps: string[]
}

/** Build your own: already on, so a small drag of the chart fires one or the other. */
const watch = (direction: 'UP' | 'DOWN', name: string): Draft & { name: string } => ({
  name,
  scope: { type: 'SYMBOL', symbol: 'BTCUSDT' },
  conditions: { logic: 'ALL', items: [{ id: 'c1', type: 'PRICE_CHANGE', source: 'LAST', direction, percent: '0.5' }] },
  action: { type: 'NOTIFY' },
  trigger: { mode: 'ON_ENTRY' },
  delivery: { ...DEFAULT_DELIVERY },
})
export const BUILD_WATCHES = [watch('DOWN', 'Price down 0.5%'), watch('UP', 'Price up 0.5%')]

function template(id: string): Template {
  const t = TEMPLATES.find(x => x.id === id)
  if (!t) throw new Error(`No template ${id}`)
  return t
}

export const TABS: Tab[] = [
  {
    id: 'liquidation', title: 'Liquidation alert', sub: 'Close half when BTC nears liquidation', template: template('tpl_6'), on: true,
    before: m => m.open('Buy', QTY, LEV), to: liqOf('Buy', P, LEV) * 1.025,
    steps: ['Set up the shortcut and switch it on', 'The trigger fires', 'The alert arrives on the glasses', 'The close is sent, then the exchange fills it'],
  },
  {
    id: 'volume', title: 'Volume spike', sub: 'Notify on a volume spike and a 5% price rise', on: true,
    template: {
      id: 'sandbox-volume', category: 'Market', title: 'Notify', sub: 'Volume spike + price up 5%',
      draft: {
        scope: { type: 'SYMBOL', symbol: SYMBOL },
        conditions: { logic: 'ALL', items: [
          { id: 'c1', type: 'PRICE_CHANGE', source: 'LAST', direction: 'UP', percent: '5' },
          { id: 'c2', type: 'VOLUME_SPIKE', multiplier: '2', windowSec: 300 },
        ] },
        action: { type: 'NOTIFY' },
        trigger: { mode: 'ON_ENTRY' },
        delivery: { ...DEFAULT_DELIVERY },
      },
    },
    before: async m => { m.seedVolumeSpike() }, to: P * 1.055,
    steps: ['Set up the shortcut and switch it on', 'BTC rises 5% with volume at least 2× usual', 'The alert arrives on the glasses'],
  },
  {
    id: 'half', title: 'Take half', sub: 'Close half at +50% ROI', template: template('tpl_2'), on: true,
    before: m => m.open('Buy', QTY, LEV), to: P * 1.055, // 10×: +5.5% is about +55% ROI
    steps: ['Set up the shortcut and switch it on', 'The trigger fires', 'Confirm on the glasses with Down → Click', 'The close is sent, then the exchange fills it'],
  },
  {
    id: 'build', title: 'Build your own', sub: 'Drag BTC a little, down or up', template: template('tpl_2'), on: false,
    before: m => m.open('Buy', QTY, LEV, 0, P * 0.98), to: P * 1.006, // 1.005 lands just short of the 0.5% watch
    steps: ['Price down and price up are already switched on', 'Drag BTC down a little, or up', 'Answer on the glasses'],
  },
]
