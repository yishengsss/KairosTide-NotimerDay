/**
 * Scene clock: the instant the environment is drawn at, plus the season instant.
 *
 * On the homepage this is simply the device clock — the scene shows now, always. Only the preview
 * page drives it differently, which is why the mode is explicit rather than a flag buried in state.
 *
 * The two instants are separate because the fast mode runs them at different rates: the hour moves
 * at 2160× (a day every 40 s) while the seasons move at a year every two minutes, so you can watch
 * spring become autumn without the sun strobing. Rates follow the reference demo's.
 */

import type { RealClock } from './real.ts'

export type SceneSpeed = 'live' | 'day' | 'year'

export const SCENE_SPEEDS: readonly SceneSpeed[] = ['live', 'day', 'year']

export const SPEED_LABEL: Record<SceneSpeed, string> = {
  live: '实时',
  day: '一日',
  year: '一年',
}

const DAY_MS = 86_400_000
const TROPICAL_YEAR_DAYS = 365.2422

/** Scene milliseconds per real millisecond. Live reads the device clock directly and is not scaled. */
const RATE: Record<SceneSpeed, { instant: number; season: number }> = {
  live: { instant: 1, season: 1 },
  day: { instant: 1440, season: 1440 },
  year: { instant: 2160, season: (TROPICAL_YEAR_DAYS * DAY_MS) / 120_000 },
}

/** One solar term; the preview's term-step buttons move by this. */
export const SOLAR_TERM_MS = (TROPICAL_YEAR_DAYS / 24) * DAY_MS

export type SceneClock = {
  /** Instant the environment is drawn at. Equals the device time while following live. */
  instant(): number
  /** Season instant. Equals `instant()` except in the fast mode, where the seasons lead. */
  season(): number
  readonly speed: SceneSpeed
  setSpeed(speed: SceneSpeed): void
  /** Shift both the instant and the season, keeping them together. */
  shift(deltaMs: number): void
  /** Pin both to an exact instant. */
  setInstant(instant: number): void
  /** Return to the device clock and follow it. */
  followNow(): void
  /** Advance by one frame. `deltaMs` is real elapsed time; ignored while live. */
  advance(deltaMs: number): void
}

/** The device's UTC offset at an instant, in milliseconds. */
const zoneOffset = (instant: number): number => new Date(instant).getTimezoneOffset() * 60_000

/**
 * Move an instant onto the season's calendar day while keeping its time of day and zone. Used when
 * leaving the fast mode: the seasons raced ahead of the clock, and jumping back to the clock's own
 * date would make the scenery run backwards.
 */
function alignToSeason(instant: number, season: number): number {
  const dayOf = (ms: number): number => Math.floor((ms - zoneOffset(ms)) / DAY_MS) * DAY_MS
  const timeOfDay = instant - zoneOffset(instant) - dayOf(instant)
  const moved = dayOf(season) + timeOfDay
  return moved + zoneOffset(moved)
}

export function createSceneClock(clock: RealClock, speed: SceneSpeed = 'live'): SceneClock {
  let mode: SceneSpeed = speed
  // Only meaningful away from live; while live both read straight off the device clock.
  let instant = clock.now()
  let season = instant

  return {
    instant() {
      return mode === 'live' ? clock.now() : instant
    },
    season() {
      return mode === 'live' ? clock.now() : season
    },
    get speed() {
      return mode
    },
    setSpeed(next) {
      if (next === mode) return
      if (next === 'live') {
        // Live is the device clock, so going back to it is the same as asking for "now".
        instant = clock.now()
        season = instant
        mode = next
        return
      }
      // Hand the current reading over as the new anchor so the scene never jumps on a speed change.
      const currentInstant = this.instant()
      const currentSeason = this.season()
      // Leaving the fast mode: the seasons had run ahead of the clock, so put the clock on the
      // season's calendar day and keep the time of day. Otherwise the scenery would run backwards.
      instant = mode === 'year' ? alignToSeason(currentInstant, currentSeason) : currentInstant
      season = mode === 'year' ? instant : currentSeason
      mode = next
    },
    shift(deltaMs) {
      instant = this.instant() + deltaMs
      season = this.season() + deltaMs
      // Stepping away from live is implied: a shifted clock can no longer be the device clock.
      if (mode === 'live') mode = 'day'
    },
    setInstant(value) {
      instant = value
      season = value
      if (mode === 'live') mode = 'day'
    },
    followNow() {
      instant = clock.now()
      season = instant
      mode = 'live'
    },
    advance(deltaMs) {
      if (mode === 'live') return
      const rate = RATE[mode]
      instant += deltaMs * rate.instant
      season += deltaMs * rate.season
    },
  }
}
