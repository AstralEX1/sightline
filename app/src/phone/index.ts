/**
 * The phone page (docs/trade-shortcuts-spec.md): hash routes, alert polling, banner. main.ts mounts it and keeps
 * writing the lens state into #source, #glasses, #server-state, #server-box, #preview and #preview-icon (Settings).
 */
import './phone.css'
import * as api from '../api.ts'
import type { AlertRecord } from '../../../server/src/types.ts'
import { renderHome } from './home.ts'
import { enterEditor, leaveEditor } from './editor.ts'
import { actionOf, chip, renderHistory } from './history.ts'
import { buildSettings, renderSettings, syncHints } from './settings.ts'
import { icon } from './icons.ts'
import { app, h, isOffline, setBack, toast } from './ui.ts'

const HOME_MS = 10_000
const OFFLINE_MS = 5000
const ALERTS_MS = 5000
const BANNER_MS = 8000

export function startPhonePage(o: { root: HTMLElement; settingsReady: Promise<unknown>; onConnect: () => void }): void {
  const root = o.root
  app.root = root
  root.classList.add('phone')
  const screens = {
    home: h('main', { class: 'screen', 'aria-label': 'Shortcuts' }),
    editor: h('main', { class: 'screen', 'aria-label': 'Shortcut' }),
    history: h('main', { class: 'screen', 'aria-label': 'History' }),
    settings: h('main', { class: 'screen', 'aria-label': 'Settings' }),
  }
  for (const el of Object.values(screens)) { el.hidden = true; el.tabIndex = -1 } // focusable by script only: a route change moves focus here
  root.append(...Object.values(screens), h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }))
  buildSettings(screens.settings)
  document.addEventListener('touchstart', () => {}, { passive: true }) // iOS applies :active press feedback only with a touch listener

  let current: { name: keyof typeof screens; hash: string } | null = null
  let restoring = false
  let routed = false
  let homeTimer: ReturnType<typeof setTimeout> | undefined

  const refreshHome = async (first: boolean) => {
    clearTimeout(homeTimer)
    if (current?.name !== 'home') return
    const offline = document.visibilityState === 'visible' ? await renderHome(screens.home, first) : false
    if (current?.name === 'home') homeTimer = setTimeout(() => void refreshHome(false), offline ? OFFLINE_MS : HOME_MS)
  }

  async function route() {
    if (restoring) { restoring = false; return }
    const hash = location.hash || '#/'
    if (current?.name === 'editor' && hash !== current.hash && !(await leaveEditor())) {
      restoring = true // put the editor's hash back without entering it again
      location.hash = current.hash
      return
    }
    const m = hash.match(/^#\/shortcut\/(.+)$/)
    const name = m ? 'editor' : hash === '#/history' ? 'history' : hash === '#/settings' ? 'settings' : 'home'
    app.from = current?.hash ?? ''
    current = { name, hash }
    for (const [k, el] of Object.entries(screens)) el.hidden = k !== name
    scrollTo(0, 0)
    // the pressed link is hidden now: name the screen and move focus to it, or a screen reader stays on the old one
    document.title = `${screens[name].getAttribute('aria-label')} · Trade Shortcuts`
    if (routed) screens[name].focus({ preventScroll: true })
    routed = true
    if (name === 'home') void refreshHome(true)
    if (name === 'editor') void enterEditor(screens.editor, decodeURIComponent(m![1]))
    if (name === 'history') { setBadge(); void renderHistory(screens.history); setBack(screens.history) }
    if (name === 'settings') { void renderSettings(); setBack(screens.settings) }
  }

  /** The badge on the home History button, kept in place between home refreshes. */
  const setBadge = () => {
    const btn = screens.home.querySelector('.circle-btn--history')
    if (!btn) return
    btn.querySelector('.badge')?.remove()
    btn.setAttribute('aria-label', app.unseen ? `History, ${app.unseen} new` : 'History')
    if (app.unseen) btn.append(h('span', { class: 'badge', 'aria-hidden': 'true' }, String(app.unseen)))
  }

  const banner = h('a', { class: 'banner', href: '#/history', 'aria-live': 'polite' }) // role=status would hide that it is a link
  root.append(banner)
  let bannerTimer: ReturnType<typeof setTimeout> | undefined
  /** In-app banner (§4.12): the alert and where to answer it; never a confirm button. */
  const showBanner = (a: AlertRecord, more = 0) => {
    const where = actionOf(a) === 'NOTIFY' ? 'OK on Even G2' : 'Confirm on Even G2'
    banner.setAttribute('aria-label', `${a.title}, ${a.target}, ${a.reason}. ${where}. Open History${more ? `, and ${more} more alert${more > 1 ? 's' : ''}` : ''}`)
    banner.replaceChildren(chip(a, 20),
      h('span', { class: 'banner__text' },
        h('span', { class: 'banner__title' }, [a.title, a.target].filter(Boolean).join(' · ')),
        h('span', { class: 'banner__sub' }, a.reason),
        h('span', { class: 'banner__where', html: icon('glasses', 15, 2) }, where)),
      h('span', { class: 'banner__time' }, more ? `now · +${more} more` : 'now'))
    banner.classList.add('is-on')
    clearTimeout(bannerTimer)
    bannerTimer = setTimeout(() => banner.classList.remove('is-on'), BANNER_MS)
  }
  banner.addEventListener('click', () => banner.classList.remove('is-on'))

  // §7.5: polling also tells the server the app is open, so alerts reach it in-app
  let after: number | null = null
  const pollAlerts = async () => {
    if (document.visibilityState !== 'visible') return
    try {
      after ??= (await api.getHistory())[0]?.createdAt ?? 0 // start after the newest known alert, by the server's clock
      const fresh = await api.getNotifications(after)
      if (!fresh.length) return
      after = fresh[fresh.length - 1].createdAt
      if (current?.name !== 'history') { app.unseen += fresh.length; setBadge() }
      showBanner(fresh[fresh.length - 1], fresh.length - 1)
    } catch (e) {
      if (!isOffline(e)) console.warn('alerts', e)
    }
  }

  void (async () => {
    await o.settingsReady // the token lives in the bridge's storage
    syncHints()
    const s = api.getSettings()
    const server = document.getElementById('server') as HTMLInputElement
    const token = document.getElementById('token') as HTMLInputElement
    server.value = s.server
    token.value = s.token
    const connect = document.getElementById('connect')!
    server.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); token.focus() } })
    token.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); connect.click() } })
    connect.addEventListener('click', () => {
      try {
        api.saveSettings(server.value.trim(), token.value.trim())
      } catch (e) {
        toast((e as Error).message)
        return
      }
      o.onConnect()
      toast('Saved')
      void renderSettings()
    })
    addEventListener('hashchange', () => void route())
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { void pollAlerts(); if (current?.name === 'home') void refreshHome(false) } })
    void route()
    void pollAlerts()
    setInterval(pollAlerts, ALERTS_MS)
  })()
}
