/**
 * The shortcuts server, unchanged, running in the page: the same http.ts routes, store, engine and session as
 * server/src/main.ts, on an in-memory SQLite and the sandbox's FakeExchange. The phone and lens call it through `fetch`.
 */
import { Buffer } from './shims/buffer.ts'
import { createServer } from '../../../server/src/http.ts'
import { createStore } from '../../../server/src/store.ts'
import { createSession } from '../../../server/src/session.ts'
import type { Draft } from '../../../server/src/registry.ts'
import type { Exchange } from '../../../server/src/types.ts'

const TOKEN = 'sandbox'
const TICK_MS = 2000 // as server/src/main.ts

type Listener = (chunk?: Uint8Array) => void
type Handler = (req: unknown, res: unknown) => unknown

export type Backend = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  /** One poll now, or the one already running. */
  tick(): Promise<void>
  stop(): void
}

export function createBackend(ex: Exchange, shortcuts: Draft[]): Backend {
  const store = createStore(':memory:')
  store.seed(shortcuts, 'sandbox')
  const session = createSession(ex, store, Date.now)
  const { handler } = createServer({ session, store, token: TOKEN, source: 'Sandbox' }) as unknown as { handler: Handler }

  let running: Promise<void> | null = null
  let stopped = false
  const requests = new Set<Promise<Response>>()
  const tick = () => stopped ? Promise.resolve()
    : (running ??= session.tick().catch(e => console.error('tick failed', e)).finally(() => { running = null }))
  void tick()
  const timer = setInterval(tick, TICK_MS)

  return {
    tick,
    stop: () => {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      void Promise.allSettled([running, ...requests]).then(() => store.close())
    },
    fetch: (input, init) => {
      if (stopped) return Promise.resolve(new Response(null, { status: 409 }))
      const request = call(handler, input, init)
      requests.add(request)
      const settled = () => requests.delete(request)
      void request.then(settled, settled)
      return request
    },
  }
}

/** A fetch, as the node:http request and response the handler expects. */
async function call(handler: Handler, input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href)
  const raw = init.body
  const body = raw == null ? new Uint8Array() : typeof raw === 'string' ? new TextEncoder().encode(raw) : new Uint8Array(raw as ArrayBuffer)
  const on: Record<string, Listener[]> = {}
  const req = {
    method: init.method ?? 'GET',
    url: url.pathname + url.search,
    headers: { authorization: `Bearer ${TOKEN}` }, // the page is the only client
    on(event: string, fn: Listener) {
      ;(on[event] ??= []).push(fn)
      // readBody listens for data, error, end in that order: once end is set, the body can flow
      if (event === 'end') queueMicrotask(() => {
        if (body.length) for (const f of on.data ?? []) f(Buffer.from(body))
        for (const f of on.end ?? []) f()
      })
      return req
    },
  }
  return new Promise(resolve => {
    let status = 200
    const headers: Record<string, string> = {}
    const res = {
      setHeader: (k: string, v: string) => { headers[k] = v },
      writeHead: (s: number, h: Record<string, string> = {}) => { status = s; Object.assign(headers, h) },
      end: (b?: string) => resolve(new Response(status === 204 ? null : b ?? null, { status, headers })),
    }
    void handler(req, res)
  })
}
