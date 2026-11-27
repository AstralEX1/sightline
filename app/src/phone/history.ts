/** History (spec §5.11): one line per alert, grouped by local day, statuses exactly as the server sends them. */
import * as api from '../api.ts'
import type { AlertDetails, AlertRecord } from '../../../server/src/types.ts'
import { ACTION_TITLE, type ActionType } from '../../../server/src/registry.ts'
import { ACTION_ICON, icon } from './icons.ts'
import { app, h, toast } from './ui.ts'

/** Action of an alert: from its shortcut when known, else from the action title it carries. */
export function actionOf(a: Pick<AlertRecord, 'shortcutId' | 'title' | 'actionType'>): ActionType {
  if (a.actionType) return a.actionType
  const sc = app.tiles?.find(t => t.id === a.shortcutId)
  return sc?.action.type ?? (Object.keys(ACTION_TITLE) as ActionType[]).find(k => ACTION_TITLE[k] === a.title) ?? 'NOTIFY'
}

/** TODAY, YESTERDAY, then MON 23 NOV (CSS uppercases). */
export function dayLabel(ms: number, now = Date.now()): string {
  const day = (t: number) => new Date(t).setHours(0, 0, 0, 0)
  const diff = Math.round((day(now) - day(ms)) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  const d = new Date(ms)
  return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`
}

const time = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export function chip(a: Pick<AlertRecord, 'shortcutId' | 'title' | 'actionType'>, size: number) {
  const { icon: name, color } = ACTION_ICON[actionOf(a)]
  return h('span', { class: 'chip chip--row', style: `--c: ${color}`, html: icon(name, size, 2.2) })
}

function row(a: AlertRecord) {
  const body = h('div', { class: 'hist__details', 'aria-live': 'polite' })
  const status = h('span', { class: 'hist__status' }, a.status)
  const summary = h('summary', { class: 'hist__summary' }, chip(a, 18),
    h('span', { class: 'hist__text' },
      h('span', { class: 'hist__top' }, h('span', {}, a.title), h('span', { class: 'hist__time' }, time(a.createdAt))),
      h('span', { class: 'hist__sub' }, [a.target, a.reason].filter(Boolean).join(' · ')), status))
  const disclosure = h('details', {}, summary, body)
  const el = h('li', { class: 'hist', 'data-alert-id': a.id }, disclosure)

  const field = (label: string, value: string) => h('div', {}, h('dt', {}, label), h('dd', {}, value))
  let request = 0
  const paint = ({ proposed, outcome, receipt }: AlertDetails) => {
    body.replaceChildren(h('dl', {},
      field('Trigger', a.reason),
      proposed ? field('Proposed', proposed) : null,
      outcome ? field('Outcome', outcome) : null,
      receipt ? field('Position readback', receipt) : null))
  }
  async function refreshDetails() {
    const version = ++request
    if (disclosure.open && !body.textContent) body.textContent = 'Loading details…'
    try {
      const details = await api.getAlertDetails(a.id)
      if (version !== request) return
      if (details.alert) status.textContent = details.alert.status
      if (disclosure.open) paint(details)
    } catch {
      if (version === request && disclosure.open) body.textContent = 'Details unavailable. Reopen to try again.'
    }
  }
  disclosure.addEventListener('toggle', () => {
    if (disclosure.open && !body.querySelector('dl')) void refreshDetails()
  })
  return {
    el, disclosure, summary, createdAt: a.createdAt, refreshDetails,
    get status() { return status.textContent ?? '' },
    update(next: AlertRecord) {
      if (status.textContent === next.status) return
      status.textContent = next.status
      request++ // an older details response must not undo the newer status
      if (disclosure.open) void refreshDetails()
      else body.replaceChildren()
    },
    open(details?: AlertDetails) {
      if (details) paint(details)
      disclosure.open = true
      summary.scrollIntoView({ block: 'nearest' })
      summary.focus({ preventScroll: true })
    },
  }
}

/** Keep rows mounted when the user switches tabs or the server returns a newer status. */
export function buildHistory(el: HTMLElement) {
  const list = h('div', {})
  const message = h('div', { role: 'status' })
  const end = h('div', { class: 'sentinel', 'aria-hidden': 'true', hidden: true })
  el.replaceChildren(h('header', { class: 'nav' }, h('h1', { class: 'title-large' }, 'History')), message, list, end)
  const entries = new Map<string, ReturnType<typeof row>>()
  const groups = new Map<number, { section: HTMLElement; title: HTMLElement; ul: HTMLUListElement }>()
  let cursor: Pick<AlertRecord, 'createdAt' | 'id'> | undefined
  let latest: Promise<void> | undefined
  let older: Promise<void> | undefined

  function upsert(alert: AlertRecord, update = true) {
    const entry = entries.get(alert.id)
    if (entry) {
      if (update) entry.update(alert)
      return entry
    }
    const day = new Date(alert.createdAt).setHours(0, 0, 0, 0)
    let group = groups.get(day)
    if (!group) {
      const title = h('h2', { class: 'group-label' }, dayLabel(day))
      const ul = h('ul', { class: 'group' })
      const section = h('section', {}, title, ul)
      const before = [...groups].filter(([key]) => key < day).sort(([a], [b]) => b - a)[0]?.[1]
      list.insertBefore(section, before?.section ?? null)
      groups.set(day, group = { section, title, ul })
    }
    const next = row(alert)
    const before = [...group.ul.children].find(child => entries.get((child as HTMLElement).dataset.alertId!)!.createdAt < alert.createdAt)
    group.ul.insertBefore(next.el, before ?? null)
    entries.set(alert.id, next)
    message.replaceChildren()
    return next
  }

  function refresh(): Promise<void> {
    if (latest) return latest
    if (!entries.size && !message.childElementCount) message.textContent = 'Loading alerts…'
    latest = (async () => {
      try {
        const page = await api.getHistory()
        for (const alert of page) upsert(alert)
        for (const [day, group] of groups) group.title.textContent = dayLabel(day)
        if (cursor === undefined && page.length) {
          cursor = page.at(-1)
          end.hidden = false
        }
        if (!entries.size) message.replaceChildren(h('div', { class: 'empty-state' },
          h('span', { class: 'empty-state__icon', html: icon('bell', 32, 1.8) }),
          h('h2', { class: 'empty-state__title' }, 'No alerts yet'),
          h('p', { class: 'empty-state__text' }, 'When one of your shortcuts fires, its alert lands here. Try one with Test alert in its menu.'),
          h('div', { class: 'empty-state__actions' }, h('a', { class: 'pill-btn', href: '#/' }, 'Your shortcuts'))))

        // A still-changing alert can move below the first page if a burst of new events arrives.
        const latestIds = new Set(page.map(alert => alert.id))
        const active = /^(Waiting for a tap|Refreshed|Sending|Submitted|Partly filled|Unknown result)/
        await Promise.all([...entries].filter(([id, item]) => !latestIds.has(id) && active.test(item.status))
          .map(([, item]) => item.refreshDetails()))
      } catch {
        if (!entries.size) message.textContent = 'Couldn’t load alerts. Retrying…'
      }
    })().finally(() => { latest = undefined })
    return latest
  }

  function more() {
    if (older || cursor === undefined || end.hidden || el.hidden) return
    older = (async () => {
      try {
        const page = await api.getHistory(cursor)
        for (const alert of page) upsert(alert, false)
        if (page.length) cursor = page.at(-1)
        else end.hidden = true
      } catch {
        toast('Couldn’t load older alerts. Scroll back to try again.')
      }
    })().finally(() => { older = undefined })
  }
  new IntersectionObserver(seen => {
    if (seen.some(item => item.isIntersecting)) more()
  }, { rootMargin: '120px' }).observe(end)

  async function openAlert(id: string, stillHere: () => boolean) {
    let entry = entries.get(id)
    if (entry) return entry.open()
    try {
      const details = await api.getAlertDetails(id)
      if (!stillHere()) return
      if (details.alert) entry = upsert(details.alert, false)
      else entry = entries.get(id)
      if (entry) return entry.open(details)
    } catch {
      if (!stillHere()) return
    }
    toast('This alert couldn’t be opened.')
  }
  return { refresh, openAlert }
}
