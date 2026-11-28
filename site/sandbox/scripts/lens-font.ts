// The sandbox lens font, cut from the Even Hub simulator's own rendering: `node site/sandbox/scripts/lens-font.ts`.
// Writes src/lens-font.png (a 4-bit atlas of shades) and src/lens-font.ts (where each glyph sits, and what each shade
// looks like at textColor 0–4). Needs a desktop session: the simulator opens a window. Uses Vite on :5211 and
// automation on :9911.
//
// Every glyph the firmware fonts have below U+2700 (pretext's advance table) goes on sheets of text containers, spaced
// so overhangs never touch, and each sheet is shot at all five text brightnesses. A first pass finds the glyphs the
// simulator lacks (it logs each one, draws nothing and moves on 4 px), which would shift everything after them. Latin, Greek and Cyrillic glyphs are
// 1-bit; the symbol font's edges are anti-aliased, and how an edge pixel dims with textColor is no simple product, so a
// pixel is stored as its shade: the levels it showed at the five brightnesses. The simulator's contextual menu has a
// font of its own, cut the same way from menus. The atlas is then checked by drawing every sheet and menu again from
// it: any pixel that differs from the simulator stops the run.
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync, inflateSync } from 'node:zlib'
import { createServer } from 'vite'
import { getAdvW, getTextWidth } from '@evenrealities/pretext'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SRC = new URL('../src/', import.meta.url)
const AUTOMATION = 'http://127.0.0.1:9911'
const W = 576
const H = 288
const LINE = 27
const GAP = '   ' // between glyphs on a sheet: wider than any overhang
const ROWS = 3 // glyph lines per sheet, two empty lines apart
const ATLAS_W = 256

const TONES = 5 // textColor 0–4
/** Screenshot alpha of each grey level 0–15, found by probing the simulator (a level is 8-bit grey >> 4). */
const LEVEL_ALPHA = [0, 96, 131, 157, 179, 197, 214, 230, 244, 255, 255, 255, 255, 255, 255, 255]

// The circled numbers, U+2460–24FF, are left out: a fifth of the atlas for characters nobody types in a shortcut name.
const chars: string[] = []
for (let cp = 0x21; cp < 0x2700; cp++) if (getAdvW(cp) > 0 && (cp < 0x2460 || cp > 0x24ff)) chars.push(String.fromCodePoint(cp))

/** Lines of glyphs as wide as the lens allows, ROWS lines a sheet. */
function sheetsOf(chars: string[]): string[][][] {
  const lines: string[][] = [[]]
  for (const ch of chars) {
    const line = lines.at(-1)!
    if (line.length && getTextWidth(GAP + [...line, ch].join(GAP)) > W - 16) lines.push([ch])
    else line.push(ch)
  }
  return Array.from({ length: Math.ceil(lines.length / ROWS) }, (_, i) => lines.slice(i * ROWS, (i + 1) * ROWS))
}
const sheetPage = (sheet: string[][], textColor: number) => ({ textObject: [{
  containerID: 1, containerName: 'sheet', xPosition: 0, yPosition: 0, width: W, height: H, paddingLength: 0, borderWidth: 0, textColor,
  content: '\n' + sheet.map(l => GAP + l.join(GAP)).join('\n\n\n'), // indented: a glyph may reach left of its pen
}] })

