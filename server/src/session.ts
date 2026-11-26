/**
 * The tick loop and the lens state: one REST poll every 2 s becomes per-target facts, shortcuts are evaluated with the
 * engine, a fired one raises an alert and (for trades) a proposal; a tap confirms it through the executor.
 * Spec: docs/shortcuts-architecture.md §8, §9.
 */
import type { AlertRecord, Balance, Candle, Channel, Exchange, Fill, Order, Position, Proposal, SessionState, Ticker } from './types.ts'
import type { Action, ClosedBy, Condition, ConditionType, PriceSource, ShortcutRule } from './registry.ts'
import { ACTION_TITLE, LIMITS, priority } from './registry.ts'
import type { Store } from './store.ts'
import type { EditableShortcut } from './validate.ts'
import { decide, evaluateCondition, evaluateGroup, initialTriggerState, VOLUME_BASE_MIN, volumeRatio, type Facts, type Protection, type Quote, type TriggerState } from './engine.ts'
import { executionLine, isMarket, isTpsl, positionLabel, queueOrder, reasonText, receiptLine, resolve, sameTerms, type Market, type Resolved, type TargetRef } from './proposals.ts'
import { closeProposal, createExecutor, type ConfirmResult } from './execute.ts'
import { matchShortcut, normalizePhrase } from './rules.ts'
import { coin, price } from './format.ts'

type Reply = { ok: boolean; message: string }
/** The glasses menu's commands and the seeded phrase each one raises. */
export const PHRASE = { stop: 'protect all', lock: 'lock profits', close: 'close all' } as const
export type Command = keyof typeof PHRASE

export type Session = {
  tick(): Promise<void>
  state(): SessionState
  /** The only way to trade: `idempotencyKey` comes from the client, a resend gets the same execution back. */
  confirm(proposalId: string, idempotencyKey: string): Promise<ConfirmResult>
  dismiss(proposalId: string, by: Channel): Reply
  /** Open on the lens: the size and leverage chosen from the card's picks. A fresh proposal with those terms replaces it. */
  pick(proposalId: string, size: number, leverage: number): Promise<Reply & { proposalId?: string }>
  /** Raises the proposals of the shortcut whose phrase was said. Nothing runs until a tap. */
  voice(text: string): Promise<Reply>
  /** Glasses menu: seeded protect, lock and close. `at` keeps one position and the toast says "close position". */
  command(kind: Command, at?: { symbol: string; positionIdx: number }): Promise<Reply>
  /** Editor · Options · Test: a simulated alert and proposal on the first target (§9). */
  test(shortcutId: string): Promise<Reply & { alertId?: string; proposalId?: string }>
  /** Editor: what a draft matches now ("3 now") and each condition's value per target. */
  preview(draft: Pick<EditableShortcut, 'scope' | 'conditions'>): { label: string; key: string; values: Record<string, number | null> }[]
  /** Apply to pickers: open positions with their epoch, and open non-protective orders. */
  pickers(): { positions: (Position & { epoch: string })[]; orders: Order[] }
  /** Detail's chart: the last hour of 1-minute last-price candles (start, close), oldest first; only for a symbol with an open position. */
  chart(symbol: string): Promise<Candle[]>
  /** The symbol picker's list: every symbol the exchange trades. */
  symbols(): Promise<string[]>
}

/** Where alerts go; without a notifier the lens is the only channel. */
export type Route = (alert: AlertRecord) => Channel[]

const SLOW_POLL_MS = 10_000
const TOAST_MS = 5_000
// shortcut: past this a flood drops its oldest waiting toast; trigger policies stop most floods
const MAX_TOASTS = 4
/** An input older than this is UNKNOWN, and the lens says the data is stale. */
const STALE_MS = 15_000
/** Fills are read with this overlap and deduped by execId, so one at a poll boundary is never lost. */
const FILL_OVERLAP_MS = 60_000
const RECENT_FILLS = 500
const TRIGGER_BY: Record<string, PriceSource> = { LastPrice: 'LAST', MarkPrice: 'MARK', IndexPrice: 'INDEX' }
/** Volume candles are read once a minute per symbol; older than this they are UNKNOWN. */
const VOLUME_POLL_MS = 60_000
/** Detail's chart: this many 1-minute closes, read again at most once a minute per symbol. */
const CHART_MIN = 60
const VOLUME_STALE_MS = 3 * VOLUME_POLL_MS
/** A write that is not done by then gets no receipt: History already says what happened. */
const RECEIPT_TTL_MS = 5 * 60_000

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
/** A position of Positions by coin: one of its coins, on its side. */
const ofCoins = (s: Extract<ShortcutRule['scope'], { type: 'COIN_POSITIONS' }>, symbol: string, side: Position['side']) =>
  s.symbols.includes(symbol) && (s.side === 'ANY' || s.side === (side === 'Buy' ? 'LONG' : 'SHORT'))
const opens = (a: Action): a is Extract<Action, { type: 'OPEN_LONG' | 'OPEN_SHORT' }> => a.type === 'OPEN_LONG' || a.type === 'OPEN_SHORT'

/** The exchange state one resolution reads. */
type Ctx = { positions: Position[]; orders: Order[]; balance: Balance | null; tickers: Record<string, Ticker> }
type Why = { reason: string; matched: string[]; type?: ConditionType; voice?: boolean; simulated?: boolean }

