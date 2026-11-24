/** DOM helpers shared by the phone screens: element builder, toast, bottom sheet, menu, dialog (spec §4.8, §4.9, §4.12). */
import * as api from '../api.ts'
import type { ApiError, Catalog, Tile } from '../api.ts'
import { icon } from './icons.ts'

type Attr = string | number | boolean | undefined | null | ((e: Event) => void)
type Kid = Node | string | null | undefined | false

/**
 * `h('button', { class: 'x', onclick: fn, 'aria-label': '…' }, 'text')`. Strings become text nodes, so server text is
 * never parsed as markup; `html` sets innerHTML and takes only this module's own icon strings.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, Attr> = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue
    if (typeof v === 'function') el.addEventListener(k.slice(2), v)
    else if (k === 'html') el.innerHTML = String(v)
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k)
  return el
}

/** One page, one account: what the screens share. */
export const app = {
  root: null as unknown as HTMLElement,
  catalog: null as Catalog | null,
  tiles: null as Tile[] | null,
  /** New alerts since History was last open: the badge on the History button. */
  unseen: 0,
  /** The route before this one: the editor's back button pops to it when it is home. */
  from: '',
}

/** No answer, or the dev proxy saying the server is down. */
export const isOffline = (e: unknown) => { const s = (e as ApiError).status; return s === undefined || s >= 500 }

export const getCatalog = async (): Promise<Catalog> => (app.catalog ??= await api.getCatalog())

let toastTimer: ReturnType<typeof setTimeout> | undefined
/** Bottom, above the safe area, 3 s, text only (§4.12). */
export function toast(text: string, ms = 3000) {
  const el = app.root.querySelector<HTMLElement>('.toast')!
  el.textContent = text
  el.classList.add('is-on')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('is-on'), ms)
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Tab stays inside `box`; Escape calls `onEscape`. */
function trap(box: HTMLElement, onEscape: () => void) {
  box.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); onEscape() }
    if (e.key !== 'Tab') return
    const f = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(x => x.offsetParent !== null)
    if (!f.length) return
    const [first, last] = [f[0], f[f.length - 1]]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  })
}

export type Sheet = { close: () => void; setDone: (enabled: boolean) => void; el: HTMLElement }

/**
 * Bottom sheet: Cancel · title · Done. `onDone` returns false to stay open. Cancel, a scrim tap, Escape and a drag down
 * discard. Focus moves in (to `focus`, else the first control) and goes back with `back()` (the token, found again after
 * the editor re-rendered).
 */
export function sheet(o: { title: string; body: Kid[]; onDone?: () => boolean | void; back?: () => void; focus?: HTMLElement }): Sheet {
  const scrim = h('div', { class: 'scrim' })
  const done = o.onDone && h('button', { class: 'link-btn link-btn--strong', type: 'button' }, 'Done')
  const el = h('section', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title },
    h('div', { class: 'sheet__grabber', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet__nav' },
      h('button', { class: 'link-btn', type: 'button', onclick: () => close() }, 'Cancel'),
      h('h2', { class: 'sheet__title' }, o.title),
      done || h('span')),
    h('div', { class: 'sheet__body' }, ...o.body))
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    el.classList.add('is-closing')
    el.classList.remove('is-open')
    scrim.classList.remove('is-open')
    setTimeout(() => { el.remove(); scrim.remove() }, 350)
    o.back?.()
  }
  done?.addEventListener('click', () => { if (!done.disabled && o.onDone!() !== false) close() })
  scrim.addEventListener('click', close)
  trap(el, close)
  drag(el, close)
  app.root.append(scrim, el)
  requestAnimationFrame(() => { el.classList.add('is-open'); scrim.classList.add('is-open') })
  ;(o.focus ?? el.querySelector<HTMLElement>(FOCUSABLE))?.focus({ preventScroll: true }) // `focus` opens the keyboard: only for a sheet that is one field
  return { close, el, setDone: on => { if (done) done.disabled = !on } }
}

