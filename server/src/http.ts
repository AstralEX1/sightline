import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { AlertDetails, ApiKeyInfo } from './types.ts'
import { PHRASE, type Command, type Session } from './session.ts'
import { StoreError, validateSettings, type Store } from './store.ts'
import type { createNotifier } from './notify.ts'
import { ACTION_TITLE, TEMPLATES, catalog, type Draft } from './registry.ts'
import { validateShortcut } from './validate.ts'
import { actionSummary, conditionSummary, executionLine } from './proposals.ts'
import { answerOf, closeIntent } from './rules.ts'
import { loud } from './stt.ts'

const MAX_BODY = 64 * 1024
// 16 kHz s16le mono is 32 KB per second. The mic stays open for 10 s; the cap is a little past that.
const MAX_VOICE = 384 * 1024
const MIN_VOICE = 9600 // 0.3 s
const API_KEY_TTL_MS = 60_000
const GLASSES_TEST_MS = 90_000
const GLASSES_TEST_RESULT_MS = 30_000

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, body === undefined ? {} : { 'Content-Type': 'application/json' })
  res.end(body === undefined ? undefined : JSON.stringify(body))
}

function authorized(header: string | undefined, token: string): boolean {
  const got = Buffer.from(header ?? '')
  const want = Buffer.from(`Bearer ${token}`)
  return got.length === want.length && timingSafeEqual(got, want)
}

