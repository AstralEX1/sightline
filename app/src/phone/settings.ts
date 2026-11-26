/**
 * Settings (spec §5.12, arch §15): Bybit (read-only), Even G2, Notifications, Timing, Connection, and
 * the lens preview. The Connection and preview elements carry the ids main.ts writes to, so they are built once and kept.
 */
import * as api from '../api.ts'
import type { SettingsPage } from '../api.ts'
import type { Settings } from '../../../server/src/types.ts'
import { parseDec } from './sentence.ts'
import { icon } from './icons.ts'
import { h, rowSwitch, sheet, subNav, toast } from './ui.ts'

let page: SettingsPage | null = null
let dynamic: HTMLElement
/** main.ts writes the account line and the glasses state here; moved, never rebuilt, so they always exist once. */
const sourceEl = h('span', { id: 'source', class: 'row__value' }, 'Connecting…')
const glassesEl = h('span', { id: 'glasses', class: 'row__value' }, 'Looking for glasses…')
/** Stored on the phone, not the server: it works offline, and the lens reads it on the next draw. */
const hintsEl = rowSwitch(api.hintsOn(), 'set-hints', (on, el) => { el.setAttribute('aria-checked', String(on)); api.setHints(on) })
const voiceEl = rowSwitch(api.voiceAnswersOn(), 'set-voice', (on, el) => {
  if (el.disabled) return
  el.setAttribute('aria-checked', String(on)); api.setVoiceAnswers(on)
})
const quietEl = rowSwitch(api.quietModeOn(), 'set-quiet', (on, el) => { el.setAttribute('aria-checked', String(on)); api.setQuietMode(on) })
const testStatus = h('p', { class: 'row row--note', role: 'status' }, 'Open Trade Shortcuts in the Even app to test your G2.')
const VOICE_ON = 'When an alert arrives the mic listens for 5 s. Say yes or no in any language. After yes, a 5 s countdown runs before anything is sent; any tap, swipe or “no” stops it. On the position list or a position, tap and hold, then Speak, and say “close” or “закрой”. A tap on the position screen does the same. The card still has to be confirmed.'
const VOICE_OFF = 'Spoken answers are off: this server has no transcription. Close still works from the menu and from a tap on the position.'
const voiceFoot = h('p', { class: 'footnote' }, VOICE_ON)
const testButton = h('button', { class: 'row--btn is-accent', type: 'button', disabled: true, onclick: () => void testGlasses() }, 'Send test to G2')
export function enableGlassesTest() {
  testButton.disabled = false
  testStatus.hidden = true
}
/** Call once the bridge's storage is read: until then the switches may show the default. */
export const syncHints = () => {
  hintsEl.setAttribute('aria-checked', String(api.hintsOn()))
  voiceEl.setAttribute('aria-checked', String(api.voiceAnswersOn()))
  quietEl.setAttribute('aria-checked', String(api.quietModeOn()))
}

/** No transcription on this server: the switch stays off and cannot be saved on. */
function applyVoice(canHear: boolean) {
  voiceEl.disabled = !canHear
  voiceEl.setAttribute('aria-checked', String(canHear && api.voiceAnswersOn()))
  voiceFoot.textContent = canHear ? VOICE_ON : VOICE_OFF
}

const row = (label: string, value: Node | string, id?: string) =>
  h('div', { class: 'row' }, h('span', { id }, label), typeof value === 'string' ? h('span', { class: 'row__value' }, value) : value)
const status = (on: boolean, text: string) => h('span', { class: 'row__value' }, h('span', { class: `dot${on ? ' is-on' : ''}`, 'aria-hidden': 'true' }), text)

async function testGlasses() {
  testButton.disabled = true
  testStatus.hidden = false
  testStatus.textContent = 'Sending test…'
  const noAnswer = 'No answer from G2. Open Trade Shortcuts on your glasses and try again.'
  try {
    const { id, remainingMs } = await api.startGlassesTest()
    const end = Date.now() + remainingMs
    testStatus.textContent = 'Open Trade Shortcuts on G2 and tap OK on the TEST card.'
    for (;;) {
      if ((await api.getGlassesTest(id)).acknowledged) {
        testStatus.textContent = 'Confirmed on G2.'
        return
      }
      const remaining = end - Date.now()
      if (remaining <= 0) break
      await new Promise(resolve => setTimeout(resolve, Math.min(1500, remaining)))
    }
    testStatus.textContent = noAnswer
  } catch (e) {
    testStatus.textContent = (e as api.ApiError).status === 404 ? noAnswer : 'Could not check G2. Check the server connection and try again.'
  } finally {
    testButton.disabled = false
  }
}

