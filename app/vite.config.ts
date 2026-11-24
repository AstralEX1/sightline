import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

const envDir = fileURLToPath(new URL('..', import.meta.url)) // one .env for server and app

export default defineConfig(({ mode }) => ({
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir,
  plugins: [{
    name: 'no-dev-token-on-the-network',
    // With --host anyone on the Wi-Fi can read the page source, and through the proxy that token trades.
    configResolved(c) {
      if (c.command === 'serve' && c.server.host && c.env.VITE_APP_TOKEN) {
        throw new Error('VITE_APP_TOKEN would be readable by everyone on this network. Empty it in .env and type the token once on the phone page.')
      }
    },
  }],
  server: {
    port: 5173, // localhost only; `npm run dev -- --host` opens it to your Wi-Fi for real glasses
    // The app calls its own origin and Vite forwards /api, so the server stays on loopback and no CORS or whitelist is involved.
    proxy: { '/api': `http://127.0.0.1:${loadEnv(mode, envDir, '').PORT || 8787}` },
  },
  build: { target: 'esnext', outDir: 'dist', emptyOutDir: true },
}))
