import type { ActionType, ClosedBy, ConditionType, PriceSource } from './registry.ts'

export type Side = 'Buy' | 'Sell'

export interface Position {
  symbol: string
  side: Side
  size: number
  entryPrice: number
  markPrice: number
  /** 0 = no liquidation price */
  liqPrice: number
  unrealisedPnl: number
  /** 0 = no stop */
  stopLoss: number
  /** 0 = no take profit */
  takeProfit: number
  /** Initial margin, the ROI denominator; 0 when Bybit gives none */
  positionIM: number
  leverage: number
  isolated: boolean
  positionIdx: number
  openedAt: number
}

export interface Fill {
  /** Bybit execId */
  id: string
  orderId: string
  orderLinkId: string
  symbol: string
  side: Side
  qty: number
  price: number
  /** What the order still has to fill after this execution: 0 = filled */
  leavesQty: number
  time: number
  /** Set when this execution closed a position by its stop loss, its take profit or a liquidation */
  closedBy?: ClosedBy
}

/** An open order from /v5/order/realtime, plain or conditional (stops live here too). */
export interface Order {
  orderId: string
  orderLinkId: string
  symbol: string
  side: Side
  /** 'Market' | 'Limit' */
  orderType: string
  price: number
  qty: number
  leavesQty: number
  reduceOnly: boolean
  /** '' for a plain order, else Bybit's stopOrderType: 'StopLoss', 'TakeProfit', 'PartialStopLoss', 'PartialTakeProfit', ... */
  stopOrderType: string
  /** 'LastPrice' | 'MarkPrice' | 'IndexPrice'; '' for a plain order */
  triggerBy: string
  triggerPrice: number
  positionIdx: number
  /** Bybit orderStatus: 'New', 'PartiallyFilled', 'Untriggered', ... */
  status: string
  /** When it was placed (Bybit createdTime); unknown: ORDER_STALE is UNKNOWN */
  createdAt?: number
}

export interface Ticker {
  last: number; mark: number; index: number
  /** Perpetuals: the next funding, rate in percent (positive: longs pay) and when it is charged */
  funding?: { ratePct: number; at: number }
}
/** A 1-minute candle: its start time, close price and volume (last-price candles only; mark and index have none). */
export interface Candle { start: number; close: number; volume?: number }
/** Steps stay strings as the API sends them: String(1e-7) would be "1e-7" and lose the decimals. */
export interface Instrument { tickSize: string; qtyStep: string; minOrderQty: number; maxMktOrderQty: number; minNotionalValue: number }
/** One position slot of a symbol, also while flat: leverage is set per slot, and positionIdx 1 / 2 mean hedge mode. */
export interface Slot { positionIdx: number; leverage: number; size: number }
/** /v5/user/query-api: whether the key is read-only and what it may do, e.g. { ContractTrade: ['Order', 'Position'], Wallet: [] } */
export interface ApiKeyInfo { readOnly: boolean; permissions: Record<string, string[]> }
/** A market order of exactly the authorized qty. */
export interface OrderRequest {
  symbol: string; side: Side; qty: string; positionIdx: number; reduceOnly: boolean; orderLinkId: string
  /** attached stop and take profit of an Open */
  stopLoss?: number; takeProfit?: number
}

export interface Card {
  id: string
  key: string
  title: string
  detail: string
  question: string
  createdAt: number
  expiresAt: number
}

/** Trading account: total value, and what a new order or margin top-up can still draw on. */
export interface Balance {
  equity: number
  available: number
}

export interface SessionState {
  positions: Position[]
  /** null until the first read, or while the exchange does not answer it */
  balance: Balance | null
  /** The head of the proposal queue (§9 order); the lens shows it with its place */
  card: Proposal | null
  pending: number
  toast: string | null
  toastAlertId?: string
  error: string | null
  updatedAt: number
  /** Enabled shortcuts that currently apply to each open position, keyed `symbol:positionIdx` */
  onByPosition?: Record<string, number>
}

/** What /api/state sends: the session plus facts only the server knows. A missing field (older server) reads as "on". */
export interface ServerState extends SessionState {
  /** false: no speech-to-text key, so the glasses must not open the mic */
  voice?: boolean
  /** Which account is behind the numbers, e.g. "Bybit testnet" or "Demo data" */
  source?: string
  /** Pending, short-lived acknowledgement requested from the lens by Settings. */
  glassesTestId?: string
}

/** Bybit V5, USDT linear perpetuals only (docs/shortcuts-architecture.md §11). Writes throw ExchangeRejected on a clear no. */
export interface Exchange {
  balance(): Promise<Balance>
  positions(): Promise<Position[]>
  openOrders(): Promise<Order[]>
  fillsSince(ms: number): Promise<Fill[]>
  ticker(symbol: string): Promise<Ticker>
  /** The last `limit` 1-minute candles of one price source, in any order. */
  kline(symbol: string, source: PriceSource, limit: number): Promise<Candle[]>
  instrument(symbol: string): Promise<Instrument>
  /** Every USDT perpetual open for trading, sorted: the editor's symbol picker. */
  symbols(): Promise<string[]>
  slots(symbol: string): Promise<Slot[]>
  apiKeyInfo(): Promise<ApiKeyInfo>
  setStop(symbol: string, positionIdx: number, price: number): Promise<void>
  /** Leaves the stop loss as it is. */
  setTakeProfit(symbol: string, positionIdx: number, price: number): Promise<void>
  addMargin(symbol: string, positionIdx: number, usd: number): Promise<void>
  /** Both sides of the symbol to `leverage`; already there counts as done. */
  setLeverage(symbol: string, leverage: number): Promise<void>
  /** Returns Bybit's orderId. A resend after a rate limit carries the same orderLinkId. */
  placeOrder(o: OrderRequest): Promise<{ orderId: string }>
  cancelOrder(symbol: string, orderId: string): Promise<void>
  /** Bybit's record of one order, open or recently closed; null when Bybit has none. */
  order(symbol: string, ref: { orderLinkId: string } | { orderId: string }): Promise<OrderState | null>
}

