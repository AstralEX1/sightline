import type { Action, Card, Config, Position, Shortcut, Side, Snapshot } from './types.ts'
import { coin, money, price, usd } from './format.ts'

export const DEFAULT_CONFIG: Config = {
  dailyLossLimitUsd: 200,
  maxActionUsd: 500,
  liqWarnPct: 3,
  marginTopUpUsd: 100,
  stopLossPct: 2,
  lockProfitPct: 3,
  noStopGraceSec: 60,
  alerts: [],
  // Safe out of the box: both only tighten stops. Orders need a shortcut the user writes.
  shortcuts: [
    { phrase: 'protect all', command: 'stop', symbol: 'ALL' },
    { phrase: 'lock profits', command: 'lock', symbol: 'ALL' },
  ],
}

const CARD_LIFETIME_MS = 60_000
/** A fired rule stays fired until its value clears the threshold by this many percentage points (liq distance, profit)
 * or percent of the level (price alerts), so a value wobbling on the line does not re-raise it. */
export const BAND_PCT = 0.5

export function liqDistancePct(p: Position): number {
  return p.liqPrice > 0 ? (Math.abs(p.markPrice - p.liqPrice) / p.markPrice) * 100 : Infinity
}

export function actionUsd(a: Action): number {
  return a.type === 'setStop' ? 0 : a.usd
}

export function addsExposure(a: Action): boolean {
  return a.type !== 'setStop'
}

/**
 * `pct` from the worse of entry and mark: a stop on the wrong side of the mark is rejected by the exchange.
 * A stop at or past liquidation would never fire, so then it goes halfway between mark and liq.
 */
export function stopPrice(p: Position, pct: number): number {
  const long = p.side === 'Buy'
  const base = long ? Math.min(p.entryPrice, p.markPrice) : Math.max(p.entryPrice, p.markPrice)
  const stop = (base * (long ? 100 - pct : 100 + pct)) / 100
  const pastLiq = p.liqPrice > 0 && (long ? stop <= p.liqPrice : stop >= p.liqPrice)
  return pastLiq ? (p.markPrice + p.liqPrice) / 2 : stop
}

/** What the position is worth if a stop at `px` fills: the number a tap on a stop card commits to. Before fees and slippage. */
export const atStop = (p: Position, px: number) => (px - p.entryPrice) * p.size * (p.side === 'Buy' ? 1 : -1)

/** True when a stop at `px` is tighter than the current one, or there is none. */
export const tightens = (p: Position, px: number) => p.stopLoss === 0 || (p.side === 'Buy' ? p.stopLoss < px : p.stopLoss > px)

const card = (now: number, key: string, title: string, detail: string, question: string, action: Action): Card =>
  ({ id: crypto.randomUUID(), key, title, detail, question, action, createdAt: now, expiresAt: now + CARD_LIFETIME_MS })

/** The same words as a row on the lens: "BTC long". */
const positionName = (p: Position) => `${coin(p.symbol)} ${p.side === 'Buy' ? 'long' : 'short'}`
/** What a tap on a stop card commits to, in plain words. */
const ifStopped = (p: Position, px: number) => `if stopped: ${money(atStop(p, px))}`

/**
 * Turns one snapshot into new cards and toasts. Pure.
 * A key fires once and re-arms only after its condition clears by BAND_PCT (it is absent from `fired`).
 */
