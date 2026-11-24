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

/** Speech → text with OpenAI. `hint` lists the shortcut phrases so short commands come back spelled the same way. */
export async function transcribe(pcm: Uint8Array, key: string, hint: string, doFetch: typeof fetch = fetch): Promise<string> {
  const form = new FormData()
  form.append('model', MODEL)
  form.append('language', 'en')
  if (hint) form.append('prompt', `Trading voice commands such as: ${hint}`)
  form.append('file', new Blob([new Uint8Array(wav(pcm))], { type: 'audio/wav' }), 'voice.wav')
  const res = await doFetch(URL, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(TIMEOUT_MS) })
  const json = (await res.json().catch(() => ({}))) as { text?: string; error?: { message?: string } }
  if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`)
  return json.text ?? ''
}
