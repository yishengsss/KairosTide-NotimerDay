/**
 * Asking the device where it is, once, on the way into the homepage.
 *
 * Three rules keep this from becoming a nag: the browser's own prompt is the only UI (the homepage
 * grows no control and no guide card for it), a denial is remembered so the next visit asks nothing,
 * and a position the user chose by hand is never overwritten. Everything here is framework-free and
 * takes its geolocation object as an argument, so the rules are testable without a browser.
 *
 * Coordinates are rounded to two decimals — about a kilometre, far more than a season, a sun
 * altitude or a weather grid cell needs. The browser only offers geolocation in a secure context, so
 * over a plain LAN address nothing is available and the timezone estimate keeps running.
 */

import { makeLocation, saveLocation } from './location.ts'
import type { SceneLocation } from './types.ts'

const DENIED_KEY = 'kairos.geo'
/** `GeolocationPositionError.PERMISSION_DENIED`, by value: the constant lives on the instance. */
const PERMISSION_DENIED = 1
/** Below this the position is not worth a new weather request or a scene recompute. */
const MOVE_THRESHOLD_KM = 5
/** Give the device a few seconds, then carry on with whatever we had. */
const TIMEOUT_MS = 8000
const EARTH_RADIUS_KM = 6371

export type Coordinates = { latitude: number; longitude: number }

/** What `navigator.geolocation` must provide; narrowed so tests can hand in a plain object. */
export type Geolocator = Pick<Geolocation, 'getCurrentPosition'>

export type GeoStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type GeoRead = { ok: true; point: Coordinates } | { ok: false; denied: boolean }

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180

/** Great-circle distance; the caller only compares it with a threshold. */
export function distanceKm(from: Coordinates, to: Coordinates): number {
  const dLat = toRadians(to.latitude - from.latitude)
  const dLon = toRadians(to.longitude - from.longitude)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Two decimals, about 1 km. */
export const round2 = (value: number): number => Math.round(value * 100) / 100

export function wasDenied(storage: GeoStorage = localStorage): boolean {
  try {
    return storage.getItem(DENIED_KEY) === 'denied'
  } catch {
    return false
  }
}

export function rememberDenied(storage: GeoStorage = localStorage): void {
  try {
    storage.setItem(DENIED_KEY, 'denied')
  } catch {
    // Private mode with storage disabled: we simply ask again next time.
  }
}

export function forgetDenial(storage: GeoStorage = localStorage): void {
  try {
    storage.removeItem(DENIED_KEY)
  } catch {
    // Same as above; the flag was never stored.
  }
}

/**
 * One reading. A refusal is reported as `denied` and is the only outcome worth remembering; a
 * timeout or a device without a fix is not a refusal and the next visit may try again.
 */
export function readPosition(geolocator: Geolocator, timeoutMs = TIMEOUT_MS): Promise<GeoRead> {
  return new Promise((resolve) => {
    let settled = false
    const done = (result: GeoRead): void => {
      if (!settled) {
        settled = true
        resolve(result)
      }
    }
    try {
      geolocator.getCurrentPosition(
        (position) => done({
          ok: true,
          point: {
            latitude: round2(position.coords.latitude),
            longitude: round2(position.coords.longitude),
          },
        }),
        (error) => done({ ok: false, denied: error.code === PERMISSION_DENIED }),
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 10 * 60 * 1000 },
      )
    } catch {
      done({ ok: false, denied: false })
    }
  })
}

/** A stored place: the manual choice or a real device fix. The estimate is not a place. */
export function isStoredPlace(location: SceneLocation | null): boolean {
  if (!location) return false
  return location.source === 'chosen' || location.source === 'device'
}

/**
 * Whether a visit should ask for the position at all. Two things stop it: a place the user chose by
 * hand, which always wins, and a denial remembered from an earlier visit. Running on the timezone
 * estimate means nothing was ever stored, so it is worth asking.
 */
export function shouldAsk(current: SceneLocation | null, storage: GeoStorage = localStorage): boolean {
  if (current?.source === 'chosen') return false
  return !wasDenied(storage)
}

/** A stored device position is only worth refreshing when the device has actually moved. */
export function isStale(current: SceneLocation | null, point: Coordinates): boolean {
  if (!current || current.source !== 'device') return true
  return distanceKm({ latitude: current.latitude, longitude: current.longitude }, point) >= MOVE_THRESHOLD_KM
}

export function deviceLocation(point: Coordinates, timezone?: string): SceneLocation {
  return makeLocation({
    latitude: point.latitude,
    longitude: point.longitude,
    timezone: timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    label: '当前位置',
    source: 'device',
  })
}

/**
 * The entry-point call. Returns the location to use, or null when nothing changed and the caller
 * should keep what it has. Never throws and never blocks the scene.
 */
export async function resolveLocationOnEntry(options: {
  current: SceneLocation | null
  /** Absent when the browser has no geolocation at all (insecure context, old browser). */
  geolocator?: Geolocator | null
  storage?: GeoStorage
  timezone?: string
}): Promise<SceneLocation | null> {
  const { current, geolocator, timezone } = options
  const storage = options.storage ?? localStorage
  if (!geolocator || !shouldAsk(isStoredPlace(current) ? current : null, storage)) return null
  const read = await readPosition(geolocator)
  if (!read.ok) {
    if (read.denied) rememberDenied(storage)
    return null
  }
  if (!isStale(isStoredPlace(current) ? current : null, read.point)) return null
  const location = deviceLocation(read.point, timezone)
  saveLocation(location, storage)
  return location
}
