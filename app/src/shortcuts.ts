import type { Shortcut } from '../../server/src/types.ts'
import { normalizePhrase } from '../../server/src/rules.ts'
import { coin, usd } from '../../server/src/format.ts'

export const shortcutLine = (s: Shortcut) =>
  `${s.phrase} -> ${s.command} ${s.symbol === 'ALL' ? 'all' : s.symbol}${s.usd ? ` ${s.usd}` : ''}`

/** "buy eth -> buy ETHUSDT 100" → Shortcut. Throws naming the bad line; the server checks the rest. */
export function parseShortcuts(text: string): Shortcut[] {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const m = line.match(/^(.+?)\s*->\s*(stop|lock|buy|sell)\s+([A-Za-z0-9]+)(?:\s+([\d.]+))?$/i)
    const phrase = m ? normalizePhrase(m[1]) : ''
    if (!m || !phrase) throw new Error(`Cannot read shortcut "${line}". Example: buy eth -> buy ETHUSDT 100`)
    const s: Shortcut = { phrase, command: m[2].toLowerCase() as Shortcut['command'], symbol: m[3].toUpperCase() }
    if (m[4]) s.usd = Number(m[4])
    return s
  })
}

/** A shortcut read back in words: what saying it puts on the lens. */
export function describeShortcut(s: Shortcut): string {
  const all = s.symbol === 'ALL'
  const does = s.command === 'stop' ? `a stop on ${all ? 'every position' : coin(s.symbol)}`
    : s.command === 'lock' ? `stop to entry on ${all ? 'every winner' : coin(s.symbol)}`
    : `${s.command} ${usd(s.usd ?? 0)} of ${coin(s.symbol)} at market`
  return `Say “${s.phrase}”: ${does}`
}