/** §5: absence is true only when verified; partial stops are a configuration the engine does not read. */
function protection(p: Position, orders: Order[], kind: 'StopLoss' | 'TakeProfit'): Protection {
  const mine = orders.filter(o => o.symbol === p.symbol && o.positionIdx === p.positionIdx)
  if (mine.some(o => o.stopOrderType === `Partial${kind}`)) return { state: 'partial' }
  const level = kind === 'StopLoss' ? p.stopLoss : p.takeProfit
  if (!level) return { state: 'none' }
  // shortcut: Bybit's default trigger (last price) when the full-mode stop order is not listed; check the listing on Demo
  return { state: 'set', price: level, triggerBy: TRIGGER_BY[mine.find(o => o.stopOrderType === kind)?.triggerBy ?? ''] ?? 'LAST' }
}

/** Crossings must still be on the triggered side and fills already happened: what a confirm checks again (§9 step 2). */
// A price change is measured from the alert's own price once it fired, so it has nothing left to recheck.
const asStates = (items: Condition[]): Condition[] => items.flatMap((c): Condition[] =>
  c.type === 'ORDER_FILLED' || c.type === 'ORDER_PARTIAL' || c.type === 'POSITION_CLOSED' || c.type === 'PRICE_CHANGE' ? []
    : c.type === 'PRICE' && c.operator === 'UP_CROSS' ? [{ ...c, operator: 'GTE' }]
    : c.type === 'PRICE' && c.operator === 'DOWN_CROSS' ? [{ ...c, operator: 'LTE' }]
    : [c])

