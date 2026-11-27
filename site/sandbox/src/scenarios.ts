/**
 * The sandbox's tabs, one scenario each. Their numbers are the templates' own (registry.ts), so the lens shows the
 * alert the app would raise. Take half is answered out loud; the other guided tabs still press Down and Click if nobody speaks.
 */
import { DEFAULT_DELIVERY, TEMPLATES, type Draft, type Template } from '../../../server/src/registry.ts'
import { liqOf, START_PRICE as P, type Market } from './market.ts'

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
  /** Play leaves the card for a spoken yes. Down and Click still answer it. */
  voice?: boolean
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
    steps: ['Switch on Near liquidation · half', 'BTC nears liquidation', 'The glasses ask: close half?', 'The exchange closes half'],
  },
  {
    id: 'profit', title: 'Lock in profit', sub: 'Stop to entry at +20% ROI', template: template('tpl_1'), on: true,
    before: m => m.open('Buy', QTY, LEV, 0, P * 0.98), to: P * 1.024, // a stop to move
    steps: ['Switch on ROI above 20% · breakeven', 'BTC reaches +20% ROI', 'The glasses ask: move the stop?', 'The stop moves to entry'],
  },
  {
    id: 'half', title: 'Take half', sub: 'Close half at +50% ROI', template: template('tpl_2'), on: true, voice: true,
    before: m => m.open('Buy', QTY, LEV), to: P * 1.055, // 10×: +5.5% is about +55% ROI
    steps: ['Switch on ROI above 50% · half', 'BTC reaches +50% ROI', 'Say yes. Five seconds to cancel', 'The exchange closes half'],
  },
  {
    id: 'build', title: 'Build your own', sub: 'Drag BTC a little, down or up', template: template('tpl_2'), on: false,
    before: m => m.open('Buy', QTY, LEV, 0, P * 0.98), to: P * 1.006, // 1.005 lands just short of the 0.5% watch
    steps: ['Price down and price up are already switched on', 'Drag BTC down a little, or up', 'Answer on the glasses'],
  },
]
