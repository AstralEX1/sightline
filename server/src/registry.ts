/**
 * Shortcut rule model, catalog, compatibility matrices and templates: the single source the phone editor,
 * the validator and the engine read. Spec: docs/shortcuts-architecture.md §4–§7, §12.
 * Named ShortcutRule here while server/src/types.ts still has the old voice `Shortcut` (removed in step 2).
 */

/** Decimal string as the phone sends it: "30", "0.5". */
export type Dec = string

export type Scope =
  | { type: 'ALL_POSITIONS' }
  /** Every position, now and later, of these coins and side: outlives one position, unlike POSITION. */
  | { type: 'COIN_POSITIONS'; symbols: string[]; side: 'ANY' | 'LONG' | 'SHORT' }
  | { type: 'POSITION'; symbol: string; positionIdx: 0 | 1 | 2; epoch: string }
  | { type: 'SYMBOL'; symbol: string }
  | { type: 'ORDER'; symbol: string; orderId: string }
  | { type: 'ALL_ORDERS' }

export type PriceSource = 'LAST' | 'MARK' | 'INDEX'

export type Condition = { id: string } & (
  | { type: 'PRICE'; source: PriceSource; operator: 'GTE' | 'LTE' | 'UP_CROSS' | 'DOWN_CROSS'; threshold: Dec }
  /** From the price when the shortcut was turned on (or the position first seen), then from the price of its last alert. */
  | { type: 'PRICE_CHANGE'; source: PriceSource; direction: 'UP' | 'DOWN'; percent: Dec }
  | { type: 'PROFIT' | 'LOSS'; unit: 'USDT' | 'ROI_PERCENT'; threshold: Dec }
  | { type: 'NEAR_LIQUIDATION' | 'NEAR_SL' | 'NEAR_TP'; distancePct: Dec }
  | { type: 'ORDER_FILLED' | 'ORDER_PARTIAL' }
  /** Last-price volume of the latest closed `windowSec` against the hour before it, as a multiple. */
  | { type: 'VOLUME_SPIKE'; multiplier: Dec; windowSec: number }
  /** The next funding is at most `minutesBefore` away and costs at least `ratePct` (a position: what it pays; a symbol: either side). */
  | { type: 'FUNDING'; ratePct: Dec; minutesBefore: number }
  /** An open order has waited at least `minutes` since it was placed. */
  | { type: 'ORDER_STALE'; minutes: number }
  /** Edge: the position was closed (fully or partly) by its stop loss, its take profit or a liquidation. */
  | { type: 'POSITION_CLOSED'; by: ClosedBy })

export type ClosedBy = 'SL' | 'TP' | 'LIQUIDATION'

/** percent > 0 is the favorable side of entry for this position, < 0 adverse, 0 = entry. */
export type Target = { kind: 'ENTRY_OFFSET'; percent: Dec } | { kind: 'PRICE'; price: Dec }

export type Action =
  | { type: 'CLOSE_POSITION'; percent: Dec }
  | { type: 'MOVE_SL' | 'SET_SL' | 'SET_TP'; target: Target }
  /** MARGIN_PERCENT: of the position's own margin (positionIM), so one shortcut fits positions of any size. */
  | { type: 'ADD_MARGIN'; amount: Dec; unit: 'USDT' | 'MARGIN_PERCENT' }
  /** The glasses ask which of `sizes` (USDT) and `leverages`; a list of one is not asked. */
  | { type: 'OPEN_LONG' | 'OPEN_SHORT'; sizes: Dec[]; leverages: Dec[]; sl?: Target; tp?: Target }
  | { type: 'INCREASE_POSITION'; notionalUsdt: Dec }
  | { type: 'CANCEL_ORDER' }
  | { type: 'NOTIFY' }

export type TriggerMode = 'ON_ENTRY' | 'ON_EVENT' | 'ONCE' | 'REPEAT'

export interface ShortcutRule {
  schemaVersion: 1
  id: string
  accountId: string
  version: number
  enabled: boolean
  draft?: boolean
  name?: string
  scope: Scope
  conditions: { logic: 'ALL' | 'ANY'; items: Condition[] }
  voicePhrase?: string
  action: Action
  trigger: { mode: TriggerMode; intervalSec?: number }
  delivery: { glasses: boolean; phone: boolean }
}

