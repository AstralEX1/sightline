/**
 * Templates that left the phone's grid (spec 2026-11-25-template-categories-design.md), kept as test fixtures so the
 * engine, validator and HTTP tests built on them keep their coverage. `template(n)` finds tpl_n here or in TEMPLATES.
 */
import { ACTION_TITLE, DEFAULT_DELIVERY, TEMPLATES, type Action, type Condition, type Draft, type Scope } from '../src/registry.ts'

type NoId<T> = T extends unknown ? Omit<T, 'id'> : never
type Removed = { id: string; title: string; sub: string; draft: Draft }
const all = { type: 'ALL_POSITIONS' } as const
const sym = { type: 'SYMBOL', symbol: '' } as const
const order = { type: 'ORDER', symbol: '', orderId: '' } as const
const entry = { mode: 'ON_ENTRY' } as const
const event = { mode: 'ON_EVENT' } as const
const t = (id: number, sub: string, scope: Scope, c: NoId<Condition>, action: Action, trigger: Draft['trigger']): Removed => ({
  id: `tpl_${id}`, title: ACTION_TITLE[action.type], sub,
  draft: { scope, conditions: { logic: 'ALL', items: [{ id: 'c1', ...c } as Condition] }, action, trigger, delivery: { ...DEFAULT_DELIVERY } },
})

export const REMOVED_TEMPLATES: Removed[] = [
  t(3, 'Profit above 100 USDT', all, { type: 'PROFIT', unit: 'USDT', threshold: '100' }, { type: 'CLOSE_POSITION', percent: '25' }, entry),
  t(4, 'Near take profit · half', all, { type: 'NEAR_TP', distancePct: '0.5' }, { type: 'CLOSE_POSITION', percent: '50' }, entry),
  t(5, 'ROI below −30% · all', all, { type: 'LOSS', unit: 'ROI_PERCENT', threshold: '30' }, { type: 'CLOSE_POSITION', percent: '100' }, entry),
  t(7, 'Near liquidation', all, { type: 'NEAR_LIQUIDATION', distancePct: '5' }, { type: 'ADD_MARGIN', amount: '50', unit: 'USDT' }, entry),
  t(9, 'Near stop loss', all, { type: 'NEAR_SL', distancePct: '0.5' }, { type: 'NOTIFY' }, entry),
  t(16, 'Loss above 50 USDT', all, { type: 'LOSS', unit: 'USDT', threshold: '50' }, { type: 'NOTIFY' }, entry),
  t(18, 'Closed by take profit', all, { type: 'POSITION_CLOSED', by: 'TP' }, { type: 'NOTIFY' }, event),
  t(19, 'Liquidated', all, { type: 'POSITION_CLOSED', by: 'LIQUIDATION' }, { type: 'NOTIFY' }, event),
  t(21, 'Funding above 0.1% · close', all, { type: 'FUNDING', ratePct: '0.1', minutesBefore: 10 }, { type: 'CLOSE_POSITION', percent: '100' }, entry),
  t(22, 'Volume 3× in 5 min', sym, { type: 'VOLUME_SPIKE', multiplier: '3', windowSec: 300 }, { type: 'NOTIFY' }, entry),
  t(23, 'Volume 5× · breakeven', all, { type: 'VOLUME_SPIKE', multiplier: '5', windowSec: 300 }, { type: 'MOVE_SL', target: { kind: 'ENTRY_OFFSET', percent: '0' } }, entry),
  t(12, 'Price rises 2%', sym, { type: 'PRICE_CHANGE', source: 'LAST', direction: 'UP', percent: '2' }, { type: 'NOTIFY' }, entry),
  t(13, 'Price crosses a level', sym, { type: 'PRICE', source: 'LAST', operator: 'UP_CROSS', threshold: '' },
    { type: 'OPEN_LONG', sizes: ['100'], leverages: ['5'], sl: { kind: 'ENTRY_OFFSET', percent: '-2' } }, { mode: 'ONCE' }),
  t(15, 'Order partly filled', order, { type: 'ORDER_PARTIAL' }, { type: 'CANCEL_ORDER' }, event),
  t(25, 'Order open over 15 min', { type: 'ALL_ORDERS' }, { type: 'ORDER_STALE', minutes: 15 }, { type: 'NOTIFY' }, entry),
]

/** A copy of template n's draft, current or removed. */
export const template = (n: number): Draft =>
  structuredClone([...TEMPLATES, ...REMOVED_TEMPLATES].find(t => t.id === `tpl_${n}`)!.draft)
