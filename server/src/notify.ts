import { randomBytes } from 'node:crypto'
import type { AlertRecord, Channel, OutboxRow, Proposal, Settings, TelegramLink } from './types.ts'

const OPEN_MS = 10_000 // a client that has not polled for this long counts as closed (§10)
const CODE_MS = 10 * 60_000
const CALL_MS = 10_000
const API = 'https://api.telegram.org/bot'
const CONNECTED = 'Connected. Bybit Shortcuts alerts will arrive here as text. Trades are confirmed only on Even G2.'

/** The part of the store delivery needs; the real store satisfies it structurally. */
export type NotifyStore = {
  settings(): Settings
  telegram(): TelegramLink
  saveTelegram(t: TelegramLink): void
  enqueue(o: { alertId: string; channel: Channel; text: string }): string
  dueOutbox(now: number): OutboxRow[]
  outboxSent(id: string, now: number): void
  outboxRetry(id: string, now: number, error: string): void
}

type Update = { update_id: number; message?: { text?: string; chat: { id: number; username?: string; first_name?: string } } }

/** Delivery of alerts to the lens, the phone app and Telegram (§10), and the Telegram bot. Nothing it sends can confirm a trade. */
export function createNotifier(o: { store: NotifyStore; token?: string; fetch?: typeof fetch; clock?: () => number }) {
  const { store, token } = o
  const doFetch = o.fetch ?? fetch
  const clock = o.clock ?? Date.now
  const seenAt = { lens: -Infinity, app: -Infinity }
  let username: string | undefined
  const open = (c: 'lens' | 'app') => clock() - seenAt[c] < OPEN_MS

  async function call(method: string, body: object, ms = CALL_MS): Promise<unknown> {
    let res: Response
    try {
      res = await doFetch(API + token + '/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) })
    } catch (e) {
      // the URL holds the token and a fetch error may quote it: never pass one on
      throw new Error(`Telegram ${method}: ${(e as Error).name === 'TimeoutError' ? 'timeout' : 'network error'}`)
    }
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string }
    if (!res.ok || !json.ok) throw new Error(`Telegram ${method}: ${json.description ?? `HTTP ${res.status}`}`)
    return json.result
  }

  function text(alert: AlertRecord, proposal?: Proposal): string {
    const lines = [`${alert.title} · ${alert.target} · ${alert.reason}`]
    if (proposal) lines.push(`${proposal.question.replace(/\s*\?\s*$/, '')} · confirm on Even G2 within ${Math.round((proposal.expiresAt - proposal.createdAt) / 1000)} s`)
    if (alert.simulated) lines.push('Test · nothing will be sent')
    return lines.join('\n')
  }

  return {
    seen(client: 'lens' | 'app'): void { seenAt[client] = clock() },

    route(alert: AlertRecord, proposal?: Proposal): Channel[] {
      const on = store.settings().notifications
      const lens = open('lens')
      const channels: Channel[] = []
      if (alert.delivery.glasses && on.glasses && lens) channels.push('glasses')
      if (alert.delivery.phone && on.app && open('app')) channels.push('app')
      if (alert.delivery.phone && on.telegram && token && store.telegram().chatId !== undefined && !lens) {
        store.enqueue({ alertId: alert.id, channel: 'telegram', text: text(alert, proposal) })
        channels.push('telegram')
      }
      return channels
    },

    text,

    async flush(): Promise<void> {
      for (const row of store.dueOutbox(clock())) {
        if (row.channel !== 'telegram') continue
        const chatId = store.telegram().chatId
        if (!token || chatId === undefined) { store.outboxRetry(row.id, clock(), 'Telegram not linked'); continue }
        try {
          await call('sendMessage', { chat_id: chatId, text: row.text })
          store.outboxSent(row.id, clock())
        } catch (e) {
          store.outboxRetry(row.id, clock(), (e as Error).message)
        }
      }
    },

    async link(): Promise<{ code: string; url: string }> {
      if (!token) throw new Error('Telegram is off: set TELEGRAM_BOT_TOKEN')
      username ??= ((await call('getMe', {})) as { username: string }).username
      const code = randomBytes(16).toString('hex')
      store.saveTelegram({ ...store.telegram(), code, codeAt: clock() })
      return { code, url: `https://t.me/${username}?start=${code}` }
    },

    unlink(): void { store.saveTelegram({ offset: store.telegram().offset }) },

    async pollUpdates(timeoutSec = 25): Promise<void> {
      if (!token) return
      const updates = (await call('getUpdates', { offset: store.telegram().offset, timeout: timeoutSec, allowed_updates: ['message'] }, (timeoutSec + 10) * 1000)) as Update[]
      if (!updates.length) return
      const t = { ...store.telegram() } // read after the long poll: link() may have issued the code meanwhile
      let linked: number | undefined
      for (const { message: m } of updates) {
        if (m && t.code && m.text?.trim() === `/start ${t.code}` && clock() - (t.codeAt ?? 0) < CODE_MS) {
          t.chatId = linked = m.chat.id
          t.name = m.chat.username ?? m.chat.first_name
          delete t.code
          delete t.codeAt
        }
      }
      t.offset = updates[updates.length - 1].update_id + 1
      store.saveTelegram(t)
      if (linked !== undefined) await call('sendMessage', { chat_id: linked, text: CONNECTED })
    },

    status(): { configured: boolean; linked: boolean; name?: string } {
      const t = store.telegram()
      const linked = !!token && t.chatId !== undefined
      return { configured: !!token, linked, name: linked ? t.name : undefined }
    },
  }
}
