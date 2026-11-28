/**
 * The G2 display as the Even Hub simulator draws it, pixel for pixel: text, image and menu containers on 576×288 in
 * pure green, brightness in alpha. Glyphs are the simulator's own (lens-font.png, cut by scripts/lens-font.ts) and
 * sit where @evenrealities/pretext's firmware metrics put them; borders are LVGL's anti-aliased rings, which the
 * simulator runs. Everything is drawn in 8-bit grey first, then each pixel's level (grey >> 4) becomes the alpha
 * the simulator's screenshot gives it.
 */
import { getAdvW, getTextWidth } from '@evenrealities/pretext'
import { BOXES, CHARS, LEVEL_ALPHA, MENU_AT, MENU_BOXES, MENU_CHARS, MENU_PAIRS, SHADES } from './lens-font.ts'

export const W = 576
export const H = 288
const LINE = 27 // the firmware's fixed line height
const FULL = 4 // textColor when the app sets none

export type TextBox = {
  containerID: number; containerName: string; xPosition: number; yPosition: number; width: number; height: number
  paddingLength?: number; borderWidth?: number; borderColor?: number; borderRadius?: number
  content?: string; textColor?: number; isEventCapture?: number
}
export type ImageBox = { containerID: number; containerName: string; xPosition: number; yPosition: number; width: number; height: number }
export type MenuItem = { itemID: number; itemName: string }
export type Page = { textObject?: TextBox[]; imageObject?: ImageBox[]; menuObject?: { menuItems?: MenuItem[] } }

const BREAKS = new Set(' ,.;:-_)]}') // LVGL's LV_TXT_BREAK_CHARS, as the simulator breaks lines

/**
 * Lines as LVGL breaks them (lv_text_get_next_line): explicit newlines, then words. A word ends its line only if it
 * fits together with the break character after it, which then counts as a word of its own; the first word of a line
 * that is too wide is cut where it stops fitting.
 */
export function wrap(text: string, max: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    const cs = [...para]
    // A glyph's width with its kerning to the next character, as LVGL reads them.
    const adv = cs.map((c, i) => (i + 1 < cs.length ? getTextWidth(c + cs[i + 1]) - getTextWidth(cs[i + 1]) : getTextWidth(c)))
    let start = 0
    do {
      let i = start
      let room = max
      while (i < cs.length && room > 0) {
        let used = 0, width = 0, cut = -1, j = i
        for (; j < cs.length; j++) {
          used += adv[j]
          if (cut < 0 && used > room) cut = j
          if (BREAKS.has(cs[j])) { if (j === i && cut < 0) width = used; break }
          if (cut < 0) width = used
        }
        const step = cut < 0 ? (j === i ? 1 : j - i) : i === start ? cut - i : 0
        room -= cut < 0 || i === start ? width : 0
        if (!step) break
        i += step
      }
      if (i === start) i++ // always at least one character
      out.push(cs.slice(start, i).join(''))
      start = i
    } while (start < cs.length)
  }
  return out
}

type Font = { w: number; shade: Uint8Array }
const GLYPH = new Map([...CHARS].map((ch, i) => [ch, i]))
let font: Promise<Font> | undefined

/** The atlas as shade ids: a 4-bit grey PNG reads back as id × 17. */
async function loadFont(): Promise<Font> {
  const img = new Image()
  img.src = new URL('./lens-font.png', import.meta.url).href
  await img.decode()
  const g = new OffscreenCanvas(img.width, img.height).getContext('2d')!
  g.drawImage(img, 0, 0)
  const px = g.getImageData(0, 0, img.width, img.height).data
  return { w: img.width, shade: Uint8Array.from({ length: img.width * img.height }, (_, i) => Math.round(px[i * 4] / 17)) }
}

/** LVGL's blend of `src` over `dst` at opacity `mix` 0–255, in 8-bit grey. */
const blend = (dst: number, src: number, mix: number) => (mix >= 253 ? src : mix <= 2 ? dst : (src * mix + dst * (255 - mix)) >> 8)
/** LVGL's mask_mix: a new mask value on top of one already in the buffer. */
const maskMix = (add: number, had: number) => (had >= 253 ? add : had <= 2 ? 0 : (add * had * 0x8081) >>> 23)
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

type Circle = { opa: number[]; start: number[]; xs: number[] }
const circles = new Map<number, Circle>()

