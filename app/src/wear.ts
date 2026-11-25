/**
 * Whether the glasses are in use, from the Even app's device status: while they are off or in the case the lens
 * stops polling the server (which keeps watching and still sends Telegram alerts).
 * Adapted from market-glimpse's src/wear.ts (github.com/adamtorgerson/market-glimpse).
 *
 * The SDK fills in what a status lacks: `isWearing` and `isInCase` become false and `connectType` "none". So a false
 * `isWearing` only counts once the glasses have reported true, and a status without a connection says nothing.
 * Wrong the other way only costs battery, so anything unclear counts as in use.
 */
export interface GlassesStatus { connectType?: string; isWearing?: boolean; isInCase?: boolean }

const OFFLINE = new Set(['connecting', 'disconnected', 'connectionFailed'])

export class WearTracker {
  private seenWearing = false
  /** Set back to true by any input from the glasses: someone is using them, whatever the last status said. */
  inUse = true

  /** Takes in a status; returns whether the glasses are now in use. */
  update(s: GlassesStatus): boolean {
    if (!s.connectType || s.connectType === 'none') return this.inUse
    if (s.isWearing === true) this.seenWearing = true
    this.inUse = !OFFLINE.has(s.connectType) && !s.isInCase && (s.isWearing === true || !this.seenWearing)
    return this.inUse
  }
}
