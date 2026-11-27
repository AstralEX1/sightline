/**
 * The Even app's side of the bridge for a page outside the Even app. The official simulator plays this part on
 * the desktop. This host forwards page and gesture messages to a browser-drawn Lens.
 */
import type { Lens, Page, TextBox } from './lens.ts'

export type Gesture = 'up' | 'down' | 'tap' | 'double' | 'long' | 'menu'

type AppWindow = Window & {
  flutter_inappwebview?: { callHandler(name: string, message: string): Promise<unknown> }
  _listenEvenAppMessage?: (message: unknown) => void
}

const EVENT: Record<Exclude<Gesture, 'menu' | 'long'>, number> = { tap: 0, up: 1, down: 2, double: 3 }
const STATUS = { sn: 'SANDBOX', connectType: 'connected', isWearing: true, batteryLevel: 86, isCharging: false, isInCase: false }

export function createHost(lens: Lens, onExit: () => void = () => {}) {
  const storage = new Map([['gt.hints', 'on'], ['gt.voice', 'off']])
  let app: AppWindow | null = null
  const send = (method: string, data: unknown) => app?._listenEvenAppMessage?.({ type: 'listen_even_app_data', method, data })

  const methods: Record<string, (data: Record<string, unknown>) => unknown> = {
    getUserInfo: () => ({ uid: 0, name: 'Sandbox', avatar: '', country: '' }),
    getGlassesInfo: () => ({ model: 'g2', sn: STATUS.sn, status: STATUS }),
    setLocalStorage: data => { storage.set(String(data.key), String(data.value)); return true },
    createStartUpPageContainer: data => { lens.setPage(data as Page); return 0 },
    rebuildPageContainer: data => { lens.setPage(data as Page); return true },
    textContainerUpgrade: data => lens.setText(String(data.containerName), String(data.content ?? ''), data.textColor as number | undefined),
    updateImageRawData: async data => ((await lens.setImage(String(data.containerName), data.imageData as number[])) ? 'success' : 'imageException'),
    shutDownPageContainer: () => { onExit(); return true },
    imuControl: () => false,
  }

  return {
    attach(w: Window, current: () => boolean = () => true, defaults?: ReadonlyMap<string, string>) {
      app = w as AppWindow
      app.flutter_inappwebview = {
        callHandler: async (_name, message) => {
          if (!current()) return null
          const request = JSON.parse(message) as { method: string; data?: Record<string, unknown> }
          if (request.method === 'getLocalStorage') {
            const key = String(request.data?.key)
            return storage.get(key) ?? defaults?.get(key) ?? ''
          }
          return methods[request.method]?.(request.data ?? {}) ?? null
        },
      }
    },

    /** Ring or temple input. Hold opens the page's contextual menu, which the Even app draws, not the plugin. */
    gesture(gesture: Gesture) {
      if (lens.menu) {
        const menu = lens.menu
        if (gesture === 'up' || gesture === 'down') {
          menu.at = (menu.at + (gesture === 'up' ? -1 : 1) + menu.items.length) % menu.items.length
          lens.draw()
        } else if (gesture === 'tap') {
          lens.closeMenu()
          send('evenHubEvent', { type: 'menuItemClickEvent', jsonData: { itemID: menu.items[menu.at].itemID } })
        } else {
          lens.closeMenu()
        }
        return
      }
      if (gesture === 'menu' || gesture === 'long') return lens.openMenu()
      const eventType = EVENT[gesture]
      const capture: TextBox | undefined = lens.page.textObject?.find(text => text.isEventCapture)
      send('evenHubEvent', capture
        ? { type: 'textEvent', jsonData: { containerID: capture.containerID, containerName: capture.containerName, eventType } }
        : { type: 'sysEvent', jsonData: { eventType } })
    },
  }
}