/** LVGL's circ_calc_aa4: a quarter circle of radius r traced at 4×, as per-row runs of edge opacity. */
function circle(r: number): Circle {
  let c = circles.get(r)
  if (c) return c
  if (r === 1) c = { opa: [180], start: [0, 1], xs: [0] }
  else {
    const cx: number[] = [], cy: number[] = [], opa: number[] = []
    let x = r * 4, y = 0, tmp = 1 - r * 4, row = 0
    const xi = [x >> 2, 0, 0, 0], xf = [0, 0, 0, 0]
    const add = (px: number, o: number) => { cx.push(px); cy.push(row); opa.push(o * 16) }
    const sum = (a: number[]) => a.reduce((s, v) => s + v, 0)
    while (y <= x) {
      let i = 0
      for (; i < 4; i++) {
        if (tmp <= 0) tmp += 2 * y + 3
        else { tmp += 2 * (y - x) + 5; x-- }
        y++
        if (y > x) break
        xi[i] = x >> 2
        xf[i] = x & 3
      }
      if (i !== 4) break
      if (xi[0] === xi[3]) add(xi[0], sum(xf))
      else {
        const n = xi[0] !== xi[1] ? 1 : xi[0] !== xi[2] ? 2 : 3 // sub-rows still on the first x
        add(xi[0], sum(xf.slice(0, n)))
        add(xi[0] - 1, 4 * n + sum(xf.slice(n)))
      }
      row++
    }
    const mid = r * 723, midInt = mid >> 10 // the 45° point, by hand
    if (cx.at(-1) !== midInt || cy.at(-1) !== midInt) {
      const t = mid - (midInt << 10)
      cx.push(midInt); cy.push(midInt)
      opa.push((t <= 512 ? (t * t * 2) >> 16 : 15 - (((1024 - t) ** 2 * 2) >> 16)) * 16)
    }
    for (let i = cx.length - 2; i >= 0; i--) { cx.push(cy[i]); cy.push(cx[i]); opa.push(opa[i]) } // the other octant
    const start: number[] = [], xs: number[] = []
    for (let i = 0, y = 0; i < cx.length; y++) {
      start[y] = i
      xs[y] = cx[i]
      for (; i < cx.length && cy[i] === y; i++) xs[y] = Math.min(xs[y], cx[i])
    }
    start.push(cx.length)
    c = { opa, start, xs }
  }
  circles.set(r, c)
  return c
}

/** LVGL's radius mask on one row: `buf` covers x = ax…; `outer` keeps what lies outside the rounded rectangle. */
function radiusMask(buf: Uint8Array, ax: number, ay: number, [x1, y1, x2, y2]: number[], radius: number, outer: boolean) {
  const len = buf.length, w = x2 - x1 + 1, h = y2 - y1 + 1
  const r = clamp(radius, 0, Math.min(w, h) >> 1)
  if (ay < y1 || ay > y2) { if (!outer) buf.fill(0); return }
  if (!r || (ax >= x1 + r && ax + len <= x2 - r) || (ay >= y1 + r && ay <= y2 - r)) {
    if (outer) buf.fill(0, Math.max(0, x1 - ax), clamp(x2 - ax + 1, 0, len))
    else { buf.fill(0, 0, clamp(x1 - ax, 0, len)); buf.fill(0, clamp(x2 - ax + 1, 0, len)) }
    return
  }
  const { opa, start, xs } = circle(r)
  const cy = ay - y1 < r ? r - (ay - y1) - 1 : ay - y1 - (h - r)
  const n = start[cy + 1] - start[cy]
  const right = x1 - ax + w - r + xs[cy]
  const left = x1 - ax + r - xs[cy] - 1
  for (let i = 0; i < n; i++) {
    const a = opa[start[cy] + n - 1 - i]
    const o = outer ? 255 - a : a
    if (right + i >= 0 && right + i < len) buf[right + i] = maskMix(o, buf[right + i])
    if (left - i >= 0 && left - i < len) buf[left - i] = maskMix(o, buf[left - i])
  }
  if (outer) { const s = clamp(left + 1, 0, len); buf.fill(0, s, s + clamp(right - s, 0, len - s)) }
  else { buf.fill(0, clamp(right + n, 0, len)); buf.fill(0, 0, clamp(left - n + 1, 0, len)) }
}

