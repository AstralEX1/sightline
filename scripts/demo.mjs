// Plain JS, not TS, so an old Node gets a clear message instead of a syntax error.
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { connect } from 'node:net'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 18)) fail(`Node.js 22.18 or later is needed (you have ${process.versions.node}): https://nodejs.org`)
process.chdir(fileURLToPath(new URL('..', import.meta.url)))
const win = process.platform === 'win32'
const [flag, address, ...extra] = process.argv.slice(2)
if ((flag !== undefined && flag !== '--qr') || extra.length) fail('Usage: npm run demo -- [--qr [LAN-IP]]')
const qr = flag === '--qr'
const lanAddresses = [...new Set(Object.values(networkInterfaces()).flat()
  .filter(ip => ip.family === 'IPv4' && !ip.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip.address))
  .map(ip => ip.address))]
const lan = qr ? address ?? (lanAddresses.length === 1 ? lanAddresses[0] : undefined) : undefined
if (qr && !lanAddresses.includes(lan)) {
  fail(`Connect to a private Wi-Fi network, then run npm run demo -- --qr again. If several adapters are active, add your Wi-Fi IP after --qr.${lanAddresses.length ? ` Available addresses: ${lanAddresses.join(', ')}.` : ''}`)
}

if (!existsSync('node_modules/.package-lock.json')) {
  console.log('Installing dependencies (npm ci)…')
  if (spawnSync('npm', ['ci'], { stdio: 'inherit', shell: win }).status !== 0) fail('npm ci failed, see above')
}

// Separate loopback port and fresh in-memory account on every run, even in a configured checkout.
const port = 8788
const appPort = 5173
const token = randomBytes(32).toString('hex')
const appHost = lan ?? 'localhost'
const url = `http://${appHost}:${appPort}`
for (const [p, host] of [[port, '127.0.0.1'], [appPort, appHost], ...(qr ? [] : [[9898, '127.0.0.1']])]) {
  if (await listening(p, host)) fail(`Port ${p} is in use. Close the earlier demo and try again.`)
}

const children = []
let bundle
const start = (program, args, extraEnv = {}) => {
  const child = spawn(program, args, { stdio: 'inherit', shell: win && program === 'npm', detached: !win, env: { ...process.env, ...extraEnv } })
  child.on('exit', code => { if (!stopping) { console.error(`\n${program} ${args.join(' ')} exited (${code}), stopping the demo`); stop(1) } })
  child.on('error', error => { if (!stopping) { console.error(error.message); stop(1) } })
  children.push(child)
}
let stopping = false
function stop(code = 0) {
  stopping = true
  for (const c of children) {
    try { win ? spawnSync('taskkill', ['/pid', String(c.pid), '/t', '/f']) : process.kill(-c.pid, 'SIGTERM') } catch { /* already gone */ }
  }
  if (bundle) rmSync(bundle, { recursive: true, force: true })
  process.exit(code)
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())

try {
  if (qr) {
    const { build, preview } = await import('vite')
    bundle = mkdtempSync(join(tmpdir(), 'trade-shortcuts-paper-'))
    await build({ configFile: 'app/vite.config.ts', envFile: false, mode: 'paper', build: { outDir: bundle } })
    await preview({
      configFile: false,
      envFile: false,
      envPrefix: [],
      build: { outDir: bundle },
      plugins: [{
        name: 'same-origin-paper-preview',
        configurePreviewServer({ middlewares }) {
          middlewares.use((req, res, next) => {
            if (req.headers.host !== new URL(url).host || (req.headers.origin && req.headers.origin !== url)) {
              res.writeHead(403).end()
              return
            }
            next()
          })
        },
      }],
      preview: {
        host: lan, port: appPort, strictPort: true, cors: false,
        proxy: { '/api/': {
          target: `http://127.0.0.1:${port}`,
          configure(proxy) {
            proxy.on('proxyReq', request => request.setHeader('Authorization', `Bearer ${token}`))
          },
        } },
      },
    })
  }
  start(process.execPath, ['server/src/main.ts'], {
    APP_TOKEN: token, EXCHANGE: 'fake', PAPER_DEMO: '1', PUBLIC_DEMO: '1', HOST: '127.0.0.1', PORT: String(port),
    OPENAI_API_KEY: '', BYBIT_API_KEY: '', BYBIT_API_SECRET: '',
  })
  await waitFor(port, '127.0.0.1', 'server')
  if (qr) {
    if (spawnSync('npm', ['exec', '--', 'evenhub', 'qr', '--url', url], { stdio: 'inherit', shell: win }).status !== 0) {
      throw new Error('The Even Hub CLI could not generate the QR code.')
    }
    console.log('Scan the QR in Even Realities → Even Hub → Developer section → Scan QR. Keep the app open.')
  } else {
    start('npm', ['run', 'dev', '--', '--mode', 'paper', '--strictPort'], { APP_TOKEN: token, PORT: String(port) })
    await waitFor(appPort, appHost, 'app')
    start('npm', ['run', 'sim', '--', '--automation-port', '9898'])
    await waitFor(9898, '127.0.0.1', 'simulator')
    console.log('Use the simulator’s Browser window for phone controls and Glasses Display for the lens.')
  }
  console.log(`Trade Shortcuts demo is running.
Wait for the BTC “Near liquidation · half” alert. Swipe down (Down in the simulator) to “Close 50%”, then tap (Click).
Check the fill on the lens and in phone History. Ctrl+C stops everything. Restart for a fresh paper account.`)
} catch (error) {
  console.error(error.message)
  stop(1)
}

function listening(p, host) {
  return new Promise(ok => {
    const s = connect({ port: p, host })
    s.once('connect', () => { s.destroy(); ok(true) })
    s.once('error', () => ok(false))
  })
}
async function waitFor(p, host, name) {
  for (const t = Date.now(); !(await listening(p, host)); await new Promise(r => setTimeout(r, 250))) {
    if (Date.now() - t > 60_000) { console.error(`The ${name} did not start on port ${p} in 60 s`); stop(1) }
  }
}
function fail(message) {
  console.error(message)
  process.exit(1)
}
