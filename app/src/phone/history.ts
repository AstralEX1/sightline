/** History (spec §5.11): one line per alert, grouped by local day, statuses exactly as the server sends them. */
import * as api from '../api.ts'
import type { AlertRecord } from '../../../server/src/types.ts'
import { ACTION_TITLE, type ActionType } from '../../../server/src/registry.ts'
import { ACTION_ICON, icon } from './icons.ts'
import { app, h, subNav, toast } from './ui.ts'

/** Action of an alert: from its shortcut when known, else from the action title it carries. */
export function actionOf(a: Pick<AlertRecord, 'shortcutId' | 'title'>): ActionType {
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

export function chip(a: Pick<AlertRecord, 'shortcutId' | 'title'>, size: number) {
  const { icon: name, color } = ACTION_ICON[actionOf(a)]
  return h('span', { class: 'chip chip--action chip--row', style: `color: ${color}`, html: icon(name, size, 2.2) })
}

function row(a: AlertRecord) {
  return h('li', { class: 'hist' },
    chip(a, 18),
    h('div', { class: 'hist__text' },
      h('div', { class: 'hist__top' }, h('span', {}, a.title), h('span', { class: 'hist__time' }, time(a.createdAt))),
      h('div', { class: 'hist__sub' }, [a.target, a.reason].filter(Boolean).join(' · ')),
      h('div', { class: 'hist__status' }, a.status)))
}

export async function renderHistory(el: HTMLElement) {
  app.unseen = 0
  const list = h('div', {})
  const end = h('div', { class: 'sentinel', 'aria-hidden': 'true' })
  el.replaceChildren(subNav('History', h('a', { class: 'icon-link', href: '#/settings', 'aria-label': 'Settings', html: icon('gear', 22, 1.8) })), list, end)
  let last = Infinity
  let busy = false
  let done = false
  let group: { label: string; ul: HTMLElement } | null = null
  const more = async () => {
    if (busy || done) return
    busy = true
    try {
      const page = await api.getHistory(Number.isFinite(last) ? last : undefined)
      if (!page.length) done = true
      for (const a of page) {
        const label = dayLabel(a.createdAt)
        if (group?.label !== label) {
          group = { label, ul: h('ul', { class: 'group' }) }
          list.append(h('h2', { class: 'group-label' }, label), group.ul)
        }
        group.ul.append(row(a))
        last = a.createdAt
      }
      if (!list.childElementCount) list.append(h('p', { class: 'empty' }, 'No alerts yet.'))
    } catch (e) {
      toast((e as Error).message)
    } finally {
      busy = false
    }
  }
  await more()
  // next page when the end of the list comes into view
  new IntersectionObserver((seen, obs) => {
    if (!el.contains(end)) return obs.disconnect()
    if (seen.some(x => x.isIntersecting)) void more()
  }, { rootMargin: '200px' }).observe(end)
}
