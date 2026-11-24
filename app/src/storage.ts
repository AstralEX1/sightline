type Bridge = { getLocalStorage(key: string): Promise<string>; setLocalStorage(key: string, value: string): Promise<boolean> }
type Browser = { getItem(key: string): string | null; setItem(key: string, value: string): void }

/**
 * Settings that survive a restart. The Even app wipes the WebView's localStorage when it or the glasses restart, so the
 * bridge's storage is the truth and a Map in front of it keeps reads synchronous. The bridge has no delete: an empty
 * string means "not set". The browser's localStorage backs it up for a plain browser and the dev server.
 */
export function createStorage(keys: readonly string[], browser: Browser | null) {
  const cache = new Map<string, string>()
  let bridge: Bridge | null = null
  const fromBrowser = (key: string) => { try { return browser?.getItem(key) ?? '' } catch { return '' } }
  return {
    /** Reads every key into the cache; a failed read leaves the key as it was. */
    async load(b: Bridge) {
      bridge = b
      await Promise.all(keys.map(async key => {
        const value = await b.getLocalStorage(key).catch(() => '')
        if (value) cache.set(key, value)
      }))
    },
    get: (key: string) => cache.get(key) || fromBrowser(key),
    set(key: string, value: string) {
      cache.set(key, value)
      try { browser?.setItem(key, value) } catch { /* blocked: the cache holds it until reload */ }
      bridge?.setLocalStorage(key, value).catch(() => {})
    },
  }
}