/** The fixed part: built once by startPhonePage, with the elements main.ts keeps writing to. */
export function buildSettings(el: HTMLElement) {
  dynamic = h('div', {}, h('div', { class: 'group' }, row('Account', sourceEl), row('Glasses', glassesEl)))
  el.append(
    subNav('Settings'),
    dynamic,
    h('h2', { class: 'group-label' }, 'Connection'),
    h('div', { class: 'group' },
      h('details', { id: 'server-box', class: 'server-box' },
        h('summary', { class: 'row row--summary' }, h('span', {}, 'Server'), h('span', { id: 'server-state', class: 'row__value' }, 'Connecting…')),
        h('label', { class: 'row row--field' }, h('span', {}, 'Address'), h('input', {
          id: 'server', class: 'row__input', type: 'url', inputmode: 'url', placeholder: 'Same as this page', autocomplete: 'off',
          autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'next', 'aria-label': 'Server address',
        })),
        h('label', { class: 'row row--field' }, h('span', {}, 'Token'), h('input', {
          id: 'token', class: 'row__input', type: 'password', placeholder: 'APP_TOKEN', autocomplete: 'off',
          autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': 'Server token',
        })),
        h('div', { class: 'row' }, h('button', { id: 'connect', class: 'row--btn is-accent', type: 'button' }, 'Connect')))),
    h('h2', { class: 'group-label' }, 'On your glasses'),
    h('div', { class: 'group' },
      h('div', { class: 'row row--switch' }, h('span', { id: 'set-quiet' }, 'Quiet mode'), quietEl),
      h('div', { class: 'row row--switch' }, h('span', { id: 'set-hints' }, 'Gesture tips'), hintsEl),
      h('div', { class: 'row row--switch' }, h('span', { id: 'set-voice' }, 'Answer alerts by voice'), voiceEl)),
    h('p', { class: 'footnote' }, 'Quiet mode shows the status and nearest liquidation risk. Tap on G2 to see the full position list.'),
    h('p', { class: 'footnote' }, 'Tips like “tap: details”. Alerts and trades always say what a tap does, and double tap always shows.'),
    voiceFoot,
    h('h2', { class: 'group-label' }, 'Lens now'),
    h('div', { class: 'lens' }, h('span', { id: 'preview-icon', class: 'lens__icon' }), h('pre', { id: 'preview', class: 'lens__text' })),
    h('p', { class: 'footnote' }, 'What Even G2 shows right now. Every trade is confirmed there; the phone never confirms one.'))
  // main.ts replaces these once the bridge answers; in a plain browser it never does
  setTimeout(() => {
    if (sourceEl.textContent === 'Connecting…') sourceEl.textContent = 'Not connected'
    if (glassesEl.textContent === 'Looking for glasses…') glassesEl.textContent = 'Not connected'
  }, 15_000)
}

async function save(next: Settings) {
  // the server wants every field, so the whole object goes, never a patch
  const s = await api.putAccountSettings(next)
  if (page) page.settings = s
}

