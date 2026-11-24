/** Shortcuts, the home screen (spec §5.1): your shortcuts and the templates as 2-column tiles, status line, History and +. */
import * as api from '../api.ts'
import type { ApiError, Tile } from '../api.ts'
import type { Template } from '../../../server/src/registry.ts'
import { ACTION_ICON, icon } from './icons.ts'
import { tileSub } from './sentence.ts'
import { app, h, isOffline, toast } from './ui.ts'
import { openDraft } from './editor.ts'

let templates: Template[] | null = null
let offline = false
let lastKey = ''
/** shortcut: the server does not report whether the lens is open, so G2 follows main.ts's #glasses text; read lens-seen from /settings once it is sent */
const g2 = () => (document.getElementById('glasses')?.textContent === 'Glasses connected' ? 'G2' : 'G2 off')

function statusLine(s: api.SettingsPage | null, err: unknown) {
  const unauthorized = (err as ApiError | null)?.status === 401
  const up = s?.bybit.status === 'Connected'
  const label = err ? (unauthorized ? 'Check the server token' : 'Server offline')
    : `Bybit · ${up ? (s!.bybit.source.includes('testnet') ? 'Testnet' : 'Demo') : 'Offline'}`
  return h('a', { class: 'status-line', href: '#/settings', 'aria-label': `${label}${err ? '' : `, Even ${g2()}`}. Settings` },
    h('span', { class: `dot${up && !err ? ' is-on' : err ? ' is-muted' : ''}`, 'aria-hidden': 'true' }),
    label,
    err ? null : h('span', { class: 'status-line__g2', html: icon('glasses', 18, 1.8) }, g2()))
}

function tile(t: Tile) {
  const { icon: name, color } = ACTION_ICON[t.action.type]
  const sub = tileSub(t)
  const sw = h('button', {
    class: 'tile__switch', type: 'button', role: 'switch', 'aria-checked': String(t.enabled), 'aria-label': t.title,
    'aria-disabled': offline ? 'true' : undefined,
  }, h('span', { class: 'tile__track' }, h('span', { class: 'tile__knob' })))
  sw.addEventListener('click', () => void toggle(t, sw))
  return h('div', { class: 'tile', 'data-state': t.enabled ? 'on' : 'off' },
    h('a', { class: 'tile__body', href: `#/shortcut/${encodeURIComponent(t.id)}`, 'aria-label': `${t.title}, ${sub}. Edit` },
      h('span', { class: 'tile__glyph', style: `color: ${t.enabled ? color : 'var(--act-cancel)'}`, html: icon(name, 26, 2) }),
      h('span', { class: 'tile__text' }, h('span', { class: 'tile__title' }, t.title), h('span', { class: 'tile__sub' }, sub))),
    sw)
}

/** Optimistic: the switch moves at 60% until the server answers, and springs back on an error (P02). */
async function toggle(t: Tile, sw: HTMLButtonElement) {
  if (offline || sw.dataset.busy) return
  const on = !t.enabled
  sw.dataset.busy = '1'
  sw.setAttribute('aria-checked', String(on))
  try {
    Object.assign(t, await api.setEnabled(t.id, on, t.version))
    sw.closest('.tile')!.replaceWith(tile(t))
  } catch (e) {
    sw.setAttribute('aria-checked', String(!on))
    delete sw.dataset.busy
    toast((e as Error).message)
    if ((e as ApiError).status !== 409) return
    if (on) location.hash = `#/shortcut/${encodeURIComponent(t.id)}` // the editor marks why
    else void renderHome(sw.closest('main')!, false) // a newer version elsewhere: refetch so the next tap carries it
  }
}

function templateTile(t: Template) {
  const { icon: name, color } = ACTION_ICON[t.draft.action.type]
  return h('button', {
    class: 'tile tile--template', type: 'button', 'aria-label': `Template: ${t.title}, ${t.sub}. Add`,
    'aria-disabled': offline ? 'true' : undefined, onclick: () => void useTemplate(t),
  },
  h('span', { class: 'tile__top' },
    h('span', { class: 'tile__glyph', style: `color: ${color}`, html: icon(name, 26, 2) }),
    h('span', { class: 'tile__badge', 'aria-hidden': 'true', html: icon('plus', 12, 3.4) })),
  h('span', { class: 'tile__text' }, h('span', { class: 'tile__title' }, t.title), h('span', { class: 'tile__sub' }, t.sub)))
}

/** A complete template is saved off at once (P04); one with values to choose opens unsaved, with placeholders. */
async function useTemplate(t: Template) {
  if (offline) return
  try {
    const sc = await api.createShortcut({ ...structuredClone(t.draft), enabled: false })
    location.hash = `#/shortcut/${encodeURIComponent(sc.id)}`
  } catch (e) {
    // shortcut: the server stores valid shortcuts only, so a template with gaps is a draft in this page until its first valid save
    if ((e as ApiError).status === 400) return openDraft(structuredClone(t.draft))
    toast((e as Error).message)
  }
}

/** Renders into `el`; called on route enter and every 10 s while home is shown. */
export async function renderHome(el: HTMLElement, first: boolean) {
  const nav = h('div', { class: 'nav' },
    h('a', { class: 'circle-btn circle-btn--history', href: '#/history', 'aria-label': app.unseen ? `History, ${app.unseen} new` : 'History', html: icon('clock', 22, 2) },
      app.unseen ? h('span', { class: 'badge', 'aria-hidden': 'true' }, String(app.unseen)) : null),
    h('a', { class: 'circle-btn circle-btn--accent', href: '#/shortcut/new', 'aria-label': 'New shortcut', html: icon('plus', 20, 2.4) }))
  if (first && !app.tiles) {
    el.replaceChildren(nav, h('h1', { class: 'title-large' }, 'Shortcuts'), h('div', { class: 'status-line' }),
      h('div', { class: 'grid' }, h('div', { class: 'tile is-loading' }), h('div', { class: 'tile is-loading' })))
  }
  const [tiles, tpl, settings] = await Promise.allSettled([api.listShortcuts(), templates ? Promise.resolve(templates) : api.getTemplates(), api.getAccountSettings()])
  const err = tiles.status === 'rejected' ? tiles.reason : null
  offline = !!err && isOffline(err)
  if (tiles.status === 'fulfilled') app.tiles = tiles.value
  if (tpl.status === 'fulfilled') templates = tpl.value
  const mine = app.tiles
  const st = settings.status === 'fulfilled' ? settings.value : null
  // the 10 s refresh replaces nothing when nothing changed, so focus and VoiceOver's place stay
  const key = JSON.stringify([mine, templates?.length, st?.bybit, err && String(err), app.unseen, g2()])
  if (!first && key === lastKey) return offline
  lastKey = key
  el.replaceChildren(
    nav,
    h('h1', { class: 'title-large' }, 'Shortcuts'),
    statusLine(st, err),
    mine?.length ? h('div', { class: 'grid' }, ...mine.map(tile))
      : h('p', { class: 'empty' }, mine ? 'No shortcuts yet. Start from a template or tap +.' : ''),
    h('h2', { class: 'title-section' }, 'Templates'),
    h('div', { class: 'grid' }, ...(templates ?? []).map(templateTile)))
  return offline
}
