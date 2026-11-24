/**
 * The tick loop and the lens state: one REST poll every 2 s becomes per-target facts, shortcuts are evaluated with the
 * engine, a fired one raises an alert and (for trades) a proposal; a tap confirms it through the executor.
 * Spec: docs/shortcuts-architecture.md §8, §9.
 */
import type { AlertRecord, Balance, Channel, Exchange, Fill, Order, Position, Proposal, SessionState, Ticker } from './types.ts'
import type { Condition, ConditionType, PriceSource, ShortcutRule } from './registry.ts'
import { ACTION_TITLE, LIMITS, priority } from './registry.ts'
import type { Store } from './store.ts'
import type { EditableShortcut } from './validate.ts'
import { decide, evaluateCondition, evaluateGroup, initialTriggerState, PriceWindow, type Facts, type Protection, type Quote } from './engine.ts'
import { isMarket, positionLabel, queueOrder, reasonText, resolve, sameTerms, type Market, type Resolved, type TargetRef } from './proposals.ts'
import { closeProposal, createExecutor, type ConfirmResult } from './execute.ts'
import { matchShortcut, normalizePhrase } from './rules.ts'
import { coin, price } from './format.ts'

type Reply = { ok: boolean; message: string }

export type Session = {
  tick(): Promise<void>
  state(): SessionState
  /** The only way to trade: `idempotencyKey` comes from the client, a resend gets the same execution back. */
  confirm(proposalId: string, idempotencyKey: string): Promise<ConfirmResult>
  dismiss(proposalId: string, by: Channel): Reply
  /** Raises the proposals of the shortcut whose phrase was said. Nothing runs until a tap. */
  voice(text: string): Promise<Reply>
  /** Glasses menu: the seeded "protect all" and "lock profits" shortcuts, by phrase. */
  command(kind: 'stop' | 'lock'): Promise<Reply>
  /** Editor · Options · Test: a simulated alert and proposal on the first target (§9). */
  test(shortcutId: string): Promise<Reply & { alertId?: string; proposalId?: string }>
  /** Editor: what a draft matches now ("3 now") and each condition's value per target. */
  preview(draft: Pick<EditableShortcut, 'scope' | 'conditions'>): { label: string; key: string; values: Record<string, number | null> }[]
  /** Apply to pickers: open positions with their epoch, and open non-protective orders. */
  pickers(): { positions: (Position & { epoch: string })[]; orders: Order[] }
}

/** Where alerts go; without a notifier the lens is the only channel. */
export type Route = (alert: AlertRecord, proposal?: Proposal) => Channel[]

const SLOW_POLL_MS = 10_000
const TOAST_MS = 5_000
// shortcut: past this a flood drops its oldest waiting toast; trigger policies stop most floods
const MAX_TOASTS = 4
const DAY_MS = 86_400_000
/** An input older than this is UNKNOWN, and the lens says the data is stale. */
const STALE_MS = 15_000
/** Fills are read with this overlap and deduped by execId, so one at a poll boundary is never lost. */
const FILL_OVERLAP_MS = 60_000
const RECENT_FILLS = 500
const SOURCES: PriceSource[] = ['LAST', 'MARK', 'INDEX']
const TRIGGER_BY: Record<string, PriceSource> = { LastPrice: 'LAST', MarkPrice: 'MARK', IndexPrice: 'INDEX' }

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

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
const asStates = (items: Condition[]): Condition[] => items.flatMap((c): Condition[] =>
  c.type === 'ORDER_FILLED' || c.type === 'ORDER_PARTIAL' ? []
    : c.type === 'PRICE' && c.operator === 'UP_CROSS' ? [{ ...c, operator: 'GTE' }]
    : c.type === 'PRICE' && c.operator === 'DOWN_CROSS' ? [{ ...c, operator: 'LTE' }]
    : [c])