/** One of the 10–300 s timings, in the numeric sheet. */
function timing(label: string, get: (s: Settings) => number, set: (s: Settings, v: number) => void) {
  const s = page!.settings
  const btn = h('button', {
    class: 'row row--btn', type: 'button', 'aria-label': `${label}, ${get(s)} seconds, edit`,
    onclick: () => {
      const input = h('input', { class: 'numeric__input', type: 'text', inputmode: 'numeric', value: String(get(page!.settings)), 'aria-label': `${label}, seconds` })
      const note = h('p', { class: 'footnote' }, 'From 10 to 300 seconds')
      const ok = () => { const v = parseDec(input.value); return v !== null && Number.isInteger(Number(v)) && Number(v) >= 10 && Number(v) <= 300 ? Number(v) : null }
      const sh = sheet({
        title: label, back: () => btn.focus(), focus: input, dirty: () => input.value !== String(get(page!.settings)),
        body: [h('label', { class: 'numeric' }, h('span', { class: 'numeric__word' }, 'Every'), h('span', { class: 'numeric__value' }, input), h('span', { class: 'numeric__unit' }, 's')), note],
        onDone: () => {
          const v = ok()
          if (v === null) return false
          const next = structuredClone(page!.settings)
          set(next, v)
          save(next).then(() => renderSettings(), e => toast((e as Error).message))
        },
      })
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sh.el.querySelector<HTMLButtonElement>('.link-btn--strong')?.click() } })
      input.addEventListener('input', () => { const v = ok(); sh.setDone(v !== null); note.classList.toggle('is-error', v === null && input.value !== ''); note.textContent = v === null && input.value !== '' ? 'Enter a number from 10 to 300' : 'From 10 to 300 seconds' })
      input.select()
    },
  }, h('span', {}, label), h('span', { class: 'row__value num' }, `${get(s)} s`, h('span', { class: 'row__chev', 'aria-hidden': 'true', html: icon('right', 14, 2.6) })))
  return btn
}

function notifySwitch(label: string, id: string, key: keyof Settings['notifications']) {
  return h('div', { class: 'row row--switch' }, h('span', { id }, label), rowSwitch(page!.settings.notifications[key], id, (on, el) => {
    el.setAttribute('aria-checked', String(on))
    const next = structuredClone(page!.settings)
    next.notifications[key] = on
    save(next).catch(e => { el.setAttribute('aria-checked', String(!on)); toast((e as Error).message) }) // springs back
  }))
}

/** The changing part, refetched on every visit. */
export async function renderSettings() {
  try {
    page = await api.getAccountSettings()
  } catch (e) {
    page = null
    const unauthorized = (e as api.ApiError).status === 401
    dynamic.replaceChildren(h('h2', { class: 'group-label' }, 'Bybit'),
      h('div', { class: 'group' }, row('Status', status(false, unauthorized ? 'Check the server token' : 'Server offline')), row('Account', sourceEl), row('Glasses', glassesEl)),
      h('p', { class: 'footnote' }, unauthorized ? 'Enter the APP_TOKEN under Connection and tap Connect.' : (e as Error).message))
    return
  }
  const b = page.bybit
  applyVoice(page.voice !== false)
  const up = b.status === 'Connected'
  const key = b.apiKey
  const access = key ? (key.readOnly || !key.trade ? 'Read only' : 'Read + Trade') : b.apiKeyError ? 'Unknown' : '—'
  dynamic.replaceChildren(
    h('h2', { class: 'group-label' }, b.source === 'Paper' ? 'Paper' : 'Bybit'),
    h('div', { class: 'group' },
      row('Status', status(up, up ? 'Connected' : 'Offline')),
      up ? null : h('p', { class: 'row row--note' }, b.status),
      row('Environment', b.source === 'Paper' ? 'Paper' : b.source.includes('testnet') ? 'Testnet' : 'Demo'),
      row('Account', sourceEl),
      row('API access', access),
      row('Withdrawals', key?.withdraw ? 'On' : 'Off'),
      row('Live trading', 'Off')),
    h('p', { class: 'footnote' }, b.source.toLowerCase().includes('bybit')
      ? 'Read from your Bybit API key. Change these on Bybit.'
      : 'Paper account. No Bybit key and no live orders.'),
    h('h2', { class: 'group-label' }, 'Even G2'),
    h('div', { class: 'group' }, row('Glasses', glassesEl), h('div', { class: 'row' }, testButton), testStatus),
    h('h2', { class: 'group-label' }, 'Notifications'),
    h('div', { class: 'group' },
      notifySwitch('Show on glasses', 'set-glasses', 'glasses'),
      notifySwitch('Show in this app', 'set-app', 'app')),
    h('p', { class: 'footnote' }, 'For every shortcut; each one can turn these off in its Options.'),
    h('h2', { class: 'group-label' }, 'Timing'),
    h('div', { class: 'group' },
      timing('Repeat cooldown', s => s.cooldownSec, (s, v) => { s.cooldownSec = v }),
      timing('Trade proposals expire', s => s.expiry.marketSec, (s, v) => { s.expiry.marketSec = v }),
      timing('Other proposals expire', s => s.expiry.protectionSec, (s, v) => { s.expiry.protectionSec = v })))
}
