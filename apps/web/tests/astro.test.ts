import { describe, expect, it } from 'vitest'

import { moonState, norm360, sunLongitude, sunPosition } from '../src/scene/pastoral/astro.ts'

/** Beijing, the location the reference demo was tuned against. */
const LAT = 39.9
const LON = 116.4

const utc = (iso: string): number => Date.parse(iso)

describe('太阳位置', () => {
  it('春分前后的太阳黄经落在 0° 附近', () => {
    // 2026-03-20 12:00Z is within hours of the equinox; the low-precision formula is good to ~0.01°.
    const lon = norm360(sunLongitude(utc('2026-03-20T12:00:00Z')))
    expect(lon < 1 || lon > 359).toBe(true)
  })

  it('夏至黄经约 90°，冬至约 270°', () => {
    expect(norm360(sunLongitude(utc('2026-06-21T12:00:00Z')))).toBeGreaterThan(89)
    expect(norm360(sunLongitude(utc('2026-06-21T12:00:00Z')))).toBeLessThan(92)
    expect(norm360(sunLongitude(utc('2026-12-21T12:00:00Z')))).toBeGreaterThan(269)
    expect(norm360(sunLongitude(utc('2026-12-21T12:00:00Z')))).toBeLessThan(272)
  })

  it('正午高度接近 90° − 纬度 + 赤纬', () => {
    const summer = sunPosition(utc('2026-06-21T04:00:00Z'), LAT, LON)
    // Declination ≈ +23.4° at the June solstice → altitude ≈ 90 − 39.9 + 23.4 ≈ 73.5°.
    expect(summer.alt).toBeGreaterThan(68)
    expect(summer.alt).toBeLessThan(78)
    const winter = sunPosition(utc('2026-12-21T04:00:00Z'), LAT, LON)
    // ≈ 90 − 39.9 − 23.4 ≈ 26.7°.
    expect(winter.alt).toBeGreaterThan(21)
    expect(winter.alt).toBeLessThan(32)
  })

  it('中午太阳在南，早晨在东', () => {
    const noon = sunPosition(utc('2026-06-21T04:00:00Z'), LAT, LON)
    expect(noon.az).toBeGreaterThan(150)
    expect(noon.az).toBeLessThan(210)
    const morning = sunPosition(utc('2026-06-21T00:00:00Z'), LAT, LON)
    expect(morning.az).toBeGreaterThan(70)
    expect(morning.az).toBeLessThan(115)
  })

  it('夜里太阳在地平线以下', () => {
    expect(sunPosition(utc('2026-06-21T16:00:00Z'), LAT, LON).alt).toBeLessThan(0)
  })
})

describe('月亮', () => {
  it('朔望周期：新月几乎不反光，满月接近 1', () => {
    // 2026-01-19 is a new moon; 2026-01-03 a full one.
    expect(moonState(utc('2026-01-19T00:00:00Z'), LAT, LON).lit).toBeLessThan(0.06)
    expect(moonState(utc('2026-01-03T00:00:00Z'), LAT, LON).lit).toBeGreaterThan(0.94)
  })

  it('朝向和高度都是有限数', () => {
    const moon = moonState(utc('2026-04-01T20:00:00Z'), LAT, LON)
    for (const value of [moon.alt, moon.az, moon.lit]) expect(Number.isFinite(value)).toBe(true)
    expect(moon.az).toBeGreaterThanOrEqual(0)
    expect(moon.az).toBeLessThanOrEqual(360)
  })
})
