/**
 * The G2 display as the Even app draws it: text, image and menu containers on 576×288, green, brightness 0–4.
 * Line breaks and every glyph's x come from @evenrealities/pretext (the firmware's own font metrics), so columns and
 * wraps land where they do on the glasses; only the glyph shapes are a stand-in font.
 */
import { getTextWidth } from '@evenrealities/pretext'

export const W = 576
export const H = 288
const LINE = 27 // the firmware's fixed line height
const MENU_LINE = 40 // a list item on the glasses
const GREEN = [70, 255, 92] as const
// Saira Light at this size is within ~1.5% of the firmware's advances (measured against pretext).
const FONT = '300 18.6px Saira, sans-serif'
const BASELINE = 19 // from the top of a line

export type TextBox = {
  containerID: number; containerName: string; xPosition: number; yPosition: number; width: number; height: number
  paddingLength?: number; borderWidth?: number; borderColor?: number; borderRadius?: number
  content?: string; textColor?: number; isEventCapture?: number
}
export type ImageBox = { containerID: number; containerName: string; xPosition: number; yPosition: number; width: number; height: number }
export type MenuItem = { itemID: number; itemName: string }
export type Page = { textObject?: TextBox[]; imageObject?: ImageBox[]; menuObject?: { menuItems?: MenuItem[] } }

const green = (alpha: number) => `rgba(${GREEN.join(',')},${alpha})`

/** Lines as LVGL breaks them: explicit newlines, then at spaces and hyphens, hard breaks for a word wider than the box. */
export function wrap(text: string, max: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (let piece of para.split(/(?<=[ -])/)) {
      if (line && getTextWidth(line + piece.trimEnd()) > max) { out.push(line.trimEnd()); line = '' }
      while (!line && piece.length > 1 && getTextWidth(piece.trimEnd()) > max) {
        let n = piece.length - 1
        while (n > 1 && getTextWidth(piece.slice(0, n)) > max) n--
        out.push(piece.slice(0, n))
        piece = piece.slice(n)
      }
      line += piece
    }
    out.push(line.trimEnd())
  }
  return out
}

export class Lens {
  page: Page = {}
  menu: { items: MenuItem[]; at: number } | null = null
  #images = new Map<string, HTMLCanvasElement>()
  #g: CanvasRenderingContext2D
  #queued = false

  constructor(canvas: HTMLCanvasElement) {
    this.#g = canvas.getContext('2d')!
    // Drawn at the size it is shown, so the glyphs stay sharp however large the scene is.
    new ResizeObserver(() => {
      const k = (canvas.clientWidth / W) * Math.min(2, devicePixelRatio || 1)
      canvas.width = Math.round(W * k)
      canvas.height = Math.round(H * k)
      this.#g.setTransform(k, 0, 0, k, 0, 0)
      this.#paint()
    }).observe(canvas)
    document.fonts?.ready.then(() => this.draw())
  }

  /** createStartUpPageContainer and rebuildPageContainer: a rebuild drops the images, as on the glasses. */
  setPage(page: Page) {
    this.page = structuredClone(page)
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

  /** A gray PNG from the app becomes green with its brightness as alpha. */
  async setImage(name: string, png: number[]): Promise<boolean> {
    const box = this.page.imageObject?.find(i => i.containerName === name)
    if (!box) return false
    try {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(png)], { type: 'image/png' }))
      const c = document.createElement('canvas')
      c.width = box.width
      c.height = box.height
      const g = c.getContext('2d')!
      g.drawImage(bitmap, 0, 0, box.width, box.height)
      const img = g.getImageData(0, 0, box.width, box.height)
      const px = img.data
      for (let i = 0; i < px.length; i += 4) {
        const lum = (px[i] * px[i + 3]) / 255
        px[i] = GREEN[0]; px[i + 1] = GREEN[1]; px[i + 2] = GREEN[2]; px[i + 3] = lum
      }
      g.putImageData(img, 0, 0)
      this.#images.set(name, c)
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
    requestAnimationFrame(() => { this.#queued = false; this.#paint() })
  }

  #paint() {
    const g = this.#g
    g.clearRect(0, 0, W, H)
    g.font = FONT
    g.textBaseline = 'alphabetic'
    if (this.menu) return this.#paintMenu()
    for (const box of this.page.textObject ?? []) this.#paintText(box)
    for (const box of this.page.imageObject ?? []) {
      const img = this.#images.get(box.containerName)
      if (img) g.drawImage(img, box.xPosition, box.yPosition)
    }
  }

  #paintText(b: TextBox) {
    const g = this.#g
    const border = b.borderWidth ?? 0
    if (border) {
      g.strokeStyle = green((b.borderColor ?? 15) / 15)
      g.lineWidth = border
      g.beginPath()
      g.roundRect(b.xPosition + border / 2, b.yPosition + border / 2, b.width - border, b.height - border, b.borderRadius ?? 0)
      g.stroke()
    }
    const inset = border + (b.paddingLength ?? 0)
    const x = b.xPosition + inset
    const y = b.yPosition + inset
    const w = b.width - 2 * inset
    const alpha = (b.textColor ?? 4) / 4
    if (!b.content || !alpha) return
    g.save()
    g.beginPath()
    g.rect(x, y, w, b.height - 2 * inset)
    g.clip()
    g.fillStyle = green(alpha)
    wrap(b.content, w).forEach((line, i) => this.#line(line, x, y + i * LINE + BASELINE))
    g.restore()
  }

  /** Each glyph centred in the firmware's advance for it, kerning included: a wider stand-in glyph spills evenly. */
  #line(text: string, x: number, y: number) {
    let before = ''
    let at = 0
    for (const ch of text) {
      const next = getTextWidth(before + ch)
      if (ch !== ' ') this.#g.fillText(ch, x + at + (next - at - this.#g.measureText(ch).width) / 2, y)
      before += ch
      at = next
    }
  }

  #paintMenu() {
    const g = this.#g
    const { items, at } = this.menu!
    g.fillStyle = green(1)
    const top = Math.max(12, (H - items.length * MENU_LINE) / 2)
    items.forEach((item, i) => {
      const y = top + i * MENU_LINE + BASELINE + 6
      if (i === at) {
        g.strokeStyle = green(0.75)
        g.lineWidth = 2
        g.beginPath()
        g.roundRect(150, top + i * MENU_LINE + 2, 276, MENU_LINE - 4, 6)
        g.stroke()
      }
      this.#line(item.itemName, (W - getTextWidth(item.itemName)) / 2, y)
    })
  }
}
