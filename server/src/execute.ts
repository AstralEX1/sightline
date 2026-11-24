/**
 * Execution service (§9 "Execution path"): the only module that writes to the exchange.
 * confirm(proposalId, idempotencyKey) consumes the proposal before any await, serializes per symbol and position,
 * rechecks fresh state, submits once and reconciles from fills and positions. No blind retries.
 */
import type { Exchange, Execution, ExecutionStatus, Fill, Position, Proposal, ProposalStatus, Terms } from './types.ts'
import type { Store } from './store.ts'
import { executionLine } from './proposals.ts'

/** An unknown result blocks other writes to the same position this long, unless reconciled first. */
// shortcut: a time-boxed block instead of an operator "resolve" button; add one if unknowns happen on Demo
export const UNKNOWN_BLOCK_MS = 60_000

export type Revalidate = (p: Proposal) => Promise<{ ok: true } | { ok: false; message: string }>
export interface ConfirmResult { ok: boolean; message: string; execution?: Execution }

const GONE: Record<Exclude<ProposalStatus, 'PENDING' | 'AUTHORIZED'>, string> = {
  DISMISSED: 'Dismissed, nothing sent',
  EXPIRED: 'Expired, nothing sent',
  SUPERSEDED: 'Replaced by a newer proposal, nothing sent',
}
const RESOLVED: ExecutionStatus[] = ['ACKNOWLEDGED', 'PARTIALLY_FILLED', 'UNKNOWN']
const IN_FLIGHT: ExecutionStatus[] = ['AUTHORIZED', 'VALIDATING', 'SUBMITTING']
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
  // A write that was in flight when the process stopped may have reached Bybit: unknown, so it blocks and reconciles like one.
  for (const e of store.openExecutions()) {
    if (IN_FLIGHT.includes(e.status)) store.saveExecution({ ...e, status: 'UNKNOWN', message: 'interrupted by a restart', updatedAt: clock() })
  }
  /** An unknown result on this lane, recent enough to block: kept in the store, so a restart does not lift it. */
  const blocking = (lane: string, self: string) =>
    store.openExecutions().some(x => x.id !== self && x.status === 'UNKNOWN' && laneOf(x.terms) === lane && clock() - x.updatedAt < UNKNOWN_BLOCK_MS)

  function save(e: Execution, status: ExecutionStatus, message = '', patch: Partial<Execution> = {}): Execution {
    const next = { ...e, ...patch, status, message, updatedAt: clock() }
    store.transaction(() => {
      store.saveExecution(next)
      const p = store.proposal(next.proposalId)
      const a = p && store.alert(p.alertId)
      if (a) store.saveAlert({ ...a, status: executionLine(next) })
    })
    return next
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
    if (blocking(lane, e.id)) return save(e, 'REJECTED', 'an earlier action on this position has an unknown result, check Bybit')
    e = save(e, 'VALIDATING')
    let v: Awaited<ReturnType<Revalidate>>
    try {
      v = await o.revalidate({ ...p, status: 'AUTHORIZED' })
    } catch (err) {
      return save(e, 'REJECTED', `could not check the position: ${errorText(err)}`)
    }
    if (!v.ok) return save(e, 'REJECTED', v.message)
    e = save(e, 'SUBMITTING') // intent is on disk before the request leaves
    try {
      const r = await send(ex, p.terms)
      return save(e, p.terms.type === 'order' ? 'ACKNOWLEDGED' : 'APPLIED', '', r ? { orderId: r.orderId } : {})
    } catch (err) {
      if ((err as Error).name === 'ExchangeRejected') return save(e, 'REJECTED', errorText(err))
      // 10000/10016, a timeout or a 5xx: it may have gone through, so no retry and nothing else on this position for a while
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
     * Fills by orderLinkId make orders FILLED or PARTIALLY_FILLED; positions settle an unknown stop or take profit.
     * `fills` are the recent fills, already deduped: totals are recomputed, so a repeat changes nothing.
     */
    reconcile(fills: Fill[], positions: Position[]): void {
      // shortcut: scans every open execution each tick, and an order Bybit dropped after its ack stays open; age them out if the list grows
      for (const e of store.openExecutions()) {
        if (!RESOLVED.includes(e.status)) continue // still in flight: run() owns it
        const t = e.terms
        if (t.type === 'order') {
          const mine = fills.filter(f => f.orderLinkId === t.orderLinkId)
          if (!mine.length) continue
          const qty = round8(mine.reduce((s, f) => s + f.qty, 0))
          const avg = mine.reduce((s, f) => s + f.price * f.qty, 0) / qty
          const status: ExecutionStatus = qty >= Number(t.qty) || mine.some(f => f.leavesQty === 0) ? 'FILLED' : 'PARTIALLY_FILLED'
          if (status !== e.status || qty !== e.filledQty) save(e, status, '', { filledQty: qty, avgPrice: avg, orderId: e.orderId ?? mine[0].orderId })
        } else if (e.status === 'UNKNOWN' && (t.type === 'setStop' || t.type === 'setTakeProfit')) {
          const p = positions.find(p => p.symbol === t.symbol && p.positionIdx === t.positionIdx)
          if (p && (t.type === 'setStop' ? p.stopLoss : p.takeProfit) === t.price) save(e, 'APPLIED')
        }
      }
    },
  }
}

export type Executor = ReturnType<typeof createExecutor>