const MENU = { rows: 5, pad: 86, minW: 228, maxW: 292, radius: 6 }
const MENU_GLYPH = new Map([...MENU_CHARS].map((ch, i) => [ch, i]))
/** The pen's step from `a` to `b` in a menu label: the measured pair, else `a`'s advance before a space (past ASCII, the text font's). */
const menuStep = (a: string, b: string) => {
  const n = MENU_GLYPH.get(a)
  return MENU_PAIRS[a + b] ?? (n === undefined ? (getAdvW(a.codePointAt(0)!) + 8) >> 4 || 4 : MENU_BOXES[n * 7 + 6])
}

export class Lens {
  page: Page = {}
  showHints = true
  menu: { items: MenuItem[]; at: number } | null = null
  #images = new Map<string, Uint8Array>()
  #g: CanvasRenderingContext2D
  #gray = new Uint8Array(W * H)
  #frame: ImageData
  #font: Font | null = null
  #queued = false
  #onDraw: () => void
  #pagePaintedAt = 0

  constructor(canvas: HTMLCanvasElement, onDraw: () => void = () => {}) {
    this.#onDraw = onDraw
    canvas.width = W
    canvas.height = H
    canvas.style.imageRendering = 'pixelated' // the lens's own pixels, scaled up
    this.#g = canvas.getContext('2d')!
    this.#frame = this.#g.createImageData(W, H)
    for (let i = 1; i < this.#frame.data.length; i += 4) this.#frame.data[i] = 255 // rgb(0, 255, 0)
    ;(font ??= loadFont()).then(f => { this.#font = f; this.draw() }, e => console.error('Lens font did not load', e))
  }

  get pagePaintedAt() { return this.#pagePaintedAt }

  /** createStartUpPageContainer and rebuildPageContainer: a rebuild drops the images, as on the glasses. */
  setPage(page: Page) {
    this.page = structuredClone(page)
    this.#pagePaintedAt = 0
    this.#images.clear()
    this.menu = null
    this.draw()
  }

  setText(name: string, content: string, textColor?: number): boolean {
    const box = this.page.textObject?.find(t => t.containerName === name)
    if (!box) return false
    box.content = content
    if (textColor !== undefined) box.textColor = textColor
    this.draw()
    return true
  }

  /** A PNG from the app becomes 16 greys, as the simulator converts it; a different size covers the box, centred. */
  async setImage(name: string, png: number[]): Promise<boolean> {
    const page = this.page
    const box = page.imageObject?.find(i => i.containerName === name)
    if (!box) return false
    try {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(png)], { type: 'image/png' }))
      if (page !== this.page) { bitmap.close(); return false }
      const { width: w, height: h } = box
      const g = new OffscreenCanvas(w, h).getContext('2d')!
      const k = Math.max(w / bitmap.width, h / bitmap.height)
      g.drawImage(bitmap, (w - bitmap.width * k) / 2, (h - bitmap.height * k) / 2, bitmap.width * k, bitmap.height * k)
      bitmap.close()
      const px = g.getImageData(0, 0, w, h).data
      const gray = new Uint8Array(w * h)
      for (let i = 0; i < gray.length; i++) {
        const lum = ((0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) * px[i * 4 + 3]) / 255
        gray[i] = Math.round(lum / 17) * 17
      }
      this.#images.set(name, gray)
      this.draw()
      return true
    } catch {
      return false
    }
  }

  openMenu() {
    const items = this.page.menuObject?.menuItems ?? []
    if (items.length) { this.menu = { items, at: 0 }; this.draw() }
  }

  closeMenu() { this.menu = null; this.draw() }

  /** Batched to one paint per frame: the app updates several containers in a row. */
  draw() {
    if (this.#queued) return
    this.#queued = true
    requestAnimationFrame(() => {
      this.#queued = false
      this.#paint()
      if (this.#font && !this.#pagePaintedAt) this.#pagePaintedAt = performance.now()
      this.#onDraw()
    })
  }

  #paint() {
    const gray = this.#gray
    gray.fill(0)
    if (this.menu) this.#paintMenu()
    else {
      for (const box of this.page.textObject ?? []) if (this.showHints || box.containerName !== 'hint') this.#paintText(box)
      for (const box of this.page.imageObject ?? []) {
        const img = this.#images.get(box.containerName)
        if (!img) continue
        for (let j = 0; j < box.height; j++) for (let i = 0; i < box.width; i++) {
          const x = box.xPosition + i, y = box.yPosition + j
          if (x >= 0 && x < W && y >= 0 && y < H) gray[y * W + x] = img[j * box.width + i]
        }
      }
    }
    const px = this.#frame.data
    for (let i = 0; i < gray.length; i++) px[i * 4 + 3] = LEVEL_ALPHA[gray[i] >> 4]
    this.#g.putImageData(this.#frame, 0, 0)
  }

  #paintText(b: TextBox) {
    const bw = b.borderWidth ?? 0
    if (bw && b.borderColor) this.#border(b.xPosition, b.yPosition, b.width, b.height, bw, b.borderRadius ?? 0, b.borderColor * 17)
    if (!b.content) return
    const inset = bw + (b.paddingLength ?? 0)
    const x = b.xPosition + inset
    const y = b.yPosition + inset
    // Text is cut at the border's inner edge, not at the padding, and wraps as if there were no border.
    const clip = [b.xPosition + bw, b.yPosition + bw, b.xPosition + b.width - bw, b.yPosition + b.height - bw]
    const tone = clamp(b.textColor ?? FULL, 0, FULL)
    wrap(b.content, b.width - 2 * (b.paddingLength ?? 0)).forEach((line, i) => {
      let before = ''
      for (const ch of line) {
        // The pen at a glyph: pretext's width up to and including it, less its own (kerning goes with the glyph before).
        this.#glyph(ch, x + getTextWidth(before + ch) - getTextWidth(ch), y + i * LINE, tone, clip)
        before += ch
      }
    })
  }

  /** One glyph from the atlas, its pen at x and its line's top at y; a character the atlas lacks shows nothing. */
  #glyph(ch: string, x: number, y: number, tone: number, [cx1, cy1, cx2, cy2]: number[], menu = false) {
    const n = (menu ? MENU_GLYPH : GLYPH).get(ch)
    const f = this.#font
    if (n === undefined || !f) return
    const [ax, ay, w, h, dx, dy] = menu ? MENU_BOXES.slice(n * 7, n * 7 + 6) : BOXES.slice(n * 6, n * 6 + 6)
    for (let j = 0; j < h; j++) {
      const py = y + dy + j
      if (py < Math.max(0, cy1) || py >= Math.min(H, cy2)) continue
      for (let i = 0; i < w; i++) {
        const px = x + dx + i
        const s = f.shade[(ay + j) * f.w + ax + i]
        if (!s || px < Math.max(0, cx1) || px >= Math.min(W, cx2)) continue
        const at = py * W + px
        this.#gray[at] = Math.max(this.#gray[at], SHADES[s][tone] * 17)
      }
    }
  }