export function createSession(ex: Exchange, store: Store, clock: () => number = Date.now, route?: Route): Session {
  const startedAt = clock()
  let positions: Position[] = []
  let orders: Order[] = []
  let balance: Balance | null = null
  let tickers: Record<string, Ticker> = {}
  let closed = 0
  let lastSlow = -Infinity
  let lastPositionsKey = ''
  // From the oldest open execution: an order acknowledged before a restart still reconciles from its fills.
  let lastFillTime = Math.min(startedAt, ...store.openExecutions().map(e => e.createdAt))
  const seenExec = new Set<string>()
  let recentFills: Fill[] = []
  /** Orders by id, also after they leave the open list: an ORDER shortcut still knows its order when the fill arrives. */
  const known = new Map<string, Order>()
  let quotes: Record<string, Partial<Record<PriceSource, Quote>>> = {}
  let prevQuotes: typeof quotes = {}
  let gap = true // the first poll has no sample before it, so it cannot make a crossing
  const windows = new Map<string, PriceWindow>()
  const warmed = new Set<string>()
  /** This poll's newest fresh execution per orderId: the ORDER_FILLED / ORDER_PARTIAL event. */
  let events = new Map<string, Fill>()
  const epochs = new Map(Object.entries(store.epochs()))
  let toasts: string[] = []
  let headSince = 0
  let error: string | null = null
  let updatedAt = 0

  const dropShown = () => {
    while (toasts.length && clock() - headSince >= TOAST_MS) { toasts.shift(); headSince += TOAST_MS }
  }
  /** `first`: the answer to the user's own tap or voice, shown at once ahead of the queue. */
  const say = (text: string, first = false) => {
    dropShown()
    if (first || !toasts.length) headSince = clock()
    if (first) toasts.unshift(text)
    else toasts.push(text)
    if (toasts.length > MAX_TOASTS) toasts.splice(1, 1) // keep the one on screen, drop the oldest waiting
  }
  const dayPnl = () => closed + positions.reduce((sum, p) => sum + p.unrealisedPnl, 0)
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
    switch (s.type) {
      case 'ALL_POSITIONS': return ps.map(pos)
      case 'POSITION': return ps.filter(p => p.symbol === s.symbol && p.positionIdx === s.positionIdx && epochOf(p) === s.epoch).map(pos)
      case 'SYMBOL': return [{ key: `sym:${s.symbol}`, symbol: s.symbol, label: coin(s.symbol) }]
      case 'ORDER': {
        const seen = os.find(o => o.orderId === s.orderId) ?? known.get(s.orderId)
        const o = seen?.symbol === s.symbol ? seen : undefined // an order id from another symbol is not this shortcut's order
        // position actions only through an opening order, mapped to the position it opened (§7): same slot, same side
        const p = o && !o.reduceOnly ? ps.find(p => p.symbol === o.symbol && p.positionIdx === o.positionIdx && p.side === o.side) : undefined
        return [{ key: `ord:${s.orderId}`, symbol: s.symbol, label: `${coin(s.symbol)} order`, order: o, position: p, epoch: p && epochOf(p) }]
      }
    }
  }

  function factsOf(t: TargetRef, now: number, os: Order[]): Facts {
    const p = t.position
    const f = t.key.startsWith('ord:') ? events.get(t.key.slice(4)) : undefined
    return {
      prices: quotes[t.symbol] ?? {},
      prev: prevQuotes[t.symbol] ?? {},
      windowAgo: (source, sec) => windows.get(`${t.symbol}:${source}`)?.ago(sec, now) ?? null,
      position: p && {
        side: p.side, size: p.size, entry: p.entryPrice, mark: p.markPrice, liqPrice: p.liqPrice > 0 ? p.liqPrice : null,
        unrealisedPnl: p.unrealisedPnl, positionIM: p.positionIM > 0 ? p.positionIM : null,
        stopLoss: protection(p, os, 'StopLoss'), takeProfit: protection(p, os, 'TakeProfit'), epoch: t.epoch ?? '', ts: now,
      },
      event: f && { kind: f.leavesQty > 0 ? 'PARTIAL' : 'FILLED', orderId: f.orderId, execId: f.id },
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
    if (a.channels.includes('telegram')) return 'Sent to Telegram · glasses disconnected'
    if (p) return 'Waiting for a tap on Even G2'
    return a.channels.includes('glasses') ? 'Shown on Even G2' : a.channels.includes('app') ? 'Shown in the app' : 'Logged'
  }

  /** One alert, and for a trade one resolved proposal or the reason it was skipped. Persisted in one transaction with its outbox row. */
  async function raise(rule: ShortcutRule, t: TargetRef, why: Why, c: Ctx) {
    const now = clock()
    const a = rule.action
    const alert: AlertRecord = {
      id: crypto.randomUUID(), shortcutId: rule.id, version: rule.version, targetKey: t.key, target: t.label, title: titleOf(rule),
      reason: why.reason, matched: why.matched, priority: priority(rule), simulated: !!why.simulated, delivery: rule.delivery, channels: [], status: '', createdAt: now,
    }
    let proposal: Proposal | undefined
    if (a.type !== 'NOTIFY') {
      let r: Resolved
      try {
        r = resolve(a, t, await market(t.symbol, a.type === 'OPEN_POSITION', c))
      } catch (e) {
        error = `${coin(t.symbol)}: ${errorText(e)}`
        return { alert, proposal, retry: true } // nothing saved: the next tick tries again
      }
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
        }
      }
    }
    store.transaction(() => {
      const old = proposal && store.pendingProposals().find(q => q.shortcutId === rule.id && q.targetKey === t.key && q.simulated === proposal.simulated)
      if (old && proposal) {
        proposal.supersedes = old.id
        closeProposal(store, old, 'SUPERSEDED', 'Replaced by a newer alert')
      }
      alert.channels = alert.skip ? [] : routeOf(alert, proposal)
      alert.status = alertStatus(alert, proposal)
      store.saveAlert(alert)
      if (proposal) store.saveProposal(proposal)
    })
    if (a.type === 'NOTIFY' && rule.delivery.glasses && store.settings().notifications.glasses) say(`${alert.title} · ${alert.target} · ${alert.reason}`)
    return { alert, proposal, retry: false }
  }

  /**
   * A pending proposal against fresh state (§9 step 3): unchanged, withdrawn with a reason, or replaced by a fresh one
   * (`supersedes`) when its resolved terms changed. Never adjusts the terms in place.
   */
  async function check(p: Proposal, c: Ctx): Promise<{ ok: true; rule: ShortcutRule; t: TargetRef } | { ok: false; reason: string; replaced?: boolean }> {
    const rule = store.getShortcut(p.shortcutId)
    if (!rule || rule.version !== p.version || !rule.enabled) return { ok: false, reason: 'shortcut changed' }
    const t = targetsOf(rule, c.positions, c.orders).find(t => t.key === p.targetKey)
    if (!t) return { ok: false, reason: 'position is closed' }
    const r = resolve(rule.action, t, await market(t.symbol, rule.action.type === 'OPEN_POSITION', c), p.terms)
    if (!r.ok) return { ok: false, reason: r.reason }
    if (sameTerms(r.terms, p.terms)) return { ok: true, rule, t }
    if (store.proposal(p.id)?.status !== p.status) return { ok: false, reason: 'it changed meanwhile', replaced: true } // a tap or another check got there first
    const now = clock()
    const fresh: Proposal = { ...p, id: crypto.randomUUID(), terms: r.terms, question: r.question, detail: detailOf(rule, r.note), createdAt: now, expiresAt: now + lifetimeMs(rule), supersedes: p.id, status: 'PENDING' }
    store.transaction(() => {
      if (store.proposal(p.id)?.status === 'PENDING') store.saveProposal({ ...p, status: 'SUPERSEDED' })
      store.saveProposal(fresh)
      const a = store.alert(p.alertId)
      if (a) store.saveAlert({ ...a, status: 'Refreshed · the terms changed' })
    })
    return { ok: false, reason: 'the terms changed: a new proposal is waiting', replaced: true }
  }

  const executor = createExecutor({
    ex, store, clock,
    async revalidate(p) {
      // fresh reads, not the last poll (§9 step 2)
      const [ps, os, bal] = await Promise.all([ex.positions(), ex.openOrders(), ex.balance()])
      const c = await check(p, { positions: ps, orders: os, balance: bal, tickers: {} })
      if (!c.ok) return { ok: false, message: c.reason }
      if (p.voice) return { ok: true } // the phrase was the trigger, its conditions were never checked
      const items = asStates(c.rule.conditions.items)
      if (!items.length) return { ok: true }
      const now = clock()
      // Strict, not the hysteresis band: a crossing must still be on its side, a loss still a loss (§9 step 2).
      const g = evaluateGroup({ logic: c.rule.conditions.logic, items }, factsOf(c.t, now, os), { now, staleMs: STALE_MS })
      return g.verdict === 'TRUE' ? { ok: true } : { ok: false, message: g.verdict === 'FALSE' ? 'the condition no longer holds' : 'could not check the condition' }
    },
  })

  // ── the poll ────────────────────────────────────────────

  const windowOf = (symbol: string, source: PriceSource) => {
    const key = `${symbol}:${source}`
    let w = windows.get(key)
    if (!w) windows.set(key, (w = new PriceWindow()))
    return w
  }

  async function tick() {
    const now = clock()
    const rules = store.listShortcuts().filter(r => r.enabled)
    const settings = store.settings()
    let fills: Fill[]
    try {
      const [ps, os, fl] = await Promise.all([ex.positions(), ex.openOrders(), ex.fillsSince(lastFillTime - FILL_OVERLAP_MS)])
      // A close or partial close moves PnL from unrealised to closed: refresh closed now, not in 10 s.
      const positionsKey = ps.map(p => `${p.symbol}:${p.positionIdx}:${p.size}`).sort().join()
      if (now - lastSlow >= SLOW_POLL_MS || positionsKey !== lastPositionsKey) {
        const [c, b] = await Promise.all([ex.closedPnlSince(Math.floor(now / DAY_MS) * DAY_MS), ex.balance().catch(() => balance)])
        closed = c
        balance = b
        lastSlow = now
        lastPositionsKey = positionsKey
      }
      positions = ps
      orders = os
      fills = fl
      error = null
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
      for (const src of SOURCES) windowOf(s, src).push(now, r.value[src === 'LAST' ? 'last' : src === 'MARK' ? 'mark' : 'index'])
    })
    gap = false

    // After a restart the price-change windows start from 1-minute candles (§5), once per symbol and source.
    for (const rule of rules) {
      for (const c of rule.conditions.items) {
        if (c.type !== 'PRICE_CHANGE') continue
        for (const s of rule.scope.type === 'ALL_POSITIONS' ? positions.map(p => p.symbol) : [rule.scope.symbol]) {
          const key = `${s}:${c.source}`
          if (warmed.has(key)) continue
          try {
            windowOf(s, c.source).warm(await ex.kline(s, c.source, LIMITS.windowSec.max / 60 + 2), now)
            warmed.add(key)
          } catch { /* UNKNOWN until a later tick warms it */ }
        }
      }
    }

    // Position epochs.
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
    for (const k of [...epochs.keys()]) if (!live.has(k)) { epochs.delete(k); store.saveEpoch(k, null) }

    // Fills: deduped by execId; only fresh ones are events (never an old reconciled one, §8).
    const unseen = fills.filter(f => !seenExec.has(f.id)).sort((a, b) => a.time - b.time)
    const fresh = unseen.filter(f => f.time > startedAt) // older ones only reconcile: no toast, no event
    for (const f of unseen) seenExec.add(f.id)
    for (const f of fresh) say(`Filled ${f.side.toUpperCase()} ${f.qty} ${coin(f.symbol)} @ ${price(f.price)}`)
    recentFills = [...recentFills, ...unseen].slice(-RECENT_FILLS)
    if (seenExec.size > 4 * RECENT_FILLS) { seenExec.clear(); for (const f of recentFills) seenExec.add(f.id) }
    if (unseen.length) lastFillTime = Math.max(lastFillTime, unseen[unseen.length - 1].time)
    events = new Map(fresh.filter(f => now - f.time <= STALE_MS).map(f => [f.orderId, f]))
    for (const o of orders) known.set(o.orderId, o)
    // shortcut: forgets the oldest orders past 1000; keep only ORDER-scope ones if a trader keeps more
    while (known.size > 1000) known.delete(known.keys().next().value!)

    executor.reconcile(recentFills, positions)

    // Pending proposals: expiry, then a recheck that withdraws or refreshes any that changed (§9).
    const head = store.pendingProposals().sort(queueOrder)[0] // what the lens shows, expired or not
    const c = ctxNow()
    for (const p of store.pendingProposals()) {
      if (p.expiresAt <= now) {
        closeProposal(store, p, 'EXPIRED', `Expired · not confirmed within ${Math.round((p.expiresAt - p.createdAt) / 1000)} s`)
        if (p.id === head?.id) say(`Expired, nothing sent: ${p.title}`) // the card on the lens must not vanish without a word
        continue
      }
      if (p.simulated) continue
      try {
        const r = await check(p, c)
        if (!r.ok && !r.replaced) closeProposal(store, p, 'SUPERSEDED', `Withdrawn · ${r.reason}`)
      } catch { /* a read failed: check it again next tick */ }
    }

    // The engine: every enabled shortcut with conditions, on every target of its scope. Voice-only ones are never evaluated.
    const waiting = new Set(store.pendingProposals().map(p => `${p.shortcutId}:${p.targetKey}`))
    // shortcut: trigger_state keeps a row per rule and position epoch for good; prune closed epochs if the table grows
    for (const rule of rules) {
      if (!rule.conditions.items.length) continue
      for (const t of targetsOf(rule, positions, orders)) {
        const key = `${rule.id}:${t.key}`
        const saved = store.trigger(key)
        const s = saved?.version === rule.version ? saved : initialTriggerState(rule.version)
        const g = evaluateGroup(rule.conditions, factsOf(t, now, orders), { now, staleMs: STALE_MS, relaxed: s.phase === 'fired' })
        const d = decide(rule, g, s, now, { cooldownSec: settings.cooldownSec, pending: waiting.has(key) })
        if (d.fire) {
          const cond = rule.conditions.items.find(c => c.id === g.reason?.id)
          const r = await raise(rule, t, { reason: cond ? reasonText(cond, g.reason?.value) : 'matched', type: cond?.type, matched: g.matched }, c)
          if (r.retry) continue // a read error must not use up a Once shortcut or start its cooldown
          if (r.proposal) waiting.add(key)
        }
        if (!saved || JSON.stringify(d.next) !== JSON.stringify(saved)) store.saveTrigger(key, d.next)
      }
    }
    updatedAt = now
  }

  const queue = () => {
    const now = clock()
    return store.pendingProposals().filter(p => p.expiresAt > now).sort(queueOrder)
  }

  async function voice(text: string): Promise<Reply> {
    const reply = (message: string) => { say(message, true); return { ok: false, message } }
    if (!normalizePhrase(text)) return reply('Heard nothing')
    const rule = matchShortcut(text, store.listShortcuts().filter(r => r.enabled))
    if (!rule) return reply(`No shortcut for "${text}"`)
    let n = 0
    for (const t of targetsOf(rule, positions, orders)) {
      if ((await raise(rule, t, { reason: `Voice: ${rule.voicePhrase}`, matched: [], voice: true }, ctxNow())).proposal) n++
    }
    if (!n) return reply(`Heard "${rule.voicePhrase}" · nothing to change`)
    return { ok: true, message: `Heard "${rule.voicePhrase}" · ${n} proposal${n > 1 ? 's' : ''}` }
  }

  return {
    tick,

    state(): SessionState {
      dropShown()
      const q = queue()
      return {
        positions,
        balance,
        dayPnl: dayPnl(),
        card: q[0] ?? null,
        pending: q.length,
        toast: toasts[0] ?? null,
        error: error ?? (updatedAt && clock() - updatedAt > STALE_MS ? `No fresh data for ${Math.round((clock() - updatedAt) / 1000)}s` : null),
        updatedAt,
      }
    },

    async confirm(proposalId, idempotencyKey) {
      const r = await executor.confirm(proposalId, idempotencyKey)
      say(r.message, true)
      return r
    },

    dismiss(proposalId, by) {
      const p = store.proposal(proposalId)
      if (!p || p.status !== 'PENDING') return { ok: false, message: 'Proposal is gone' }
      closeProposal(store, p, 'DISMISSED', `Dismissed on ${by === 'glasses' ? 'Even G2' : 'the phone'}`, { dismissedBy: by })
      return { ok: true, message: 'Dismissed, nothing sent' }
    },

    voice,
    command: kind => voice(kind === 'stop' ? 'protect all' : 'lock profits'),

    async test(shortcutId) {
      const rule = store.getShortcut(shortcutId)
      if (!rule) return { ok: false, message: 'No such shortcut' }
      const t = targetsOf(rule, positions, orders)[0]
      if (!t) return { ok: false, message: 'Nothing to test on now: no position or order it applies to' }
      const { alert, proposal, retry } = await raise(rule, t, { reason: 'Test alert', matched: [], simulated: true }, ctxNow())
      if (retry) return { ok: false, message: 'Could not read Bybit, try again' }
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
      orders: orders.filter(o => !o.stopOrderType && o.leavesQty > 0),
    }),
  }
}
