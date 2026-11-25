import {
  ACTION_TITLE, ACTION_TYPES, CONDITION_ACTION, CONDITION_TYPES, LIMITS, SCOPE_LABEL, SCOPE_RULES, STACKING,
  conditionLabel, isEvent, isTrade,
  type Action, type Condition, type Draft, type PriceSource, type Scope, type Target, type TriggerMode,
} from './registry.ts'
import { normalizePhrase } from './rules.ts'

/** `message` is the sentence the editor shows; `conditionId` / `field` say which row or token it belongs to. */
export type Issue = { code: string; message: string; conditionId?: string; field?: string }
/** What the phone edits. The server adds id, account, version and the on/off switch when it saves. */
export type EditableShortcut = Draft & { name?: string }
export interface Validation { ok: boolean; issues: Issue[]; value?: EditableShortcut }

const SYMBOL = /^[A-Z0-9]{2,20}$/
const ID = /^[A-Za-z0-9_-]{1,64}$/
const DEC = /^-?\d{1,12}(\.\d{1,10})?$/
const SOURCES: PriceSource[] = ['LAST', 'MARK', 'INDEX']
const MODES: TriggerMode[] = ['ON_ENTRY', 'ON_EVENT', 'ONCE', 'REPEAT']
const BIG = 1e9

/** gt/ge and lt/le bounds; the message names them. */
type Range = { gt?: number; ge?: number; lt?: number; le?: number }
const rangeText = (r: Range) => [
  r.gt !== undefined ? `above ${r.gt}` : r.ge !== undefined ? `at least ${r.ge}` : '',
  r.lt !== undefined ? `below ${r.lt}` : r.le !== undefined ? `at most ${r.le}` : '',
].filter(Boolean).join(' and ')
const inRange = (n: number, r: Range) =>
  (r.gt === undefined || n > r.gt) && (r.ge === undefined || n >= r.ge) && (r.lt === undefined || n < r.lt) && (r.le === undefined || n <= r.le)

const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const oneOf = <T extends string>(v: unknown, list: readonly T[]): v is T => typeof v === 'string' && (list as readonly string[]).includes(v)

/**
 * Trust boundary for the shortcut editor (§7). Collects every problem instead of stopping at the first,
 * so the editor can flag each row. Returns a clean copy with known fields only.
 */
