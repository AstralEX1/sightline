/**
 * Execution service (§9 "Execution path"): the only module that writes to the exchange.
 * confirm(proposalId, idempotencyKey) consumes the proposal before any await, serializes per symbol and position,
 * rechecks fresh state, submits once and reconciles from fills and positions. No blind retries.
 */
import type { Exchange, Execution, ExecutionStatus, Fill, Position, Proposal, ProposalStatus, Terms } from './types.ts'
import type { Store } from './store.ts'
import { executionLine } from './proposals.ts'
import { price } from './format.ts'

export type Revalidate = (p: Proposal) => Promise<{ ok: true; openLeverage?: number } | { ok: false; message: string }>
export interface ConfirmResult { ok: boolean; message: string; execution?: Execution }

const GONE: Record<Exclude<ProposalStatus, 'PENDING' | 'AUTHORIZED'>, string> = {
  DISMISSED: 'Dismissed, nothing sent',
  EXPIRED: 'Expired, nothing sent',
  SUPERSEDED: 'Replaced by a newer proposal, nothing sent',
}
const RESOLVED: ExecutionStatus[] = ['ACKNOWLEDGED', 'PARTIALLY_FILLED', 'UNKNOWN']
const IN_FLIGHT: ExecutionStatus[] = ['AUTHORIZED', 'VALIDATING', 'SUBMITTING']
/** Well past Bybit's 5 s recv window: a request that has not arrived by then can no longer run. */
export const SETTLE_MS = 30_000
/** Between two lookups of one order; a not-found counts only on the second miss, as Hummingbot does with its lost orders. */
export const LOOKUP_EVERY_MS = 10_000
const DEAD = ['Cancelled', 'Rejected', 'Deactivated']
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const round8 = (n: number) => Math.round(n * 1e8) / 1e8

/** One lane per account / symbol / positionIdx (§10): two writes to one position never overlap. */
export const laneOf = (t: Terms) => (t.type === 'cancel' ? `${t.symbol}:order:${t.orderId}` : `${t.symbol}:${t.positionIdx}`)

/** Ends a proposal that is still pending and writes the alert's History line, in one transaction. False when it was no longer pending. */
export function closeProposal(store: Store, p: Proposal, status: ProposalStatus, line: string, patch: Partial<Proposal> = {}): boolean {
  return store.transaction(() => {
    if (store.proposal(p.id)?.status !== 'PENDING') return false // a tap may have authorized it while the caller awaited
    store.saveProposal({ ...p, ...patch, status })
    const a = store.alert(p.alertId)
    if (a) store.saveAlert({ ...a, status: line })
    return true
  })
}

function send(ex: Exchange, t: Terms): Promise<{ orderId: string } | void> {
  switch (t.type) {
    case 'order': return ex.placeOrder({ symbol: t.symbol, side: t.side, qty: t.qty, positionIdx: t.positionIdx, reduceOnly: t.reduceOnly, orderLinkId: t.orderLinkId, stopLoss: t.stopLoss, takeProfit: t.takeProfit })
    case 'setStop': return ex.setStop(t.symbol, t.positionIdx, t.price)
    case 'setTakeProfit': return ex.setTakeProfit(t.symbol, t.positionIdx, t.price)
    case 'addMargin': return ex.addMargin(t.symbol, t.positionIdx, t.usd)
    case 'cancel': return ex.cancelOrder(t.symbol, t.orderId)
  }
}

