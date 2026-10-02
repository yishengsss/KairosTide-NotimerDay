/** Compose location + weather + astronomy into the frame the scene draws. */

import { moonState, norm360, sunLongitude, sunPosition } from '../scene/pastoral/astro.ts'
import type { Atmosphere, EnvironmentFrame, SceneLocation } from './types.ts'

const MOON_TILT = 8

export function hemisphereLongitude(longitude: number, hemisphere: 'north' | 'south'): number {
  return hemisphere === 'south' ? -longitude : longitude
}

export function computeEnvironment(
  location: SceneLocation,
  atmosphere: Atmosphere,
  instant: number,
  season = instant,
): EnvironmentFrame {
  // The southern hemisphere mirrors the sky east–west and reads the season half a year out of phase.
  const mirrored = hemisphereLongitude(location.longitude, location.hemisphere)
  const sun = sunPosition(instant, location.latitude, mirrored, season)
  const moon = moonState(instant, location.latitude, mirrored)
  const solarLongitude = norm360(
    sunLongitude(season) + (location.hemisphere === 'south' ? 180 : 0),
  )
  const sunPoint = sunPosition(instant, location.latitude, mirrored, season)
  return {
    instant,
    season,
    location,
    atmosphere,
    astro: {
      solarLongitude,
      sun: { alt: sun.alt, az: sun.az },
      moon: {
        alt: moon.alt,
        az: moon.az,
        lit: moon.lit,
        angle: Math.atan2(sunPoint.alt - moon.alt, sunPoint.az - moon.az) * (180 / Math.PI) + MOON_TILT,
      },
      accuracy: location.accuracy,
    },
  }
}

export const environmentSeasonFrom = (frame: EnvironmentFrame): number => frame.season