/** Drag down from the grabber or nav: 1:1, dismiss past half the height or on a fast flick, else spring back. */
function drag(el: HTMLElement, close: () => void) {
  // shortcut: a CSS curve stands in for the velocity-handoff spring of §3.5, write the spring step if it feels off on a device
  let y0 = 0, t0 = 0, dy = 0, on = false
  const grip = (e: PointerEvent) => (e.target as HTMLElement).closest('.sheet__grabber, .sheet__nav') && !(e.target as HTMLElement).closest('button')
  el.addEventListener('pointerdown', e => {
    if (!grip(e)) return
    on = true; y0 = e.clientY; t0 = e.timeStamp; dy = 0
    el.setPointerCapture(e.pointerId)
    el.style.transition = 'none'
  })
  el.addEventListener('pointermove', e => {
    if (!on) return
    dy = Math.max(0, e.clientY - y0)
    el.style.transform = `translateY(${dy}px)`
  })
  const end = (e: PointerEvent) => {
    if (!on) return
    on = false
    el.style.transition = el.style.transform = ''
    const v = dy / Math.max(1, e.timeStamp - t0) // px per ms
    if (dy + v * 200 > el.offsetHeight / 2) close() // projected end point
  }
  el.addEventListener('pointerup', end)
  el.addEventListener('pointercancel', end)
}

export type MenuItem = { label: string; checked?: boolean; danger?: boolean; disabled?: boolean; onPick: () => void }

/** Menu anchored 8 px under `anchor`, left edge clamped to the page inset; menuitemradio when an item can be checked. */
export function menu(anchor: HTMLElement, items: MenuItem[], label: string, back?: () => void) {
  const radio = items.some(i => i.checked !== undefined)
  const scrim = h('div', { class: 'menu-scrim' })
  const close = () => { scrim.remove(); box.remove(); back?.() }
  const box = h('div', { class: 'menu', role: 'menu', 'aria-label': label },
    ...items.map(i => h('button', {
      class: `menu__item${i.danger ? ' is-danger' : ''}`, type: 'button', role: radio ? 'menuitemradio' : 'menuitem',
      'aria-checked': radio ? String(!!i.checked) : undefined, disabled: i.disabled,
      onclick: () => { i.onPick(); close() }, // pick first: a sheet it opens keeps focus
    }, h('span', {}, i.label), i.checked ? h('span', { class: 'menu__check', html: icon('check', 18, 2.4) }) : null)))
  scrim.addEventListener('click', close)
  trap(box, close)
  app.root.append(scrim, box)
  const r = anchor.getBoundingClientRect()
  const w = box.offsetWidth
  const left = Math.max(16, Math.min(r.left, innerWidth - 16 - w))
  const below = r.bottom + 8 + box.offsetHeight < innerHeight
  box.style.left = `${left}px`
  box.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - 8 - box.offsetHeight)}px`
  box.style.transformOrigin = `${r.left + r.width / 2 - left}px ${below ? 0 : box.offsetHeight}px`
  requestAnimationFrame(() => box.classList.add('is-open'))
  ;(box.querySelector<HTMLElement>('[aria-checked="true"]') ?? box.querySelector<HTMLElement>('button'))?.focus()
}

/** Centered dialog, 270 wide, title + one line + stacked buttons. Resolves with the index of the button. */
export function dialog(o: { title: string; text?: string; buttons: { label: string; primary?: boolean; danger?: boolean }[] }): Promise<number> {
  return new Promise(resolve => {
    const before = document.activeElement as HTMLElement | null
    const pick = (i: number) => { wrap.remove(); before?.focus(); resolve(i) }
    const wrap = h('div', { class: 'dialog-scrim' },
      h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title', 'aria-describedby': o.text ? 'dlg-text' : undefined },
        h('h2', { id: 'dlg-title', class: 'dialog__title' }, o.title),
        o.text ? h('p', { id: 'dlg-text', class: 'dialog__text' }, o.text) : null,
        ...o.buttons.map((b, i) => h('button', {
          class: `dialog__btn${b.primary ? ' is-primary' : ''}${b.danger ? ' is-danger' : ''}`, type: 'button', onclick: () => pick(i),
        }, b.label))))
    trap(wrap, () => pick(-1)) // Escape picks nothing
    app.root.append(wrap)
    wrap.querySelector<HTMLElement>('.is-primary, button')?.focus()
  })
}

/** Row switch 51 × 31 (Settings, Options). */
export const rowSwitch = (on: boolean, labelledBy: string, onToggle: (on: boolean, el: HTMLButtonElement) => void, disabled = false) => {
  const el = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-labelledby': labelledBy, disabled },
    h('span', { class: 'switch__knob' }))
  el.addEventListener('click', () => onToggle(el.getAttribute('aria-checked') !== 'true', el))
  return el
}

/** History and Settings nav: back link to Shortcuts, centered title, optional right button. */
export const subNav = (title: string, right?: Node) => h('div', { class: 'nav nav--sub' },
  h('a', { class: 'back-link', href: '#/', html: `${icon('back', 20, 2.6)}<span>Shortcuts</span>` }),
  h('h1', { class: 'nav-title' }, title),
  right ?? h('span'))
