import { fileURLToPath } from 'node:url'
import type { Exchange } from './types.ts'
import { createSession } from './session.ts'
import { createServer } from './http.ts'
import { createStore } from './store.ts'
import { createNotifier } from './notify.ts'
import { tokenProblem } from './config.ts'
import { assertTestnet, createBybit } from './bybit.ts'
import { demoExchange } from './fake-exchange.ts'
import { transcribe } from './stt.ts'
import { CLOSE_SEED, STARTER_RULES, VOICE_SEEDS } from './registry.ts'

const TICK_MS = 2000
const env = process.env

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const token = env.APP_TOKEN ?? ''
const port = Number(env.PORT) || 8787
const host = env.HOST || '127.0.0.1'
const problem = tokenProblem(token)
if (problem) fail(problem)

let ex: Exchange
let source = 'Demo data' // shown on the phone page, so nobody mistakes the demo for an account
const mode = env.EXCHANGE === 'bybit' ? 'bybit' : 'fake'
if (mode === 'bybit') {
  const base = env.BYBIT_BASE || 'https://api-testnet.bybit.com'
  try {
    assertTestnet(base)
  } catch (e) {
    fail((e as Error).message)
  }
  if (!env.BYBIT_API_KEY || !env.BYBIT_API_SECRET) fail('Set BYBIT_API_KEY and BYBIT_API_SECRET for EXCHANGE=bybit.')
  ex = createBybit({ key: env.BYBIT_API_KEY, secret: env.BYBIT_API_SECRET, base })
  source = base.includes('demo') ? 'Bybit demo' : 'Bybit testnet'
} else {
  ex = demoExchange(Date.now()).ex
}

// One file per exchange mode, so demo shortcuts and alerts never mix with a real account's.
const store = createStore(fileURLToPath(new URL(`../data/${mode}.db`, import.meta.url)))
store.seed([...STARTER_RULES, ...VOICE_SEEDS])
store.seed([CLOSE_SEED], 'seeded:close')
const notifier = createNotifier({ store, token: env.TELEGRAM_BOT_TOKEN || undefined })
const session = createSession(ex, store, Date.now, notifier.route)

let busy = false
async function tick() {
  if (busy) return // never overlap: a slow exchange must not stack polls
  busy = true
  try {
    await session.tick()
  } catch (e) {
    console.error('tick failed', e)
  } finally {
    busy = false
  }
}
void tick()
setInterval(tick, TICK_MS)

// Telegram has its own loop: a slow or unreachable Telegram must never delay the poll, or crossings and liquidations wait with it.
let flushing = false
setInterval(() => {
  if (flushing) return
  flushing = true
  notifier.flush().catch(e => console.error('telegram flush failed', (e as Error).message)).finally(() => { flushing = false })
}, TICK_MS)

// Telegram linking: /start <code> arrives by long polling, so no webhook and no public URL (§2).
if (env.TELEGRAM_BOT_TOKEN) {
  void (async () => {
    for (;;) {
      try {
        await notifier.pollUpdates()
      } catch (e) {
        console.error((e as Error).message) // never the token: notify.ts keeps it out of its errors
        await new Promise(r => setTimeout(r, 5000))
      }
    }
  })()
}

const openaiKey = env.OPENAI_API_KEY
createServer({
  session, store, token, notifier, source,
  apiKeyInfo: () => ex.apiKeyInfo(),
  transcribe: openaiKey ? pcm => transcribe(pcm, openaiKey) : undefined,
}).listen(port, host, () => console.log(`Trade Shortcuts server on http://${host}:${port} (exchange: ${mode}, voice: ${openaiKey ? 'on' : 'off'}, telegram: ${env.TELEGRAM_BOT_TOKEN ? 'on' : 'off'})`))
