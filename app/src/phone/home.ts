/** Shortcuts, the home screen (spec §5.1): your shortcuts and the templates as 2-column tiles, status line, History and +. */
import * as api from '../api.ts'
import type { ApiError, TemplateTile, Tile } from '../api.ts'
import { ACTION_ICON, WARN, icon } from './icons.ts'
import { app, h, isOffline, toast } from './ui.ts'

let templates: TemplateTile[] | null = null
let offline = false
let lastKey = ''
/** shortcut: the server does not report whether the lens is open, so G2 follows main.ts's #glasses text; read lens-seen from /settings once it is sent */
const g2 = () => (document.getElementById('glasses')?.textContent === 'Glasses connected' ? 'G2' : 'G2 off')

function statusLine(s: api.SettingsPage | null, err: unknown) {
  const unauthorized = (err as ApiError | null)?.status === 401
  const up = s?.bybit.status === 'Connected'
  const label = err ? (unauthorized ? 'Check the server token' : 'Server offline')
    : up && s?.bybit.source === 'Paper' ? 'Paper' : `Bybit · ${up ? (s!.bybit.source.includes('testnet') ? 'Testnet' : 'Demo') : 'Offline'}`
  return h('a', { class: 'status-line', href: '#/settings', 'aria-label': `${label}${err ? '' : `, Even ${g2()}`}. Settings` },
    h('span', { class: `dot${up && !err ? ' is-on' : err ? ' is-muted' : ''}`, 'aria-hidden': 'true' }),
    label,
    err ? null : h('span', { class: 'status-line__g2', html: icon('glasses', 18, 1.8) }, g2()),
    h('span', { class: 'status-line__chev', 'aria-hidden': 'true', html: icon('right', 14, 2.6) }))
}

/** Nothing to show because the server did not answer: say why and offer the way out (HIG empty states). */
function unreachable(err: unknown, retry: () => void) {
  const unauthorized = (err as ApiError | null)?.status === 401
  return h('div', { class: 'empty-state', role: 'status' },
    h('span', { class: 'empty-state__icon', html: WARN.replace('width="16" height="16"', 'width="32" height="32"') }),
    h('h2', { class: 'empty-state__title' }, unauthorized ? 'The server needs a token' : 'Can’t reach the server'),
    h('p', { class: 'empty-state__text' }, unauthorized
      ? 'Enter the APP_TOKEN in Settings to see your shortcuts.'
      : 'Your shortcuts show here once it answers. Check the address in Settings, or try again.'),
    h('div', { class: 'empty-state__actions' },
      h('a', { class: 'pill-btn pill-btn--accent', href: '#/settings' }, 'Open Settings'),
      unauthorized ? null : h('button', { class: 'pill-btn', type: 'button', onclick: retry }, 'Try again')))
}

/**
 * Logo (action glyph) + title. Color follows the action.
 * Templates keep their catalog title; shortcuts without a custom name use the action title.
 */
function tile(t: Tile) {
  const { icon: name, color } = ACTION_ICON[t.action.type]
  const label = t.draft ? `${t.title}, draft` : t.title
  const sw = h('button', {
    class: 'tile__switch', type: 'button', role: 'switch', 'aria-checked': String(t.enabled), 'aria-label': `${t.title}, ${t.summary}`, // two tiles can share a title: the rule tells them apart
    'aria-disabled': offline || t.draft ? 'true' : undefined,
  }, h('span', { class: 'tile__track' }, h('span', { class: 'tile__knob' })))
  sw.addEventListener('click', () => void toggle(t, sw))
  return h('div', { class: 'tile', 'data-state': t.draft ? 'draft' : t.enabled ? 'on' : 'off', style: `--c: ${color}` },
    h('a', { class: 'tile__body', href: `#/shortcut/${encodeURIComponent(t.id)}`, 'aria-label': `${label}. Edit` },
      h('span', { class: 'tile__glyph', html: icon(name, 32, 2.6) }),
      h('span', { class: 'tile__title' }, t.title)),
    sw)
}

/** Optimistic: the switch moves at 60% until the server answers, and springs back on an error (P02). */
async function toggle(t: Tile, sw: HTMLButtonElement) {
  if (offline || sw.dataset.busy) return
  if (t.draft) { location.hash = `#/shortcut/${encodeURIComponent(t.id)}`; return }
  const on = !t.enabled
  sw.dataset.busy = '1'
  sw.setAttribute('aria-checked', String(on))
  try {
    Object.assign(t, await api.setEnabled(t.id, on, t.version))
    // update in place: a new tile would cut the knob's slide
    const el = sw.closest<HTMLElement>('.tile')!
    el.dataset.state = t.draft ? 'draft' : t.enabled ? 'on' : 'off'
    sw.setAttribute('aria-label', `${t.title}, ${t.summary}`)
    sw.setAttribute('aria-checked', String(t.enabled))
    delete sw.dataset.busy
  } catch (e) {
    sw.setAttribute('aria-checked', String(!on))
    delete sw.dataset.busy
    toast((e as Error).message)
    if ((e as ApiError).status !== 409) return
    if (on) location.hash = `#/shortcut/${encodeURIComponent(t.id)}` // the editor marks why
    else void renderHome(sw.closest('main')!, false) // a newer version elsewhere: refetch so the next tap carries it
  }
}

