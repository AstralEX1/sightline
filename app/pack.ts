import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serverAddress } from './src/server-address.ts'

// The first origin is the default backend; every origin is allowlisted, so Settings › Connection can switch between them.
const args = process.argv.slice(2)
const output = args.find(a => a.endsWith('.ehpk')) ?? 'trade-shortcuts.ehpk'
let origins: string[]
try {
  origins = args.filter(a => !a.endsWith('.ehpk')).map(serverAddress)
  if (!origins.length || origins.some(o => !o.startsWith('https://') || new URL(o).origin !== o)) throw new Error()
} catch {
  console.error('Usage: npm run pack -- https://your-backend.example [https://another-backend.example …] [output.ehpk]')
  process.exit(1)
}
const origin = origins[0]

const work = mkdtempSync(join(tmpdir(), 'trade-shortcuts-pack-'))
try {
  const dist = join(work, 'dist')
  const manifestPath = join(work, 'app.json')
  const manifest = JSON.parse(readFileSync('app/app.json', 'utf8'))
  const network = manifest.permissions.find((permission: { name: string }) => permission.name === 'network')
  network.whitelist = origins
  writeFileSync(manifestPath, JSON.stringify(manifest))
  execFileSync('npm', ['run', 'build', '--', '--outDir', dist], {
    stdio: 'inherit',
    env: { ...process.env, VITE_TRADE_SHORTCUTS_BACKEND_ORIGIN: origin, VITE_DEMO_TOKEN: '' },
  })
  execFileSync('evenhub', ['pack', manifestPath, dist, '--sdk-ver', manifest.min_sdk_version, '-o', output], { stdio: 'inherit' })
} finally {
  rmSync(work, { recursive: true, force: true })
}
