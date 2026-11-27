/**
 * The phone page (docs/trade-shortcuts-spec.md): hash routes, alert polling, banner. main.ts mounts it and keeps
 * writing the lens state into #source, #glasses, #server-state, #server-box, #preview and #preview-icon (Settings).
 */
import './phone.css'
import * as api from '../api.ts'
import type { AlertRecord } from '../../../server/src/types.ts'
import { renderHome } from './home.ts'
import { enterEditor, leaveEditor } from './editor.ts'
import { actionOf, buildHistory, chip } from './history.ts'
import { buildSettings, renderSettings, syncHints } from './settings.ts'
import { icon } from './icons.ts'
import { app, h, isOffline, toast } from './ui.ts'

const HOME_MS = 10_000
const OFFLINE_MS = 5000
const ALERTS_MS = 5000
const BANNER_MS = 8000

export function startPhonePage(o: { root: HTMLElement; settingsReady: Promise<unknown>; onConnect: () => void; onDisplayChange: () => void }): void {
  const root = o.root
  app.root = root
  root.classList.add('phone')
  const screens = {
    home: h('main', { class: 'screen', 'aria-label': 'Shortcuts' }),
    editor: h('main', { class: 'screen screen--editor', 'aria-label': 'Shortcut' }),
    history: h('main', { class: 'screen', 'aria-label': 'History' }),
    settings: h('main', { class: 'screen', 'aria-label': 'Settings' }),
  }
  const tabs = {
    home: h('a', { href: '#/', html: icon('scope', 22) }, 'Shortcuts'),
    history: h('a', { href: '#/history', html: icon('clock', 22) }, 'History'),
    settings: h('a', { href: '#/settings', html: icon('gear', 22) }, 'Settings'),
  }
  const nav = h('nav', { class: 'phone-tabs', 'aria-label': 'Main navigation', hidden: true }, ...Object.values(tabs))
  const badge = h('span', { class: 'badge', 'aria-hidden': 'true', hidden: true })
  tabs.history.append(badge)
  for (const el of Object.values(screens)) { el.hidden = true; el.tabIndex = -1 } // focusable by script only: a route change moves focus here
  root.append(...Object.values(screens), nav, h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }))
  buildSettings(screens.settings, o.onDisplayChange)
  const historyPage = buildHistory(screens.history)
  document.addEventListener('touchstart', () => {}, { passive: true }) // iOS applies :active press feedback only with a touch listener
  history.scrollRestoration = 'manual'

  let current: { name: keyof typeof screens; hash: string } | null = null
  let resolvingRoute = false
  const scroll = { home: 0, history: 0, settings: 0 }
  let unseen = 0
  let homeTimer: ReturnType<typeof setTimeout> | undefined

  const refreshHome = async (first: boolean) => {
    clearTimeout(homeTimer)
    if (current?.name !== 'home') return
    const offline = document.visibilityState === 'visible' ? await renderHome(screens.home, first) : false
    if (current?.name === 'home') homeTimer = setTimeout(() => void refreshHome(false), offline ? OFFLINE_MS : HOME_MS)
  }

  async function route() {
    if (resolvingRoute) return
    let hash = location.hash || '#/'
    if (current?.hash === hash) return
    if (current?.name === 'editor') {
      resolvingRoute = true
      try {
        if (!(await leaveEditor())) {
          location.hash = current.hash
          return
        }
        hash = location.hash || '#/'
      } finally {
        resolvingRoute = false
      }
    }
    const m = hash.match(/^#\/shortcut\/(.+)$/)
    const alert = hash.match(/^#\/history\/([\w-]+)$/)
    const name = m ? 'editor' : hash === '#/history' || alert ? 'history' : hash === '#/settings' ? 'settings' : 'home'
    const previous = current
    if (previous && previous.name !== 'editor') scroll[previous.name] = window.scrollY
    app.from = previous?.hash ?? ''
    current = { name, hash }
    for (const [k, el] of Object.entries(screens)) el.hidden = k !== name
    nav.hidden = name === 'editor'
    root.classList.toggle('phone--tabs', !nav.hidden)
    for (const [key, tab] of Object.entries(tabs)) {
      if (key === name) tab.setAttribute('aria-current', 'page')
      else tab.removeAttribute('aria-current')
    }
    scrollTo(0, name === 'editor' ? 0 : scroll[name])
    document.title = `${screens[name].getAttribute('aria-label')} · Trade Shortcuts`
    if (previous && previous.name !== name) screens[name].focus({ preventScroll: true })
    if (name === 'home') void refreshHome(true)
    if (name === 'editor') void enterEditor(screens.editor, decodeURIComponent(m![1]))
    if (name === 'history') {
      unseen = 0
      setBadge()
      const refreshed = historyPage.refresh()
      if (alert) void refreshed.then(() => {
        const stillHere = () => current?.hash === hash
        if (stillHere()) return historyPage.openAlert(alert[1], stillHere)
      })
    }
    if (name === 'settings') void renderSettings()
  }

  const setBadge = () => {
    badge.hidden = !unseen
    badge.textContent = unseen > 99 ? '99+' : String(unseen)
    tabs.history.setAttribute('aria-label', unseen ? `History, ${unseen} new` : 'History')
  }

  const banner = h('a', { class: 'banner', href: '#/history', 'aria-live': 'polite' }) // role=status would hide that it is a link
  root.append(banner)
  let bannerTimer: ReturnType<typeof setTimeout> | undefined
  /** In-app banner (§4.12): the alert and where to answer it; never a confirm button. */
  const showBanner = (a: AlertRecord, more = 0) => {
    const notify = actionOf(a) === 'NOTIFY'
    const phone = notify && a.status !== 'Waiting for a tap on Even G2'
    const where = phone ? 'Shown in the app' : notify ? 'OK on Even G2' : 'Confirm on Even G2'
    banner.href = `#/history/${encodeURIComponent(a.id)}`
    banner.setAttribute('aria-label', `${a.title}, ${a.target}, ${a.reason}. ${where}. Open alert in History${more ? `, and ${more} more alert${more > 1 ? 's' : ''}` : ''}`)
    banner.replaceChildren(chip(a, 20),
      h('span', { class: 'banner__text' },
        h('span', { class: 'banner__title' }, [a.title, a.target].filter(Boolean).join(' · ')),
        h('span', { class: 'banner__sub' }, a.reason),
        h('span', { class: 'banner__where', html: icon(phone ? 'bell' : 'glasses', 15, 2) }, where)),
      h('span', { class: 'banner__time' }, more ? `now · +${more} more` : 'now'))
    banner.classList.add('is-on')
    clearTimeout(bannerTimer)
    bannerTimer = setTimeout(() => banner.classList.remove('is-on'), BANNER_MS)
  }
  banner.addEventListener('click', () => banner.classList.remove('is-on'))

  // §7.5: polling also tells the server the app is open, so alerts reach it in-app
  let after: AlertRecord | null | undefined
  const pollAlerts = async () => {
    if (document.visibilityState !== 'visible') return
    if (current?.name === 'history') void historyPage.refresh()
    try {
      if (after === undefined) after = (await api.getHistory())[0] ?? null
      const fresh = await api.getNotifications(after ?? undefined)
      if (!fresh.length) return
      after = fresh[fresh.length - 1]
      if (current?.name !== 'history') { unseen += fresh.length; setBadge() }
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