export type ConditionType = Condition['type']
export type ActionType = Action['type']
export type ScopeType = Scope['type']

/** Registry order is the matrix order (C1–C13, A1–A10). */
export const CONDITION_TYPES = ['PRICE', 'PRICE_CHANGE', 'PROFIT', 'LOSS', 'NEAR_LIQUIDATION', 'NEAR_SL', 'NEAR_TP', 'ORDER_FILLED', 'ORDER_PARTIAL', 'VOLUME_SPIKE', 'FUNDING', 'ORDER_STALE', 'POSITION_CLOSED'] as const satisfies readonly ConditionType[]
export const ACTION_TYPES = ['CLOSE_POSITION', 'MOVE_SL', 'SET_SL', 'SET_TP', 'ADD_MARGIN', 'OPEN_LONG', 'OPEN_SHORT', 'INCREASE_POSITION', 'CANCEL_ORDER', 'NOTIFY'] as const satisfies readonly ActionType[]
export const SCOPE_TYPES = ['ALL_POSITIONS', 'COIN_POSITIONS', 'POSITION', 'SYMBOL', 'ORDER', 'ALL_ORDERS'] as const satisfies readonly ScopeType[]

/** Editor words. PROFIT/LOSS read "ROI" with the ROI unit (see conditionLabel). */
export const CONDITION_LABEL: Record<ConditionType, string> = {
  PRICE: 'Price', PRICE_CHANGE: 'Price change', PROFIT: 'Profit', LOSS: 'Loss',
  NEAR_LIQUIDATION: 'Liquidation distance', NEAR_SL: 'Stop loss distance', NEAR_TP: 'Take profit distance',
  ORDER_FILLED: 'Order filled', ORDER_PARTIAL: 'Order partly filled',
  VOLUME_SPIKE: 'Volume spike', FUNDING: 'Funding rate', ORDER_STALE: 'Order age', POSITION_CLOSED: 'Position closed',
}
export const ACTION_TITLE: Record<ActionType, string> = {
  CLOSE_POSITION: 'Close position', MOVE_SL: 'Move stop loss', SET_SL: 'Set stop loss', SET_TP: 'Set take profit',
  ADD_MARGIN: 'Add margin', OPEN_LONG: 'Open long', OPEN_SHORT: 'Open short', INCREASE_POSITION: 'Increase position', CANCEL_ORDER: 'Cancel order', NOTIFY: 'Notify',
}
export const SCOPE_LABEL: Record<ScopeType, string> = { ALL_POSITIONS: 'All positions', COIN_POSITIONS: 'Positions by coin', POSITION: 'One position', SYMBOL: 'One symbol', ORDER: 'One order', ALL_ORDERS: 'All orders' }

export const conditionLabel = (c: Condition) =>
  (c.type === 'PROFIT' || c.type === 'LOSS') && c.unit === 'ROI_PERCENT' ? 'ROI' : CONDITION_LABEL[c.type]

/** Which reason the lens shows when several OR branches match: lower is stronger (§5). */
export const SEVERITY: Record<ConditionType, number> = {
  NEAR_LIQUIDATION: 0, POSITION_CLOSED: 1, LOSS: 2, NEAR_SL: 3, FUNDING: 5, PRICE_CHANGE: 6, VOLUME_SPIKE: 7, PRICE: 8,
  NEAR_TP: 9, PROFIT: 10, ORDER_STALE: 11, ORDER_PARTIAL: 12, ORDER_FILLED: 13,
}

/** Edge events are true only during their evaluation; everything else is a state (§8). */
export const isEvent = (c: Condition) =>
  c.type === 'ORDER_FILLED' || c.type === 'ORDER_PARTIAL' || c.type === 'POSITION_CLOSED' || (c.type === 'PRICE' && (c.operator === 'UP_CROSS' || c.operator === 'DOWN_CROSS'))

const CRITICAL = new Set<ConditionType>(['NEAR_LIQUIDATION', 'LOSS', 'NEAR_SL'])
export const priority = (r: Pick<ShortcutRule, 'conditions'>) => (r.conditions.items.some(c => CRITICAL.has(c.type)) ? 'CRITICAL' : 'NORMAL')

/** Actions that change the exchange. Everything but Notify needs a tap on the glasses. */
export const isTrade = (a: ActionType) => a !== 'NOTIFY'

