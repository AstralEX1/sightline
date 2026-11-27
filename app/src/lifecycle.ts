import { OsEventTypeList as E } from '@evenrealities/even_hub_sdk'

export const LIFECYCLE = [E.FOREGROUND_ENTER_EVENT, E.FOREGROUND_EXIT_EVENT, E.SYSTEM_EXIT_EVENT]

export type Exit = 'none' | 'asked' | 'open'
export type Act = 'show' | 'resume' | 'ignore' | 'quit' | 'pass'

export function exitStep(state: Exit, type: E): { next: Exit; act: Act } {
  if (type === E.SYSTEM_EXIT_EVENT) return { next: 'none', act: 'quit' }
  if (type === E.FOREGROUND_ENTER_EVENT) {
    if (state === 'asked') return { next: 'open', act: 'ignore' }
    return { next: 'none', act: state === 'open' ? 'show' : 'resume' }
  }
  if (type === E.FOREGROUND_EXIT_EVENT && state === 'open') return { next: 'none', act: 'show' }
  return { next: state, act: 'pass' }
}

export function createDedupe(windowMs = 600) {
  const last = new Map<number, number>()
  return (type: number, now: number) => {
    const prev = last.get(type)
    if (prev !== undefined && now - prev < windowMs) return true
    last.set(type, now) // only a pass moves the window, so a repeat never extends it
    return false
  }
}
