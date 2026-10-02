/**
 * Pure mapping from (season instant, instant, weather) to everything the renderer and the audio
 * engine need. No DOM, no WebGL: this is the part worth unit-testing.
 *
 * Weather comes only from a real observation. Calendar-based rain/snow/fog probabilities from the
 * demo stay in the preview page.
 */

import { clamp, hash, inTerms, lerp, smooth } from './math.ts'
import type { WeatherAvailability } from '../../environment/types.ts'

export const KEYS = ['lichun', 'chunfen', 'lixia', 'xiazhi', 'liqiu', 'qiufen', 'lidong', 'dongzhi'] as const
export const PHASES = ['day', 'dawn', 'dusk', 'night'] as const
export type SeasonKey = (typeof KEYS)[number]
export type Phase = (typeof PHASES)[number]

/** Foliage fullness and snow cover per key season, in KEYS order. */
export const FOLIAGE = [0.15, 0.85, 1, 1, 1, 0.9, 0.3, 0.05]
export const SNOWY = [0.35, 0, 0, 0, 0, 0, 0, 1]

export type PhenologyChannel =
  | 'frost' | 'petals' | 'leaves' | 'swallows' | 'butterflies' | 'fireflies' | 'geese'
  | 'smoke' | 'aWind' | 'aBirds' | 'aCicada' | 'aFrogs' | 'aCrickets'

export type PastoralInput = {
  seasonMs: number
  instantMs: number
  latitude: number
  longitude: number
  /** Sun and moon altitude/azimuth in degrees, already mirrored for the hemisphere. */
  sun: { alt: number; az: number }
  moon: { alt: number; az: number; lit: number }
  solarLongitude: number
  weather: {
    availability: WeatherAvailability
    rain: number
    snow: number
    fog: number
    cloud: number
    wind: number
    thunder: boolean
  }
  reducedMotion: boolean
}

export type PastoralState = {
  solarLongitude: number
  term: number
  seasonIndex: number
  seasonBlend: number
  currentKey: SeasonKey
  nextKey: SeasonKey
  /** Which twilight image to use: dawn before noon, dusk after. */
  twilight: 'dawn' | 'dusk'
  weights: { day: number; night: number; twilight: number }
  /** 0 at night, 1 in daylight; drives cloud shade, fog colour and star alpha. */
  day: number
  hour: number
  gold: number
  foliage: number
  snowy: number
  pondFrozen: number
  /**
   * Sun and moon reflection on the water: 1 with a real observation, 0.5 while the weather is
   * unknown — a mirror-bright pond would claim a clear sky the scene has no evidence for.
   */
  reflection: number
  /** Weather mapped to on-screen intensity, already neutral when unavailable. */
  weather: {
    rain: number
    snow: number
    fog: number
    cloud: number
    wind: number
    thunder: boolean
    /** Frost is a seasonal ground look, shown only with usable weather and no precipitation. */
    frost: number
  }
  wind: number
  channels: Record<PhenologyChannel, number>
}

const NEUTRAL_TARGETS: Record<PhenologyChannel, number> = {
  frost: 0, petals: 0, leaves: 0, swallows: 0, butterflies: 0, fireflies: 0, geese: 0,
  smoke: 0, aWind: 0, aBirds: 0, aCicada: 0, aFrogs: 0, aCrickets: 0,
}

/** Reflection strength while the weather is unknown. [提案] M1 计划 §1。 */
export const UNKNOWN_WEATHER_REFLECTION = 0.5

/** Neutral weather used when the observation is unavailable or still loading. */
export const NEUTRAL_WEATHER = { rain: 0, snow: 0, fog: 0, cloud: 0, wind: 0, thunder: false }

export type WeatherChannels = typeof NEUTRAL_WEATHER

/**
 * The weather the scene is allowed to show: the real observation, or the neutral value. The engine
 * eases towards this so a change never snaps; the scene never invents weather of its own.
 */
export function weatherTargets(weather: PastoralInput['weather']): WeatherChannels {
  return weather.availability === 'available'
    ? { rain: weather.rain, snow: weather.snow, fog: weather.fog, cloud: weather.cloud,
        wind: weather.wind, thunder: weather.thunder }
    : NEUTRAL_WEATHER
}

export const SEASONAL = (values: readonly number[], index: number, blend: number): number =>
  lerp(values[index] ?? 0, values[(index + 1) % values.length] ?? 0, blend)

export function seasonOf(solarLongitude: number): { term: number; index: number; blend: number } {
  const term = Math.floor(solarLongitude / 15) % 24
  const segment = (((solarLongitude - 315) % 360) + 360) % 360 / 45
  const index = Math.floor(segment) % 8
  return { term, index, blend: smooth(0, 1, segment - Math.floor(segment)) }
}