// Rows C1–C13, columns A1–A10, copied from §7. Y allowed, G allowed with runtime guards, N unsupported.
const CONDITION_ACTION_ROWS = [
  'YGGGGGGGGY', // PRICE
  'YGGGGGGGGY', // PRICE_CHANGE
  'YGGGGNNGNY', // PROFIT
  'YGGGGNNGNY', // LOSS: Increase averages down, behind a stop and Once
  'YGGNGNNNNY', // NEAR_LIQUIDATION
  'YGNNGNNNNY', // NEAR_SL
  'YGGGGNNNNY', // NEAR_TP
  'GGGGGNNNNY', // ORDER_FILLED
  'GGGGGNNNYY', // ORDER_PARTIAL
  'YGGGGNNNNY', // VOLUME_SPIKE: a spike has no direction, so nothing that opens or adds; not on orders
  'YNNNNNNNNY', // FUNDING: close before paying it, or just say so
  'NNNNNNNNYY', // ORDER_STALE: cancel the order or say so
  'NNNNNNNNNY', // POSITION_CLOSED: the position may be gone, so only a notice
]
// Symmetric, rows and columns C1–C13. B and/or, O or only, A and only, V same metric (checked in validate), - never
// (no common scope, or a close, which leaves no position for the other condition to read).
const STACKING_ROWS = [
  'VBBBBBBAABBB-',
  'BVBBBBBAABBB-',
  'BBVOBBB--BB--',
  'BBOVBBB--BB--',
  'BBBBVBB--BB--',
  'BBBBBVB--BB--',
  'BBBBBBV--BB--',
  'AA-----VO----',
  'AA-----OV----',
  'BBBBBBB--VB--',
  'BBBBBBB--BV--',
  'BB---------V-',
  '------------V',
]

export type Cell = 'Y' | 'G' | 'N'
export type StackCell = 'B' | 'O' | 'A' | 'V' | '-'

export const CONDITION_ACTION = Object.fromEntries(CONDITION_TYPES.map((c, i) =>
  [c, Object.fromEntries(ACTION_TYPES.map((a, j) => [a, CONDITION_ACTION_ROWS[i][j] as Cell]))])) as Record<ConditionType, Record<ActionType, Cell>>

export const STACKING = Object.fromEntries(CONDITION_TYPES.map((c, i) =>
  [c, Object.fromEntries(CONDITION_TYPES.map((d, j) => [d, STACKING_ROWS[i][j] as StackCell]))])) as Record<ConditionType, Record<ConditionType, StackCell>>

const POSITION_ACTIONS: ActionType[] = ['CLOSE_POSITION', 'MOVE_SL', 'SET_SL', 'SET_TP', 'ADD_MARGIN', 'INCREASE_POSITION', 'NOTIFY']
const POSITION_CONDITIONS: ConditionType[] = ['PROFIT', 'LOSS', 'NEAR_LIQUIDATION', 'NEAR_SL', 'NEAR_TP', 'VOLUME_SPIKE', 'FUNDING', 'POSITION_CLOSED']

/** What each "Apply to" choice can hold (§4). All positions has no absolute price level: each position is a different symbol. */
export const SCOPE_RULES: Record<ScopeType, { conditions: ConditionType[]; actions: ActionType[] }> = {
  ALL_POSITIONS: { conditions: ['PRICE_CHANGE', ...POSITION_CONDITIONS], actions: POSITION_ACTIONS },
  // A price level needs one coin: validate checks it
  COIN_POSITIONS: { conditions: ['PRICE', 'PRICE_CHANGE', ...POSITION_CONDITIONS], actions: POSITION_ACTIONS },
  POSITION: { conditions: ['PRICE', 'PRICE_CHANGE', ...POSITION_CONDITIONS], actions: POSITION_ACTIONS },
  SYMBOL: { conditions: ['PRICE', 'PRICE_CHANGE', 'VOLUME_SPIKE', 'FUNDING'], actions: ['OPEN_LONG', 'OPEN_SHORT', 'NOTIFY'] },
  // Position actions here act on the position the order opened, so they need a fill condition (validate checks it).
  ORDER: { conditions: ['PRICE', 'PRICE_CHANGE', 'ORDER_FILLED', 'ORDER_PARTIAL', 'ORDER_STALE'], actions: ['CLOSE_POSITION', 'MOVE_SL', 'SET_SL', 'SET_TP', 'ADD_MARGIN', 'CANCEL_ORDER', 'NOTIFY'] },
  // Every plain order (stops and take profits excluded), each its own target; position actions as on One order.
  ALL_ORDERS: { conditions: ['ORDER_FILLED', 'ORDER_PARTIAL', 'ORDER_STALE'], actions: ['CLOSE_POSITION', 'MOVE_SL', 'SET_SL', 'SET_TP', 'ADD_MARGIN', 'CANCEL_ORDER', 'NOTIFY'] },
}

