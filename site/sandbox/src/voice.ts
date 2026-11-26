/**
 * The app posts a recording and the server transcribes it. In the sandbox the recording is only loud enough
 * to pass the silence check. The words are whatever the browser's speech recognition heard.
 */

const WAIT_MS = 1200

let text = ''
let pending: ((word: string) => void) | null = null

/** A new listen. Drops whatever the previous one heard. */
export function beginUtterance() {
  text = ''
}

/** The latest transcript for the open listen. */
export function hear(word: string) {
  const next = word.replace(/\s+/g, ' ').trim()
  if (!next) return
  text = next
  pending?.(text)
  pending = null
}

/** What this listen heard. Recognition often finishes just after the mic closes, so wait a moment. */
export function transcript(waitMs = WAIT_MS): Promise<string> {
  if (text) return Promise.resolve(text)
  return new Promise(resolve => {
    const timer = setTimeout(() => { pending = null; resolve(text) }, waitMs)
    pending = word => { clearTimeout(timer); resolve(word) }
  })
}

/** 100 ms of 16 kHz s16le, loud enough that the server does not treat it as silence. */
export function pcmFrame(): Uint8Array {
  const samples = 1600
  const pcm = new Uint8Array(samples * 2)
  const view = new DataView(pcm.buffer)
  for (let i = 0; i < samples; i++) view.setInt16(i * 2, i % 20 < 10 ? 12_000 : -12_000, true)
  return pcm
}
