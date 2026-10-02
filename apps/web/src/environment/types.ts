/** The one shape the scene consumes. Environment never reads business state. */

export type Hemisphere = 'north' | 'south'

export type SceneLocationSource = 'chosen' | 'device' | 'timezone-estimate'

export type SceneLocation = {
  latitude: number
  longitude: number
  timezone: string
  label: string
  hemisphere: Hemisphere
  /** `precise` when the user chose or granted a real position, `approximate` for the timezone guess. */
  accuracy: 'precise' | 'approximate'
  source: SceneLocationSource
}

export type WeatherAvailability = 'available' | 'unavailable' | 'loading'

/** Normalized weather. Everything here comes from a real observation, never from the calendar. */
export type Atmosphere = {
  availability: WeatherAvailability
  condition: 'clear' | 'partly_cloudy' | 'overcast' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunderstorm' | 'unknown'
  cloud: number
  rain: number
  snow: number
  fog: number
  wind: number
  thunder: boolean
  observedAt: string | null
}

export type AstroFrame = {
  solarLongitude: number
  sun: { alt: number; az: number }
  moon: { alt: number; az: number; lit: number; angle: number }
  accuracy: 'precise' | 'approximate'
}

export type EnvironmentFrame = {
  /** Real instant, milliseconds since epoch. Drives the hour and the sky bodies. */
  instant: number
  /** Season instant, milliseconds. Equals `instant` on the homepage; the preview page can override it. */
  season: number
  location: SceneLocation
  atmosphere: Atmosphere
  astro: AstroFrame
}

export const NO_WEATHER: Atmosphere = {
  availability: 'unavailable',
  condition: 'unknown',
  cloud: 0,
  rain: 0,
  snow: 0,
  fog: 0,
  wind: 0,
  thunder: false,
  observedAt: null,
}