/** Bounds the phone editor and the validator share. */
export const LIMITS = {
  maxConditions: 10,
  maxName: 40,
  maxPhrase: 40,
  repeatSec: { min: 60, max: 86_400, default: 300 },
  pricePct: { min: 0, max: 100 }, // price change, distances: (min, max]
  stopPct: { min: -100, max: 100 }, // stop offsets from entry: (min, max)
  tpPct: { min: 0, max: 1000 }, // take profit offsets: (min, max]
  closePct: { min: 0, max: 100 }, // (min, max]
  marginPct: { min: 0, max: 100 }, // Add margin, of the position's margin: (min, max]
  maxCoins: 10,
  leverage: { min: 1, max: 200 },
  /** Choices one Open offers on the glasses, sizes and leverages each */
  maxPicks: 5,
  leverages: ['1', '1.5', '2', '5', '10'],
  volumeX: { min: 1, max: 100 }, // (min, max]
  volumeWindowSec: { min: 60, max: 3_600, step: 60 }, // against the hour before it: one kline request of 121 candles
  fundingPct: { min: 0, max: 5 }, // (min, max]; Bybit caps most perps far below
  fundingMin: { min: 1, max: 480 }, // the longest funding interval is 8 h
  orderAgeMin: { min: 1, max: 10_080 }, // a week
}

export const DEFAULT_DELIVERY = { glasses: true, phone: true }

/** A template is a disabled draft; '' marks a value the user must enter before it can be turned on. */
export type Draft = Pick<ShortcutRule, 'scope' | 'conditions' | 'action' | 'trigger' | 'delivery'> & { voicePhrase?: string }
/** The groups of the Templates grid, each with its own switch on the phone. */
export type TemplateCategory = 'Protect' | 'Take profit' | 'Market' | 'Orders'
export interface Template { id: string; category: TemplateCategory; title: string; sub: string; draft: Draft }

type NoId<T> = T extends unknown ? Omit<T, 'id'> : never
const all = { type: 'ALL_POSITIONS' } as const
const one = (c: NoId<Condition>): Draft['conditions'] => ({ logic: 'ALL', items: [{ id: 'c1', ...c } as Condition] })
const entry = { mode: 'ON_ENTRY' } as const
const event = { mode: 'ON_EVENT' } as const
const t = (category: TemplateCategory, id: number, sub: string, scope: Scope, conditions: Draft['conditions'], action: Action, trigger: Draft['trigger']): Template =>
  ({ id: `tpl_${id}`, category, title: ACTION_TITLE[action.type], sub, draft: { scope, conditions, action, trigger, delivery: { ...DEFAULT_DELIVERY } } })

const sym = { type: 'SYMBOL', symbol: '' } as const
const change = (direction: 'UP' | 'DOWN', id: string): Condition => ({ id, type: 'PRICE_CHANGE', source: 'LAST', direction, percent: '15' })

/**
 * The seeds of §12, in the order of the Templates grid on the Shortcuts screen: the ones where answering on the glasses
 * matters, by category. Numbers fit a 5–10× position. Ids are stable; the gaps are templates that were removed.
 */
