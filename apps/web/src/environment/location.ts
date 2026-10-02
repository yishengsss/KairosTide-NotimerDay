/** Where the scene is: an explicit choice, or a timezone-derived guess. Never auto-locates here. */

import type { SceneLocation } from './types.ts'

const STORAGE_KEY = 'kairos.place'

/** Rough longitude for a UTC offset in hours; 15° per hour, with China kept on its nominal zone. */
const zoneLongitude = (offsetHours: number): number => Math.max(-180, Math.min(180, offsetHours * 15))

function offsetHours(timezone: string, at = new Date()): number {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' })
  const part = formatter.formatToParts(at).find((item) => item.type === 'timeZoneName')?.value ?? 'GMT+0'
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(part)
  if (!match) return 0
  const sign = match[1] === '-' ? -1 : 1
  return sign * (Number(match[2] ?? 0) + Number(match[3] ?? 0) / 60)
}

export function isPlausibleLatitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90
}

export function isPlausibleLongitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180
}

export function makeLocation(input: {
  latitude: number
  longitude: number
  timezone: string
  label: string
  source: 'chosen' | 'device'
}): SceneLocation {
  if (!isPlausibleLatitude(input.latitude) || !isPlausibleLongitude(input.longitude)) {
    throw new Error('latitude or longitude out of range')
  }
  return {
    latitude: input.latitude,
    longitude: input.longitude,
    timezone: input.timezone,
    label: input.label,
    hemisphere: input.latitude < 0 ? 'south' : 'north',
    accuracy: 'precise',
    source: input.source,
  }
}

/** No stored place yet: guess the longitude from the device zone and use 35°N. No network, no prompt. */
export function estimateLocation(timezone = Intl.DateTimeFormat().resolvedOptions().timeZone): SceneLocation {
  const latitude = 35
  return {
    latitude,
    longitude: zoneLongitude(offsetHours(timezone)),
    timezone,
    label: '未设置',
    hemisphere: 'north',
    accuracy: 'approximate',
    source: 'timezone-estimate',
  }
}

export function loadLocation(storage: Pick<Storage, 'getItem'> = localStorage,
  timezone?: string): SceneLocation {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return estimateLocation(timezone)
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return estimateLocation(timezone)
    const record = parsed as Record<string, unknown>
    const { latitude, longitude, timezone: zone, label } = record
    if (!isPlausibleLatitude(latitude) || !isPlausibleLongitude(longitude)) return estimateLocation(timezone)
    return makeLocation({
      latitude,
      longitude,
      timezone: typeof zone === 'string' && zone ? zone : (timezone ?? 'UTC'),
      label: typeof label === 'string' && label ? label : '我的地点',
      source: record.source === 'device' ? 'device' : 'chosen',
    })
  } catch {
    return estimateLocation(timezone)
  }
}

export function saveLocation(location: SceneLocation, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(location))
}

export function clearLocation(storage: Pick<Storage, 'removeItem'> = localStorage): void {
  storage.removeItem(STORAGE_KEY)
}

export const locationStorageKey = STORAGE_KEY
