/**
 * The Even app's side of the bridge, for a page that is not inside the Even app. The SDK calls
 * `flutter_inappwebview.callHandler('evenAppMessage', …)` and listens on `window._listenEvenAppMessage`; the official
 * simulator plays this part on the desktop, this does it in the browser and draws on a Lens.
 */
import type { Lens, Page, TextBox } from './lens.ts'

export type Gesture = 'up' | 'down' | 'tap' | 'double' | 'menu'

type AppWindow = Window & {
  flutter_inappwebview?: { callHandler(name: string, message: string): Promise<unknown> }
  _listenEvenAppMessage?: (message: unknown) => void
}

// OsEventTypeList in the SDK
const EVENT: Record<Exclude<Gesture, 'menu'>, number> = { tap: 0, up: 1, down: 2, double: 3 }
const STATUS = { sn: 'SANDBOX', connectType: 'connected', isWearing: true, batteryLevel: 86, isCharging: false, isInCase: false }

export function createHost(lens: Lens) {
  // Lens gesture tips on for every visitor, and no microphone: the sandbox answers by tap only.
  const storage = new Map([['gt.hints', 'on'], ['gt.voice', 'off']])
  let app: AppWindow | null = null
  const send = (method: string, data: unknown) => app?._listenEvenAppMessage?.({ type: 'listen_even_app_data', method, data })

  const methods: Record<string, (d: Record<string, unknown>) => unknown> = {
    getUserInfo: () => ({ uid: 0, name: 'Sandbox', avatar: '', country: '' }),
    getGlassesInfo: () => ({ model: 'g2', sn: STATUS.sn, status: STATUS }),
    setLocalStorage: d => { storage.set(String(d.key), String(d.value)); return true },
    getLocalStorage: d => storage.get(String(d.key)) ?? '',
    createStartUpPageContainer: d => { lens.setPage(d as Page); return 0 },
    rebuildPageContainer: d => { lens.setPage(d as Page); return true },
    textContainerUpgrade: d => lens.setText(String(d.containerName), String(d.content ?? ''), d.textColor as number | undefined),
    updateImageRawData: async d => ((await lens.setImage(String(d.containerName), d.imageData as number[])) ? 'success' : 'imageException'),
    shutDownPageContainer: () => true, // the exit dialogue: the sandbox keeps the app open
    audioControl: () => false,
    imuControl: () => false,
  }

  return {
    /** Before the app's scripts run in that window. */
    attach(w: Window) {
      app = w as AppWindow
      app.flutter_inappwebview = {
        callHandler: async (_name, message) => {
          const m = JSON.parse(message) as { method: string; data?: Record<string, unknown> }
          return methods[m.method]?.(m.data ?? {}) ?? null
        },
      }
    },

    /** Ring or temple input. Hold opens the page's contextual menu, which the Even app draws, not the plugin. */
    gesture(g: Gesture) {
      if (lens.menu) {
        const menu = lens.menu
        if (g === 'up' || g === 'down') { menu.at = (menu.at + (g === 'up' ? -1 : 1) + menu.items.length) % menu.items.length; lens.draw() }
        else if (g === 'tap') { lens.closeMenu(); send('evenHubEvent', { type: 'menuItemClickEvent', jsonData: { itemID: menu.items[menu.at].itemID } }) }
        else lens.closeMenu()
        return
      }
      if (g === 'menu') return lens.openMenu()
      const eventType = EVENT[g]
      const capture: TextBox | undefined = lens.page.textObject?.find(t => t.isEventCapture)
      send('evenHubEvent', capture
        ? { type: 'textEvent', jsonData: { containerID: capture.containerID, containerName: capture.containerName, eventType } }
        : { type: 'sysEvent', jsonData: { eventType } })
    },
  }
}
