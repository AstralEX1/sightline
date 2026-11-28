import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

test('Sandbox API stays on the built-in server with a configured external origin', async (t) => {
  const previousOrigin = process.env.VITE_TRADE_SHORTCUTS_BACKEND_ORIGIN
  t.after(() => {
    if (previousOrigin === undefined) delete process.env.VITE_TRADE_SHORTCUTS_BACKEND_ORIGIN
    else process.env.VITE_TRADE_SHORTCUTS_BACKEND_ORIGIN = previousOrigin
  })
  process.env.VITE_TRADE_SHORTCUTS_BACKEND_ORIGIN = 'https://backend.example.invalid'
  const result = await build({
    configFile: path('../vite.config.ts'),
    logLevel: 'silent',
    build: {
      write: false,
      rollupOptions: {
        input: path('../../../app/src/api.ts'),
        preserveEntrySignatures: 'strict',
      },
    },
  })
  assert.ok(!Array.isArray(result) && 'output' in result)
  const entry = result.output[0]
  assert.equal(entry.type, 'chunk')
  const api = await import(`data:text/javascript;base64,${Buffer.from(entry.code).toString('base64')}`)
  const fetch = t.mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL) => Response.json({}))

  await api.listShortcuts()
  await api.loadSettings({ getLocalStorage: async () => 'https://saved.example.invalid' })
  await api.getState()
  assert.deepEqual(fetch.mock.calls.map(({ arguments: [url] }) => url), ['/api/shortcuts', '/api/state'])
})
