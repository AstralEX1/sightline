/**
 * Runs inside the phone frame, before the app: it is the frame's Even app WebView. The bridge and the server live in
 * the parent page (page.ts); the app itself, app/src/main.ts, is imported unchanged.
 */
import './editor-spotlight.css'

type Sandbox = { attach(w: Window, run: number): boolean; fetch(input: RequestInfo | URL, init: RequestInit | undefined, run: number): Promise<Response> }

const sandbox = (parent as unknown as { sandbox?: Sandbox }).sandbox
const run = Number(new URLSearchParams(location.search).get('run'))
if (!sandbox || parent === window) {
  location.replace('./') // opened on its own: the sandbox page holds the bridge and the server
} else if (sandbox.attach(window, run)) {
  window.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href)
    // The embedded app must stay on the paper backend even if its server address is edited.
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) {
      return Promise.resolve(new Response(null, { status: 403 }))
    }
    return sandbox.fetch(url.pathname + url.search, init, run)
  }
  await import('../../../app/src/main.ts')
}
