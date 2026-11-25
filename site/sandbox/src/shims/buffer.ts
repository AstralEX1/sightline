/** The few Buffer calls the server makes: http.ts reads request bodies, store.ts and notify.ts make hex ids. */
type Bytes = Uint8Array & { toString(encoding?: string): string }

const wrap = (u: Uint8Array): Bytes => Object.assign(u, {
  toString: (encoding = 'utf8') => encoding === 'hex' ? Array.from(u, b => b.toString(16).padStart(2, '0')).join('') : new TextDecoder().decode(u),
})

export const Buffer = {
  wrap,
  from: (v: string | Uint8Array) => wrap(typeof v === 'string' ? new TextEncoder().encode(v) : new Uint8Array(v)),
  concat(list: Uint8Array[]) {
    const out = new Uint8Array(list.reduce((n, b) => n + b.length, 0))
    let at = 0
    for (const b of list) { out.set(b, at); at += b.length }
    return wrap(out)
  },
}

;(globalThis as { Buffer?: unknown }).Buffer = Buffer // http.ts uses the global, as in Node
