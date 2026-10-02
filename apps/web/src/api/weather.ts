/**
 * Weather and place search. The supplier's terms are what get normalized here: a report the server
 * could not obtain comes back as `unavailable`, and this module must never turn that into clear sky.
 */

import type { components } from '../../../../contracts/api.d.ts'
import type { Atmosphere, WeatherAvailability } from '../environment/types.ts'
import { getJson, type RequestOptions } from './client.ts'

type SceneWeatherDto = components['schemas']['SceneWeather']
type SceneWeatherValues = components['schemas']['SceneWeatherValues']
type PlaceListDto = components['schemas']['PlaceList']

export type Place = {
  name: string
  latitude: number
  longitude: number
  timezone: string
  country: string | null
  admin1: string | null
}

/** Where the observation came from, for attribution in the place page. */
export type WeatherReport = {
  atmosphere: Atmosphere
  source: string
  attribution: string
  observedAt: number | null
}

const unavailable = (source: string, attribution: string): WeatherReport => ({
  atmosphere: {
    availability: 'unavailable',
    condition: 'unknown',
    cloud: 0,
    rain: 0,
    snow: 0,
    fog: 0,
    wind: 0,
    thunder: false,
    observedAt: null,
  },
  source,
  attribution,
  observedAt: null,
})

function atmosphere(values: SceneWeatherValues, availability: WeatherAvailability,
  observedAt: string | null): Atmosphere {
  return {
    availability,
    condition: values.condition,
    cloud: values.cloud,
    rain: values.rain,
    snow: values.snow,
    fog: values.fog,
    wind: values.wind,
    thunder: values.thunder,
    observedAt,
  }
}

export async function fetchSceneWeather(
  latitude: number,
  longitude: number,
  options: RequestOptions = {},
): Promise<Atmosphere> {
  const report = await fetchWeatherReport(latitude, longitude, options)
  return report.atmosphere
}

/** The full report, including who to credit. The scene only needs `atmosphere`. */
export async function fetchWeatherReport(
  latitude: number,
  longitude: number,
  options: RequestOptions = {},
): Promise<WeatherReport> {
  const query = new URLSearchParams({ lat: latitude.toFixed(4), lon: longitude.toFixed(4) })
  const dto = (await getJson(`/weather/scene?${query.toString()}`, options)) as SceneWeatherDto
  if (dto.availability !== 'available' || !dto.weather) {
    return { ...unavailable(dto.source, dto.attribution), observedAt: dateOrNull(dto.observed_at) }
  }
  return {
    atmosphere: atmosphere(dto.weather, 'available', dto.observed_at),
    source: dto.source,
    attribution: dto.attribution,
    observedAt: dateOrNull(dto.observed_at),
  }
}

export async function fetchPlaces(query: string, options: RequestOptions = {}): Promise<Place[]> {
  const search = new URLSearchParams({ q: query })
  const dto = (await getJson(`/places?${search.toString()}`, options)) as PlaceListDto
  return dto.items.map((item) => ({
    name: item.name,
    latitude: item.latitude,
    longitude: item.longitude,
    timezone: item.timezone,
    country: item.country,
    admin1: item.admin1,
  }))
}

const dateOrNull = (value: string | null): number | null => {
  if (value === null) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}
