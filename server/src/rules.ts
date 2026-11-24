import type { Position } from './types.ts'

/** Distance from liquidation in percent of the mark; Infinity when Bybit gives no liquidation price. */
export function liqDistancePct(p: Position): number {
  return p.liqPrice > 0 ? (Math.abs(p.markPrice - p.liqPrice) / p.markPrice) * 100 : Infinity
}

export const normalizePhrase = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** The shortcut with the longest voice phrase that appears in the text as whole words. */
export function matchShortcut<T extends { voicePhrase?: string }>(text: string, shortcuts: T[]): T | null {
  const t = ` ${normalizePhrase(text)} `
  let best: T | null = null
  for (const sc of shortcuts) {
    const phrase = sc.voicePhrase
    if (phrase && t.includes(` ${phrase} `) && phrase.length > (best?.voicePhrase?.length ?? 0)) best = sc
  }
  return best
}