/** Reads the body. Over the limit the rest is drained and discarded so the client still gets the 413. */
function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size <= max) chunks.push(c)
    })
    req.on('error', reject)
    req.on('end', () => (size > max ? reject(new HttpError(413, 'Body too large')) : resolve(Buffer.concat(chunks))))
  })
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req, MAX_BODY)
  let v: unknown
  try {
    v = JSON.parse(body.toString('utf8') || 'null')
  } catch {
    throw new HttpError(400, 'Bad JSON')
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

const version = (v: unknown) => {
  if (!Number.isInteger(v)) throw new HttpError(400, 'Expected the version the edit was made against')
  return v as number
}

export type Transcribe = (pcm: Uint8Array) => Promise<string>
type Notifier = ReturnType<typeof createNotifier>

/** Every route needs the bearer token and works on the token's one account (§10). */
export function createServer(d: {
  session: Session; store: Store; token: string
  notifier?: Notifier; transcribe?: Transcribe; source?: string; apiKeyInfo?: () => Promise<ApiKeyInfo>
}): Server {
  const { session, store } = d
  let apiKey: { at: number; value: ApiKeyInfo | null; error?: string } | null = null
  const glassesTests = new Map<string, { id: string; expiresAt: number; acknowledged: boolean }>()
  /** A tile's When and Do summaries: worded here once, for shortcuts and templates (home shows logo + title). */
  const lines = (r: Draft) => ({ summary: conditionSummary(r), doSummary: actionSummary(r.action) })
  // A voice command with no custom name is titled by its phrase, so "close all" is not a second "Close position".
  const phraseTitle = (phrase: string) => phrase.charAt(0).toUpperCase() + phrase.slice(1)
  const tile = (r: ReturnType<Store['listShortcuts']>[number]) => ({
    ...r, title: r.name ?? (r.voicePhrase ? phraseTitle(r.voicePhrase) : ACTION_TITLE[r.action.type]), ...lines(r),
  })

  return createHttpServer(async (req, res) => {
    // Any origin: the Even Hub WebView origin varies, and every route needs the token anyway.
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    if (req.method === 'OPTIONS') return send(res, 204)

    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      return send(res, 400, { error: 'Invalid request URL' })
    }
    const path = url.pathname
    if (!path.startsWith('/api/')) return send(res, 404, { error: 'Not found' })
    if (!authorized(req.headers.authorization, d.token)) return send(res, 401, { error: 'Unauthorized' })

    try {
      const route = `${req.method} ${path}`
      const num = (name: string) => (url.searchParams.has(name) ? Number(url.searchParams.get(name)) : undefined)

      // Lens
      if (route === 'GET /api/state') {
        const lens = url.searchParams.get('client') === 'lens'
        if (lens) d.notifier?.seen('lens')
        const test = lens ? glassesTests.get(url.searchParams.get('device') ?? '') : undefined
        const glassesTestId = test && !test.acknowledged && test.expiresAt > Date.now() ? test.id : undefined
        return send(res, 200, { ...session.state(), voice: !!d.transcribe, source: d.source ?? '', glassesTestId })
      }
      const testPath = path.match(/^\/api\/glasses-test\/([0-9a-f]{32})(?:\/([\w-]+))?$/)
      if (testPath) {
        const [, device, testId] = testPath
        const now = Date.now()
        let test = glassesTests.get(device)
        if (req.method === 'POST' && !testId) {
          for (const [key, entry] of glassesTests) if (entry.expiresAt + GLASSES_TEST_RESULT_MS <= now) glassesTests.delete(key)
          if (!test || test.acknowledged || test.expiresAt <= now) {
            if (glassesTests.size >= 128 && !glassesTests.has(device)) throw new HttpError(429, 'Too many connection tests')
            test = { id: crypto.randomUUID(), expiresAt: now + GLASSES_TEST_MS, acknowledged: false }
            glassesTests.set(device, test)
          }
          return send(res, 201, { id: test.id, remainingMs: test.expiresAt - now })
        }
        if (testId && (req.method === 'GET' || req.method === 'POST')) {
          if (!test || test.id !== testId || test.expiresAt + GLASSES_TEST_RESULT_MS <= now ||
            (req.method === 'POST' && !test.acknowledged && test.expiresAt <= now)) throw new HttpError(404, 'Connection test expired')
          if (req.method === 'POST') test.acknowledged = true
          return send(res, 200, { acknowledged: test.acknowledged })
        }
      }
      const proposal = path.match(/^\/api\/proposals\/([\w-]+)\/(confirm|dismiss|pick)$/)
      if (proposal && req.method === 'POST') {
        const b = await readJson(req)
        if (proposal[2] === 'pick') {
          if (typeof b.size !== 'number' || typeof b.leverage !== 'number') throw new HttpError(400, 'Expected {size, leverage}')
          return send(res, 200, await session.pick(proposal[1], b.size, b.leverage))
        }
        if (proposal[2] === 'dismiss') return send(res, 200, session.dismiss(proposal[1], b.by === 'app' ? 'app' : 'glasses'))
        if (typeof b.idempotencyKey !== 'string' || !b.idempotencyKey || b.idempotencyKey.length > 100) throw new HttpError(400, 'Expected {idempotencyKey}')
        const r = await session.confirm(proposal[1], b.idempotencyKey)
        return send(res, 200, { ok: r.ok, message: r.message, executionId: r.execution?.id, status: r.execution?.status })
      }
      const proposalExecution = path.match(/^\/api\/proposals\/([\w-]+)\/execution$/)
      if (proposalExecution && req.method === 'GET') {
        const e = store.executionByProposal(proposalExecution[1])
        return e ? send(res, 200, e) : send(res, 404, { error: 'Not found' })
      }
      const execution = path.match(/^\/api\/executions\/([\w-]+)$/)
      if (execution && req.method === 'GET') {
        const e = store.execution(execution[1])
        return e ? send(res, 200, e) : send(res, 404, { error: 'Not found' })
      }
      if (route === 'POST /api/voice') {
        if (!d.transcribe) throw new HttpError(503, 'Voice is off: set OPENAI_API_KEY on the server')
        const pcm = await readBody(req, MAX_VOICE)
        if (pcm.length < MIN_VOICE) throw new HttpError(400, 'Too short')
        if (!loud(pcm)) return send(res, 200, { heard: '', answer: null, close: null })
        let heard: string
        try {
          heard = await d.transcribe(pcm)
        } catch (e) {
          throw new HttpError(502, `Transcription failed: ${(e as Error).message}`)
        }
        // yes/no answers the card. close is a phrase from the position list or a position; the card still has to be confirmed.
        return send(res, 200, { heard, answer: answerOf(heard), close: closeIntent(heard) })
      }
      if (route === 'POST /api/command') {
        const b = await readJson(req)
        if (typeof b.command !== 'string' || !Object.hasOwn(PHRASE, b.command)) throw new HttpError(400, 'Expected {command: "stop" | "lock" | "close"}')
        const at = b.position as { symbol?: unknown; positionIdx?: unknown } | undefined
        if (at !== undefined && (typeof at?.symbol !== 'string' || !Number.isInteger(at.positionIdx))) throw new HttpError(400, 'Expected {position: {symbol, positionIdx}}')
        return send(res, 200, await session.command(b.command as Command, at as { symbol: string; positionIdx: number } | undefined))
      }

      // Shortcuts, editor
      if (route === 'GET /api/catalog') return send(res, 200, catalog())
      if (route === 'GET /api/templates') return send(res, 200, TEMPLATES.map(t => ({ ...t, ...lines(t.draft) })))
      if (route === 'GET /api/shortcuts') return send(res, 200, store.listShortcuts().map(tile))
      if (route === 'POST /api/shortcuts/validate') {
        const b = await readJson(req)
        const v = validateShortcut(b, { phrasesInUse: store.phrasesInUse(typeof b.id === 'string' ? b.id : undefined) })
        return send(res, 200, v.value ? { ...v, targets: session.preview(v.value) } : v)
      }
      if (route === 'POST /api/shortcuts') {
        const b = await readJson(req)
        if (typeof b.templateId === 'string') return send(res, 201, tile(store.createFromTemplate(b.templateId)))
        const r = store.createShortcut(b)
        return r.ok ? send(res, 201, tile(r.shortcut)) : send(res, 400, { error: r.issues[0]?.message ?? 'Invalid shortcut', issues: r.issues })
      }
      const shortcut = path.match(/^\/api\/shortcuts\/([\w-]+)(?:\/(enable|pause|test))?$/)
      if (shortcut) {
        const [, id, verb] = shortcut
        if (req.method === 'PUT' && !verb) {
          const b = await readJson(req)
          const r = store.updateShortcut(id, b, version(b.version))
          return r.ok ? send(res, 200, tile(r.shortcut)) : send(res, 400, { error: r.issues[0]?.message ?? 'Invalid shortcut', issues: r.issues })
        }
        if (req.method === 'DELETE' && !verb) {
          store.deleteShortcut(id, version(num('version')))
          return send(res, 204)
        }
        if (req.method === 'POST' && (verb === 'enable' || verb === 'pause')) {
          const b = await readJson(req)
          return send(res, 200, tile(store.setEnabled(id, verb === 'enable', b.version === undefined ? undefined : version(b.version))))
        }
        if (req.method === 'POST' && verb === 'test') return send(res, 200, await session.test(id))
        if (req.method === 'GET' && !verb) {
          const r = store.getShortcut(id)
          return r ? send(res, 200, tile(r)) : send(res, 404, { error: 'Not found' })
        }
      }
      if (route === 'GET /api/chart') return send(res, 200, await session.chart(url.searchParams.get('symbol') ?? ''))
      if (route === 'GET /api/positions') return send(res, 200, session.pickers().positions)
      if (route === 'GET /api/orders/open') return send(res, 200, session.pickers().orders)
      if (route === 'GET /api/symbols') {
        const names = await session.symbols().catch((e: Error) => { throw new HttpError(502, `Could not read the symbols: ${e.message}`) })
        return send(res, 200, names)
      }

      // History, notifications, settings
      if (route === 'GET /api/history') {
        const limit = num('limit') ?? 50
        const beforeId = url.searchParams.get('beforeId') ?? undefined
        return send(res, 200, store.history(num('before'), Number.isInteger(limit) ? Math.max(1, Math.min(limit, 200)) : 50, beforeId))
      }
      const history = path.match(/^\/api\/history\/([\w-]+)$/)
      if (history && req.method === 'GET') {
        const alert = store.alert(history[1])
        if (!alert) throw new HttpError(404, 'Not found')
        const p = store.latestProposalForAlert(alert.id)
        const e = p && store.executionByProposal(p.id)
        const details: AlertDetails = {
          alert,
          proposed: p?.picks ? 'Quantity and leverage awaiting selection' : p?.question.replace(/\?$/, ''),
          outcome: e ? executionLine(e) : p?.status === 'PENDING' && !alert.simulated ? 'Waiting for a tap on Even G2' : alert.status,
          receipt: e?.receipt,
        }
        return send(res, 200, details)
      }
      if (route === 'GET /api/notifications') {
        d.notifier?.seen('app')
        const on = store.settings().notifications.app
        return send(res, 200, on ? store.alertsAfter(num('after') ?? 0, undefined, url.searchParams.get('afterId') ?? undefined) : [])
      }
      if (route === 'GET /api/settings') {
        if (d.apiKeyInfo && (!apiKey || Date.now() - apiKey.at > API_KEY_TTL_MS)) {
          apiKey = await d.apiKeyInfo().then(value => ({ at: Date.now(), value }), (e: Error) => ({ at: Date.now(), value: null, error: e.message }))
        }
        const key = apiKey?.value
        return send(res, 200, {
          settings: store.settings(),
          bybit: {
            source: d.source ?? '',
            status: session.state().error ?? 'Connected',
            apiKey: key ? { readOnly: key.readOnly, trade: (key.permissions.ContractTrade ?? []).length > 0, withdraw: (key.permissions.Wallet ?? []).includes('Withdraw') } : null,
            apiKeyError: apiKey?.error,
            liveTrading: false, // a server switch, never on: assertTestnet refuses live hosts
          },
          voice: !!d.transcribe,
        })
      }
      if (route === 'PUT /api/settings') {
        let s
        try {
          s = validateSettings(await readJson(req))
        } catch (e) {
          if (e instanceof HttpError) throw e
          throw new HttpError(400, (e as Error).message)
        }
        store.saveSettings(s)
        return send(res, 200, s)
      }
      send(res, 404, { error: 'Not found' })
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message })
      if (e instanceof StoreError) return send(res, e.code === 'not_found' ? 404 : 409, { error: e.message })
      console.error(e)
      send(res, 500, { error: 'Server error' })
    }
  })
}
