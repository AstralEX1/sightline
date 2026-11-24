import type { Action, Balance, Card, Config, Exchange, Position, SessionState } from './types.ts'
import { actionUsd, addsExposure, evaluate, shortcutCards, tightens, voiceCards } from './rules.ts'
import { coin, price, usd } from './format.ts'

export type Session = {
  tick(): Promise<void>
  state(): SessionState
  answer(cardId: string, yes: boolean): Promise<{ ok: boolean; message: string }>
  /** Queues the cards a voice transcript asks for. Nothing runs until a YES tap. */
  voice(text: string): { ok: boolean; message: string }
  /** Glasses menu: a stop on every position (`stop`) or stops to entry on those in profit (`lock`). Also only queues cards. */
  command(kind: 'stop' | 'lock'): { ok: boolean; message: string }
}

const SLOW_POLL_MS = 10_000
const TOAST_MS = 5_000
// shortcut: past this a flood drops its oldest waiting toast; threshold hysteresis would stop most floods
const MAX_TOASTS = 4
const DAY_MS = 86_400_000
const STALE_MS = 15_000

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function createSession(ex: Exchange, getConfig: () => Config, clock: () => number = Date.now): Session {
  let positions: Position[] = []
  let balance: Balance | null = null
  let closed = 0
  let lastSlow = -Infinity
  let lastFillTime = clock()
  let fired = new Set<string>()
  let queue: Card[] = []
  let locked = false
  let lockedDay: number | null = null // once tripped, the lock holds until the next UTC day
  let lastPositionsKey = ''
  // Toasts show one after another for TOAST_MS each, so two alerts in the same tick are both seen.
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

  async function tick() {
    const cfg = getConfig()
    const now = clock()
    const prices: Record<string, number> = {}
    try {
      positions = await ex.positions()
      // A close or partial close moves PnL from unrealised to closed: refresh closed now, not in 10 s.
      const positionsKey = positions.map(p => `${p.symbol}:${p.positionIdx}:${p.size}`).sort().join()
      if (now - lastSlow >= SLOW_POLL_MS || positionsKey !== lastPositionsKey) {
        const [c, b, fills] = await Promise.all([
          ex.closedPnlSince(Math.floor(now / DAY_MS) * DAY_MS),
          ex.balance().catch(() => balance), // a footer line, not worth skipping the rules for
          ex.fillsSince(lastFillTime),
        ])
        closed = c
        balance = b
        const fresh = fills.filter(f => f.time > lastFillTime).sort((a, b) => a.time - b.time)
        for (const f of fresh) say(`Filled ${f.side.toUpperCase()} ${f.qty} ${coin(f.symbol)} @ ${price(f.price)}`)
        if (fresh.length) lastFillTime = fresh[fresh.length - 1].time
        lastSlow = now
        lastPositionsKey = positionsKey
      }
      error = null
    } catch (e) {
      error = errorText(e) // keep the last good data, skip rules on a partial read
      return
    }
    for (const a of cfg.alerts) {
      if (positions.some(p => p.symbol === a.symbol) || a.symbol in prices) continue
      try {
        prices[a.symbol] = await ex.lastPrice(a.symbol)
      } catch (e) {
        error = `Alert ${a.symbol}: ${errorText(e)}` // one bad alert must not stop the other rules
      }
    }
    // An unanswered card that expired is raised again while its condition holds.
    for (const c of queue) if (c.expiresAt <= now) fired.delete(c.key)
    const day = Math.floor(now / DAY_MS)
    const r = evaluate({ positions, dayPnl: dayPnl(), prices, now }, cfg, fired, lockedDay === day)
    if (r.locked) lockedDay = day
    fired = r.fired
    locked = r.locked
    // A card stays until it expires or is answered, so the choice under your finger is never reset.
    // It goes early only when it can no longer run.
    queue = queue.filter((c, i) => {
      if (c.expiresAt <= now) {
        // The card on the lens must not vanish without a word, unless the same one is raised again right below.
        if (i === 0 && !r.cards.some(n => n.key === c.key)) say(`Expired, nothing sent: ${c.title}`)
        return false
      }
      if (runnable(c.action)) return true
      fired.delete(c.key) // e.g. a stop the mark ran past: raise it again next tick with a fresh price
      return false
    })
    for (const c of r.cards) if (!queue.some(q => q.key === c.key)) queue.push(c)
    for (const t of r.toasts) say(t)
    updatedAt = now
  }

  /** False for exposure while locked, and for a stop or margin card whose position is gone, or a stop that would loosen or sits past the mark. */
  function runnable(a: Action): boolean {
    if (locked && addsExposure(a)) return false
    if (a.type === 'transfer' || a.type === 'order') return true
    const p = positions.find(p => p.symbol === a.symbol && p.positionIdx === a.positionIdx)
    return !!p && (a.type === 'addMargin' || (tightens(p, a.price) && (p.side === 'Buy' ? a.price < p.markPrice : a.price > p.markPrice)))
  }

  function run(a: Action): Promise<void> {
    switch (a.type) {
      case 'setStop': return ex.setStop(a.symbol, a.positionIdx, a.price)
      case 'addMargin': return ex.addMargin(a.symbol, a.positionIdx, a.usd)
      case 'transfer': return ex.transferToTrading(a.usd)
      case 'order': return ex.marketOrder(a.symbol, a.side, a.usd)
    }
  }

  async function answer(cardId: string, yes: boolean) {
    const card = queue[0]
    if (!card || card.id !== cardId) return { ok: false, message: 'Card is gone' }
    queue.shift() // before any await, so a second tap on the same card gets "Card is gone"
    if (card.expiresAt <= clock()) {
      fired.delete(card.key)
      return { ok: false, message: 'Card expired' }
    }
    if (!yes) return { ok: true, message: 'Skipped' }
    const cap = getConfig().maxActionUsd
    const refusal = locked && addsExposure(card.action) ? 'Locked: daily loss limit'
      : actionUsd(card.action) > cap ? `Over your ${usd(cap)} cap` : null
    if (refusal) { say(refusal, true); return { ok: false, message: refusal } }
    // `positions` can be newer than the queue check: a failed slow read returns from tick() before it.
    // Never send a stop that now loosens one, or a margin top-up for a position that is gone.
    if (!runnable(card.action)) {
      fired.delete(card.key) // raised again with a fresh price if the condition still holds
      const message = 'No longer valid, nothing sent'
      say(message, true)
      return { ok: false, message }
    }
    try {
      await run(card.action)
    } catch (e) {
      // Offer again only when a repeat cannot double anything: a stop is safe to set twice,
      // a money action only after a clear "no" (a 502 or a timeout may still have gone through).
      const { name } = e as Error
      const clearNo = name === 'ExchangeRejected'
      const moneyAction = addsExposure(card.action)
      if (clearNo || !moneyAction) fired.delete(card.key)
      const unknown = !clearNo && (moneyAction || name === 'TimeoutError')
      const message = unknown ? `Unknown result: ${name === 'TimeoutError' ? 'timed out' : errorText(e)}. Check the exchange.` : `Failed: ${errorText(e)}`
      say(message, true)
      return { ok: false, message }
    }
    const message = `Done: ${card.question.replace(/\?$/, '')}`
    say(message, true)
    return { ok: true, message }
  }

  function enqueue(r: { cards: Card[]; message: string }) {
    for (const c of r.cards) if (!queue.some(q => q.key === c.key)) queue.push(c)
    if (!r.cards.length) say(r.message, true) // a card is its own answer; only "nothing to do" needs words
    return { ok: r.cards.length > 0, message: r.message }
  }

  const voice = (text: string) => enqueue(voiceCards(text, positions, getConfig(), locked, clock()))

  // The menu works whatever the shortcut list says: these are the two safe defaults, by name.
  const command = (kind: 'stop' | 'lock') => enqueue(shortcutCards(
    { phrase: kind === 'stop' ? 'protect all' : 'lock profits', command: kind, symbol: 'ALL' }, positions, getConfig(), locked, clock(), 'Menu'))

  function state(): SessionState {
    dropShown()
    return {
      positions,
      balance,
      dayPnl: dayPnl(),
      dailyLossLimitUsd: getConfig().dailyLossLimitUsd,
      locked,
      card: queue[0] ?? null,
      pending: queue.length,
      toast: toasts[0] ?? null,
      error: error ?? (updatedAt && clock() - updatedAt > STALE_MS ? `No fresh data for ${Math.round((clock() - updatedAt) / 1000)}s` : null),
      updatedAt,
    }
  }

  return { tick, state, answer, voice, command }
}
