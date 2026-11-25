/**
 * Runs inside the phone frame, before the app: it is the frame's Even app WebView. The bridge and the server live in
 * the parent page (page.ts); the app itself, app/src/main.ts, is imported unchanged.
 */
type Sandbox = { attach(w: Window): void; fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> }

const sandbox = (parent as unknown as { sandbox?: Sandbox }).sandbox
if (!sandbox || parent === window) {
  location.replace('./') // opened on its own: the sandbox page holds the bridge and the server
} else {
  sandbox.attach(window)
  const own = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href)
    return url.pathname.startsWith('/api/') ? sandbox.fetch(input, init) : own(input, init)
  }
  await import('../../../app/src/main.ts')
}
