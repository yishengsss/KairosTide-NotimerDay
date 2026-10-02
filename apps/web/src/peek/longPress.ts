/**
 * Long-press gesture, framework-free so its rules are testable without a DOM renderer.
 *
 * Hold ~600 ms on empty scene → `onHold(x, y)`. Moving more than 10 px, lifting, cancelling or the
 * page hiding all abandon the press. Elements that are interactive (buttons, cards, the picker) are
 * not "empty scene" and never start a press.
 */

import { after, type Cancel } from '../ui/delay.ts'

export const HOLD_MS = 600
export const MOVE_TOLERANCE_PX = 10

export type PressPoint = { x: number; y: number }

export type LongPress = {
  down(point: PressPoint, onBlank: boolean): void
  move(point: PressPoint): void
  /** Lift, cancel, or the page hid. Returns true when this release ended a short tap. */
  up(): boolean
  cancel(): void
}

export function createLongPress(onHold: (point: PressPoint) => void, holdMs = HOLD_MS): LongPress {
  let origin: PressPoint | null = null
  let held = false
  let timer: Cancel | null = null

  const reset = (): void => {
    timer?.()
    timer = null
    origin = null
    held = false
  }

  return {
    down(point, onBlank) {
      reset()
      if (!onBlank) return
      origin = point
      timer = after(holdMs, () => {
        timer = null
        held = true
        onHold(point)
      })
    },
    move(point) {
      if (!origin || held) return
      if (Math.hypot(point.x - origin.x, point.y - origin.y) > MOVE_TOLERANCE_PX) reset()
    },
    up() {
      const tap = origin !== null && !held
      reset()
      return tap
    },
    cancel: reset,
  }
}

/** True when a pointer target is part of the bare scene rather than a control laid over it. */
export function isBlankTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true
  return target.closest('button, a, input, textarea, select, [role="dialog"], [data-interactive]') === null
}