export function createSession(ex: Exchange, store: Store, clock: () => number = Date.now, route?: Route): Session {
  const startedAt = clock()
  let positions: Position[] = []
  let orders: Order[] = []
  let balance: Balance | null = null
  let tickers: Record<string, Ticker> = {}
  let lastSlow = -Infinity
  let lastPositionsKey = ''
  let evaluationFailures = new Set<string>()
  // From the oldest open execution: an order acknowledged before a restart still reconciles from its fills.
  let lastFillTime = Math.min(startedAt, ...store.openExecutions().map(e => e.createdAt))
  const seenExec = new Set<string>()
  let recentFills: Fill[] = []
  /** Orders by id, also after they leave the open list: an ORDER shortcut still knows its order when the fill arrives. */
  const known = new Map<string, Order>()
  let quotes: Record<string, Partial<Record<PriceSource, Quote>>> = {}
  let prevQuotes: typeof quotes = {}
  let gap = true // the first poll has no sample before it, so it cannot make a crossing
  /** This poll's newest fresh execution per orderId: the ORDER_FILLED / ORDER_PARTIAL event. */
  let events = new Map<string, Fill>()
  /** This poll's closes by stop, take profit or liquidation, keyed by the position's target key. */
  type Close = { by: ClosedBy; orderId: string; price: number; symbol: string; side: Position['side']; idx: number; epoch: string }
  let closes = new Map<string, Close>()
  /** Last-price 1-minute candles per symbol for VOLUME_SPIKE, and when they were read. */
  const volumes = new Map<string, { at: number; candles: Candle[] }>()
  const charts = new Map<string, { at: number; candles: Candle[] }>()
  const epochs = new Map(Object.entries(store.epochs()))
  // shortcut: in memory, so a restart between the tap and the fill leaves that one without a receipt; store `before` on the execution if that matters
  const receipts = new Map<string, { before?: Position; epoch?: string; at: number }>()
  const toasts: { text: string; alertId?: string }[] = []
  let headSince = 0
  let error: string | null = null
  let updatedAt = 0

  const dropShown = () => {
    while (toasts.length && clock() - headSince >= TOAST_MS) { toasts.shift(); headSince += TOAST_MS }
  }
  /** `first`: the answer to the user's own tap or voice, shown at once ahead of the queue. */
  const say = (text: string, { first = false, alertId }: { first?: boolean; alertId?: string } = {}) => {
    dropShown()
    if (first || !toasts.length) headSince = clock()
    if (first) toasts.unshift({ text, alertId })
    else toasts.push({ text, alertId })
    if (toasts.length > MAX_TOASTS) toasts.splice(1, 1) // keep the one on screen, drop the oldest waiting
  }
  const ctxNow = (): Ctx => ({ positions, orders, balance, tickers })
  const routeOf: Route = route ?? (a => (a.delivery.glasses ? ['glasses'] : []))

  // ── targets and facts ───────────────────────────────────

  /** The position's lifecycle: a new one starts when it opens or flips side, so a reopened position is not the old one. */
  const epochOf = (p: Position) => {
    const e = epochs.get(`${p.symbol}:${p.positionIdx}`)
    return e?.startsWith(`${p.side}:`) ? e : `${p.side}:new`
  }

  function targetsOf(rule: Pick<ShortcutRule, 'scope'>, ps: Position[], os: Order[]): TargetRef[] {
    const s = rule.scope
    const pos = (p: Position): TargetRef => {
      const epoch = epochOf(p)
      return { key: `pos:${p.symbol}:${p.positionIdx}:${epoch}`, symbol: p.symbol, label: positionLabel(p), position: p, epoch }
    }
    const ord = (id: string, symbol: string, o: Order | undefined): TargetRef => {
      // position actions only through an opening order, mapped to the position it opened (§7): same slot, same side
      const p = o && !o.reduceOnly ? ps.find(p => p.symbol === o.symbol && p.positionIdx === o.positionIdx && p.side === o.side) : undefined
      return { key: `ord:${id}`, symbol, label: `${coin(symbol)} order`, order: o, position: p, epoch: p && epochOf(p) }
    }
    switch (s.type) {
      case 'ALL_POSITIONS': return ps.map(pos)
      case 'COIN_POSITIONS': return ps.filter(p => ofCoins(s, p.symbol, p.side)).map(pos)
      case 'POSITION': return ps.filter(p => p.symbol === s.symbol && p.positionIdx === s.positionIdx && epochOf(p) === s.epoch).map(pos)
      case 'SYMBOL': return [{ key: `sym:${s.symbol}`, symbol: s.symbol, label: coin(s.symbol) }]
      case 'ORDER': {
        const seen = os.find(o => o.orderId === s.orderId) ?? known.get(s.orderId)
        const o = seen?.symbol === s.symbol ? seen : undefined // an order id from another symbol is not this shortcut's order
        return [ord(s.orderId, s.symbol, o)]
      }
      case 'ALL_ORDERS': {
        // Every open plain order (stops and take profits excluded), and the filled ones that left the open list, so a fill
        // and a later tap still find their order. shortcut: only orders seen open in a poll; a market order fills before
        // the next poll and is skipped, read the execution's closedSize if market entries should count too.
        const open = os.filter(o => !isTpsl(o) && o.leavesQty > 0)
        const gone = new Map(recentFills.flatMap(f => {
          const o = known.get(f.orderId)
          return o && !isTpsl(o) && !open.some(x => x.orderId === o.orderId) ? [[o.orderId, o] as const] : []
        }))
        return [...open, ...gone.values()].map(o => ord(o.orderId, o.symbol, o))
      }
    }
  }

  /** Positions this poll closed by stop, take profit or liquidation that are gone now: targets for POSITION_CLOSED only. */
  function closedTargets(rule: ShortcutRule, live: TargetRef[]): TargetRef[] {
    if (!rule.conditions.items.some(c => c.type === 'POSITION_CLOSED')) return []
    const s = rule.scope
    return [...closes].flatMap(([key, c]) => {
      if (live.some(t => t.key === key)) return [] // a partial close: the live target carries it
      if (s.type === 'POSITION' && (s.symbol !== c.symbol || s.positionIdx !== c.idx || s.epoch !== c.epoch)) return []
      if (s.type === 'COIN_POSITIONS' && !ofCoins(s, c.symbol, c.side)) return []
      if (s.type !== 'POSITION' && s.type !== 'ALL_POSITIONS' && s.type !== 'COIN_POSITIONS') return []
      return [{ key, symbol: c.symbol, label: positionLabel(c), epoch: c.epoch }]
    })
  }

  /** `fresh`: a ticker read just now, in place of the last poll's prices. */
  function factsOf(t: TargetRef, now: number, os: Order[], base?: TriggerState['base'], fresh?: Ticker): Facts {
    const p = t.position
    const tk = fresh ?? tickers[t.symbol]
    const f = t.key.startsWith('ord:') ? events.get(t.key.slice(4)) : undefined
    return {
      prices: fresh ? { LAST: { price: fresh.last, ts: now }, MARK: { price: fresh.mark, ts: now }, INDEX: { price: fresh.index, ts: now } } : quotes[t.symbol] ?? {},
      prev: prevQuotes[t.symbol] ?? {},
      base,
      position: p && {
        side: p.side, size: p.size, entry: p.entryPrice, mark: p.markPrice, liqPrice: p.liqPrice > 0 ? p.liqPrice : null,
        unrealisedPnl: p.unrealisedPnl, positionIM: p.positionIM > 0 ? p.positionIM : null,
        stopLoss: protection(p, os, 'StopLoss'), takeProfit: protection(p, os, 'TakeProfit'), epoch: t.epoch ?? '', ts: now,
      },
      event: f && { kind: f.leavesQty > 0 ? 'PARTIAL' : 'FILLED', orderId: f.orderId, execId: f.id },
      volumeRatio: sec => {
        const v = volumes.get(t.symbol)
        return v && now - v.at <= VOLUME_STALE_MS ? volumeRatio(v.candles, sec, v.at) : null
      },
      funding: tk?.funding && { ...tk.funding, ts: fresh ? now : quotes[t.symbol]?.LAST?.ts ?? 0 },
      order: t.order && { open: os.some(o => o.orderId === t.order!.orderId), createdAt: t.order.createdAt },
      closed: closes.get(t.key),
    }
  }

  async function market(symbol: string, slots: boolean, c: Ctx): Promise<Market> {
    const [ticker, instrument, s] = await Promise.all([c.tickers[symbol] ?? ex.ticker(symbol), ex.instrument(symbol), slots ? ex.slots(symbol) : []])
    return { ticker, instrument, orders: c.orders, positions: c.positions, balance: c.balance, slots: s }
  }

  const titleOf = (rule: ShortcutRule) => rule.name ?? ACTION_TITLE[rule.action.type]
  const lifetimeMs = (rule: ShortcutRule) => {
    const { expiry } = store.settings()
    return (isMarket(rule.action) ? expiry.marketSec : expiry.protectionSec) * 1000
  }
  const detailOf = (rule: ShortcutRule, note?: string) => [titleOf(rule), note].filter(Boolean).join(' · ')

  // ── alerts and proposals ────────────────────────────────

  function alertStatus(a: AlertRecord, p?: Proposal): string {
    if (a.skip) return `Skipped · ${a.skip.reason}`
    if (a.simulated) return 'Simulation · nothing sent to Bybit'
    if (p) return 'Waiting for a tap on Even G2'
    return a.channels.includes('glasses') ? 'Shown on Even G2' : a.channels.includes('app') ? 'Shown in the app' : 'Logged'
  }

  /** One alert, and for a trade one resolved proposal or the reason it was skipped. Persisted in one transaction with its proposal. */
  async function raise(rule: ShortcutRule, t: TargetRef, why: Why, c: Ctx) {
    const now = clock()
    const a = rule.action
    const alert: AlertRecord = {
      id: crypto.randomUUID(), shortcutId: rule.id, version: rule.version, targetKey: t.key, target: t.label, title: titleOf(rule), actionType: a.type,
      reason: why.reason, matched: why.matched, priority: priority(rule), simulated: !!why.simulated, delivery: rule.delivery, channels: [], status: '', createdAt: now,
    }
    let proposal: Proposal | undefined
    {
      let r: Resolved
      try {
        // A notice needs no exchange read. The card is the whole action.
        r = a.type === 'NOTIFY'
          ? { ok: true, terms: { type: 'notify' }, question: '' }
          : resolve(a, t, await market(t.symbol, opens(a), c))
      } catch (e) {
        error = `${coin(t.symbol)}: ${errorText(e)}`
        return { alert, proposal, error: 'Could not read Bybit, try again' } // nothing saved: the next tick tries again
      }
      // A phrase or the menu asking for what a card already asks: that card answers it, a second one would ask twice.
      const same = r.ok && why.voice && store.pendingProposals().find(q =>
        q.targetKey === t.key && !q.simulated && sameTerms(q.terms, r.terms)
        && (q.terms.type !== 'notify' || (q.shortcutId === rule.id && q.version === rule.version)))
      if (same) return { alert, proposal: same }
      if (!r.ok) alert.skip = { code: r.code, reason: r.reason }
      else {
        const kind = why.voice ? `voice:${a.type === 'SET_SL' ? 'stop' : a.type === 'MOVE_SL' ? 'lock' : 'say'}`
          : why.type === 'NEAR_LIQUIDATION' ? 'liq' : a.type === 'MOVE_SL' ? 'lock' : a.type === 'SET_SL' ? 'nostop' : 'rule'
        proposal = {
          id: crypto.randomUUID(), key: `${kind}:${rule.id}:${t.key}`, title: `${why.simulated ? 'TEST · ' : ''}${t.label} · ${why.reason}`,
          who: t.label, why: why.reason, reasonType: why.type,
          detail: detailOf(rule, r.note), question: r.question, createdAt: now, expiresAt: now + lifetimeMs(rule),
          alertId: alert.id, shortcutId: rule.id, version: rule.version, targetKey: t.key, epoch: t.epoch, terms: r.terms,
          simulated: !!why.simulated, voice: why.voice, priority: alert.priority, status: 'PENDING',
          ...(opens(a) && (a.sizes.length > 1 || a.leverages.length > 1) && { picks: { sizes: a.sizes.map(Number), leverages: a.leverages.map(Number) } }),
        }
      }
    }
    // Phone-only notify stays in History and the app banner. It does not take the lens.
    if (proposal?.terms.type === 'notify' && !(rule.delivery.glasses && store.settings().notifications.glasses)) proposal = undefined
    const saved = store.transaction(() => {
      const current = store.getShortcut(rule.id)
      if (!current || current.version !== rule.version || (!why.simulated && !current.enabled)) return false
      const old = proposal && store.pendingProposals().find(q => q.shortcutId === rule.id && q.targetKey === t.key && q.simulated === proposal.simulated)
      if (old && proposal) {
        proposal.supersedes = old.id
        closeProposal(store, old, 'SUPERSEDED', 'Replaced by a newer alert')
      }
      alert.channels = alert.skip ? [] : routeOf(alert)
      alert.status = alertStatus(alert, proposal)
      store.saveAlert(alert)
      if (proposal) store.saveProposal(proposal)
      return true
    })
    if (!saved) return { alert, proposal: undefined, error: 'Shortcut changed' }
    return { alert, proposal }
  }

  /**
   * A pending proposal against fresh state (§9 step 3): unchanged, withdrawn with a reason, or replaced by a fresh one
   * (`supersedes`) when its resolved terms changed. Never adjusts the terms in place.
   */
  async function check(p: Proposal, c: Ctx): Promise<{ ok: true; rule: ShortcutRule; t: TargetRef } | { ok: false; reason: string; replaced?: boolean }> {
    const rule = store.getShortcut(p.shortcutId)
    if (!rule || rule.version !== p.version || !rule.enabled) return { ok: false, reason: 'shortcut changed' }
    const t = targetsOf(rule, c.positions, c.orders).find(t => t.key === p.targetKey)
    if (!t) return { ok: false, reason: p.terms.type === 'cancel' ? 'order is no longer open' : 'position is closed' }
    const r = resolve(rule.action, t, await market(t.symbol, opens(rule.action), c), p.terms)
    if (store.getShortcut(rule.id)?.version !== rule.version) return { ok: false, reason: 'shortcut changed' }
    if (!r.ok) return { ok: false, reason: r.reason }
    if (sameTerms(r.terms, p.terms)) return { ok: true, rule, t }
    const fresh = replace(p, rule, r, 'Refreshed · the terms changed')
    return { ok: false, reason: fresh ? 'the terms changed: a new proposal is waiting' : 'it changed meanwhile', replaced: true }
  }

  /** A fresh proposal with new terms in place of `p`, which stops counting. Never adjusts terms in place. */
  function replace(p: Proposal, rule: ShortcutRule, r: Extract<Resolved, { ok: true }>, status: string, extra: Partial<Proposal> = {}): Proposal | null {
    const now = clock()
    return store.transaction(() => {
      const current = store.proposal(p.id)
      if (!current || current.status !== p.status) return null
      if (current.status === 'PENDING') {
        if (current.expiresAt <= now) return null
        store.saveProposal({ ...current, status: 'SUPERSEDED' })
      } else if (current.status !== 'AUTHORIZED') return null
      const fresh: Proposal = { ...p, id: crypto.randomUUID(), terms: r.terms, question: r.question, detail: detailOf(rule, r.note), createdAt: now, expiresAt: now + lifetimeMs(rule), supersedes: p.id, status: 'PENDING', ...extra }
      store.saveProposal(fresh)
      const a = store.alert(p.alertId)
      if (a) store.saveAlert({ ...a, status })
      return fresh
    })
  }

  const executor = createExecutor({
    ex, store, clock,
    async revalidate(p) {
      if (p.terms.type === 'notify') return { ok: false, message: 'Nothing to send' }
      // fresh reads, not the last poll (§9 step 2): the price too, so a level or a distance is checked as it is at the tap
      const [ps, os, bal, tk] = await Promise.all([ex.positions(), ex.openOrders(), ex.balance(), ex.ticker(p.terms.symbol)])
      const c = await check(p, { positions: ps, orders: os, balance: bal, tickers: { [p.terms.symbol]: tk } })
      if (!c.ok) return { ok: false, message: c.reason }
      const pass = { ok: true as const, openLeverage: opens(c.rule.action) && p.terms.type === 'order' ? p.terms.leverage : undefined }
      if (p.voice) return pass // the phrase was the trigger, its conditions were never checked
      const { logic, items: original } = c.rule.conditions
      const items = asStates(original)
      if (!items.length) return pass
      // An event already recorded in History is still a true branch of an OR.
      if (logic === 'ANY' && store.alert(p.alertId)?.matched.some(id => !items.some(item => item.id === id))) return pass
      const now = clock()
      // Strict, not the hysteresis band: a crossing must still be on its side, a loss still a loss (§9 step 2).
      const g = evaluateGroup({ logic, items }, factsOf(c.t, now, os, undefined, tk), { now, staleMs: STALE_MS })
      return g.verdict === 'TRUE' ? pass : { ok: false, message: g.verdict === 'FALSE' ? 'the condition no longer holds' : 'could not check the condition' }
    },
  })

  // ── the poll ────────────────────────────────────────────

  async function tick() {
    const now = clock()
    const rules = store.listShortcuts().filter(r => r.enabled)
    const settings = store.settings()
    let fills: Fill[]
    // A failed fills read must not blind the position rules: they still run, and the fills come next tick (deduped by id).
    let fillsError: unknown = null
    try {
      const [ps, os, fl] = await Promise.all([ex.positions(), ex.openOrders(), ex.fillsSince(lastFillTime - FILL_OVERLAP_MS).catch(e => { fillsError = e; return [] })])
      // A close or partial close changes the balance: refresh it now, not in 10 s.
      const positionsKey = ps.map(p => `${p.symbol}:${p.positionIdx}:${p.size}`).sort().join()
      if (now - lastSlow >= SLOW_POLL_MS || positionsKey !== lastPositionsKey) {
        balance = await ex.balance().catch(() => balance)
        lastSlow = now
        lastPositionsKey = positionsKey
      }
      positions = ps
      orders = os
      fills = fl
      error = fillsError === null ? null : errorText(fillsError)
    } catch (e) {
      error = errorText(e) // keep the last good data, skip the rules on a partial read
      gap = true // the next good sample must not make a crossing with one from before the gap
      return
    }

    // Prices of every watched symbol; one bad symbol must not stop the others.
    const symbols = [...new Set([...positions.map(p => p.symbol), ...rules.flatMap(r => ('symbol' in r.scope ? [r.scope.symbol] : []))])]
    const got = await Promise.allSettled(symbols.map(s => ex.ticker(s)))
    prevQuotes = gap ? {} : quotes
    quotes = {}
    tickers = {}
    got.forEach((r, i) => {
      const s = symbols[i]
      if (r.status === 'rejected') { error = `${coin(s)}: ${errorText(r.reason)}`; return }
      tickers[s] = r.value
      quotes[s] = { LAST: { price: r.value.last, ts: now }, MARK: { price: r.value.mark, ts: now }, INDEX: { price: r.value.index, ts: now } }
    })
    gap = false

    // Volume candles for VOLUME_SPIKE, once a minute per symbol.
    const volumeSymbols = new Set(rules.filter(r => r.conditions.items.some(c => c.type === 'VOLUME_SPIKE'))
      .flatMap(r => ('symbol' in r.scope ? [r.scope.symbol] : positions.map(p => p.symbol))))
    for (const s of volumeSymbols) {
      if (now - (volumes.get(s)?.at ?? -Infinity) < VOLUME_POLL_MS) continue
      try {
        volumes.set(s, { at: now, candles: await ex.kline(s, 'LAST', LIMITS.volumeWindowSec.max / 60 + VOLUME_BASE_MIN + 1) })
      } catch { /* UNKNOWN until a later tick reads it */ }
    }

    // Position epochs; the ones before this poll name the positions a close in it ended.
    const before = new Map(epochs)
    const live = new Set<string>()
    for (const p of positions) {
      const k = `${p.symbol}:${p.positionIdx}`
      live.add(k)
      if (!epochs.get(k)?.startsWith(`${p.side}:`)) {
        const e = `${p.side}:${now}`
        epochs.set(k, e)
        store.saveEpoch(k, e)
      }
    }
    // Without this poll's fills a gone position's close comes next tick, and must still find the epoch it ended.
    if (fillsError === null) for (const k of [...epochs.keys()]) if (!live.has(k)) { epochs.delete(k); store.saveEpoch(k, null) }

    // Fills: deduped by execId; only fresh ones are events (never an old reconciled one, §8).
    const unseen = fills.filter(f => !seenExec.has(f.id)).sort((a, b) => a.time - b.time)
    const fresh = unseen.filter(f => f.time > startedAt) // older ones only reconcile: no toast, no event
    for (const f of unseen) seenExec.add(f.id)
    for (const f of fresh) say(`Filled ${f.side.toUpperCase()} ${f.qty} ${coin(f.symbol)} @ ${price(f.price)}`)
    recentFills = [...recentFills, ...unseen].slice(-RECENT_FILLS)
    if (seenExec.size > 4 * RECENT_FILLS) { seenExec.clear(); for (const f of recentFills) seenExec.add(f.id) }
    if (unseen.length) lastFillTime = Math.max(lastFillTime, unseen[unseen.length - 1].time)
    events = new Map(fresh.filter(f => now - f.time <= STALE_MS).map(f => [f.orderId, f]))
    closes = new Map()
    for (const f of fresh) {
      if (!f.closedBy || now - f.time > STALE_MS) continue
      const side = f.side === 'Buy' ? 'Sell' : 'Buy' // a close trades against the position
      // shortcut: a liquidation's order is not listed, so its slot is the one this side held; hedge mode with both sides of one symbol is fine, two slots of one side cannot happen
      const idx = known.get(f.orderId)?.positionIdx ?? [0, 1, 2].find(i => before.get(`${f.symbol}:${i}`)?.startsWith(`${side}:`))
      const epoch = idx === undefined ? undefined : before.get(`${f.symbol}:${idx}`)
      if (!epoch?.startsWith(`${side}:`)) continue // opened and closed between two polls: no position to name
      closes.set(`pos:${f.symbol}:${idx}:${epoch}`, { by: f.closedBy, orderId: f.orderId, price: f.price, symbol: f.symbol, side, idx: idx!, epoch })
    }
    for (const o of orders) known.set(o.orderId, o)
    // shortcut: forgets the oldest orders past 1000; keep only ORDER-scope ones if a trader keeps more
    while (known.size > 1000) known.delete(known.keys().next().value!)

    await executor.reconcile(recentFills, positions)

    // Receipts use positions read on a poll after the execution update, including after a partial fill.
    for (const [id, r] of receipts) {
      const e = store.execution(id)
      if (!e || e.status === 'REJECTED' || e.status === 'SIMULATED' || now - r.at > RECEIPT_TTL_MS) { receipts.delete(id); continue }
      const partial = e.status === 'PARTIALLY_FILLED'
      if ((partial ? !!e.receipt : e.status !== 'FILLED' && e.status !== 'APPLIED') || e.updatedAt >= now) continue
      const t = e.terms
      const after = t.type === 'cancel' || t.type === 'notify' ? undefined : positions.find(p => p.symbol === t.symbol && p.positionIdx === t.positionIdx)
      // Bybit updates its position timestamp on every fill, so compare the tracked lifecycle instead.
      if (after && r.before && r.epoch !== epochOf(after)) {
        receipts.delete(id)
        continue
      }
      if (t.type === 'order') {
        // Fills and position snapshots arrive independently from Bybit.
        const expected = (r.before?.size ?? 0) + (t.reduceOnly ? -e.filledQty : e.filledQty)
        if (Math.abs(expected - (after?.size ?? 0)) >= 0.5e-8 || (after && !r.before && after.side !== t.side)) continue
      }
      const receipt = receiptLine(t, r.before, after)
      if (!partial) receipts.delete(id)
      if (!receipt) continue
      store.transaction(() => {
        store.saveExecution({ ...e, receipt })
        const a = store.alert(store.proposal(e.proposalId)?.alertId ?? '')
        if (a && store.latestProposalForAlert(a.id)?.id === e.proposalId) {
          store.saveAlert({ ...a, status: `${executionLine(e)} · ${receipt}` })
        }
      })
    }

    // Pending proposals: expiry, then a recheck that withdraws or refreshes any that changed (§9).
    const head = store.pendingProposals().sort(queueOrder)[0] // what the lens shows, expired or not
    const c = ctxNow()
    for (const p of store.pendingProposals()) {
      if (p.expiresAt <= now) {
        const secs = Math.round((p.expiresAt - p.createdAt) / 1000)
        const notify = p.terms.type === 'notify'
        closeProposal(store, p, 'EXPIRED', notify ? `Expired · not acknowledged within ${secs} s` : `Expired · not confirmed within ${secs} s`)
        if (p.id === head?.id) say(notify ? `Expired: ${p.title}` : `Expired, nothing sent: ${p.title}`) // the card on the lens must not vanish without a word
        continue
      }
      if (p.simulated || p.terms.type === 'notify') continue // a notice stays until OK or expiry; the position may already be gone
      try {
        const r = await check(p, c)
        if (!r.ok && !r.replaced) closeProposal(store, p, 'SUPERSEDED', `Withdrawn · ${r.reason}`)
      } catch { /* a read failed: check it again next tick */ }
    }

    // The engine: every enabled shortcut with conditions, on every target of its scope. Voice-only ones are never evaluated.
    const waiting = new Set(store.pendingProposals().filter(p => !p.simulated).map(p => `${p.shortcutId}:${p.targetKey}`))
    const failed = new Set<string>()
    // shortcut: trigger_state keeps a row per rule and position epoch for good; prune closed epochs if the table grows
    for (const rule of rules) {
      try {
        if (!rule.conditions.items.length) continue
        const live = targetsOf(rule, positions, orders)
        const priced = rule.conditions.items.some(c => c.type === 'PRICE_CHANGE')
        for (const t of [...live, ...closedTargets(rule, live)]) {
          const key = `${rule.id}:${t.key}`
          const saved = store.trigger(key)
          let s = saved?.version === rule.version ? saved : initialTriggerState(rule.version)
          const q = quotes[t.symbol]
          const pricesNow = q && Object.fromEntries(Object.entries(q).map(([src, x]) => [src, x.price]))
          // Price change counts from the first price this version sees for the target.
          if (priced && pricesNow) s = { ...s, base: { ...pricesNow, ...s.base } }
          const g = evaluateGroup(rule.conditions, factsOf(t, now, orders, s.base), { now, staleMs: STALE_MS, relaxed: s.phase === 'fired' })
          const d = decide(rule, g, s, now, { cooldownSec: settings.cooldownSec, pending: waiting.has(key) })
          if (d.fire) {
            const cond = rule.conditions.items.find(c => c.id === g.reason?.id)
            const r = await raise(rule, t, { reason: cond ? reasonText(cond, g.reason?.value) : 'matched', type: cond?.type, matched: g.matched }, c)
            if (r.error) continue // a read error must not use up a Once shortcut or start its cooldown
            if (r.proposal) waiting.add(key)
            else if (r.alert.skip) d.next.latched = s.latched // nothing was sent: a skip does not use up a Once shortcut, it waits for a new entry
            if (priced && pricesNow) d.next.base = pricesNow // the next alert needs a new move from here
          }
          if (!saved || JSON.stringify(d.next) !== JSON.stringify(saved)) store.saveTrigger(key, d.next)
        }
      } catch {
        const key = `${rule.id}:${rule.version}`
        failed.add(key)
        if (evaluationFailures.has(key)) continue
        console.warn(`Shortcut evaluation failed: ${key}`)
        store.audit('shortcut', rule.id, 'evaluation_failed', `version ${rule.version}`)
      }
    }
    evaluationFailures = failed
    updatedAt = now
  }

  const queue = () => {
    const now = clock()
    return store.pendingProposals().filter(p => p.expiresAt > now).sort(queueOrder)
  }

  async function voice(text: string, at?: { symbol: string; positionIdx: number }, said?: string): Promise<Reply> {
    const reply = (message: string) => { say(message, { first: true }); return { ok: false, message } }
    if (!normalizePhrase(text)) return reply('Heard nothing')
    const rule = matchShortcut(text, store.listShortcuts().filter(r => r.enabled))
    if (!rule) return reply(`No shortcut for "${text}"`)
    let n = 0
    for (const t of targetsOf(rule, positions, orders)) {
      if (at && (t.position?.symbol !== at.symbol || t.position.positionIdx !== at.positionIdx)) continue
      if ((await raise(rule, t, { reason: `Voice: ${rule.voicePhrase}`, matched: [], voice: true }, ctxNow())).proposal) n++
    }
    const heard = said ?? rule.voicePhrase
    if (!n) return reply(`Heard "${heard}" · nothing to change`)
    return { ok: true, message: `Heard "${heard}" · ${n} proposal${n > 1 ? 's' : ''}` }
  }

  return {
    tick,

    state(): SessionState {
      dropShown()
      const q = queue()
      const enabled = store.listShortcuts().filter(r => r.enabled)
      const onByPosition: Record<string, number> = {}
      for (const p of positions) {
        const key = `${p.symbol}:${p.positionIdx}`
        onByPosition[key] = enabled.filter(r =>
          targetsOf(r, positions, orders).some(t => t.position?.symbol === p.symbol && t.position.positionIdx === p.positionIdx)).length
      }
      return {
        positions,
        balance,
        card: q[0] ?? null,
        pending: q.length,
        toast: toasts[0]?.text ?? null,
        toastAlertId: toasts[0]?.alertId,
        error: error ?? (updatedAt && clock() - updatedAt > STALE_MS ? `No fresh data for ${Math.round((clock() - updatedAt) / 1000)}s` : null),
        updatedAt,
        onByPosition,
      }
    },

    async confirm(proposalId, idempotencyKey) {
      const p = store.proposal(proposalId)
      if (p?.terms.type === 'notify') return { ok: false, message: 'Nothing to send' }
      // Its terms hold placeholder choices: only the proposal a pick made can be confirmed
      if (p?.picks && p.status === 'PENDING') return { ok: false, message: 'Pick the size and leverage on Even G2 first' }
      const t = p?.terms
      // Only a first tap: a resend gets the old execution back, and the last poll would already be its after side.
      const first = !store.executionByKey(idempotencyKey) && !store.executionByProposal(proposalId)
      // the last poll is what the alert showed: the before side of the receipt
      const before = t && t.type !== 'cancel' ? positions.find(x => x.symbol === t.symbol && x.positionIdx === t.positionIdx) : undefined
      const epoch = before && epochOf(before)
      const r = await executor.confirm(proposalId, idempotencyKey)
      if (first && r.execution && t?.type !== 'cancel') receipts.set(r.execution.id, { before, epoch, at: clock() })
      // A failed fresh check did not consume the rule. A later valid sample may raise a new proposal.
      if (first && p && r.execution?.status === 'REJECTED') {
        const reason = r.execution.message
        const recheckFailed = reason === 'the condition no longer holds' || reason === 'could not check the condition'
          || reason.startsWith('could not check the position')
        if (recheckFailed) {
          const key = `${p.shortcutId}:${p.targetKey}`
          const s = store.trigger(key)
          if (s?.version === p.version) store.saveTrigger(key, { ...s, phase: 'armed', lastAlertAt: null, latched: false })
        }
      }
      say(r.message, { first: true })
      return r
    },

    dismiss(proposalId, by) {
      const p = store.proposal(proposalId)
      if (!p || p.status !== 'PENDING') return { ok: false, message: 'Proposal is gone' }
      const where = by === 'glasses' ? 'Even G2' : 'the phone'
      const notice = p.terms.type === 'notify'
      closeProposal(store, p, 'DISMISSED', notice ? `OK on ${where}` : `Dismissed on ${where}`, { dismissedBy: by })
      return { ok: true, message: notice ? 'OK' : 'Dismissed, nothing sent' }
    },

    async pick(proposalId, size, leverage) {
      const p = store.proposal(proposalId)
      if (!p || p.status !== 'PENDING' || p.expiresAt <= clock()) return { ok: false, message: 'Proposal is gone' }
      // Only what the card offered: the client names a choice, the server builds the terms.
      if (!p.picks?.sizes.includes(size) || !p.picks.leverages.includes(leverage)) return { ok: false, message: 'Not one of the choices' }
      const rule = store.getShortcut(p.shortcutId)
      if (!rule || rule.version !== p.version || (!p.simulated && !rule.enabled) || !opens(rule.action)) return { ok: false, message: 'Shortcut changed' }
      const t = targetsOf(rule, positions, orders).find(t => t.key === p.targetKey)
      if (!t) return { ok: false, message: 'Nothing to open on' }
      let r: Resolved
      try {
        r = resolve(rule.action, t, await market(t.symbol, true, ctxNow()), undefined, undefined, { size, leverage })
      } catch (e) {
        return { ok: false, message: `Could not read Bybit: ${errorText(e)}` }
      }
      if (!r.ok) return { ok: false, message: r.reason.charAt(0).toUpperCase() + r.reason.slice(1) }
      // No picks left: the next page is Review. A test stays a test.
      const fresh = replace(p, rule, r, `Chose ${size} USDT · ${leverage}x`, { picks: undefined })
      if (!fresh) return { ok: false, message: 'Proposal is gone' }
      return { ok: true, message: fresh.question, proposalId: fresh.id }
    },

    voice: text => voice(text),
    // Close of one position matches the "close all" seed, then keeps that position. The toast names that one position.
    command: (kind, at) => voice(PHRASE[kind], at, kind === 'close' && at ? 'close position' : undefined),

    async test(shortcutId) {
      const rule = store.getShortcut(shortcutId)
      if (!rule) return { ok: false, message: 'No such shortcut' }
      if (rule.draft) return { ok: false, message: 'Complete the shortcut before testing it' }
      const t = targetsOf(rule, positions, orders)[0]
      if (!t) return { ok: false, message: 'Nothing to test on now: no position or order it applies to' }
      const { alert, proposal, error } = await raise(rule, t, { reason: 'Test alert', matched: [], simulated: true }, ctxNow())
      if (error) return { ok: false, message: error }
      return { ok: !alert.skip, message: alert.status, alertId: alert.id, proposalId: proposal?.id }
    },

    preview(draft) {
      const now = clock()
      return targetsOf(draft, positions, orders).map(t => {
        const f = factsOf(t, now, orders)
        return { key: t.key, label: t.label, values: Object.fromEntries(draft.conditions.items.map(c => [c.id, evaluateCondition(c, f, { now, staleMs: STALE_MS }).value ?? null])) }
      })
    },

    pickers: () => ({
      positions: positions.map(p => ({ ...p, epoch: epochOf(p) })),
      orders: orders.filter(o => !isTpsl(o) && o.leavesQty > 0),
    }),

    async chart(symbol) {
      if (!positions.some(p => p.symbol === symbol)) return [] // the lens never asks for others; nobody else spends the Bybit rate limit
      const now = clock()
      const c = charts.get(symbol)
      if (c && now - c.at < VOLUME_POLL_MS) return c.candles
      const candles = (await ex.kline(symbol, 'LAST', CHART_MIN)).sort((a, b) => a.start - b.start).map(k => ({ start: k.start, close: k.close }))
      charts.set(symbol, { at: now, candles })
      return candles
    },

    symbols: () => ex.symbols(),
  }
}
