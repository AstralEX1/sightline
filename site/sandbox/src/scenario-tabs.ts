// Adapted from SL UI Library Project section tabs (navigation-overflow-tabs-v11).
// The sandbox supplies the shared panel's content and lifecycle.
export function mountScenarioTabs(root: HTMLElement, initial: number, onNavigate: (index: number) => void) {
  const life = new AbortController()
  const options = { signal: life.signal }
  const track = root.querySelector<HTMLElement>('[role=tablist]')!
  const panel = root.querySelector<HTMLElement>('[role=tabpanel]')!
  const tabs = [...track.querySelectorAll<HTMLButtonElement>('[data-tab]')]
  const indicator = document.createElement('span')
  indicator.className = 'nv-tab-indicator'
  indicator.setAttribute('aria-hidden', 'true')
  track.append(indicator)
  let selected = initial

  function position(animate = false) {
    const tab = tabs[selected]
    if (!animate) indicator.style.transition = 'none'
    indicator.style.width = `${Math.max(0, tab.offsetWidth - 16)}px`
    indicator.style.transform = `translate(${tab.offsetLeft + 8}px, ${tab.offsetTop + tab.offsetHeight - 3}px)`
    if (!animate) {
      indicator.getBoundingClientRect()
      indicator.style.removeProperty('transition')
    }
  }

  function paint() {
    tabs.forEach((tab, index) => {
      tab.setAttribute('aria-controls', panel.id)
      tab.setAttribute('aria-selected', String(index === selected))
      tab.tabIndex = index === selected ? 0 : -1
    })
    panel.setAttribute('aria-labelledby', tabs[selected].id)
  }

  function navigate(index: number, animate: boolean) {
    if (index === selected) return
    selected = index
    paint()
    position(animate)
    onNavigate(index)
  }

  tabs.forEach((tab, index) => {
    // Pointer selection leaves the global G2 keyboard shortcuts available.
    tab.addEventListener('mousedown', event => { if (event.button === 0) event.preventDefault() }, options)
    tab.addEventListener('click', () => navigate(index, true), options)
  })
  track.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (selected + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    navigate(index, false)
    tabs[selected].focus({ preventScroll: true })
  }, options)
  const observer = new ResizeObserver(() => position())
  observer.observe(track)
  paint()
  position()

  window.addEventListener('pagehide', event => {
    if (event.persisted) return
    life.abort()
    observer.disconnect()
    indicator.remove()
  }, options)
}
