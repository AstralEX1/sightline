/**
 * Phone icons: Phosphor Icons (https://phosphoricons.com, MIT, © 2023 Phosphor Icons), copied as SVG bodies on its
 * 256-unit grid instead of the package, since the page uses two dozen. Fill weight for action glyphs (white on their
 * color, like Apple Shortcuts) and editor lines; Bold for navigation and controls, where Fill carets would be triangles.
 * To add one: https://api.iconify.design/ph.json?icons=<name> and paste its body. The lens keeps its own set in app/src/icons.ts.
 */
import type { ActionType } from '../../../server/src/registry.ts'

const P = {
  close: '<path fill="currentColor" d="M128 24a104 104 0 1 0 104 104A104.11 104.11 0 0 0 128 24m40 136a8 8 0 0 1-8 8h-48a8 8 0 0 1 0-16h28.69l-50.35-50.34a8 8 0 0 1 11.32-11.32L152 140.69V112a8 8 0 0 1 16 0Z"/>', // arrow-circle-down-right-fill
  'shield-check': '<path fill="currentColor" d="M208 40H48a16 16 0 0 0-16 16v56c0 52.72 25.52 84.67 46.93 102.19c23.06 18.86 46 25.26 47 25.53a8 8 0 0 0 4.2 0c1-.27 23.91-6.67 47-25.53C198.48 196.67 224 164.72 224 112V56a16 16 0 0 0-16-16m-34.32 69.66l-56 56a8 8 0 0 1-11.32 0l-24-24a8 8 0 0 1 11.32-11.32L112 148.69l50.34-50.35a8 8 0 0 1 11.32 11.32Z"/>', // shield-check-fill
  shield: '<path fill="currentColor" d="M224 56v56c0 52.72-25.52 84.67-46.93 102.19c-23.06 18.86-46 25.27-47 25.53a8 8 0 0 1-4.2 0c-1-.26-23.91-6.67-47-25.53C57.52 196.67 32 164.72 32 112V56a16 16 0 0 1 16-16h160a16 16 0 0 1 16 16"/>', // shield-fill
  flag: '<path fill="currentColor" d="M232 56v120a8 8 0 0 1-2.76 6c-15.28 13.23-29.89 18-43.82 18c-18.91 0-36.57-8.74-53-16.85C105.87 170 82.79 158.61 56 179.77V224a8 8 0 0 1-16 0V56a8 8 0 0 1 2.77-6c36-31.18 68.31-15.21 96.79-1.12C167 62.46 190.79 74.2 218.76 50A8 8 0 0 1 232 56"/>', // flag-fill
  wallet: '<path fill="currentColor" d="M216 64H56a8 8 0 0 1 0-16h136a8 8 0 0 0 0-16H56a24 24 0 0 0-24 24v128a24 24 0 0 0 24 24h160a16 16 0 0 0 16-16V80a16 16 0 0 0-16-16m-36 80a12 12 0 1 1 12-12a12 12 0 0 1-12 12"/>', // wallet-fill
  open: '<path fill="currentColor" d="M128 24a104 104 0 1 0 104 104A104.13 104.13 0 0 0 128 24m40 112h-32v32a8 8 0 0 1-16 0v-32H88a8 8 0 0 1 0-16h32V88a8 8 0 0 1 16 0v32h32a8 8 0 0 1 0 16"/>', // plus-circle-fill
  grow: '<path fill="currentColor" d="M240 56v64a8 8 0 0 1-13.66 5.66L200 99.31l-58.34 58.35a8 8 0 0 1-11.32 0L96 123.31l-66.34 66.35a8 8 0 0 1-11.32-11.32l72-72a8 8 0 0 1 11.32 0L136 140.69L188.69 88l-26.35-26.34A8 8 0 0 1 168 48h64a8 8 0 0 1 8 8"/>', // trend-up-fill
  cancel: '<path fill="currentColor" d="M128 24a104 104 0 1 0 104 104A104.11 104.11 0 0 0 128 24m37.66 130.34a8 8 0 0 1-11.32 11.32L128 139.31l-26.34 26.35a8 8 0 0 1-11.32-11.32L116.69 128l-26.35-26.34a8 8 0 0 1 11.32-11.32L128 116.69l26.34-26.35a8 8 0 0 1 11.32 11.32L139.31 128Z"/>', // x-circle-fill
  bell: '<path fill="currentColor" d="M221.8 175.94c-5.55-9.56-13.8-36.61-13.8-71.94a80 80 0 1 0-160 0c0 35.34-8.26 62.38-13.81 71.94A16 16 0 0 0 48 200h40.81a40 40 0 0 0 78.38 0H208a16 16 0 0 0 13.8-24.06M128 216a24 24 0 0 1-22.62-16h45.24A24 24 0 0 1 128 216"/>', // bell-fill
  when: '<path fill="currentColor" d="m213.85 125.46l-112 120a8 8 0 0 1-13.69-7l14.66-73.33l-57.63-21.64a8 8 0 0 1-3-13l112-120a8 8 0 0 1 13.69 7l-14.7 73.41l57.63 21.61a8 8 0 0 1 3 12.95Z"/>', // lightning-fill
  'do-empty': '<path fill="currentColor" d="M240 128a15.74 15.74 0 0 1-7.6 13.51L88.32 229.65a16 16 0 0 1-16.2.3A15.86 15.86 0 0 1 64 216.13V39.87a15.86 15.86 0 0 1 8.12-13.82a16 16 0 0 1 16.2.3l144.08 88.14A15.74 15.74 0 0 1 240 128"/>', // play-fill
  scope: '<g fill="currentColor"><path d="m220 169.09l-92 53.65l-92-53.65a8 8 0 0 0-8 13.82l96 56a8 8 0 0 0 8.06 0l96-56a8 8 0 1 0-8.06-13.82"/><path d="m220 121.09l-92 53.65l-92-53.65a8 8 0 0 0-8 13.82l96 56a8 8 0 0 0 8.06 0l96-56a8 8 0 1 0-8.06-13.82"/><path d="m28 86.91l96 56a8 8 0 0 0 8.06 0l96-56a8 8 0 0 0 0-13.82l-96-56a8 8 0 0 0-8.06 0l-96 56a8 8 0 0 0 0 13.82"/></g>', // stack-fill
  mic: '<path fill="currentColor" d="M80 128V64a48 48 0 0 1 96 0v64a48 48 0 0 1-96 0m128 0a8 8 0 0 0-16 0a64 64 0 0 1-128 0a8 8 0 0 0-16 0a80.11 80.11 0 0 0 72 79.6V240a8 8 0 0 0 16 0v-32.4a80.11 80.11 0 0 0 72-79.6"/>', // microphone-fill
  'plus-circle': '<path fill="currentColor" d="M128 24a104 104 0 1 0 104 104A104.13 104.13 0 0 0 128 24m40 112h-32v32a8 8 0 0 1-16 0v-32H88a8 8 0 0 1 0-16h32V88a8 8 0 0 1 16 0v32h32a8 8 0 0 1 0 16"/>', // plus-circle-fill
  back: '<path fill="currentColor" d="M168.49 199.51a12 12 0 0 1-17 17l-80-80a12 12 0 0 1 0-17l80-80a12 12 0 0 1 17 17L97 128Z"/>', // caret-left-bold
  down: '<path fill="currentColor" d="m216.49 104.49l-80 80a12 12 0 0 1-17 0l-80-80a12 12 0 0 1 17-17L128 159l71.51-71.52a12 12 0 0 1 17 17Z"/>', // caret-down-bold
  right: '<path fill="currentColor" d="m184.49 136.49l-80 80a12 12 0 0 1-17-17L159 128L87.51 56.49a12 12 0 1 1 17-17l80 80a12 12 0 0 1-.02 17"/>', // caret-right-bold
  plus: '<path fill="currentColor" d="M228 128a12 12 0 0 1-12 12h-76v76a12 12 0 0 1-24 0v-76H40a12 12 0 0 1 0-24h76V40a12 12 0 0 1 24 0v76h76a12 12 0 0 1 12 12"/>', // plus-bold
  check: '<path fill="currentColor" d="m232.49 80.49l-128 128a12 12 0 0 1-17 0l-56-56a12 12 0 1 1 17-17L96 183L215.51 63.51a12 12 0 0 1 17 17Z"/>', // check-bold
  clock: '<path fill="currentColor" d="M140 80v41.21l34.17 20.5a12 12 0 1 1-12.34 20.58l-40-24A12 12 0 0 1 116 128V80a12 12 0 0 1 24 0m-12-52a99.38 99.38 0 0 0-70.76 29.34c-4.69 4.74-9 9.37-13.24 14V64a12 12 0 0 0-24 0v40a12 12 0 0 0 12 12h40a12 12 0 0 0 0-24H57.77c5.23-6 10.6-11.78 16.49-17.74a76 76 0 1 1 1.58 109a12 12 0 0 0-16.48 17.46A100 100 0 1 0 128 28"/>', // clock-counter-clockwise-bold
  glasses: '<path fill="currentColor" d="M200 36a12 12 0 0 0 0 24a12 12 0 0 1 12 12v50.46A47.94 47.94 0 0 0 142.75 148h-29.5A47.94 47.94 0 0 0 44 122.46V72a12 12 0 0 1 12-12a12 12 0 0 0 0-24a36 36 0 0 0-36 36v92a48 48 0 0 0 95.32 8h25.36a48 48 0 0 0 95.32-8V72a36 36 0 0 0-36-36M68 188a24 24 0 1 1 24-24a24 24 0 0 1-24 24m120 0a24 24 0 1 1 24-24a24 24 0 0 1-24 24"/>', // eyeglasses-bold
  gear: '<path fill="currentColor" d="M128 76a52 52 0 1 0 52 52a52.06 52.06 0 0 0-52-52m0 80a28 28 0 1 1 28-28a28 28 0 0 1-28 28m113.86-49.57a12 12 0 0 0-5.86-8.09l-27.79-15.85l-.11-31.31a12 12 0 0 0-4.25-9.12a116 116 0 0 0-38-21.41a12 12 0 0 0-9.68.89L128 37.27L99.83 21.53a12 12 0 0 0-9.7-.9a116.1 116.1 0 0 0-38 21.47a12 12 0 0 0-4.24 9.1l-.14 31.34L20 98.35a12 12 0 0 0-5.85 8.11a110.7 110.7 0 0 0 0 43.11a12 12 0 0 0 5.85 8.09l27.82 15.85l.11 31.31a12 12 0 0 0 4.25 9.12a116 116 0 0 0 38 21.41a12 12 0 0 0 9.68-.89L128 218.73l28.14 15.74a12 12 0 0 0 9.7.9a116.1 116.1 0 0 0 38-21.47a12 12 0 0 0 4.24-9.1l.14-31.34l27.81-15.81a12 12 0 0 0 5.85-8.11a110.7 110.7 0 0 0-.02-43.11m-22.63 33.18l-26.88 15.28a11.94 11.94 0 0 0-4.55 4.59c-.54 1-1.11 1.93-1.7 2.88a12 12 0 0 0-1.83 6.31l-.14 30.33a91.8 91.8 0 0 1-21.07 11.87l-27.15-15.19a12 12 0 0 0-5.86-1.53h-3.73a12.1 12.1 0 0 0-6.14 1.51L93 210.82A92.3 92.3 0 0 1 71.88 199l-.11-30.24a12 12 0 0 0-1.83-6.32c-.58-.94-1.16-1.91-1.7-2.88A11.9 11.9 0 0 0 63.7 155l-26.9-15.37a86.5 86.5 0 0 1 0-23.24l26.88-15.28a12 12 0 0 0 4.55-4.58c.54-1 1.11-1.94 1.7-2.89a12 12 0 0 0 1.83-6.31L71.87 57a91.8 91.8 0 0 1 21.07-11.83l27.15 15.19a11.9 11.9 0 0 0 6.15 1.52h3.44a12.1 12.1 0 0 0 6.14-1.51L163 45.18A92.3 92.3 0 0 1 184.12 57l.11 30.24a12 12 0 0 0 1.83 6.32c.58.94 1.16 1.91 1.7 2.88a11.9 11.9 0 0 0 4.54 4.56l26.9 15.33a86.5 86.5 0 0 1 .03 23.28"/>', // gear-six-bold
  search: '<path fill="currentColor" d="M232.49 215.51L185 168a92.12 92.12 0 1 0-17 17l47.53 47.54a12 12 0 0 0 17-17ZM44 112a68 68 0 1 1 68 68a68.07 68.07 0 0 1-68-68"/>', // magnifying-glass-bold
} as const