export function evaluate(s: Snapshot, cfg: Config, fired: Set<string>, alreadyLocked = false) {
  const locked = alreadyLocked || s.dayPnl <= -cfg.dailyLossLimitUsd
  const active = new Set<string>()
  const cards: Card[] = []
  const toasts: string[] = []
  const band = (key: string) => (fired.has(key) ? BAND_PCT : 0)

  const note = (key: string, text: string) => {
    active.add(key)
    if (!fired.has(key)) toasts.push(text)
  }

  const raise = (key: string, title: string, detail: string, question: string, action: Action) => {
    // Locked: no new exposure, but the trader still hears about it. Own key, so it shows even if the card was up.
    if (locked && addsExposure(action)) return note(`${key}:locked`, `${title}. Locked: stops only`)
    active.add(key)
    if (fired.has(key)) return
    const amount = actionUsd(action)
    if (amount > cfg.maxActionUsd) {
      toasts.push(`${usd(amount)} is over your ${usd(cfg.maxActionUsd)} cap`)
      return
    }
    cards.push(card(s.now, key, title, detail, question, action))
  }

  for (const p of s.positions) {
    const name = positionName(p)
    const long = p.side === 'Buy'
    const pnl = `PnL ${money(p.unrealisedPnl)}`

    const dist = liqDistancePct(p)
    if (dist < cfg.liqWarnPct + band(`liq:${p.symbol}`)) {
      const top = cfg.marginTopUpUsd
      raise(`liq:${p.symbol}`, `${name} · ${dist.toFixed(1)}% from liquidation`, `Liquidation at ${price(p.liqPrice)} · ${pnl}`,
        p.isolated ? `Add ${usd(top)} margin to ${coin(p.symbol)}?` : `Move ${usd(top)} Funding → Trading?`,
        p.isolated ? { type: 'addMargin', symbol: p.symbol, positionIdx: p.positionIdx, usd: top } : { type: 'transfer', usd: top })
    }

    const move = ((p.markPrice - p.entryPrice) / p.entryPrice) * 100 * (long ? 1 : -1)
    if (move >= cfg.lockProfitPct - band(`lock:${p.symbol}`) && tightens(p, p.entryPrice)) {
      raise(`lock:${p.symbol}`, `${name} · up ${move.toFixed(1)}%`, `${pnl} · ${ifStopped(p, p.entryPrice)}`, `Move ${coin(p.symbol)} stop to entry ${price(p.entryPrice)}?`,
        { type: 'setStop', symbol: p.symbol, positionIdx: p.positionIdx, price: p.entryPrice })
      continue // the entry stop is better than the default one below
    }

    if (p.stopLoss === 0 && s.now - p.openedAt >= cfg.noStopGraceSec * 1000) {
      const stop = stopPrice(p, cfg.stopLossPct)
      raise(`nostop:${p.symbol}`, `${name} · no stop`, `Entry ${price(p.entryPrice)} · ${ifStopped(p, stop)}`, `Set ${coin(p.symbol)} stop at ${price(stop)}?`,
        { type: 'setStop', symbol: p.symbol, positionIdx: p.positionIdx, price: stop })
    }
  }

  for (const a of cfg.alerts) {
    const px = s.positions.find(p => p.symbol === a.symbol)?.markPrice ?? s.prices[a.symbol]
    if (px === undefined) continue
    const b = (a.price * band(`alert:${a.id}`)) / 100
    if (a.when === 'above' ? px < a.price - b : px > a.price + b) continue
    const title = `${coin(a.symbol)} ${a.when} ${price(a.price)}`
    if (a.orderUsd && a.side) {
      raise(`alert:${a.id}`, title, `Now ${price(px)}`, `${a.side} ${usd(a.orderUsd)} at market?`,
        { type: 'order', symbol: a.symbol, side: a.side, usd: a.orderUsd })
    } else {
      note(`alert:${a.id}`, `${title}: now ${price(px)}`)
    }
  }

  return { cards, toasts, fired: active, locked }
}

export const normalizePhrase = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** The longest shortcut whose phrase appears in the text as whole words. */
export function matchShortcut(text: string, shortcuts: Shortcut[]): Shortcut | null {
  const t = ` ${normalizePhrase(text)} `
  let best: Shortcut | null = null
  for (const sc of shortcuts) if (t.includes(` ${sc.phrase} `) && sc.phrase.length > (best?.phrase.length ?? 0)) best = sc
  return best
}

/** A voice transcript → cards from the user's shortcuts. Pure. Each card still needs a YES tap. */
export function voiceCards(text: string, positions: Position[], cfg: Config, locked: boolean, now: number): { cards: Card[]; message: string } {
  if (!normalizePhrase(text)) return { cards: [], message: 'Heard nothing' }
  const sc = matchShortcut(text, cfg.shortcuts)
  if (!sc) return { cards: [], message: `No shortcut for "${text}"` }
  return shortcutCards(sc, positions, cfg, locked, now)
}

/** The cards one shortcut asks for, said aloud or picked from the glasses menu. Pure. */
export function shortcutCards(sc: Shortcut, positions: Position[], cfg: Config, locked: boolean, now: number, source = 'Voice'): { cards: Card[]; message: string } {
  const title = `${source}: ${sc.phrase}`

  if (sc.command === 'buy' || sc.command === 'sell') {
    const side: Side = sc.command === 'buy' ? 'Buy' : 'Sell'
    const amount = sc.usd ?? 0
    if (locked) return { cards: [], message: 'Locked: daily loss limit' }
    if (amount > cfg.maxActionUsd) return { cards: [], message: `${usd(amount)} is over your ${usd(cfg.maxActionUsd)} cap` }
    const action: Action = { type: 'order', symbol: sc.symbol, side, usd: amount }
    return { cards: [card(now, `voice:${sc.phrase}`, title, 'Market order', `${side} ${usd(amount)} ${coin(sc.symbol)} at market?`, action)], message: title }
  }

  const cards: Card[] = []
  for (const p of positions) {
    if (sc.symbol !== 'ALL' && p.symbol !== sc.symbol) continue
    const lock = sc.command === 'lock'
    const px = lock ? p.entryPrice : stopPrice(p, cfg.stopLossPct)
    const inProfit = p.side === 'Buy' ? p.markPrice > p.entryPrice : p.markPrice < p.entryPrice
    if ((lock && !inProfit) || !tightens(p, px)) continue // never loosen a stop; an entry stop must sit behind the mark
    cards.push(card(now, `voice:${sc.command}:${p.symbol}`, title, `${positionName(p)} · ${ifStopped(p, px)}`,
      lock ? `Move ${coin(p.symbol)} stop to entry ${price(px)}?` : `Set ${coin(p.symbol)} stop at ${price(px)}?`,
      { type: 'setStop', symbol: p.symbol, positionIdx: p.positionIdx, price: px }))
  }
  return { cards, message: cards.length ? title : `${title} · nothing to change` }
}
