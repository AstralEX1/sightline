import { fileURLToPath } from 'node:url'
import type { Exchange } from './types.ts'
import { createSession } from './session.ts'
import { createServer } from './http.ts'
import { loadConfig, saveConfig, tokenProblem } from './config.ts'
import { assertTestnet, createBybit } from './bybit.ts'
import { demoExchange } from './fake-exchange.ts'
import { transcribe } from './stt.ts'

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

const configFile = fileURLToPath(new URL('../data/config.json', import.meta.url))
let config = loadConfig(configFile)
const session = createSession(ex, () => config)

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

const openaiKey = env.OPENAI_API_KEY
createServer({
  session, token,
  source,
  getConfig: () => config,
  setConfig: c => { config = c; saveConfig(configFile, c) },
  transcribe: openaiKey ? (pcm, hint) => transcribe(pcm, openaiKey, hint) : undefined,
}).listen(port, host, () => console.log(`Sightline server on http://${host}:${port} (exchange: ${mode}, voice: ${openaiKey ? 'on' : 'off'})`))