export const TEMPLATES: Template[] = [
  t('Protect', 6, 'Near liquidation · half', all, one({ type: 'NEAR_LIQUIDATION', distancePct: '3' }), { type: 'CLOSE_POSITION', percent: '50' }, entry),
  // before the close at 3%; a percent of each position's own margin, isolated only (a cross one is skipped with the reason)
  t('Protect', 28, 'Near liquidation · 25%', all, one({ type: 'NEAR_LIQUIDATION', distancePct: '5' }), { type: 'ADD_MARGIN', amount: '25', unit: 'MARGIN_PERCENT' }, entry),
  t('Protect', 27, 'Near stop loss', all, one({ type: 'NEAR_SL', distancePct: '1' }), { type: 'NOTIFY' }, entry),
  t('Protect', 17, 'Closed by stop loss', all, one({ type: 'POSITION_CLOSED', by: 'SL' }), { type: 'NOTIFY' }, event),
  t('Take profit', 1, 'ROI above 20% · breakeven', all, one({ type: 'PROFIT', unit: 'ROI_PERCENT', threshold: '20' }), { type: 'MOVE_SL', target: { kind: 'ENTRY_OFFSET', percent: '0' } }, entry),
  t('Take profit', 2, 'ROI above 50% · half', all, one({ type: 'PROFIT', unit: 'ROI_PERCENT', threshold: '50' }), { type: 'CLOSE_POSITION', percent: '50' }, entry),
  t('Market', 10, 'Price crosses a level', sym, one({ type: 'PRICE', source: 'LAST', operator: 'UP_CROSS', threshold: '' }), { type: 'NOTIFY' }, event),
  // either way: "moves" names no direction
  t('Market', 26, 'Price moves 15%', all, { logic: 'ANY', items: [change('UP', 'c1'), change('DOWN', 'c2')] }, { type: 'NOTIFY' }, entry),
  t('Market', 11, 'Price falls 2%', all, one({ type: 'PRICE_CHANGE', source: 'LAST', direction: 'DOWN', percent: '2' }), { type: 'NOTIFY' }, entry),
  t('Market', 20, 'Funding above 0.05% in 30 min', all, one({ type: 'FUNDING', ratePct: '0.05', minutesBefore: 30 }), { type: 'NOTIFY' }, entry),
  t('Orders', 14, 'Order filled', { type: 'ALL_ORDERS' }, one({ type: 'ORDER_FILLED' }), { type: 'SET_TP', target: { kind: 'ENTRY_OFFSET', percent: '3' } }, event),
  t('Orders', 24, 'Order open over 1 h', { type: 'ALL_ORDERS' }, one({ type: 'ORDER_STALE', minutes: 60 }), { type: 'CANCEL_ORDER' }, entry),
]

/** Trade Shortcuts's voice commands as voice-only shortcuts, seeded on first start (§12). */
export const VOICE_SEEDS: Draft[] = [
  { voicePhrase: 'protect all', scope: all, conditions: { logic: 'ALL', items: [] }, action: { type: 'SET_SL', target: { kind: 'ENTRY_OFFSET', percent: '-2' } }, trigger: entry, delivery: { ...DEFAULT_DELIVERY } },
  { voicePhrase: 'lock profits', scope: all, conditions: { logic: 'ALL', items: [] }, action: { type: 'MOVE_SL', target: { kind: 'ENTRY_OFFSET', percent: '0' } }, trigger: entry, delivery: { ...DEFAULT_DELIVERY } },
]
/** The menu's Close all and Detail's Close position; seeded apart, so servers seeded before it get it once too. */
export const CLOSE_SEED: Draft = { voicePhrase: 'close all', scope: all, conditions: { logic: 'ALL', items: [] }, action: { type: 'CLOSE_POSITION', percent: '100' }, trigger: entry, delivery: { ...DEFAULT_DELIVERY } }

/**
 * Two risk rules switched on at first start, so the lens has work before anyone opens the editor: near liquidation ·
 * half (template 6), ROI above 20% · breakeven (1). Every one still waits for a tap.
 */
export const STARTER_RULES: Draft[] = ['tpl_6', 'tpl_1'].map(id => structuredClone(TEMPLATES.find(t => t.id === id)!.draft))

/** What GET /api/catalog sends: the phone filters the editor's choices with the same tables the server validates with. */
export const catalog = () => ({
  conditions: CONDITION_TYPES.map((type, i) => ({ type, code: `C${i + 1}`, label: CONDITION_LABEL[type], severity: SEVERITY[type] })),
  actions: ACTION_TYPES.map((type, i) => ({ type, code: `A${i + 1}`, title: ACTION_TITLE[type], trade: isTrade(type) })),
  scopes: SCOPE_TYPES.map(type => ({ type, label: SCOPE_LABEL[type], ...SCOPE_RULES[type] })),
  conditionAction: CONDITION_ACTION,
  stacking: STACKING,
  limits: LIMITS,
})