export function validateShortcut(input: unknown, ctx: { phrasesInUse?: string[] } = {}): Validation {
  const issues: Issue[] = []
  const add = (code: string, message: string, at: { conditionId?: string; field?: string } = {}) => { issues.push({ code, message, ...at }) }

  /** A decimal string in range, or null with an issue. */
  const dec = (v: unknown, what: string, r: Range, at: { conditionId?: string; field: string }): string | null => {
    if (v === '' || v === undefined || v === null) return add('missing_value', `Enter ${what}`, at), null
    if (typeof v !== 'string' || !DEC.test(v) || !inRange(Number(v), r)) return add('bad_value', `${what[0].toUpperCase()}${what.slice(1)} must be ${rangeText(r)}`, at), null
    return v
  }

  const r = obj(input)
  if (!r) return { ok: false, issues: [{ code: 'bad_shape', message: 'Expected a shortcut' }] }

  // Apply to
  let scope: Scope | null = null
  const s = obj(r.scope)
  const symbol = (v: unknown, field: string) => {
    if (typeof v === 'string' && SYMBOL.test(v)) return v
    add(v ? 'bad_value' : 'missing_value', v ? 'Symbol must look like BTCUSDT' : 'Choose a symbol', { field })
    return null
  }
  const text = (v: unknown, what: string, field: string) => {
    if (typeof v === 'string' && v && v.length <= 64) return v
    add('missing_value', `Choose ${what}`, { field })
    return null
  }
  if (s?.type === 'ALL_POSITIONS') scope = { type: 'ALL_POSITIONS' }
  else if (s?.type === 'ALL_ORDERS') scope = { type: 'ALL_ORDERS' }
  else if (s?.type === 'SYMBOL') {
    const sym = symbol(s.symbol, 'scope.symbol')
    if (sym) scope = { type: 'SYMBOL', symbol: sym }
  } else if (s?.type === 'POSITION') {
    const sym = symbol(s.symbol, 'scope.symbol')
    const idx = s.positionIdx
    const epoch = text(s.epoch, 'a position', 'scope.epoch')
    if (idx !== 0 && idx !== 1 && idx !== 2) add('bad_value', 'Choose a position', { field: 'scope.positionIdx' })
    else if (sym && epoch) scope = { type: 'POSITION', symbol: sym, positionIdx: idx, epoch }
  } else if (s?.type === 'ORDER') {
    const sym = symbol(s.symbol, 'scope.symbol')
    const orderId = text(s.orderId, 'an order', 'scope.orderId')
    if (sym && orderId) scope = { type: 'ORDER', symbol: sym, orderId }
  } else add('bad_scope', 'Choose what this applies to', { field: 'scope' })

  // When
  const target = (v: unknown, field: string, pct: Range): Target | null => {
    const t = obj(v)
    if (t?.kind === 'ENTRY_OFFSET') {
      const percent = dec(t.percent, 'a percent from entry', pct, { field: `${field}.percent` })
      return percent === null ? null : { kind: 'ENTRY_OFFSET', percent }
    }
    if (t?.kind === 'PRICE') {
      const price = dec(t.price, 'a price', { gt: 0, lt: BIG }, { field: `${field}.price` })
      return price === null ? null : { kind: 'PRICE', price }
    }
    add('bad_value', 'Choose a price or a percent from entry', { field })
    return null
  }

  /** Whole minutes in [min, max], returned times `unit` (60 for a window in seconds), or null with an issue. */
  const minutes = (v: unknown, min: number, max: number, unit: number, what: string, at: { conditionId?: string; field: string }) => {
    const n = typeof v === 'number' ? v / unit : NaN
    if (Number.isInteger(n) && n >= min && n <= max) return v as number
    add('bad_value', `${what} must be whole minutes from ${min} to ${max}`, at)
    return null
  }

  const c = obj(r.conditions)
  if (!c) add('bad_shape', 'Add a condition or a voice phrase', { field: 'conditions' })
  const logic = c?.logic === 'ANY' ? 'ANY' : 'ALL'
  if (c && c.logic !== 'ALL' && c.logic !== 'ANY') add('bad_value', 'Choose and or or', { field: 'conditions.logic' })
  const rawItems = Array.isArray(c?.items) ? c.items : []
  if (c && !Array.isArray(c.items)) add('bad_shape', 'Conditions must be a list', { field: 'conditions.items' })
  if (rawItems.length > LIMITS.maxConditions) add('too_many_conditions', `Up to ${LIMITS.maxConditions} conditions`, { field: 'conditions.items' })

  const seenIds = new Set<string>()
  const items: Condition[] = []
  let allParsed = true
  for (const raw of rawItems.slice(0, LIMITS.maxConditions)) {
    const x = obj(raw)
    const id = typeof x?.id === 'string' && ID.test(x.id) && !seenIds.has(x.id) ? x.id : null
    if (!x || !id) { add('bad_condition', 'Each condition needs its own id', { field: 'conditions.items' }); allParsed = false; continue }
    seenIds.add(id)
    const at = (field: string) => ({ conditionId: id, field })
    let out: Condition | null = null
    switch (x.type) {
      case 'PRICE': {
        if (!oneOf(x.source, SOURCES) || !oneOf(x.operator, ['GTE', 'LTE', 'UP_CROSS', 'DOWN_CROSS'] as const)) { add('bad_value', 'Choose a price source and a comparison', at('operator')); break }
        const threshold = dec(x.threshold, 'a price', { gt: 0, lt: BIG }, at('threshold'))
        if (threshold) out = { id, type: 'PRICE', source: x.source, operator: x.operator, threshold }
        break
      }
      case 'PRICE_CHANGE': {
        if (!oneOf(x.source, SOURCES) || !oneOf(x.direction, ['UP', 'DOWN'] as const)) { add('bad_value', 'Choose rises or falls', at('direction')); break }
        const percent = dec(x.percent, 'a percent', { gt: LIMITS.pricePct.min, le: LIMITS.pricePct.max }, at('percent'))
        const w = LIMITS.windowSec
        const okWindow = Number.isInteger(x.windowSec) && (x.windowSec as number) >= w.min && (x.windowSec as number) <= w.max && (x.windowSec as number) % w.step === 0
        if (!okWindow) add('bad_value', `Time window must be whole minutes from ${w.min / 60} to ${w.max / 60}`, at('windowSec'))
        if (percent && okWindow) out = { id, type: 'PRICE_CHANGE', source: x.source, direction: x.direction, percent, windowSec: x.windowSec as number }
        break
      }
      case 'PROFIT':
      case 'LOSS': {
        if (!oneOf(x.unit, ['USDT', 'ROI_PERCENT'] as const)) { add('bad_value', 'Choose ROI or USDT', at('unit')); break }
        const threshold = dec(x.threshold, x.unit === 'USDT' ? 'an amount in USDT' : 'a percent', { gt: 0, lt: BIG }, at('threshold'))
        if (threshold) out = { id, type: x.type, unit: x.unit, threshold }
        break
      }
      case 'NEAR_LIQUIDATION':
      case 'NEAR_SL':
      case 'NEAR_TP': {
        const distancePct = dec(x.distancePct, 'a distance in percent', { gt: LIMITS.pricePct.min, le: LIMITS.pricePct.max }, at('distancePct'))
        if (distancePct) out = { id, type: x.type, distancePct }
        break
      }
      case 'SL_MISSING':
      case 'ORDER_FILLED':
      case 'ORDER_PARTIAL':
        out = { id, type: x.type }
        break
      case 'VOLUME_SPIKE': {
        const multiplier = dec(x.multiplier, 'a multiple of the usual volume', { gt: LIMITS.volumeX.min, le: LIMITS.volumeX.max }, at('multiplier'))
        const windowSec = minutes(x.windowSec, LIMITS.volumeWindowSec.min / 60, LIMITS.volumeWindowSec.max / 60, 60, 'Time window', at('windowSec'))
        if (multiplier && windowSec !== null) out = { id, type: 'VOLUME_SPIKE', multiplier, windowSec }
        break
      }
      case 'FUNDING': {
        const ratePct = dec(x.ratePct, 'a funding rate in percent', { gt: LIMITS.fundingPct.min, le: LIMITS.fundingPct.max }, at('ratePct'))
        const minutesBefore = minutes(x.minutesBefore, LIMITS.fundingMin.min, LIMITS.fundingMin.max, 1, 'Time before funding', at('minutesBefore'))
        if (ratePct && minutesBefore !== null) out = { id, type: 'FUNDING', ratePct, minutesBefore }
        break
      }
      case 'ORDER_STALE': {
        const m = minutes(x.minutes, LIMITS.orderAgeMin.min, LIMITS.orderAgeMin.max, 1, 'Order age', at('minutes'))
        if (m !== null) out = { id, type: 'ORDER_STALE', minutes: m }
        break
      }
      case 'POSITION_CLOSED':
        if (oneOf(x.by, ['SL', 'TP', 'LIQUIDATION'] as const)) out = { id, type: 'POSITION_CLOSED', by: x.by }
        else add('bad_value', 'Choose stop loss, take profit or liquidation', at('by'))
        break
      default:
        add('bad_condition', 'Unknown condition', at('type'))
    }
    if (out) items.push(out)
    else allParsed = false
  }

  // Voice phrase and name
  let voicePhrase: string | undefined
  if (r.voicePhrase !== undefined && r.voicePhrase !== '') {
    const p = r.voicePhrase
    if (typeof p !== 'string' || !p || p.length > LIMITS.maxPhrase || p !== normalizePhrase(p)) add('bad_value', `Voice phrase: up to ${LIMITS.maxPhrase} lowercase letters, digits and spaces`, { field: 'voicePhrase' })
    else if (ctx.phrasesInUse?.includes(p)) add('phrase_taken', `Another shortcut already uses "${p}"`, { field: 'voicePhrase' })
    else voicePhrase = p
  }
  if (Array.isArray(c?.items) && rawItems.length === 0 && (r.voicePhrase === undefined || r.voicePhrase === '')) add('no_conditions', 'Add a condition or a voice phrase', { field: 'conditions.items' })
  let name: string | undefined
  if (r.name !== undefined) {
    if (typeof r.name !== 'string' || r.name.trim().length > LIMITS.maxName) add('bad_value', `Name: up to ${LIMITS.maxName} characters`, { field: 'name' })
    else if (r.name.trim()) name = r.name.trim()
  }

  // Do
  let action: Action | null = null
  const a = obj(r.action)
  const af = (f: string) => ({ field: `action.${f}` })
  const money = (v: unknown, what: string, f: string) => dec(v, what, { gt: 0, lt: BIG }, af(f))
  const stopRange = { gt: LIMITS.stopPct.min, lt: LIMITS.stopPct.max }
  const tpRange = { gt: LIMITS.tpPct.min, le: LIMITS.tpPct.max }
  switch (a?.type) {
    case 'CLOSE_POSITION': {
      const percent = dec(a.percent, 'how much to close', { gt: LIMITS.closePct.min, le: LIMITS.closePct.max }, af('percent'))
      if (percent) action = { type: 'CLOSE_POSITION', percent }
      break
    }
    case 'MOVE_SL':
    case 'SET_SL':
    case 'SET_TP': {
      const tg = target(a.target, 'action.target', a.type === 'SET_TP' ? tpRange : stopRange)
      if (tg) action = { type: a.type, target: tg }
      break
    }
    case 'ADD_MARGIN': {
      const usdt = money(a.usdt, 'an amount in USDT', 'usdt')
      if (usdt) action = { type: 'ADD_MARGIN', usdt }
      break
    }
    case 'OPEN_POSITION': {
      if (a.side !== 'LONG' && a.side !== 'SHORT') add('missing_value', 'Choose long or short', af('side'))
      const notionalUsdt = money(a.notionalUsdt, 'a size in USDT', 'notionalUsdt')
      const leverage = dec(a.leverage, 'leverage', { ge: LIMITS.leverage.min, le: LIMITS.leverage.max }, af('leverage'))
      // A stop on a new position sits on the losing side of entry, a take profit on the winning side.
      const sl = a.sl === undefined ? undefined : target(a.sl, 'action.sl', { gt: LIMITS.stopPct.min, lt: 0 })
      const tp = a.tp === undefined ? undefined : target(a.tp, 'action.tp', tpRange)
      if ((a.side === 'LONG' || a.side === 'SHORT') && notionalUsdt && leverage && sl !== null && tp !== null) {
        action = { type: 'OPEN_POSITION', side: a.side, notionalUsdt, leverage, ...(sl && { sl }), ...(tp && { tp }) }
      }
      break
    }
    case 'INCREASE_POSITION': {
      const notionalUsdt = money(a.notionalUsdt, 'a size in USDT', 'notionalUsdt')
      if (notionalUsdt) action = { type: 'INCREASE_POSITION', notionalUsdt }
      break
    }
    case 'CANCEL_ORDER':
    case 'NOTIFY':
      action = { type: a.type }
      break
    default:
      add('bad_action', 'Choose an action', { field: 'action' })
  }

  // Options
  const tr = obj(r.trigger)
  let trigger: Draft['trigger'] | null = null
  if (!oneOf(tr?.mode, MODES)) add('bad_value', 'Choose when it fires', { field: 'trigger.mode' })
  else if (tr.mode !== 'REPEAT') trigger = { mode: tr.mode }
  else {
    const sec = tr.intervalSec ?? LIMITS.repeatSec.default
    const { min, max } = LIMITS.repeatSec
    if (!Number.isInteger(sec) || (sec as number) < min || (sec as number) > max) add('bad_value', `Repeat every ${min / 60} min to ${max / 3600} h`, { field: 'trigger.intervalSec' })
    else trigger = { mode: 'REPEAT', intervalSec: sec as number }
  }
  const d = obj(r.delivery)
  const delivery = d && typeof d.glasses === 'boolean' && typeof d.phone === 'boolean' ? { glasses: d.glasses, phone: d.phone } : null
  if (!delivery) add('bad_value', 'Choose where alerts go', { field: 'delivery' })

  // How the parts fit together (§7). Only on parts that parsed, so one typo does not bury the rest.
  if (scope && action) {
    const title = ACTION_TITLE[action.type]
    const where = SCOPE_LABEL[scope.type]
    const rules = SCOPE_RULES[scope.type]
    if (!rules.actions.includes(action.type)) add('action_not_in_scope', `${title} is not available for ${where}`, { field: 'action' })
    for (const x of items) {
      if (!rules.conditions.includes(x.type)) add('not_in_scope', `${conditionLabel(x)} is not available for ${where}`, { conditionId: x.id })
      else if (CONDITION_ACTION[x.type][action.type] === 'N') add('incompatible_action', `${conditionLabel(x)} is incompatible with ${title}`, { conditionId: x.id })
    }
    const onPosition = action.type !== 'CANCEL_ORDER' && action.type !== 'NOTIFY'
    const incompatible = issues.some(i => i.code === 'incompatible_action') // one problem at a time
    if (scope.type === 'ORDER' && onPosition && !incompatible && !items.some(x => x.type === 'ORDER_FILLED' || x.type === 'ORDER_PARTIAL')) {
      add('needs_fill', `${title} on one order needs Order filled or Order partly filled`, { field: 'action' })
    }
    const priceTargets = [action.type === 'OPEN_POSITION' ? [action.sl, action.tp] : [], 'target' in action ? [action.target] : []].flat()
    if (scope.type === 'ALL_POSITIONS' && priceTargets.some(tg => tg?.kind === 'PRICE')) {
      add('price_needs_one_symbol', 'A price works for one symbol, not All positions: use a percent from entry', { field: 'action.target' })
    }
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const x = items[i], y = items[j]
      const pair = `${conditionLabel(x)} and ${conditionLabel(y)}`
      const at = { conditionId: y.id }
      const cell = STACKING[x.type][y.type]
      if (cell === '-') add('cannot_combine', `${pair} cannot be combined`, at)
      else if (cell === 'O' && logic === 'ALL') add('needs_or', `${pair} cannot both be true: use or`, at)
      else if (cell === 'A' && logic === 'ANY') add('needs_and', `${pair} only work with and`, at)
      else if (cell === 'V') sameMetric(x, y, logic, add)
    }
  }

  const crossings = items.filter(x => x.type === 'PRICE' && isEvent(x))
  if (crossings.length) {
    const other = items.find(x => !crossings.includes(x))
    if (logic === 'ANY' && other) add('crossing_or_state', 'A price crossing can only be or-ed with other crossings', { conditionId: other.id })
    if (logic === 'ALL' && crossings.length > 1) add('two_crossings', 'Two price crossings never happen at once: use or', { conditionId: crossings[1].id })
    const fill = items.find(x => x.type === 'ORDER_FILLED' || x.type === 'ORDER_PARTIAL')
    if (fill) add('crossing_with_fill', 'A fill goes with a price level, not a crossing', { conditionId: crossings[0].id })
  }
  const priced = items.filter(x => x.type === 'PRICE' || x.type === 'PRICE_CHANGE')
  const mixed = priced.find(x => 'source' in x && 'source' in priced[0] && x.source !== priced[0].source)
  if (mixed) add('mixed_source', 'Use one price source in a shortcut', { conditionId: mixed.id })

  if (trigger && action && items.length) {
    const hasEvent = items.some(isEvent)
    if (hasEvent && trigger.mode !== 'ON_EVENT' && trigger.mode !== 'ONCE') add('needs_on_event', 'A crossing, a fill or a close fires On event or Once', { field: 'trigger.mode' })
    if (!hasEvent && trigger.mode === 'ON_EVENT') add('needs_event', 'On event needs a price crossing, a fill or a close', { field: 'trigger.mode' })
    if ((action.type === 'OPEN_POSITION' || action.type === 'INCREASE_POSITION') && trigger.mode !== 'ONCE') {
      add('needs_once', `${ACTION_TITLE[action.type]} fires Once`, { field: 'trigger.mode' })
    }
  }
  if (action && delivery && isTrade(action.type) && !delivery.glasses) {
    add('needs_glasses', `${ACTION_TITLE[action.type]} is confirmed on Even G2: keep Glasses on`, { field: 'delivery' })
  }

  const ok = issues.length === 0 && allParsed && !!scope && !!action && !!trigger && !!delivery
  if (!ok) return { ok: false, issues }
  const value: EditableShortcut = {
    ...(name && { name }),
    scope: scope!, conditions: { logic, items }, ...(voicePhrase && { voicePhrase }),
    action: action!, trigger: trigger!, delivery: delivery!,
  }
  return { ok, issues, value }
}

