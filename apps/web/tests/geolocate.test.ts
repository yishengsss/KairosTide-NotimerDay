/**
 * Location on the way into the homepage (plan §2.1): ask once when nothing is stored, remember a
 * refusal, never overwrite a place the user chose, skip the refresh when the device has not moved,
 * and never touch the coordinate precision.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  deviceLocation, distanceKm, forgetDenial, isStale, readPosition, rememberDenied,
  resolveLocationOnEntry, round2, shouldAsk, wasDenied, type Geolocator,
} from '../src/environment/geolocate.ts'
import { estimateLocation, loadLocation } from '../src/environment/location.ts'
import type { SceneLocation } from '../src/environment/types.ts'

const memory = (): Storage => {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage
}

const chosen: SceneLocation = {
  latitude: 34.34, longitude: 108.94, timezone: 'Asia/Shanghai', label: '西安', hemisphere: 'north',
  accuracy: 'precise', source: 'chosen',
}

const device: SceneLocation = { ...chosen, label: '当前位置', source: 'device' }

/** A geolocator that answers with a fixed point, or with a failure code. */
const geolocator = (point: { latitude: number; longitude: number } | number): Geolocator => ({
  getCurrentPosition: ((ok: PositionCallback, fail?: PositionErrorCallback) => {
    if (typeof point === 'number') {
      fail?.({ code: point } as GeolocationPositionError)
      return
    }
    ok({ coords: point } as GeolocationPosition)
  }) as Geolocation['getCurrentPosition'],
})

describe('取地点', () => {
  it('没有存过地点时请求一次，成功就存成 device 并保留两位小数', async () => {
    const storage = memory()
    const found = await resolveLocationOnEntry({
      current: loadLocation(storage, 'Asia/Shanghai'),
      geolocator: geolocator({ latitude: 34.341_234, longitude: 108.939_876 }),
      storage,
      timezone: 'Asia/Shanghai',
    })
    expect(found?.source).toBe('device')
    expect(found?.label).toBe('当前位置')
    expect(found?.latitude).toBe(34.34)
    expect(found?.longitude).toBe(108.94)
    expect(loadLocation(storage).latitude).toBe(34.34)
  })

  it('拒绝后在本地记下，之后不再问', async () => {
    const storage = memory()
    const locator = geolocator(1) // PERMISSION_DENIED
    const spy = vi.spyOn(locator, 'getCurrentPosition')
    expect(await resolveLocationOnEntry({ current: null, geolocator: locator, storage })).toBeNull()
    expect(wasDenied(storage)).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    // 第二次进入：连问都不问。
    expect(await resolveLocationOnEntry({ current: null, geolocator: locator, storage })).toBeNull()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('超时或没有定位不算拒绝，下次进入还会再试', async () => {
    const storage = memory()
    const locator = geolocator(3) // TIMEOUT
    expect(await resolveLocationOnEntry({ current: null, geolocator: locator, storage })).toBeNull()
    expect(wasDenied(storage)).toBe(false)
    expect(shouldAsk(null, storage)).toBe(true)
  })

  it('手选的地点优先，首页不覆盖它', async () => {
    const storage = memory()
    const locator = geolocator({ latitude: 1, longitude: 2 })
    const spy = vi.spyOn(locator, 'getCurrentPosition')
    expect(await resolveLocationOnEntry({ current: chosen, geolocator: locator, storage })).toBeNull()
    expect(spy).not.toHaveBeenCalled()
    expect(shouldAsk(chosen)).toBe(false)
  })

  it('移动不到 5 km 不替换，超过才替换', () => {
    const here = { latitude: 34.34, longitude: 108.94 }
    expect(distanceKm(here, { latitude: 34.35, longitude: 108.94 })).toBeLessThan(5)
    expect(isStale(device, { latitude: 34.35, longitude: 108.94 })).toBe(false)
    expect(isStale(device, { latitude: 34.48, longitude: 108.94 })).toBe(true)
    // 还没有存过、或存的是估算值，第一次拿到的位置就该用上。
    expect(isStale(null, here)).toBe(true)
    expect(isStale(estimateLocation('Asia/Shanghai'), here)).toBe(true)
  })

  it('已经用设备定位存过时，没移动就不重复写入', async () => {
    const storage = memory()
    const found = await resolveLocationOnEntry({
      current: device, geolocator: geolocator({ latitude: 34.34, longitude: 108.94 }), storage,
    })
    expect(found).toBeNull()
  })

  it('设备不支持定位时安静地保持估算', async () => {
    expect(await resolveLocationOnEntry({ current: null, geolocator: null, storage: memory() })).toBeNull()
  })

  it('拒绝标记可以清除（用户在设置页主动授权后）', () => {
    const storage = memory()
    rememberDenied(storage)
    expect(shouldAsk(null, storage)).toBe(false)
    expect(shouldAsk(chosen, storage)).toBe(false)
    forgetDenial(storage)
    expect(wasDenied(storage)).toBe(false)
    expect(shouldAsk(null, storage)).toBe(true)
  })
})

describe('读取位置的细节', () => {
  it('getCurrentPosition 抛异常时返回失败而不是抛出', async () => {
    const broken: Geolocator = {
      getCurrentPosition: () => {
        throw new Error('insecure context')
      },
    }
    expect(await readPosition(broken)).toEqual({ ok: false, denied: false })
  })

  it('两位数取整', () => {
    expect(round2(34.341_9)).toBe(34.34)
    expect(round2(108.939_876)).toBe(108.94)
    expect(round2(-34.341_9)).toBe(-34.34)
    expect(round2(0.004)).toBe(0)
  })

  it('设备时区是默认时区', () => {
    expect(deviceLocation({ latitude: 1, longitude: 2 }).timezone)
      .toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })
})
