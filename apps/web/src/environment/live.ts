/**
 * Live environment for a page: a location, a weather session refreshed while visible, and a frame
 * getter the scene reads each animation frame. Framework-free; pages wrap it as they like.
 */

import type { SceneClock } from '../clock/scene.ts'
import { every, type Cancel } from '../ui/delay.ts'
import { computeEnvironment } from './frame.ts'
import { loadLocation } from './location.ts'
import type { Atmosphere, EnvironmentFrame, SceneLocation } from './types.ts'
import { WeatherSession, weatherSourceFor } from './weather.ts'

/** How often to ask the session; it only goes to the network when its own 10-minute cache expires. */
const WEATHER_CHECK_MS = 60_000

export type LiveEnvironment = {
  readonly location: SceneLocation
  readonly atmosphere: Atmosphere
  /** Cheap: pure astronomy over cached location and weather. Safe to call every frame. */
  frame(): EnvironmentFrame
  /**
   * The device reported a new position (the homepage asks once on entry). The scene recomputes from
   * the next frame on, and the weather session is pointed at the new coordinate so the old
   * observation is never shown for the new place.
   */
  setLocation(location: SceneLocation): void
  /** Replace the atmosphere outright; the preview page uses this for its calendar weather. */
  overrideAtmosphere(atmosphere: Atmosphere | null): void
  start(): void
  stop(): void
}

export function createLiveEnvironment(clock: SceneClock, location: SceneLocation = loadLocation()):
  LiveEnvironment {
  const session = new WeatherSession(weatherSourceFor(location))
  let place = location
  let override: Atmosphere | null = null
  let poll: Cancel | null = null

  const atmosphere = (): Atmosphere => override ?? session.current
  const check = (force = false): void => {
    if (typeof document !== 'undefined' && document.hidden) return
    void session.refresh(Date.now(), force)
  }
  const onVisibility = (): void => {
    if (!document.hidden) check()
  }

  return {
    get location() {
      return place
    },
    get atmosphere() {
      return atmosphere()
    },
    frame() {
      return computeEnvironment(place, atmosphere(), clock.instant(), clock.season())
    },
    setLocation(next) {
      place = next
      session.setSource(weatherSourceFor(next))
      check(true)
    },
    overrideAtmosphere(next) {
      override = next
    },
    start() {
      if (poll) return
      check(true)
      poll = every(WEATHER_CHECK_MS, () => check())
      document.addEventListener('visibilitychange', onVisibility)
    },
    stop() {
      poll?.()
      poll = null
      document.removeEventListener('visibilitychange', onVisibility)
    },
  }
}
