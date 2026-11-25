/**
 * The pure half of the shortcut engine: four-valued conditions, groups, trigger policies and rolling price windows.
 * No I/O and no timers: the caller passes the clock. Spec: docs/shortcuts-architecture.md §5, §8.
 */
import { isEvent, LIMITS, SEVERITY } from './registry.ts'
import type { ClosedBy, Condition, ConditionType, Dec, PriceSource, ShortcutRule } from './registry.ts'
import type { Side } from './types.ts'

export interface Quote { price: number; ts: number }

export type Protection = { state: 'none' } | { state: 'set'; price: number; triggerBy: PriceSource } | { state: 'unknown' } | { state: 'partial' }

export interface PositionFacts {
  side: Side
  size: number
  entry: number
  mark: number
  /** null when Bybit gives none */
  liqPrice: number | null
  unrealisedPnl: number
  /** null when unknown: ROI is then UNKNOWN */
  positionIM: number | null
  stopLoss: Protection
  takeProfit: Protection
  epoch: string
  /** when the position was read */
  ts: number
}

/** Everything one target's conditions read, built from one REST poll. */
export interface Facts {
  prices: Partial<Record<PriceSource, Quote>>
  /** The sample before `prices`, per source. Leave it out after a failed poll so a gap never makes a crossing. */
  prev: Partial<Record<PriceSource, Quote>>
  windowAgo: (source: PriceSource, windowSec: number) => number | null
  position?: PositionFacts
  /** The target order's new execution in this poll: comes from diffing two polls, so never from the first one. */
  event?: { kind: 'FILLED' | 'PARTIAL'; orderId: string; execId: string }
  /** VOLUME_SPIKE: the multiple of the window's volume over the hour before it; null when unknown. */
  volumeRatio?: (windowSec: number) => number | null
  /** The symbol's next funding: rate in percent (positive: longs pay) and when it is charged. */
  funding?: { ratePct: number; at: number; ts: number }
  /** ORDER_STALE: the target order, and whether it is still open. */
  order?: { open: boolean; createdAt?: number }
  /** This poll's close of the target position by its stop, take profit or a liquidation; `orderId` dedupes split fills. */
  closed?: { by: ClosedBy; orderId: string; price: number }
}

export type Verdict = 'TRUE' | 'FALSE' | 'UNKNOWN' | 'NOT_APPLICABLE'
export interface ConditionResult { verdict: Verdict; value?: number }

export interface EvalOpts {
  now: number
  /** An input older than this is UNKNOWN. */
  staleMs: number
  /** The rule already fired for this target: thresholds give way by the band, so a wobble on the line does not rearm it. */
  relaxed?: boolean
}

/** Band for percent metrics (ROI, distances, price change), in percentage points. */
export const BAND_POINTS = 0.5
/** Band for prices and USDT amounts, in percent of the level. */
export const BAND_LEVEL_PCT = 0.5

const UNKNOWN: ConditionResult = { verdict: 'UNKNOWN' }
const NOT_APPLICABLE: ConditionResult = { verdict: 'NOT_APPLICABLE' }
const is = (ok: boolean, value?: number): ConditionResult => ({ verdict: ok ? 'TRUE' : 'FALSE', value })