function templateTile(t: TemplateTile) {
  const { icon: name, color } = ACTION_ICON[t.draft.action.type]
  return h('button', {
    class: 'tile tile--template', type: 'button', style: `--c: ${color}`, 'aria-label': `Template: ${t.title}. Add`,
    'aria-disabled': offline ? 'true' : undefined, onclick: () => useTemplate(t),
  },
  h('span', { class: 'tile__top' },
    h('span', { class: 'tile__glyph', html: icon(name, 32, 2.6) }),
    h('span', { class: 'tile__badge', 'aria-hidden': 'true', html: icon('plus', 12, 3.4) })),
  h('span', { class: 'tile__title' }, t.title))
}

/**
 * One block per category: a heading that folds its grid away like a Notion toggle (kept on this phone, so it works offline too), the grid.
 * Templates from a server that sends no category stay one plain grid.
 */
function templateGroups(list: TemplateTile[]) {
  const collapsed = api.collapsedCategories()
  const cats = [...new Set(list.map(t => t.category))]
  return cats.map((c, i) => {
    const id = `tpl-cat-${i}`
    const grid = h('div', { class: 'grid', id, hidden: !!c && collapsed.has(c) }, ...list.filter(t => t.category === c).map(templateTile))
    return h('div', { class: 'tpl-group' },
      c ? h('h3', { class: 'tpl-group__title' }, h('button', {
        class: 'tpl-group__toggle', type: 'button', 'aria-expanded': String(!grid.hidden), 'aria-controls': id,
        onclick: (e: Event) => {
          const open = !!grid.hidden
          grid.hidden = !open
          ;(e.currentTarget as HTMLElement).setAttribute('aria-expanded', String(open))
          if (open && !matchMedia('(prefers-reduced-motion: reduce)').matches) grid.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' })
          api.setCategoryOpen(c, open)
        },
      }, h('span', { class: 'tpl-group__chev', 'aria-hidden': 'true', html: icon('right', 14, 2.6) }), c)) : null,
      grid)
  })
}

/** Opens the template as a new, unsaved shortcut: nothing is created until Add (or an edit) in the editor. */
function useTemplate(t: TemplateTile) {
  if (offline) return
  location.hash = `#/shortcut/new?tpl=${encodeURIComponent(t.id)}`
}

/** Renders into `el`; called on route enter and every 10 s while home is shown. */
export async function renderHome(el: HTMLElement, first: boolean) {
  const nav = () => h('div', { class: 'nav' },
    h('a', { class: 'circle-btn circle-btn--history', href: '#/history', 'aria-label': app.unseen ? `History, ${app.unseen} new` : 'History', html: icon('clock', 22, 2) },
      app.unseen ? h('span', { class: 'badge', 'aria-hidden': 'true' }, String(app.unseen)) : null),
    h('a', {
      class: 'circle-btn circle-btn--accent', href: '#/shortcut/new', html: icon('plus', 20, 2.4),
      'aria-label': offline ? 'New shortcut, unavailable while the server is offline' : 'New shortcut',
      'aria-disabled': offline ? 'true' : undefined, onclick: (e: Event) => { if (offline) e.preventDefault() },
    }))
  if (first && !app.tiles) {
    el.replaceChildren(nav(), h('h1', { class: 'title-large' }, 'Shortcuts'), h('div', { class: 'status-line' }),
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
  // a toggle leaves lastKey stale, so the next refresh rebuilds: keep focus on the same control (a category heading by the grid it controls)
  const a = el.contains(document.activeElement) ? document.activeElement! : null
  const f = a && ['aria-label', 'aria-labelledby', 'aria-controls'].map(k => a.getAttribute(k) && `[${k}="${CSS.escape(a.getAttribute(k)!)}"]`).find(Boolean)
  el.replaceChildren(
    nav(),
    h('h1', { class: 'title-large' }, 'Shortcuts'),
    statusLine(st, err),
    mine?.length ? h('div', { class: 'grid' }, ...mine.map(tile))
      : mine ? h('p', { class: 'empty empty--hero' }, 'No shortcuts yet. Start from a template below, or tap +.')
      : unreachable(err, () => void renderHome(el, true)),
    ...(templates?.length ? [h('h2', { class: 'title-section' }, 'Templates'), ...templateGroups(templates)] : []))
  if (f) el.querySelector<HTMLElement>(f)?.focus({ preventScroll: true })
  return offline
}