export function createExecutor(o: { ex: Exchange; store: Store; clock: () => number; revalidate: Revalidate }) {
  const { ex, store, clock } = o
  const lanes = new Map<string, Promise<unknown>>()
  /** Only reconciliation can clear an unknown result, including after restart. */
  const lookedAt = new Map<string, { at: number; misses: number }>()
  // An unknown add margin has no id to look up, so it settles only when the position closes; it must not trap a Close.
  const blocking = (lane: string, self: string, next: Terms) =>
    store.openExecutions().some(x => x.id !== self && x.status === 'UNKNOWN' && laneOf(x.terms) === lane
      && (x.terms.type !== 'addMargin' || next.type === 'addMargin'))

  /** Bybit's order, null when it has none, undefined when not due or the read failed. */
  async function lookUp(e: Execution, ref: { orderLinkId: string } | { orderId: string }) {
    const last = lookedAt.get(e.id)
    if (last && clock() - last.at < LOOKUP_EVERY_MS) return undefined
    lookedAt.set(e.id, { at: clock(), misses: last?.misses ?? 0 })
    try {
      const o = await ex.order(e.terms.symbol, ref)
      return store.execution(e.id)?.status === e.status ? o : undefined // changed meanwhile: the next tick decides
    } catch {
      return undefined
    }
  }
  const miss = (e: Execution) => ++lookedAt.get(e.id)!.misses >= 2

  function save(e: Execution, status: ExecutionStatus, message = '', patch: Partial<Execution> = {}): Execution {
    const next = { ...e, ...patch, status, message, updatedAt: clock() }
    if (e.status === 'PARTIALLY_FILLED' && (status !== e.status || next.filledQty !== e.filledQty)) delete next.receipt
    if (!RESOLVED.includes(status)) lookedAt.delete(e.id)
    store.transaction(() => {
      store.saveExecution(next)
      const p = store.proposal(next.proposalId)
      const a = p && store.alert(p.alertId)
      if (a) store.saveAlert({ ...a, status: executionLine(next) })
    })
    return next
  }

  // A write that was being sent when the process stopped may have reached Bybit: unknown, so it blocks and reconciles like one.
  // Before SUBMITTING nothing left the server. Through save(), so History shows the outcome too.
  for (const e of store.openExecutions()) {
    if (!IN_FLIGHT.includes(e.status)) continue
    if (e.status === 'SUBMITTING') save(e, 'UNKNOWN', 'interrupted by a restart')
    else save(e, 'REJECTED', 'interrupted by a restart before sending')
  }

  function serialize<T>(lane: string, fn: () => Promise<T>): Promise<T> {
    const run = (lanes.get(lane) ?? Promise.resolve()).then(fn, fn)
    const tail = run.catch(() => {})
    lanes.set(lane, tail)
    void tail.then(() => { if (lanes.get(lane) === tail) lanes.delete(lane) }) // a lane per cancelled order id must not pile up
    return run
  }

  const result = (e: Execution): ConfirmResult => ({ ok: e.status !== 'REJECTED' && e.status !== 'UNKNOWN', message: executionLine(e), execution: e })

  async function run(p: Proposal, e: Execution): Promise<Execution> {
    if (p.simulated) return save(e, 'SIMULATED') // a test never reaches the adapter
    const lane = laneOf(p.terms)
    if (blocking(lane, e.id, p.terms)) return save(e, 'REJECTED', 'an earlier action on this position has an unknown result, check Bybit')
    e = save(e, 'VALIDATING')
    let v: Awaited<ReturnType<Revalidate>>
    try {
      v = await o.revalidate({ ...p, status: 'AUTHORIZED' })
    } catch (err) {
      return save(e, 'REJECTED', `could not check the position: ${errorText(err)}`)
    }
    if (!v.ok) return save(e, 'REJECTED', v.message)
    if (v.openLeverage !== undefined) {
      // Before SUBMITTING: a leverage that did not take leaves no order behind, so nothing is unknown
      try {
        await ex.setLeverage(p.terms.symbol, v.openLeverage)
      } catch (err) {
        return save(e, 'REJECTED', `could not set ${v.openLeverage}x leverage: ${errorText(err)}`)
      }
    }
    e = save(e, 'SUBMITTING') // intent is on disk before the request leaves
    try {
      const r = await send(ex, p.terms)
      return save(e, p.terms.type === 'order' ? 'ACKNOWLEDGED' : 'APPLIED', '', r ? { orderId: r.orderId } : {})
    } catch (err) {
      if ((err as Error).name === 'ExchangeRejected') return save(e, 'REJECTED', errorText(err))
      // 10000/10016, a timeout or a 5xx: it may have gone through, so no retry and nothing else on this lane until reconciled
      return save(e, 'UNKNOWN', (err as Error).name === 'TimeoutError' ? 'timed out' : errorText(err))
    }
  }

  return {
    /** The only way to trade. A second tap or a resend returns the execution the first one started. */
    async confirm(proposalId: string, idempotencyKey: string): Promise<ConfirmResult> {
      const byKey = store.executionByKey(idempotencyKey)
      if (byKey) return byKey.proposalId === proposalId ? result(byKey) : { ok: false, message: 'This confirmation was already used' }
      const done = store.executionByProposal(proposalId)
      if (done) return result(done)
      const p = store.proposal(proposalId)
      if (!p) return { ok: false, message: 'Proposal is gone' }
      if (p.status !== 'PENDING') return { ok: false, message: GONE[p.status as keyof typeof GONE] ?? 'Proposal is gone' }
      const now = clock()
      if (p.expiresAt <= now) {
        closeProposal(store, p, 'EXPIRED', `Expired · not confirmed within ${Math.round((p.expiresAt - p.createdAt) / 1000)} s`)
        return { ok: false, message: GONE.EXPIRED }
      }
      const e: Execution = { id: crypto.randomUUID(), proposalId, idempotencyKey, terms: p.terms, status: 'AUTHORIZED', message: '', filledQty: 0, avgPrice: 0, createdAt: now, updatedAt: now }
      // consumed before the first await: a concurrent confirm finds the execution above
      store.transaction(() => {
        store.saveProposal({ ...p, status: 'AUTHORIZED' })
        store.saveExecution(e)
      })
      return result(await serialize(laneOf(p.terms), () => run(p, e)))
    },

    /**
     * Settles open executions from Bybit, after a fresh read only. Fills by orderLinkId make orders FILLED or PARTIALLY_FILLED.
     * Past SETTLE_MS an unknown or unfilled order is looked up by orderLinkId: missing twice means it never reached Bybit,
     * cancelled or rejected with nothing filled means no trade. An unknown stop or take profit settles from the position,
     * an unknown cancel from the order's status. `fills` are the recent fills, already deduped: a repeat changes nothing.
     */
    async reconcile(fills: Fill[], positions: Position[]): Promise<void> {
      // shortcut: scans every open execution each tick; age old ones out if the list grows
      for (const e of store.openExecutions()) {
        if (!RESOLVED.includes(e.status)) continue // still in flight: run() owns it
        const t = e.terms
        const settled = clock() - e.updatedAt >= SETTLE_MS
        if (t.type === 'order') {
          const mine = fills.filter(f => f.orderLinkId === t.orderLinkId)
          if (mine.length) {
            const qty = round8(mine.reduce((s, f) => s + f.qty, 0))
            const avg = mine.reduce((s, f) => s + f.price * f.qty, 0) / qty
            const status: ExecutionStatus = qty >= Number(t.qty) || mine.some(f => f.leavesQty === 0) ? 'FILLED' : 'PARTIALLY_FILLED'
            if (status !== e.status || qty !== e.filledQty) save(e, status, '', { filledQty: qty, avgPrice: avg, orderId: e.orderId ?? mine[0].orderId })
            continue
          }
          if (!settled || e.status === 'PARTIALLY_FILLED') continue
          const o = await lookUp(e, { orderLinkId: t.orderLinkId })
          if (o === undefined) continue
          if (o === null) { if (e.status === 'UNKNOWN' && miss(e)) save(e, 'REJECTED', 'never reached Bybit, nothing traded'); continue }
          if (DEAD.includes(o.status) && o.cumExecQty === 0) save(e, 'REJECTED', `Bybit ${o.status.toLowerCase()} it, nothing traded`)
          else if (o.status === 'Filled') save(e, 'FILLED', '', { filledQty: o.cumExecQty, avgPrice: o.avgPrice, orderId: o.orderId }) // its fills were missed
          else if (e.status === 'UNKNOWN') save(e, 'ACKNOWLEDGED', '', { orderId: o.orderId }) // it went through: fills finish it
        } else if (e.status !== 'UNKNOWN') {
          continue
        } else if (t.type === 'setStop' || t.type === 'setTakeProfit') {
          const p = positions.find(p => p.symbol === t.symbol && p.positionIdx === t.positionIdx)
          const level = p && (t.type === 'setStop' ? p.stopLoss : p.takeProfit)
          if (level === t.price) save(e, 'APPLIED')
          else if (settled) save(e, 'REJECTED', p ? `not applied, Bybit shows ${level ? price(level) : 'none'}` : 'position closed')
        } else if (t.type === 'cancel') {
          const o = settled ? await lookUp(e, { orderId: t.orderId }) : undefined
          if (o === null && miss(e)) save(e, 'REJECTED', 'order not found on Bybit')
          if (!o) continue
          if (o.status === 'Cancelled' || o.status === 'PartiallyFilledCanceled' || o.status === 'Deactivated') save(e, 'APPLIED')
          else if (o.status === 'Filled' || o.status === 'Rejected') save(e, 'REJECTED', `order ${o.status.toLowerCase()} before the cancel`)
          else save(e, 'REJECTED', 'order is still open on Bybit')
        } else if (!positions.some(p => p.symbol === t.symbol && p.positionIdx === t.positionIdx)) {
          // shortcut: an unknown add margin has no record to look up, so it blocks until the position closes; compare positionIM if it happens
          save(e, 'REJECTED', 'position closed, result unknown')
        }
      }
    },
  }
}

export type Executor = ReturnType<typeof createExecutor>
