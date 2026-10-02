/**
 * The one bridge from the environment dimension to the scene engine. The engine has its own input
 * shape so it can stay framework- and app-agnostic; this is where an `EnvironmentFrame` becomes it.
 */

import type { EnvironmentFrame } from '../environment/types.ts'
import type { PastoralInput } from './pastoral/model.ts'

export function pastoralInput(frame: EnvironmentFrame, reducedMotion = false): PastoralInput {
  const { atmosphere, astro, location } = frame
  return {
    seasonMs: frame.season,
    instantMs: frame.instant,
    latitude: location.latitude,
    longitude: location.longitude,
    sun: { alt: astro.sun.alt, az: astro.sun.az },
    moon: { alt: astro.moon.alt, az: astro.moon.az, lit: astro.moon.lit },
    solarLongitude: astro.solarLongitude,
    weather: {
      availability: atmosphere.availability,
      rain: atmosphere.rain,
      snow: atmosphere.snow,
      fog: atmosphere.fog,
      cloud: atmosphere.cloud,
      wind: atmosphere.wind,
      thunder: atmosphere.thunder,
    },
    reducedMotion,
  }
}

/** Scene mood. `work` is a low-intensity, reversible shift while a rigid event is in progress. */
export type SceneMood = 'free' | 'work'
