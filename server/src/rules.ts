import type { Position } from './types.ts'

/** Distance from liquidation in percent of the mark; Infinity when Bybit gives no liquidation price. */
export function liqDistancePct(p: Position): number {
  return p.liqPrice > 0 ? (Math.abs(p.markPrice - p.liqPrice) / p.markPrice) * 100 : Infinity
}

export const normalizePhrase = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// Whole answers only: "yes, close it" or "no idea" stays unanswered, so a stray sentence never confirms a trade.
const YES = [
  'yes', 'yeah', 'yep', 'yup', 'ya', 'ok', 'okay', 'o k', 'sure', 'confirm', 'confirmed', 'approve', 'accept', 'affirmative', 'correct',
  'right', 'do it', 'go', 'go ahead', 'send', 'send it', 'execute', 'proceed', 'absolutely', 'of course', 'yes please', 'ok go',
  'да', 'ага', 'угу', 'ок', 'окей', 'хорошо', 'давай', 'да давай', 'конечно', 'подтверждаю', 'подтвердить', 'отправляй', 'отправить', 'верно', 'точно', 'делай',
  'гаразд', 'добре', 'підтверджую', // uk
  'ja', 'jawohl', 'klar', 'genau', 'bestätigen', 'bestätige', 'los', // de, nl
  'oui', 'ouais', 'd accord', 'confirme', 'confirmer', 'vas y', 'allez', // fr
  'sí', 'si', 'sì', 'claro', 'vale', 'dale', 'confirmar', 'confirmo', 'certo', 'va bene', 'conferma', 'confermo', // es, it
  'sim', 'pode', 'beleza', // pt
  'tak', 'dobrze', 'potwierdzam', 'evet', 'tamam', 'onaylıyorum', 'prima', 'oké', 'bevestig', // pl, tr, nl
  '是', '是的', '好', '好的', '对', '确认', '可以', '行', 'はい', 'うん', 'ええ', '確認', 'オーケー', 'いいよ', '네', '예', '응', '확인', '좋아',
  'نعم', 'أجل', 'हाँ', 'हां', 'haan', 'כן', 'ναι', 'ano', 'igen', 'da',
]
const NO = [
  'no', 'nope', 'nah', 'cancel', 'stop', 'dismiss', 'reject', 'decline', 'skip', 'abort', 'wait', 'hold', 'hold on', 'not now', 'no thanks',
  'no thank you', 'don t', 'do not', 'never mind', 'nevermind', 'no no',
  'нет', 'неа', 'не', 'не надо', 'нет не надо', 'отмена', 'отменить', 'отмени', 'стоп', 'стой', 'подожди', 'отклонить', 'отклоняю', 'не сейчас',
  'ні', 'скасувати', 'скасуй', 'не треба', // uk
  'nein', 'nee', 'abbrechen', 'stopp', 'nicht', 'warte', 'annuleren', // de, nl
  'non', 'annuler', 'annule', 'arrête', 'attends', // fr
  'cancelar', 'cancela', 'para', 'espera', 'annulla', 'aspetta', 'não', 'nao', // es, it, pt
  'nie', 'anuluj', 'hayır', 'iptal', 'dur', // pl, tr
  '不', '不要', '不是', '取消', '算了', 'いいえ', 'いや', 'キャンセル', 'やめて', '아니', '아니요', '아니오', '취소',
  'لا', 'إلغاء', 'नहीं', 'nahin', 'nahi', 'לא', 'όχι', 'ne', 'nem',
]
// Left out on purpose: Russian 'так' ("so…") and 'ha' (a laugh) start too many non-answers.
// Unicode letters kept, so "Да." and "好的。" survive; diacritics too ("sí" is not "si" everywhere).
const answerKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const spoken = (s: string) => answerKey(s).replace(/ (please|пожалуйста|bitte|por favor|per favore|s il vous plaît|proszę)$/u, '')
const YES_SET = new Set(YES.map(answerKey))
const NO_SET = new Set(NO.map(answerKey))
/** A spoken answer to the alert on the lens, in any of the languages above; null for anything else. */
export function answerOf(text: string): 'yes' | 'no' | null {
  const t = spoken(text)
  return NO_SET.has(t) ? 'no' : YES_SET.has(t) ? 'yes' : null // no wins: a word in both lists must never trade
}

// Whole phrase only, same as yes/no: "close the door" and "yes, close it" do not trade.
const CLOSE_ONE = new Set([
  'close', 'close it', 'close this', 'close position', 'close the position',
  'закрой', 'закрыть', 'закрой позицию', 'закрыть позицию', 'закрой позу', 'закрыть позу', 'закрой эту', 'закрой эту позицию',
])
const CLOSE_ALL = new Set([
  'close all', 'close everything', 'close all positions',
  'закрой все', 'закрыть все', 'закрой все позиции', 'закрыть все позиции', 'закрой все позы',
])
/** A spoken close from the position list or a position. `coin` is the ticker in "close btc"; absent means the one in focus. */
export function closeIntent(text: string): { all: boolean; coin?: string } | null {
  const t = spoken(text)
  if (CLOSE_ALL.has(t)) return { all: true }
  if (CLOSE_ONE.has(t)) return { all: false }
  const named = /^(?:close|закрой|закрыть) ([a-z0-9]{2,12})$/.exec(t)
  return named ? { all: false, coin: named[1] } : null
}

/** The shortcut with the longest voice phrase that appears in the text as whole words. */
export function matchShortcut<T extends { voicePhrase?: string }>(text: string, shortcuts: T[]): T | null {
  const t = ` ${normalizePhrase(text)} `
  let best: T | null = null
  for (const sc of shortcuts) {
    const phrase = sc.voicePhrase
    if (phrase && t.includes(` ${phrase} `) && phrase.length > (best?.voicePhrase?.length ?? 0)) best = sc
  }
  return best
}