/** Bybit orderStatus: New, PartiallyFilled, Filled, Cancelled, PartiallyFilledCanceled, Rejected, Untriggered, Triggered, Deactivated */
export interface OrderState { orderId: string; status: string; cumExecQty: number; avgPrice: number }

// ── Shortcut runtime records (§9, §10) ─────────────────────

export type Channel = 'glasses' | 'app'

/** The exact exchange command a tap authorizes, resolved when the proposal is built. Never taken from a client. */
export type Terms =
  | {
    type: 'order'; symbol: string; side: Side; qty: string; positionIdx: number; reduceOnly: boolean; orderLinkId: string
    stopLoss?: number; takeProfit?: number
    /** Open and Increase: what the lens prints next to qty */
    notionalUsdt?: number; leverage?: number; marginUsdt?: number
  }
  | { type: 'setStop'; symbol: string; positionIdx: number; price: number }
  | { type: 'setTakeProfit'; symbol: string; positionIdx: number; price: number }
  | { type: 'addMargin'; symbol: string; positionIdx: number; usd: number }
  | { type: 'cancel'; symbol: string; orderId: string }
  | { type: 'notify' }

/** One matching group of one shortcut on one target: the evidence, and History's line. */
export interface AlertRecord {
  id: string
  shortcutId: string
  version: number
  /** Stable target identity: 'pos:BTCUSDT:0:<epoch>', 'sym:BTCUSDT', 'ord:<orderId>' */
  targetKey: string
  /** "BTCUSDT long" */
  target: string
  /** The shortcut's name or action title, e.g. "Close position" */
  title: string
  /** Action at the time of the alert. Older History records may omit it. */
  actionType?: ActionType
  /** "liquidation distance 3.2%", or "Voice: protect all" */
  reason: string
  /** ids of the matching conditions */
  matched: string[]
  priority: 'CRITICAL' | 'NORMAL'
  simulated: boolean
  /** The shortcut's delivery switches when it fired */
  delivery: { glasses: boolean; phone: boolean }
  /** Channels it reached */
  channels: Channel[]
  /** History's last status: "Submitted · waiting for fill", "Skipped · stop would be past the price", ... */
  status: string
  /** Set when the action's guards fail for this target: no proposal then */
  skip?: { code: string; reason: string }
  createdAt: number
}

export interface AlertDetails {
  alert?: AlertRecord
  proposed?: string
  outcome?: string
  receipt?: string
}

export type ProposalStatus = 'PENDING' | 'DISMISSED' | 'EXPIRED' | 'SUPERSEDED' | 'AUTHORIZED'

/** Today's lens card plus what it authorizes. Immutable once built, except its status. */
export interface Proposal extends Card {
  /** The lens alert's two lines: "BTC long", and "liquidation distance 3.2%" or "Voice: protect all" */
  who: string
  why: string
  /** The condition behind `why`, for the lens icon; none for direct commands and tests */
  reasonType?: ConditionType
  alertId: string
  shortcutId: string
  version: number
  targetKey: string
  epoch?: string
  terms: Terms
  /** Open with more than one size or leverage: the lens asks which before Review (terms hold the first of each until then) */
  picks?: { sizes: number[]; leverages: number[] }
  /** The proposal this one replaced: a tap aimed at the old one does nothing */
  supersedes?: string
  /** A test from the editor: confirming it never reaches the exchange */
  simulated: boolean
  /** Raised by a voice phrase: its conditions were not checked, so a confirm does not check them either */
  voice?: boolean
  /** Raised by a menu or gesture: like a voice phrase, it supplies its own trigger */
  manual?: boolean
  /** From the alert: orders the lens queue */
  priority: 'CRITICAL' | 'NORMAL'
  status: ProposalStatus
  dismissedBy?: Channel
}

export type ExecutionStatus =
  | 'AUTHORIZED' | 'VALIDATING' | 'SUBMITTING' | 'ACKNOWLEDGED'
  | 'APPLIED' | 'FILLED' | 'PARTIALLY_FILLED' | 'PARTIALLY_FILLED_CANCELLED' | 'REJECTED' | 'UNKNOWN' | 'SIMULATED'

export interface Execution {
  id: string
  proposalId: string
  /** From the client's confirm: a resend with the same key gets this execution back */
  idempotencyKey: string
  terms: Terms
  status: ExecutionStatus
  /** Bybit's reason on a rejection, what is unknown, or the result line */
  message: string
  orderId?: string
  filledQty: number
  avgPrice: number
  createdAt: number
  updatedAt: number
  /** What a filled or applied write changed, read back from Bybit after it: "0.05 → 0.025 BTC", "stop none → 60,760" */
  receipt?: string
}

/** Account settings shown in Settings (§9, §10). */
export interface Settings {
  /** Repeat cooldown of state alerts, 10–300 s */
  cooldownSec: number
  /** Proposal lifetime: market orders, and protection / margin / cancel; 10–300 s */
  expiry: { marketSec: number; protectionSec: number }
  notifications: { glasses: boolean; app: boolean }
}

export const DEFAULT_SETTINGS: Settings = {
  cooldownSec: 60,
  expiry: { marketSec: 30, protectionSec: 60 },
  notifications: { glasses: true, app: true },
}