export function pastoralState(input: PastoralInput): PastoralState {
  const { term, index, blend } = seasonOf(input.solarLongitude)
  const hour = localHour(input.instantMs, input.longitude)
  const sunAlt = input.sun.alt

  const day = smooth(1, 10, sunAlt)
  const night = 1 - smooth(-15, -6, sunAlt)
  const twilight = Math.max(0, 1 - day - night)
  const daywise = smooth(-10, 4, sunAlt)
  const mirrored = input.sun.az > 180 ? input.sun.az - 180 : input.sun.az
  const available = input.weather.availability === 'available'
  const weather = weatherTargets(input.weather)
  const wet = Math.max(weather.rain, weather.snow)
  // Frost is a ground look between 霜降 and 立冬, only in the early morning and only in dry weather.
  const frost = available && wet === 0 && inTerms(term, 14, 16) ? Math.max(0, fogBump(hour, 4.5, 9.5) * 0.9) : 0
  const seasonal = inTerms(term, 15, 21) ? 1.25 : inTerms(term, 11, 14) ? 1.1 : inTerms(term, 6, 9) ? 0.75 : 1
  const channels: Record<PhenologyChannel, number> = {
    ...NEUTRAL_TARGETS,
    frost,
    petals: inTerms(term, 0, 1) ? 1 : 0,
    leaves: inTerms(term, 13, 15) ? 1 : 0,
    swallows: inTerms(term, 0, 11) ? daywise * (1 - wet) : 0,
    butterflies: inTerms(term, 1, 4) ? daywise * (1 - wet) * smooth(8, 25, sunAlt) : 0,
    fireflies: inTerms(term, 6, 10) ? (1 - daywise) * (1 - wet) : 0,
    geese: inTerms(term, 11, 14) ? daywise * (1 - wet) : 0,
    smoke: houseSmoke(hour, inTerms(term, 15, 21)),
    aWind: 0.35 + (inTerms(term, 15, 21) ? 0.35 : 0) + (inTerms(term, 11, 14) ? 0.15 : 0) + wet * 0.2,
    aBirds: inTerms(term, 21, 11)
      ? daywise * (1 - wet) * (0.35 + 0.65 * smooth(25, 0, sunAlt))
      : daywise * 0.1 * (1 - wet),
    aCicada: inTerms(term, 7, 10) ? smooth(20, 45, sunAlt) * (1 - wet) : 0,
    aFrogs: inTerms(term, 3, 9) ? Math.max(1 - daywise, weather.rain * 0.7) : 0,
    aCrickets: inTerms(term, 9, 14) ? (1 - daywise) * (1 - wet) : 0,
  }
  return {
    solarLongitude: input.solarLongitude,
    term,
    seasonIndex: index,
    seasonBlend: blend,
    currentKey: KEYS[index] ?? 'lichun',
    nextKey: KEYS[(index + 1) % KEYS.length] ?? 'chunfen',
    twilight: mirrored < 180 ? 'dawn' : 'dusk',
    weights: { day, night, twilight },
    day: daywise,
    hour,
    gold: clamp(1 - Math.abs(sunAlt - 4) / 9),
    foliage: SEASONAL(FOLIAGE, index, blend),
    snowy: SEASONAL(SNOWY, index, blend),
    pondFrozen: inTerms(term, 17, 20) ? 1 : 0,
    reflection: available ? 1 : UNKNOWN_WEATHER_REFLECTION,
    weather: { ...weather, frost },
    wind: seasonal * (1 + wet * 0.6) * (input.reducedMotion ? 0.5 : 1) * (weather === NEUTRAL_WEATHER
      ? 1
      : clamp(0.75 + weather.wind * 0.6, 0.75, 1.35)),
    channels,
  }
}

const fogBump = (hour: number, start: number, end: number): number => {
  const x = (hour - start) / (end - start)
  return x <= 0 || x >= 1 ? 0 : Math.min(1, Math.min(x, 1 - x) * 6)
}

function houseSmoke(hour: number, cold: boolean): number {
  const peaks = Math.max(
    fogBump(hour, 5.3, 8.2),
    fogBump(hour, 10.8, 12.8) * 0.8,
    fogBump(hour, 16.8, cold ? 22 : 19.8),
  )
  return peaks > 0.15 ? 1 : 0
}

/** Local hour from longitude and UTC instant, so the scene does not depend on the device zone. */
export function localHour(instantMs: number, longitude: number): number {
  const utcHours = (instantMs / 3600000) % 24
  return (utcHours + longitude / 15 + 24) % 24
}

/** Deterministic per-day seed, kept for the preview page's calendar weather only. */
export const calendarSeed = (instantMs: number, longitude: number): number =>
  hash(Math.floor(((instantMs / 3600000 + longitude / 15) % 24 + 24) % 24))