/** One condition against one target's facts, with the §5 formulas. Pure. */
export function evaluateCondition(c: Condition, f: Facts, o: EvalOpts): ConditionResult {
  const fresh = (ts: number) => o.now - ts <= o.staleMs
  const quote = (s: PriceSource) => { const q = f.prices[s]; return q && fresh(q.ts) ? q : undefined }
  const points = o.relaxed ? BAND_POINTS : 0
  const ofLevel = (n: number) => (o.relaxed ? (n * BAND_LEVEL_PCT) / 100 : 0)
  const near = (dist: number, max: Dec) => is(dist <= Number(max) + points, dist)
  const p = f.position && f.position.size > 0 && fresh(f.position.ts) ? f.position : undefined
  const d = p?.side === 'Sell' ? -1 : 1

  switch (c.type) {
    case 'PRICE': {
      const cur = quote(c.source)
      if (!cur) return UNKNOWN
      const t = Number(c.threshold)
      if (c.operator === 'GTE') return is(cur.price >= t - ofLevel(t), cur.price)
      if (c.operator === 'LTE') return is(cur.price <= t + ofLevel(t), cur.price)
      const prev = f.prev[c.source]
      if (!prev || cur.ts - prev.ts > o.staleMs) return UNKNOWN // the first sample, or one from before a gap
      return is(c.operator === 'UP_CROSS' ? prev.price < t && t <= cur.price : prev.price > t && t >= cur.price, cur.price)
    }
    case 'PRICE_CHANGE': {
      const cur = quote(c.source)
      const ago = cur && f.windowAgo(c.source, c.windowSec)
      if (!cur || !ago) return UNKNOWN
      const change = 100 * (cur.price / ago - 1)
      const min = Number(c.percent) - points
      return is(c.direction === 'UP' ? change >= min : change <= -min, change)
    }
    case 'PROFIT':
    case 'LOSS': {
      if (!p) return UNKNOWN
      const usdt = c.unit === 'USDT'
      const v = usdt ? p.unrealisedPnl : p.positionIM ? (100 * p.unrealisedPnl) / p.positionIM : null
      if (v === null) return UNKNOWN
      const n = Number(c.threshold)
      const min = n - (usdt ? ofLevel(n) : points)
      return is(c.type === 'PROFIT' ? v >= min : v <= -min, v)
    }
    case 'NEAR_LIQUIDATION':
      if (!p) return UNKNOWN
      if (p.liqPrice === null) return NOT_APPLICABLE
      return near((100 * d * (p.mark - p.liqPrice)) / p.mark, c.distancePct)
    case 'NEAR_SL':
    case 'NEAR_TP': {
      if (!p) return UNKNOWN
      const level = c.type === 'NEAR_SL' ? p.stopLoss : p.takeProfit
      if (level.state === 'none') return NOT_APPLICABLE
      if (level.state !== 'set') return UNKNOWN // unknown, or partial stops the engine does not read
      const px = quote(level.triggerBy)?.price
      if (px === undefined) return UNKNOWN
      return near(c.type === 'NEAR_SL' ? (100 * d * (px - level.price)) / px : (100 * d * (level.price - px)) / px, c.distancePct)
    }
    case 'SL_MISSING':
      if (!p) return UNKNOWN
      return p.stopLoss.state === 'none' ? is(true) : p.stopLoss.state === 'set' ? is(false) : UNKNOWN
    case 'ORDER_FILLED':
    case 'ORDER_PARTIAL':
      return is(f.event?.kind === (c.type === 'ORDER_FILLED' ? 'FILLED' : 'PARTIAL'))
    case 'VOLUME_SPIKE': {
      const x = f.volumeRatio?.(c.windowSec) ?? null
      if (x === null) return UNKNOWN
      const n = Number(c.multiplier)
      return is(x >= n - ofLevel(n), x)
    }
    case 'FUNDING': {
      const fd = f.funding && fresh(f.funding.ts) ? f.funding : undefined
      const left = fd && fd.at - o.now
      if (!fd || left === undefined || left < 0) return UNKNOWN // past the charge: the ticker has not rolled over yet
      // A position pays when its side matches the rate's sign; a symbol alone watches either side.
      const pays = f.position ? (p ? d * fd.ratePct : null) : Math.abs(fd.ratePct)
      if (pays === null) return UNKNOWN
      const n = Number(c.ratePct)
      return is(left <= c.minutesBefore * 60_000 && pays >= n - ofLevel(n), pays)
    }
    case 'ORDER_STALE': {
      if (!f.order || f.order.createdAt === undefined) return UNKNOWN
      if (!f.order.open) return NOT_APPLICABLE
      const age = (o.now - f.order.createdAt) / 60_000
      return is(age >= c.minutes, age)
    }
    case 'POSITION_CLOSED':
      return is(f.closed?.by === c.by, f.closed?.price)
  }
}