  /** LVGL's border: the ring between the box and the box inset by `bw`, both with rounded corners. */
  #border(x: number, y: number, w: number, h: number, bw: number, radius: number, color: number, clipCorners = false) {
    const r = Math.min(radius, Math.min(w, h) >> 1)
    const outer = [x, y, x + w - 1, y + h - 1]
    const inner = [x + bw, y + bw, x + w - 1 - bw, y + h - 1 - bw]
    const row = new Uint8Array(w)
    for (let j = Math.max(0, y); j < Math.min(H, y + h); j++) {
      row.fill(255)
      radiusMask(row, x, j, inner, Math.max(0, r - bw), true)
      if (r) radiusMask(row, x, j, outer, r, false)
      if (r && clipCorners) radiusMask(row, x, j, outer, r, false)
      for (let i = Math.max(0, -x); i < Math.min(w, W - x); i++) {
        if (row[i]) this.#gray[j * W + x + i] = blend(this.#gray[j * W + x + i], color, row[i])
      }
    }
  }

  /** The simulator's menu: a panel on the left, five rows, the chosen one bright and the others at textColor 1. */
  #paintMenu() {
    const { items, at } = this.menu!
    const panel = clamp(Math.max(...items.map(i => getTextWidth(i.itemName))) + MENU.pad, MENU.minW, MENU.maxW)
    // The panel's corners are masked twice over (a rounded border inside a clip of the same radius).
    this.#border(0, 0, panel, H, 1, MENU.radius, 255, true)
    const first = Math.max(0, at - (MENU.rows - 1))
    items.slice(first, first + MENU.rows).forEach((item, k) => {
      let x = MENU_AT.x
      ;[...item.itemName].forEach((ch, n, chars) => {
        this.#glyph(ch, x, MENU_AT.top + k * MENU_AT.pitch, first + k === at ? FULL : 1, [1, 1, panel - 1, H - 1], true)
        x += menuStep(ch, chars[n + 1])
      })
    })
  }
}