/** Two conditions of the same type (cell V): duplicates, redundant limits, ranges that are never or always true. */
function sameMetric(x: Condition, y: Condition, logic: 'ALL' | 'ANY', add: (code: string, message: string, at?: { conditionId?: string }) => void) {
  const at = { conditionId: y.id }
  const label = conditionLabel(x)
  const same = JSON.stringify({ ...x, id: '' }) === JSON.stringify({ ...y, id: '' })
  if (same) return add('duplicate', `${label} is listed twice`, at)
  if (x.type === 'PRICE' && y.type === 'PRICE') {
    if (isEvent(x) || isEvent(y)) return // crossings: the crossing rules decide
    if (x.operator === y.operator) return add('redundant', `Two ${label.toLowerCase()} limits in the same direction: keep one`, at)
    const above = Number(x.operator === 'GTE' ? x.threshold : y.threshold)
    const below = Number(x.operator === 'LTE' ? x.threshold : y.threshold)
    if (logic === 'ALL' && above >= below) add('never_true', `${label} can never be above ${above} and below ${below}`, at)
    if (logic === 'ANY' && below >= above) add('always_true', `${label} is always above ${above} or below ${below}`, at)
    return
  }
  if (x.type === 'PRICE_CHANGE' && y.type === 'PRICE_CHANGE') {
    if (x.windowSec !== y.windowSec) return
    if (x.direction === y.direction) add('redundant', `Two ${label.toLowerCase()} limits in the same direction: keep one`, at)
    else if (logic === 'ALL') add('never_true', `${label} cannot rise and fall in the same window`, at)
    return
  }
  if ((x.type === 'PROFIT' || x.type === 'LOSS') && x.type === y.type && 'unit' in y) {
    if (x.unit === y.unit) add('redundant', `Two ${label} limits in the same direction: keep one`, at)
    return
  }
  if (x.type === 'NEAR_LIQUIDATION' || x.type === 'NEAR_SL' || x.type === 'NEAR_TP') return add('redundant', `${label} twice: keep one`, at)
  if (x.type === 'POSITION_CLOSED') {
    if (logic === 'ALL') add('needs_or', `A position closes one way at a time: use or`, at)
    return
  }
  if (x.type === 'VOLUME_SPIKE' && y.type === 'VOLUME_SPIKE' && x.windowSec !== y.windowSec) return
  return add('redundant', `${label} twice: keep one`, at) // funding, order age, volume in one window
}

/** For the editor: is this condition type, on its own, allowed for this action and scope? */
export const allowed = (scope: Scope['type'], condition: Condition['type'], action: Action['type']) =>
  SCOPE_RULES[scope].conditions.includes(condition) && SCOPE_RULES[scope].actions.includes(action) && CONDITION_ACTION[condition][action] !== 'N'

export { ACTION_TYPES, CONDITION_TYPES }
