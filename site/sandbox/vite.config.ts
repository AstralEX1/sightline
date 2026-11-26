import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// The real server runs in the page: its Node built-ins map to small browser shims (sandbox/src/shims).
// The build lands in the landing site, served at /sandbox/.
export default defineConfig({
  root: at('.'),
  base: './',
  define: { 'import.meta.env.TRADE_SHORTCUTS_SANDBOX': 'true' },
  resolve: {
    alias: {
      'node:http': at('src/shims/http.ts'),
      'node:crypto': at('src/shims/crypto.ts'),
      'node:sqlite': at('src/shims/sqlite.ts'),
      'node:fs': at('src/shims/fs.ts'),
      'node:path': at('src/shims/path.ts'),
    },
  },
  server: { port: 5199, fs: { allow: [at('../..')] } },
  build: {
    target: 'esnext',
    outDir: at('../landing/sandbox'),
    emptyOutDir: true,
    rollupOptions: { input: { index: at('index.html'), app: at('app.html'), phone: at('phone.html') } },
  },
})
