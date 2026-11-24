/**
 * Phone icons of spec §3.4, 24-unit grid, stroked. Kept here until they are merged into app/src/icons.ts
 * (off-limits while the lens work there is uncommitted).
 */
import type { ActionType } from '../../../server/src/registry.ts'

const P = {
  close: '<path d="M7 7l10 10M17 9v8H9"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z"/>',
  'shield-bar': '<path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z"/><path d="M12 9v5"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14.5h2"/>',
  grow: '<path d="M7 17L17 7M9 7h8v8"/>',
  x: '<path d="M7 7l10 10M17 7L7 17"/>',
  bell: '<path d="M6 16v-5a6 6 0 0112 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 004 0"/>',
  when: '<path d="M8 16L16 8M10 8h6v6"/>',
  'do-empty': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  scope: '<rect x="7" y="3" width="13" height="13" rx="2.5"/><path d="M4 8v10.5A2.5 2.5 0 006.5 21H16"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  'plus-circle': '<circle cx="12" cy="12" r="9.5"/><path d="M12 8v8M8 12h8"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  glasses: '<circle cx="6.5" cy="14" r="3.5"/><circle cx="17.5" cy="14" r="3.5"/><path d="M10 14h4M3 13l1.5-5M21 13l-1.5-5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  mic: '<path d="M9 5a3 3 0 016 0v6a3 3 0 01-6 0z"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
} as const

export type Icon = keyof typeof P

export const icon = (name: Icon, size = 20, stroke = 2) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`

/** Filled glyphs: a circle in --chip with an x in --text-2, and the warning triangle. */
export const REMOVE = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="var(--chip)"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="var(--text-2)" stroke-width="2" stroke-linecap="round"/></svg>'
export const WARN = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5L1.5 21h21z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 9.5v5M12 17.6v.4" stroke="var(--surface)" stroke-width="2.2" stroke-linecap="round"/></svg>'

export const ACTION_ICON: Record<ActionType, { icon: Icon; color: string }> = {
  CLOSE_POSITION: { icon: 'close', color: 'var(--act-close)' },
  MOVE_SL: { icon: 'shield', color: 'var(--act-stop)' },
  SET_SL: { icon: 'shield-bar', color: 'var(--act-stop)' },
  SET_TP: { icon: 'target', color: 'var(--act-stop)' },
  ADD_MARGIN: { icon: 'wallet', color: 'var(--act-margin)' },
  OPEN_POSITION: { icon: 'grow', color: 'var(--act-grow)' },
  INCREASE_POSITION: { icon: 'grow', color: 'var(--act-grow)' },
  CANCEL_ORDER: { icon: 'x', color: 'var(--act-cancel)' },
  NOTIFY: { icon: 'bell', color: 'var(--act-notify)' },
}
