/**
 * The sandbox's tabs, one scenario each: two templates that are already on, and one the visitor adds from a template.
 * Their numbers are the templates' own (registry.ts), so the lens shows the alert the app would raise.
 */
import { TEMPLATES, type Template } from '../../../server/src/registry.ts'
import { liqOf, START_PRICE as P, type Market } from './market.ts'

const QTY = 0.05 // 4,800 USDT at 96,000; 480 USDT margin at 10×
const LEV = 10

export type Tab = {
  /** The URL hash that opens it */
  id: string
  title: string
  sub: string
  template: Template
  /** On from the start; otherwise the phone opens the template in the editor and the visitor adds it. */
  on: boolean
  /** The account before anything moves. */
  before(m: Market): Promise<void>
  /** Where Play moves the price so the shortcut fires. */
  to: number
  /** What to do, in order; the move step offers Play. */
  steps: string[]
}

function template(id: string): Template {
  const t = TEMPLATES.find(x => x.id === id)
  if (!t) throw new Error(`No template ${id}`)
  return t
}

export const TABS: Tab[] = [
  {
    id: 'liquidation', title: 'Liquidation alert', sub: 'Close half when BTC nears liquidation', template: template('tpl_6'), on: true,
    before: m => m.open('Buy', QTY, LEV), to: liqOf('Buy', P, LEV) * 1.025,
    steps: ['Drag the chart down', 'Answer on the glasses', 'Half the position is closed'],
  },
  {
    id: 'profit', title: 'Lock in profit', sub: 'Stop to entry at +20% ROI', template: template('tpl_1'), on: true,
    before: m => m.open('Buy', QTY, LEV, 0, P * 0.98), to: P * 1.024, // a stop to move
    steps: ['Drag the chart up', 'Answer on the glasses', 'The stop moves to entry'],
  },
  {
    id: 'build', title: 'Build your own', sub: 'Start from a template, change anything', template: template('tpl_3'), on: false,
    before: m => m.open('Buy', QTY, LEV, 0, P * 0.98), to: P * 1.025,
    steps: ['Change the shortcut, tap Add', 'Drag the chart up', 'Answer on the glasses'],
  },
]
