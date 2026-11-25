const URL = 'https://api.openai.com/v1/audio/transcriptions'
const MODEL = 'gpt-4o-mini-transcribe'
const TIMEOUT_MS = 15_000
const RATE = 16_000 // the glasses send 16 kHz mono s16le PCM

/** Raw PCM → WAV: the API wants a file format. */
export function wav(pcm: Uint8Array): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + pcm.length, 4)
  h.write('WAVEfmt ', 8)
  h.writeUInt32LE(16, 16) // fmt chunk size
  h.writeUInt16LE(1, 20) // PCM
  h.writeUInt16LE(1, 22) // mono
  h.writeUInt32LE(RATE, 24)
  h.writeUInt32LE(RATE * 2, 28) // byte rate
  h.writeUInt16LE(2, 32) // block align
  h.writeUInt16LE(16, 34) // bits per sample
  h.write('data', 36)
  h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

// shortcut: a guess; a Mac mic's room noise read RMS ~30 per 100 ms. Measure the G2 mic's noise floor and speech level and tune it
const QUIET_RMS = 300
const CHUNK = 3200 // 100 ms of 16 kHz s16le: a short "yes" is loud for a moment, not on average over 5 s

/** Loud enough to hold speech: silence goes nowhere, since the model then invents words ("yes" included). */
export function loud(pcm: Uint8Array): boolean {
  const v = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  for (let at = 0; at + 1 < pcm.byteLength; at += CHUNK) {
    const n = Math.floor(Math.min(CHUNK, pcm.byteLength - at) / 2)
    let sum = 0
    for (let i = 0; i < n; i++) sum += v.getInt16(at + i * 2, true) ** 2
    if (Math.sqrt(sum / n) >= QUIET_RMS) return true
  }
  return false
}

/** Speech → text with OpenAI, any language. No prompt: on silence the model read the prompt back as if it were said. */
export async function transcribe(pcm: Uint8Array, key: string, doFetch: typeof fetch = fetch): Promise<string> {
  const form = new FormData()
  form.append('model', MODEL)
  form.append('file', new Blob([new Uint8Array(wav(pcm))], { type: 'audio/wav' }), 'voice.wav')
  const res = await doFetch(URL, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(TIMEOUT_MS) })
  const json = (await res.json().catch(() => ({}))) as { text?: string; error?: { message?: string } }
  if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`)
  return json.text ?? ''
}