export interface GroupResult {
  verdict: 'TRUE' | 'FALSE' | 'UNKNOWN'
  /** ids of the TRUE conditions */
  matched: string[]
  /** The strongest TRUE condition (§5 rank): the one reason the lens shows. */
  reason?: { id: string; type: ConditionType; value?: number }
  /** Identity of each TRUE edge condition, for dedupe: `exec:<execId>`, or `<source>@<ts>` of the crossing sample. */
  events: string[]
}

const eventKey = (c: Condition, f: Facts) =>
  c.type === 'PRICE' ? `${c.source}@${f.prices[c.source]?.ts}` : c.type === 'POSITION_CLOSED' ? `close:${f.closed?.orderId}` : `exec:${f.event?.execId}`

/** A rule's conditions with the §8 truth rules. No items (voice-only) is UNKNOWN. Pure. */
export function evaluateGroup(g: ShortcutRule['conditions'], f: Facts, o: EvalOpts): GroupResult {
  const results = g.items.map(c => ({ c, ...evaluateCondition(c, f, o) }))
  const some = (...v: Verdict[]) => results.some(r => v.includes(r.verdict))
  const verdict = !results.length ? 'UNKNOWN'
    : g.logic === 'ALL' ? (some('FALSE', 'NOT_APPLICABLE') ? 'FALSE' : some('UNKNOWN') ? 'UNKNOWN' : 'TRUE')
    : some('TRUE') ? 'TRUE' : some('UNKNOWN') ? 'UNKNOWN' : 'FALSE'
  const hits = results.filter(r => r.verdict === 'TRUE')
  const top = hits.toSorted((a, b) => SEVERITY[a.c.type] - SEVERITY[b.c.type])[0]
  return {
    verdict,
    matched: hits.map(r => r.c.id),
    reason: top && { id: top.c.id, type: top.c.type, value: top.value },
    events: hits.filter(r => isEvent(r.c)).map(r => eventKey(r.c, f)),
  }
}

export const DEFAULT_COOLDOWN_SEC = 60
// shortcut: remembers the last 50 event keys, so a duplicate older than that fires again; keep a time-bounded set if fills arrive in bursts.
const SEEN_MAX = 50

/** Per rule and target; plain JSON so it can be persisted. */
export interface TriggerState {
  /** The rule version it belongs to: another version starts over. */
  version: number
  /** start: nothing definite yet. armed: a definite FALSE seen. fired: alerted; evaluate with `relaxed` until a definite FALSE. */
  phase: 'start' | 'armed' | 'fired'
  lastAlertAt: number | null
  /** recent event keys, newest last */
  seen: string[]
  /** ONCE has fired; only rearm() clears it */
  latched: boolean
}

export const initialTriggerState = (version: number): TriggerState => ({ version, phase: 'start', lastAlertAt: null, seen: [], latched: false })

/** The explicit rearm of a ONCE rule. It still waits for a new entry or a new event. */
export const rearm = (s: TriggerState): TriggerState => ({ ...s, latched: false })

export interface Decision { fire: boolean; currentlyMatches: boolean; next: TriggerState }

/**
 * Whether this evaluation raises an alert, by the rule's trigger mode (§8). Pure.
 * `pending`: the previous alert's proposal is unresolved (REPEAT waits for it). `cooldownSec` applies to state alerts only.
 */
