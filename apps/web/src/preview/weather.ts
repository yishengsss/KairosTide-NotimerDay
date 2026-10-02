/**
 * Preview-only weather presets. The homepage never imports this: on the homepage, rain, snow and fog
 * come from Open-Meteo and nowhere else.
 */

import { NO_WEATHER, type Atmosphere } from '../environment/types.ts'

export type PreviewWeather = 'live' | 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog' | 'unavailable'

export const PREVIEW_WEATHERS: readonly PreviewWeather[] =
  ['live', 'clear', 'cloudy', 'rain', 'storm', 'snow', 'fog', 'unavailable']

export const WEATHER_LABEL: Record<PreviewWeather, string> = {
  live: '实况',
  clear: '晴',
  cloudy: '多云',
  rain: '雨',
  storm: '雷雨',
  snow: '雪',
  fog: '雾',
  unavailable: '无数据',
}

const observed = (patch: Partial<Atmosphere>): Atmosphere => ({
  ...NO_WEATHER,
  availability: 'available',
  condition: 'clear',
  observedAt: null,
  ...patch,
})

/** `null` means “use the live observation”. */
export function previewAtmosphere(choice: PreviewWeather): Atmosphere | null {
  switch (choice) {
    case 'live':
      return null
    case 'clear':
      return observed({ condition: 'clear', cloud: 0.1, wind: 0.2 })
    case 'cloudy':
      return observed({ condition: 'overcast', cloud: 0.85, wind: 0.35 })
    case 'rain':
      return observed({ condition: 'rain', cloud: 0.95, rain: 0.75, wind: 0.5 })
    case 'storm':
      return observed({ condition: 'thunderstorm', cloud: 1, rain: 0.95, wind: 0.8, thunder: true })
    case 'snow':
      return observed({ condition: 'snow', cloud: 0.9, snow: 0.75, wind: 0.3 })
    case 'fog':
      return observed({ condition: 'fog', cloud: 0.6, fog: 0.85, wind: 0.1 })
    case 'unavailable':
      return { ...NO_WEATHER }
  }
}

export const isPreviewWeather = (value: string | null): value is PreviewWeather =>
  value !== null && (PREVIEW_WEATHERS as readonly string[]).includes(value)
