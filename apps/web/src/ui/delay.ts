/**
 * Interface delays: hide the controls after a pause, hold a press, fold a card away.
 *
 * These are the only timers outside the sync engine, and they live here so that no component can
 * quietly grow its own polling loop. Nothing in this file may fetch or touch the schedule.
 */

export type Cancel = () => void

/** Run `callback` once after `ms`. The returned function cancels it; calling it twice is harmless. */
export function after(ms: number, callback: () => void): Cancel {
  let handle: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    handle = null
    callback()
  }, ms)
  return () => {
    if (handle !== null) clearTimeout(handle)
    handle = null
  }
}

/** A restartable delay: every `restart()` pushes the deadline back out. */
export function createDebounce(ms: number, callback: () => void): { restart(): void; cancel(): void } {
  let cancel: Cancel | null = null
  return {
    restart() {
      cancel?.()
      cancel = after(ms, callback)
    },
    cancel() {
      cancel?.()
      cancel = null
    },
  }
}

/** Run `callback` every `ms` until cancelled. For display refresh only — never for fetching. */
export function every(ms: number, callback: () => void): Cancel {
  let handle: ReturnType<typeof setInterval> | null = setInterval(callback, ms)
  return () => {
    if (handle !== null) clearInterval(handle)
    handle = null
  }
}
