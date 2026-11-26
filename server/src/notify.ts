import type { AlertRecord, Channel, Settings } from './types.ts'

const OPEN_MS = 10_000 // a client that has not polled for this long counts as closed (§10)

/** Route alerts to clients that are currently polling. */
export function createNotifier(o: { store: { settings(): Settings }; clock?: () => number }) {
  const { store } = o
  const clock = o.clock ?? Date.now
  const seenAt = { lens: -Infinity, app: -Infinity }
  const open = (c: 'lens' | 'app') => clock() - seenAt[c] < OPEN_MS

  return {
    seen(client: 'lens' | 'app'): void { seenAt[client] = clock() },

    route(alert: AlertRecord): Channel[] {
      const on = store.settings().notifications
      const channels: Channel[] = []
      if (alert.delivery.glasses && on.glasses && open('lens')) channels.push('glasses')
      if (alert.delivery.phone && on.app && open('app')) channels.push('app')
      return channels
    },
  }
}