let job: object = {}
let shown: (s: { seq: number; error: string }) => void = () => {}
const vite = await createServer({
  root: fileURLToPath(new URL('lens-probe/', import.meta.url)),
  configFile: false,
  logLevel: 'warn',
  cacheDir: join(tmpdir(), 'lens-probe-vite'),
  server: { port: 5211, strictPort: true, fs: { allow: [ROOT] } },
  plugins: [{
    name: 'lens-probe',
    configureServer: s => void s.middlewares.use((req, res, next) => {
      if (req.url === '/probe/job') return void res.end(JSON.stringify(job))
      if (req.url !== '/probe/shown') return next()
      let body = ''
      req.on('data', (d: Buffer) => (body += d))
      req.on('end', () => { shown(JSON.parse(body)); res.end() })
    }),
  }],
})
await vite.listen()
const sim = spawn('node_modules/.bin/evenhub-simulator', ['http://localhost:5211/', '--automation-port', '9911'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
const missing = new Set<string>()
for (const out of [sim.stdout, sim.stderr]) {
  out.on('data', (d: Buffer) => { for (const [, hex] of String(d).matchAll(/not found for U\+([0-9A-F]+)/g)) missing.add(String.fromCodePoint(parseInt(hex, 16))) })
}

let seq = 0
/** The lens after the probe page shows `page`: alpha per pixel (the simulator draws green, brightness in alpha). */
async function shoot(page: object, menu = false): Promise<Uint8Array> {
  const mine = ++seq
  const done = new Promise<{ error: string }>(ok => (shown = s => s.seq === mine && ok(s)))
  job = { seq: mine, page }
  const { error } = await Promise.race([done, sleep(30_000).then(() => ({ error: 'the probe page did not answer in 30 s' }))])
  if (error) throw new Error(error)
  await sleep(1500) // the simulator redraws a moment after the bridge answers
  if (menu) await input('context_menu')
  const png = decodePng(Buffer.from(await (await fetch(`${AUTOMATION}/api/screenshot/glasses`)).arrayBuffer()))
  if (png.w !== W || png.h !== H) throw new Error(`screenshot is ${png.w}×${png.h}`)
  if (menu) await input('click') // a tap picks an item and closes the menu; a double tap left the simulator stuck
  return png.rgba.filter((_, i) => i % 4 === 3)
}
async function input(action: string) {
  await fetch(`${AUTOMATION}/api/input`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })
  await sleep(1500)
}

type Glyph = { ch: string; dx: number; dy: number; w: number; h: number; g: Uint8Array }
const glyphs: Glyph[] = []
const placed: { glyph: Glyph; x: number; y: number }[][] = [] // per sheet, for the check
const shots: Uint8Array[][] = [] // per sheet, per text brightness
/** Each pattern of levels a text pixel showed across textColor 0–4 → its id; 0 is dark at all five. */
const shades = new Map<string, number>([[Array(TONES).fill(0).join(), 0]])

// The contextual menu is the simulator's own, in a slightly larger font with its own advances. Its rows, as laid out
// there; MENU.x, where the labels start, is measured.
const MENU = { x: 0, top: 30, pitch: 50 }
const ITEM_ALPHA = [255, 179] // the chosen item, the others: 1-bit glyphs at textColor 4 and 1
const menuGlyphs: (Glyph & { adv: number })[] = []
const menuGlyph = new Map<string, Glyph & { adv: number }>()
/** Menu kerning: a pair of characters → how far the pen moves from the first to the second. */
const menuPairs = new Map<string, number>()
const menuShots: { a: Uint8Array; names: string[] }[] = []
const menuStep = (a: string, b: string) => menuPairs.get(a + b) ?? menuGlyph.get(a)!.adv
const menuPage = (names: string[]) => ({
  textObject: [{ containerID: 1, containerName: 'menu', xPosition: 16, yPosition: 16, width: 544, height: 32, content: ' ', isEventCapture: 1 }],
  menuObject: { menuItems: names.map((itemName, i) => ({ itemID: i + 1, itemName })) },
})
/** Ink of menu item k between x0 and x1: its columns and box, and each pixel as the full shade. */
function menuInk(a: Uint8Array, k: number, x0 = 2, x1 = 226) {
  const top = MENU.top + k * MENU.pitch
  const cols = new Set<number>()
  let bx1 = W, by1 = H, bx2 = -1, by2 = -1
  for (let y = top - 15; y < top + 35; y++) for (let x = x0; x <= x1; x++) {
    const v = a[y * W + x]
    if (!v) continue
    if (v !== ITEM_ALPHA[k ? 1 : 0]) throw new Error(`menu item ${k}: alpha ${v} at ${x},${y}, expected a 1-bit glyph`)
    cols.add(x); bx1 = Math.min(bx1, x); bx2 = Math.max(bx2, x); by1 = Math.min(by1, y); by2 = Math.max(by2, y)
  }
  const w = bx2 < 0 ? 0 : bx2 - bx1 + 1, h = bx2 < 0 ? 0 : by2 - by1 + 1
  const full = shades.get('2,4,5,7,9')!
  const g = Uint8Array.from({ length: w * h }, (_, i) => (a[(by1 + Math.floor(i / w)) * W + bx1 + (i % w)] ? full : 0))
  return { cols: [...cols].sort((p, q) => p - q), dx: w ? bx1 - MENU.x : 0, dy: h ? by1 - top : 0, w, h, g }
}

try {
  for (let t = Date.now(); !(await fetch(`${AUTOMATION}/api/ping`).then(r => r.ok, () => false)); await sleep(250)) {
    if (Date.now() - t > 30_000) throw new Error('simulator did not start in 30 s')
  }
  for (const sheet of sheetsOf(chars)) await shoot(sheetPage(sheet, 4))
  await sleep(500)
  console.log(`the simulator lacks ${missing.size} of ${chars.length} glyphs`)
  const lacking = missing.size
  const sheets = sheetsOf(chars.filter(c => !missing.has(c)))
  for (const [s, sheet] of sheets.entries()) {
    if (Buffer.byteLength(sheetPage(sheet, 0).textObject[0].content) > 999) throw new Error(`sheet ${s} is over the 999-byte text limit`)
    shots[s] = []
    for (let tone = 0; tone < TONES; tone++) shots[s][tone] = await shoot(sheetPage(sheet, tone))
    console.log(`sheet ${s + 1}/${sheets.length}`)

    const cover = new Uint8Array(W * H) // shade ids, in the order found
    for (let i = 0; i < cover.length; i++) {
      const key = shots[s].map(shot => LEVEL_ALPHA.indexOf(shot[i])).join()
      if (key.includes('-1')) throw new Error(`sheet ${s}, pixel ${i % W},${Math.floor(i / W)}: alpha off the lens's scale (${key})`)
      if (!shades.has(key)) shades.set(key, shades.size)
      cover[i] = shades.get(key)!
    }

    placed[s] = []
    sheet.forEach((line, row) => {
      const top = (3 * row + 1) * LINE // lines 1, 4, 7
      // The pen at each glyph: pretext's width up to and including it, less its own (kerning goes with the glyph before).
      const pens = line.map((ch, k) => getTextWidth(GAP + line.slice(0, k).map(c => c + GAP).join('') + ch) - getTextWidth(ch))
      line.forEach((ch, k) => {
        const left = k ? Math.round((pens[k - 1] + getTextWidth(line[k - 1]) + pens[k]) / 2) : 0
        const right = k < line.length - 1 ? Math.round((pens[k] + getTextWidth(ch) + pens[k + 1]) / 2) : W
        // Its line and the empty one above and below, so rows never share a pixel.
        const y0 = top - LINE
        const y1 = top + 2 * LINE
        let x1 = W, y1i = H, x2 = -1, y2 = -1
        for (let y = y0; y < y1; y++) for (let x = left; x < right; x++) {
          if (!cover[y * W + x]) continue
          if (x === left || x === right - 1 || y === y0 || y === y1 - 1) throw new Error(`"${ch}" on sheet ${s} reaches its neighbours at ${x},${y} (window ${left}–${right - 1} × ${y0}–${y1 - 1}): space the sheet out`)
          x1 = Math.min(x1, x); x2 = Math.max(x2, x); y1i = Math.min(y1i, y); y2 = Math.max(y2, y)
        }
        const w = x2 < 0 ? 0 : x2 - x1 + 1
        const h = x2 < 0 ? 0 : y2 - y1i + 1
        const g = new Uint8Array(w * h)
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = cover[(y1i + y) * W + x1 + x]
        const glyph = { ch, dx: w ? x1 - pens[k] : 0, dy: h ? y1i - top : 0, w, h, g }
        glyphs.push(glyph)
        placed[s].push({ glyph, x: pens[k], y: top })
      })
    })
  }

  // It has been seen to drop a different few glyphs from one pass to the next; any drop shifts a sheet line.
  if (missing.size > lacking) throw new Error(`the simulator dropped ${[...missing].slice(lacking).join('')} on the second pass: run again`)

  // The menu font, printable ASCII: an item is one character, three spaces and a bar, which marks where it ends.
  const cal = await shoot(menuPage(['|', '|   |', '|    |']), true)
  const bars = [0, 1, 2].map(k => menuInk(cal, k).cols)
  MENU.x = bars[0][0]
  const space = bars[2][1] - bars[2][0] - (bars[1][1] - bars[1][0])
  const bar = menuInk(cal, 0)
  menuGlyphs.push({ ...bar, ch: '|', adv: bars[1][1] - bars[1][0] - 3 * space }, { ch: ' ', dx: 0, dy: 0, w: 0, h: 0, g: new Uint8Array(0), adv: space })
  const ascii = Array.from({ length: 94 }, (_, i) => String.fromCharCode(0x21 + i)).filter(c => c !== '|')
  for (let i = 0; i < ascii.length; i += 5) {
    const names = ascii.slice(i, i + 5).map(c => c + '   |')
    const a = await shoot(menuPage(names), true)
    names.forEach((name, k) => {
      const end = menuInk(a, k).cols.at(-1)!
      menuGlyphs.push({ ...menuInk(a, k, 2, end - 1), ch: name[0], adv: end - MENU.x - 3 * space })
    })
    menuShots.push({ a, names })
  }
  for (const g of menuGlyphs) menuGlyph.set(g.ch, g)

  // That advance holds before a space; between letters the menu font kerns, so the pairs in the app's own labels
  // (app/src/main.ts) are measured: each glyph found where its whole bitmap is lit, near where the text font puts it.
  const main = readFileSync(new URL('../../../app/src/main.ts', import.meta.url), 'utf8')
  const labels = [...new Set([...main.matchAll(/itemName: (.*)/g)].flatMap(m => [...m[1].matchAll(/'([^']+)'/g)].map(q => q[1])))]
  for (let i = 0; i < labels.length; i += 5) {
    const names = labels.slice(i, i + 5)
    const a = await shoot(menuPage(names), true)
    names.forEach((name, k) => {
      const top = MENU.top + k * MENU.pitch
      const chars = [...name]
      let pen = MENU.x
      for (let n = 1; n < chars.length; n++) {
        const g = menuGlyph.get(chars[n])
        if (!g) throw new Error(`menu label "${name}": no menu glyph for "${chars[n]}"`)
        const lit = (x: number) => g.g.every((v, j) => !v || a[(top + g.dy + Math.floor(j / g.w)) * W + x + g.dx + (j % g.w)] === ITEM_ALPHA[k ? 1 : 0])
        const guess = pen + getTextWidth(chars[n - 1] + chars[n]) - getTextWidth(chars[n]) + 1
        const at = !g.w ? pen + menuGlyph.get(chars[n - 1])!.adv : [0, -1, 1, -2, 2, -3, 3].map(d => guess + d).find(lit)
        if (at === undefined) throw new Error(`menu label "${name}": "${chars[n]}" not found near x ${guess}`)
        menuPairs.set(chars[n - 1] + chars[n], at - pen)
        pen = at
      }
    })
    menuShots.push({ a, names })
  }
  console.log(`menu font: ${menuGlyphs.length} glyphs, ${menuPairs.size} pairs from ${labels.length} labels`)
} finally {
  try { process.kill(-sim.pid!, 'SIGTERM') } catch { /* already gone */ }
  await vite.close()
}

// Shades darkest first, so the atlas reads as a picture of the font.
if (shades.size > 16) throw new Error(`${shades.size} shades do not fit a 4-bit atlas`)
const found = [...shades.keys()].map(k => k.split(',').map(Number))
const order = found.map((_, i) => i).sort((a, b) => found[a].reduceRight((d, v, t) => d || v - found[b][t], 0))
const shade = order.map(i => found[i])
const rank = order.map((_, i) => order.indexOf(i))
for (const g of [...glyphs, ...menuGlyphs]) g.g = g.g.map(id => rank[id])

// The check: every sheet drawn again from the glyphs, at every brightness, is the simulator's screenshot.
for (const [s, list] of placed.entries()) {
  for (let tone = 0; tone < TONES; tone++) {
    const level = new Uint8Array(W * H)
    for (const { glyph: { dx, dy, w, h, g }, x, y } of list) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) level[(y + dy + j) * W + x + dx + i] = shade[g[j * w + i]][tone]
    }
    const bad = level.findIndex((v, i) => LEVEL_ALPHA[v] !== shots[s][tone][i])
    if (bad >= 0) throw new Error(`check failed: sheet ${s}, textColor ${tone}, pixel ${bad % W},${Math.floor(bad / W)}`)
  }
}

// The same check for the menus: each label drawn from the menu glyphs at their advances and pairs.
for (const { a, names } of menuShots) {
  names.forEach((name, k) => {
    const top = MENU.top + k * MENU.pitch
    const level = new Uint8Array(W * H)
    let pen = MENU.x
    ;[...name].forEach((ch, n, chars) => {
      const { dx, dy, w, h, g } = menuGlyph.get(ch)!
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) level[(top + dy + j) * W + pen + dx + i] = Math.max(level[(top + dy + j) * W + pen + dx + i], shade[g[j * w + i]][k ? 1 : 4])
      if (n < chars.length - 1) pen += menuStep(ch, chars[n + 1])
    })
    for (let y = top - 15; y < top + 35; y++) for (let x = 2; x <= 226; x++) {
      if (LEVEL_ALPHA[level[y * W + x]] !== a[y * W + x]) throw new Error(`check failed: menu item "${name}", pixel ${x},${y}`)
    }
  })
}

// Atlas: glyphs left to right in rows as tall as the tallest glyph, a pixel apart; the menu's after the text's.
const all = [...glyphs, ...menuGlyphs]
const rowH = Math.max(...all.map(g => g.h))
const boxes: number[] = []
let x = 0
let y = 0
for (const g of all) {
  if (x + g.w > ATLAS_W) { x = 0; y += rowH + 1 }
  boxes.push(x, y, g.w, g.h, g.dx, g.dy)
  x += g.w + 1
}
const atlasH = y + rowH
const atlas = new Uint8Array(ATLAS_W * atlasH)
all.forEach((g, n) => {
  const [ax, ay] = boxes.slice(n * 6, n * 6 + 2)
  for (let j = 0; j < g.h; j++) atlas.set(g.g.subarray(j * g.w, (j + 1) * g.w), (ay + j) * ATLAS_W + ax)
})
const menuBoxes = menuGlyphs.flatMap((g, n) => [...boxes.slice((glyphs.length + n) * 6, (glyphs.length + n + 1) * 6), g.adv])
writeFileSync(new URL('lens-font.png', SRC), encodeGray4(atlas, ATLAS_W, atlasH))
writeFileSync(new URL('lens-font.ts', SRC), `// Generated by scripts/lens-font.ts from the Even Hub simulator's rendering; run it again rather than edit this.
/** Screenshot alpha of each grey level 0–15 (a level is 8-bit grey >> 4). */
export const LEVEL_ALPHA = ${JSON.stringify(LEVEL_ALPHA)}
/** Per atlas value 0–15: the grey level that pixel shows at textColor 0–4. */
export const SHADES = ${JSON.stringify(shade)}
/** The characters in lens-font.png, in order. */
export const CHARS = ${JSON.stringify(glyphs.map(g => g.ch).join(''))}
/** Per character: x, y, width, height in the atlas, then its offset from the pen, x and from the top of its line, y. */
export const BOXES = [${boxes.slice(0, glyphs.length * 6).join(',')}]
/** The menu's font (printable ASCII): its characters, then per character the same six numbers and its advance. */
export const MENU_CHARS = ${JSON.stringify(menuGlyphs.map(g => g.ch).join(''))}
export const MENU_BOXES = [${menuBoxes.join(',')}]
/** Menu kerning, measured for the app's labels: a pair → the pen's step from its first character to its second. */
export const MENU_PAIRS: Record<string, number> = ${JSON.stringify(Object.fromEntries(menuPairs))}
/** Where the menu's labels start, and its rows' tops: the first at \`top\`, then every \`pitch\`. */
export const MENU_AT = ${JSON.stringify(MENU)}
/** In pretext's tables but not drawn by the simulator: it shows nothing there and moves on 4 px. */
export const MISSING = ${JSON.stringify([...missing].join(''))}
`)
console.log(`${glyphs.length} glyphs, ${menuGlyphs.length} menu glyphs, ${shade.length} shades, atlas ${ATLAS_W}×${atlasH}, checked against ${placed.length * TONES + menuShots.length + 1} screenshots`)

/** 8-bit RGBA, as the simulator writes it. */
function decodePng(buf: Buffer): { w: number; h: number; rgba: Uint8Array } {
  const idat: Buffer[] = []
  let w = 0, h = 0
  for (let at = 8; at < buf.length;) {
    const len = buf.readUInt32BE(at)
    const type = buf.toString('latin1', at + 4, at + 8)
    const data = buf.subarray(at + 8, at + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4)
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error('expected an 8-bit RGBA PNG, not interlaced')
    }
    if (type === 'IDAT') idat.push(data)
    at += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * 4
  const out = new Uint8Array(h * stride)
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]
    for (let i = 0; i < stride; i++) {
      const v = raw[y * (stride + 1) + 1 + i]
      const a = i >= 4 ? out[y * stride + i - 4] : 0
      const b = y ? out[(y - 1) * stride + i] : 0
      const c = i >= 4 && y ? out[(y - 1) * stride + i - 4] : 0
      const p = a + b - c
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c
      out[y * stride + i] = v + [0, a, b, (a + b) >> 1, paeth][filter]
    }
  }
  return { w, h, rgba: out }
}

/** Values 0–15 as a 4-bit greyscale PNG: the browser reads each back as value × 17. */
function encodeGray4(levels: Uint8Array, w: number, h: number): Buffer {
  const row = Math.ceil(w / 2)
  const raw = Buffer.alloc(h * (row + 1))
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * (row + 1) + 1 + (x >> 1)] |= levels[y * w + x] << (x & 1 ? 0 : 4)
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length)
    out.write(type, 4, 'latin1')
    data.copy(out, 8)
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr[8] = 4 // depth 4, colour type 0 (grey)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}
