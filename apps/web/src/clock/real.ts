/**
 * The device clock. This is the only source the long-press time peek may read, and the only place
 * that calls `Date.now()` for display purposes — everything else works from an injected instant, so
 * the rest of the app is testable without mocking the system clock.
 */

export type RealClock = {
  /** Milliseconds since the epoch, according to the device. */
  now(): number
}

export const realClock: RealClock = { now: () => Date.now() }

/** `14:37` in the device's own zone. Hours are not zero-padded; the minute always is. */
export function formatClockTime(instant: number): string {
  const date = new Date(instant)
  const hour = date.getHours()
  const minute = date.getMinutes().toString().padStart(2, '0')
  return `${hour}:${minute}`
}

/** `2026年10月2日 星期五`. Used by the place page, not by the homepage. */
export function formatClockDate(instant: number): string {
  const date = new Date(instant)
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 星期${weekdays[date.getDay()]}`
}
