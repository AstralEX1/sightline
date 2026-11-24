import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { Config } from './types.ts'
import type { Session } from './session.ts'
import { validateConfig } from './config.ts'

const MAX_BODY = 64 * 1024
// 16 kHz s16le mono is 32 KB per second; the app stops listening after 5 s
const MAX_VOICE = 320 * 1024
const MIN_VOICE = 9600 // 0.3 s

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

async function readJson(req: IncomingMessage): Promise<unknown> {
  const body = await readBody(req, MAX_BODY)
  try {
    return JSON.parse(body.toString('utf8') || 'null')
  } catch {
    throw new HttpError(400, 'Bad JSON')
  }
}

export type Transcribe = (pcm: Uint8Array, hint: string) => Promise<string>

export function createServer(d: { session: Session; token: string; getConfig: () => Config; setConfig: (c: Config) => void; transcribe?: Transcribe; source?: string }): Server {
  return createHttpServer(async (req, res) => {
    // Any origin: the Even Hub WebView origin varies, and every route needs the token anyway.
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
    if (req.method === 'OPTIONS') return send(res, 204)

    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    if (!path.startsWith('/api/')) return send(res, 404, { error: 'Not found' })
    if (!authorized(req.headers.authorization, d.token)) return send(res, 401, { error: 'Unauthorized' })

    try {
      const route = `${req.method} ${path}`
      if (route === 'GET /api/state') return send(res, 200, { ...d.session.state(), voice: !!d.transcribe, source: d.source ?? '' })
      if (route === 'GET /api/config') return send(res, 200, d.getConfig())
      if (route === 'POST /api/answer') {
        const b = (await readJson(req)) as { cardId?: unknown; yes?: unknown } | null
        if (typeof b?.cardId !== 'string' || typeof b.yes !== 'boolean') throw new HttpError(400, 'Expected {cardId, yes}')
        return send(res, 200, await d.session.answer(b.cardId, b.yes))
      }
      if (route === 'POST /api/voice') {
        if (!d.transcribe) throw new HttpError(503, 'Voice is off: set OPENAI_API_KEY on the server')
        const pcm = await readBody(req, MAX_VOICE)
        if (pcm.length < MIN_VOICE) throw new HttpError(400, 'Too short')
        let heard: string
        try {
          heard = await d.transcribe(pcm, d.getConfig().shortcuts.map(s => s.phrase).join(', '))
        } catch (e) {
          throw new HttpError(502, `Transcription failed: ${(e as Error).message}`)
        }
        return send(res, 200, { heard, ...d.session.voice(heard) })
      }
      if (route === 'POST /api/command') {
        const b = (await readJson(req)) as { command?: unknown } | null
        if (b?.command !== 'stop' && b?.command !== 'lock') throw new HttpError(400, 'Expected {command: "stop" | "lock"}')
        return send(res, 200, d.session.command(b.command))
      }
      if (route === 'PUT /api/config') {
        const body = await readJson(req)
        let next: Config
        try {
          next = validateConfig(body)
        } catch (e) {
          throw new HttpError(400, (e as Error).message)
        }
        d.setConfig(next)
        return send(res, 200, next)
      }
      send(res, 404, { error: 'Not found' })
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message })
      console.error(e)
      send(res, 500, { error: 'Server error' })
    }
  })
}
