/**
 * Astronomy for the scene. Meeus low-precision formulas, ported from the 田园四时 demo
 * (`~/Desktop/untitled folder 2/index.html`, ASTRO block) and kept dependency-free so it is unit-testable.
 */

const RAD = Math.PI / 180
export const sind = (d: number): number => Math.sin(d * RAD)
export const cosd = (d: number): number => Math.cos(d * RAD)
export const tand = (d: number): number => Math.tan(d * RAD)
export const norm360 = (d: number): number => ((d % 360) + 360) % 360
const daysJ2000 = (ms: number): number => ms / 864e5 + 2440587.5 - 2451545.0

export type Horizontal = { alt: number; az: number }
export type MoonState = Horizontal & { lit: number; waxing: boolean }

/** Apparent solar longitude in degrees. Solar terms are `floor(lam / 15)`, with 0 = 春分. */
export function sunLongitude(ms: number): number {
  const T = daysJ2000(ms) / 36525
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * sind(M) +
    (0.019993 - 0.000101 * T) * sind(2 * M) +
    0.000289 * sind(3 * M)
  const omega = 125.04 - 1934.136 * T
  return norm360(L0 + C - 0.00569 - 0.00478 * sind(omega))
}

export function moonEcliptic(ms: number): { lam: number; beta: number } {
  const T = daysJ2000(ms) / 36525
  const lam =
    218.32 +
    481267.881 * T +
    6.29 * sind(135.0 + 477198.87 * T) -
    1.27 * sind(259.3 - 413335.36 * T) +
    0.66 * sind(235.7 + 890534.22 * T) +
    0.21 * sind(269.9 + 954397.74 * T) -
    0.19 * sind(357.5 + 35999.05 * T) -
    0.11 * sind(186.5 + 966404.03 * T)
  const beta =
    5.13 * sind(93.3 + 483202.02 * T) +
    0.28 * sind(228.2 + 960400.89 * T) -
    0.28 * sind(318.3 + 6003.15 * T) -
    0.17 * sind(217.6 - 407332.21 * T)
  return { lam: norm360(lam), beta }
}

/** Equatorial → horizontal. Azimuth runs from north toward east. */
export function equatorialToHorizontal(ms: number, ra: number, dec: number, lat: number, lon: number): Horizontal {
  const lha = norm360(280.46061837 + 360.98564736629 * daysJ2000(ms) + lon - ra)
  const alt = Math.asin(sind(lat) * sind(dec) + cosd(lat) * cosd(dec) * cosd(lha)) / RAD
  const az = norm360(Math.atan2(sind(lha), cosd(lha) * sind(lat) - tand(dec) * cosd(lat)) / RAD + 180)
  return { alt, az }
}

export const obliquity = (ms: number): number => 23.4393 - 0.013 * (daysJ2000(ms) / 36525)

export function horizontal(ms: number, lam: number, beta: number, lat: number, lon: number): Horizontal {
  const eps = obliquity(ms)
  const ra = Math.atan2(sind(lam) * cosd(eps) - tand(beta) * sind(eps), cosd(lam)) / RAD
  const dec = Math.asin(sind(beta) * cosd(eps) + cosd(beta) * sind(eps) * sind(lam)) / RAD
  return equatorialToHorizontal(ms, ra, dec, lat, lon)
}

/**
 * Sun position. `seasonMs` only sets declination, so an accelerated season clock and the hour
 * angle advance independently and both stay continuous.
 */
export function sunPosition(ms: number, lat: number, lon: number, seasonMs: number = ms): Horizontal {
  const eps = obliquity(ms)
  const lam = sunLongitude(ms)
  const ra = Math.atan2(sind(lam) * cosd(eps), cosd(lam)) / RAD
  const dec = Math.asin(sind(obliquity(seasonMs)) * sind(sunLongitude(seasonMs))) / RAD
  return equatorialToHorizontal(ms, ra, dec, lat, lon)
}

export function moonState(ms: number, lat: number, lon: number): MoonState {
  const m = moonEcliptic(ms)
  const elong = norm360(m.lam - sunLongitude(ms))
  const pos = horizontal(ms, m.lam, m.beta, lat, lon)
  return { alt: pos.alt, az: pos.az, lit: (1 - cosd(elong)) / 2, waxing: elong < 180 }
}