export type Icon = keyof typeof P

/** `_weight` is ignored: Phosphor bakes the weight into each glyph. Kept so the call sites read the same. */
export const icon = (name: Icon, size = 20, _weight = 2) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${P[name]}</svg>`

/** The remove control (x-circle-fill in the second text color) and the warning sign (warning-fill). */
export const REMOVE = `<svg width="24" height="24" viewBox="0 0 256 256" fill="var(--text-2)" aria-hidden="true"><path fill="currentColor" d="M128 24a104 104 0 1 0 104 104A104.11 104.11 0 0 0 128 24m37.66 130.34a8 8 0 0 1-11.32 11.32L128 139.31l-26.34 26.35a8 8 0 0 1-11.32-11.32L116.69 128l-26.35-26.34a8 8 0 0 1 11.32-11.32L128 116.69l26.34-26.35a8 8 0 0 1 11.32 11.32L139.31 128Z"/></svg>`
export const WARN = `<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path fill="currentColor" d="M236.8 188.09L149.35 36.22a24.76 24.76 0 0 0-42.7 0L19.2 188.09a23.51 23.51 0 0 0 0 23.72A24.35 24.35 0 0 0 40.55 224h174.9a24.35 24.35 0 0 0 21.33-12.19a23.51 23.51 0 0 0 .02-23.72M120 104a8 8 0 0 1 16 0v40a8 8 0 0 1-16 0Zm8 88a12 12 0 1 1 12-12a12 12 0 0 1-12 12"/></svg>`

export const ACTION_ICON: Record<ActionType, { icon: Icon; color: string }> = {
  CLOSE_POSITION: { icon: 'close', color: 'var(--act-close)' },
  MOVE_SL: { icon: 'shield-check', color: 'var(--act-stop)' },
  SET_SL: { icon: 'shield', color: 'var(--act-stop)' },
  SET_TP: { icon: 'flag', color: 'var(--act-stop)' },
  ADD_MARGIN: { icon: 'wallet', color: 'var(--act-margin)' },
  OPEN_POSITION: { icon: 'open', color: 'var(--act-grow)' },
  INCREASE_POSITION: { icon: 'grow', color: 'var(--act-grow)' },
  CANCEL_ORDER: { icon: 'cancel', color: 'var(--act-cancel)' },
  NOTIFY: { icon: 'bell', color: 'var(--act-notify)' },
}