export function decide(
  rule: Pick<ShortcutRule, 'version' | 'enabled' | 'conditions' | 'trigger'>,
  g: GroupResult,
  state: TriggerState,
  now: number,
  o: { cooldownSec?: number; pending?: boolean } = {},
): Decision {
  const s = state.version === rule.version ? state : initialTriggerState(rule.version)
  if (!rule.enabled || !rule.conditions.items.length) return { fire: false, currentlyMatches: false, next: s }
  const { mode } = rule.trigger
  const edge = mode === 'ON_EVENT' || (mode === 'ONCE' && rule.conditions.items.some(isEvent))
  const fresh = edge ? g.events.filter(k => !s.seen.includes(k)) : []
  const waitSec = Math.max(o.cooldownSec ?? DEFAULT_COOLDOWN_SEC, mode === 'REPEAT' ? (rule.trigger.intervalSec ?? LIMITS.repeatSec.default) : 0)
  const cooled = s.lastAlertAt === null || now - s.lastAlertAt >= waitSec * 1000
  const hit = g.verdict === 'TRUE' && (edge ? fresh.length > 0 : mode === 'REPEAT' ? cooled && !o.pending : cooled && s.phase !== 'fired')
  const fire = hit && !(mode === 'ONCE' && s.latched)
  return {
    fire,
    currentlyMatches: fire && !edge && s.phase === 'start',
    next: {
      version: s.version,
      phase: g.verdict === 'FALSE' ? 'armed' : hit ? 'fired' : s.phase,
      lastAlertAt: fire ? now : s.lastAlertAt,
      seen: fresh.length ? [...s.seen, ...fresh].slice(-SEEN_MAX) : s.seen,
      latched: s.latched || (mode === 'ONCE' && fire),
    },
  }
}

const MINUTE_MS = 60_000
const GAP_MS = 2 * MINUTE_MS
const KEEP_MS = LIMITS.windowSec.max * 1000 + GAP_MS

/** Price history of one symbol and source, for PRICE_CHANGE. Holds the largest window plus the gap allowance. */
export class PriceWindow {
  // shortcut: bounded by time, not count (a 1 s poll keeps ~14,500 points); downsample when WS ticks feed it.
  #points: [ts: number, price: number][] = []

  push(ts: number, price: number) {
    const pts = this.#points
    let i = pts.length
    while (i > 0 && pts[i - 1][0] > ts) i--
    if (pts[i - 1]?.[0] === ts) pts[i - 1] = [ts, price]
    else pts.splice(i, 0, [ts, price])
    const cut = pts[pts.length - 1][0] - KEEP_MS
    while (pts[0][0] < cut) pts.shift()
  }

  /** 1-minute candles in any order. A close is the price at the candle's end; the candle still open at `now` is skipped. */
  warm(candles: { start: number; close: number }[], now: number) {
    for (const k of candles) if (k.start + MINUTE_MS <= now) this.push(k.start + MINUTE_MS, k.close)
  }

  /** The price at or just before now − window; null before the history or inside a gap over 2 minutes. */
  ago(windowSec: number, now: number): number | null {
    const target = now - windowSec * 1000
    const pts = this.#points
    let i = pts.length - 1
    while (i >= 0 && pts[i][0] > target) i--
    if (i < 0) return null
    return (pts[i + 1]?.[0] ?? now) - pts[i][0] > GAP_MS ? null : pts[i][1]
  }
}

/** Minutes of volume the window is measured against. */
export const VOLUME_BASE_MIN = 60

/**
 * VOLUME_SPIKE's number: average volume per minute of the last `windowSec` of closed candles, over that of the hour before.
 * `at` is when the candles were read, so the candle still open then never counts. Null without enough history. Pure.
 */
export function volumeRatio(candles: { start: number; volume?: number }[], windowSec: number, at: number): number | null {
  const ks = candles.filter(k => k.volume !== undefined && k.start + MINUTE_MS <= at).sort((a, b) => a.start - b.start)
  const n = windowSec / 60
  const recent = ks.slice(-n)
  const base = ks.slice(-n - VOLUME_BASE_MIN, -n)
  if (recent.length < n || base.length < VOLUME_BASE_MIN / 2) return null
  const avg = (xs: typeof ks) => xs.reduce((sum, k) => sum + k.volume!, 0) / xs.length
  const b = avg(base)
  return b > 0 ? avg(recent) / b : null
}
