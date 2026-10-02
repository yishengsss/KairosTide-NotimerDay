/** Fetch normalized weather through the api layer. Failure stays unavailable; the scene never fakes sky. */

import { fetchSceneWeather } from '../api/weather.ts'
import type { Atmosphere } from './types.ts'
import { NO_WEATHER } from './types.ts'

export const WEATHER_REFRESH_MS = 10 * 60 * 1000

export type WeatherSource = () => Promise<Atmosphere>

/** A real coordinate only; the timezone estimate must not trigger a request. */
export function weatherSourceFor(
  location: { latitude: number; longitude: number; accuracy: 'precise' | 'approximate' },
): WeatherSource {
  if (location.accuracy === 'approximate') return () => Promise.resolve(NO_WEATHER)
  return async () => {
    const report = await fetchSceneWeather(location.latitude, location.longitude)
    return report
  }
}

/** Keeps at most one in-flight request and refreshes on a slow interval while the page is visible. */
export class WeatherSession {
  private source: WeatherSource
  private cache: Atmosphere = NO_WEATHER
  private fetchedAt = 0
  private inflight: Promise<Atmosphere> | null = null

  constructor(source: WeatherSource) {
    this.source = source
  }

  get current(): Atmosphere {
    return this.cache
  }

  setSource(source: WeatherSource): void {
    this.source = source
    this.fetchedAt = 0
    this.cache = NO_WEATHER
  }

  async refresh(now = Date.now(), force = false): Promise<Atmosphere> {
    if (!force && now - this.fetchedAt < WEATHER_REFRESH_MS && this.fetchedAt !== 0) return this.cache
    if (this.inflight) return this.inflight
    this.inflight = this.source()
      .then((atmosphere) => {
        this.cache = atmosphere
        this.fetchedAt = Date.now()
        return atmosphere
      })
      .catch(() => {
        this.fetchedAt = Date.now()
        this.cache = { ...NO_WEATHER, availability: 'unavailable' }
        return this.cache
      })
      .finally(() => {
        this.inflight = null
      })
    return this.inflight
  }
}
