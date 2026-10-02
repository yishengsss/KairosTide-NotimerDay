/**
 * Schedule clock: the device clock plus whatever offset the server reports.
 *
 * Business instants come from the server's zone of truth, so "is this reminder due?" must not be
 * decided by a device whose clock is minutes off. The offset is captured when a snapshot arrives and
 * then carried by the device clock, which keeps ticking correctly while the network is down.
 *
 * This clock never touches the scene. The long-press peek reads `RealClock`; a user who wants to know
 * the time must be told the device's answer, not the schedule's.
 */

import type { RealClock } from './real.ts'

export type Calibration = {
  /** Server time when the snapshot was produced. */
  serverNow: number
  /** Device time when that snapshot arrived. */
  fetchedAt: number
}

export type ScheduleClock = {
  /** Schedule time now, in milliseconds since the epoch. */
  now(): number
  /** Milliseconds the schedule clock is ahead of the device. Zero until first calibration. */
  offset(): number
  /** False until a snapshot has been seen; the UI downgrades its wording rather than guessing. */
  readonly synced: boolean
  /** Adopt a snapshot's timing. A wildly implausible offset is ignored rather than trusted blindly. */
  calibrate(calibration: Calibration): void
  /** Milliseconds from now until `instant`; negative once it has passed. */
  until(instant: number): number
  /** 0 outside the warning window, ramping to 1 exactly at the start. */
  urgency(startAt: number, leadSeconds: number): number
}

/**
 * Beyond this the server and the device disagree so violently that something other than clock drift
 * is wrong (a wrong year, a mangled payload). Keep the device clock; do not jump the schedule.
 */
const MAX_PLAUSIBLE_OFFSET_MS = 24 * 60 * 60 * 1000

export function createScheduleClock(clock: RealClock): ScheduleClock {
  let offsetMs = 0
  let synced = false

  return {
    now() {
      return clock.now() + offsetMs
    },
    offset() {
      return offsetMs
    },
    get synced() {
      return synced
    },
    calibrate(calibration) {
      if (!Number.isFinite(calibration.serverNow) || !Number.isFinite(calibration.fetchedAt)) return
      const next = calibration.serverNow - calibration.fetchedAt
      if (Math.abs(next) > MAX_PLAUSIBLE_OFFSET_MS) return
      offsetMs = next
      synced = true
    },
    until(instant) {
      return instant - (clock.now() + offsetMs)
    },
    urgency(startAt, leadSeconds) {
      const leadMs = Math.max(0, leadSeconds) * 1000
      const remaining = startAt - (clock.now() + offsetMs)
      if (leadMs <= 0) return remaining <= 0 ? 1 : 0
      if (remaining >= leadMs) return 0
      if (remaining <= 0) return 1
      return 1 - remaining / leadMs
    },
  }
}
