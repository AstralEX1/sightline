import { OsEventTypeList as E } from '@evenrealities/even_hub_sdk'

/** Foreground and exit events: the only ones the firmware repeats, and the ones the exit dialogue turns around. */
export const LIFECYCLE = [E.FOREGROUND_ENTER_EVENT, E.FOREGROUND_EXIT_EVENT, E.SYSTEM_EXIT_EVENT]

/** After `shutDownPageContainer(1)`: `asked` until the dialogue shows, `open` until the user answers. */
export type Exit = 'none' | 'asked' | 'open'
export type Act = 'show' | 'resume' | 'ignore' | 'quit' | 'pass'

/**
 * The host's exit dialogue inverts the foreground events: ENTER means it appeared (the page is already cleared, and a
 * rebuild behind it only loses the images), EXIT means the user said No, SYSTEM_EXIT means Yes. Outside the dialogue they
 * mean what they say, and ENTER is also what opening the contextual menu sends (Even Hub docs, Contextual Menu): `resume`
 * redraws what changed but never rebuilds, because a rebuild beneath the open menu closes it. A lost EXIT heals on the
 * next ENTER, which then counts as a return after the dialogue: `show` rebuilds the page it cleared.
 */
export function exitStep(state: Exit, type: E): { next: Exit; act: Act } {
  if (type === E.SYSTEM_EXIT_EVENT) return { next: 'none', act: 'quit' }
  if (type === E.FOREGROUND_ENTER_EVENT) {
    if (state === 'asked') return { next: 'open', act: 'ignore' }
    return { next: 'none', act: state === 'open' ? 'show' : 'resume' }
  }
  if (type === E.FOREGROUND_EXIT_EVENT && state === 'open') return { next: 'none', act: 'show' }
  return { next: state, act: 'pass' }
}

/** The firmware sends one physical transition twice, 50 to 100 ms apart. Remembers when each type last got through. */
export function createDedupe(windowMs = 600) {
  const last = new Map<number, number>()
  return (type: number, now: number) => {
    const prev = last.get(type)
    if (prev !== undefined && now - prev < windowMs) return true
    last.set(type, now) // only a pass moves the window, so a repeat never extends it
    return false
  }
}
