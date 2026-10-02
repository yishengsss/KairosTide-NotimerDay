import { describe, expect, it } from 'vitest'

import { KEYS, NEUTRAL_WEATHER, UNKNOWN_WEATHER_REFLECTION, pastoralState, seasonOf, weatherTargets,
  type PastoralInput }
  from '../src/scene/pastoral/model.ts'

const base: PastoralInput = {
  seasonMs: Date.parse('2026-06-21T04:00:00Z'),
  instantMs: Date.parse('2026-06-21T04:00:00Z'),
  latitude: 39.9,
  longitude: 116.4,
  sun: { alt: 70, az: 180 },
  moon: { alt: -20, az: 300, lit: 0.5 },
  solarLongitude: 90,
  weather: { availability: 'available', rain: 0, snow: 0, fog: 0, cloud: 0.2, wind: 0.3, thunder: false },
  reducedMotion: false,
}

describe('节气索引', () => {
  it('八个节气图在黄经上均匀分布', () => {
    // 315° is 立春, the start of the eight-key cycle.
    expect(KEYS[seasonOf(315).index]).toBe('lichun')
    expect(KEYS[seasonOf(0).index]).toBe('chunfen')
    expect(KEYS[seasonOf(90).index]).toBe('xiazhi')
    expect(KEYS[seasonOf(180).index]).toBe('qiufen')
    expect(KEYS[seasonOf(270).index]).toBe('dongzhi')
  })

  it('黄经跨越 360° 时索引回到 0，不出现负值', () => {
    for (const lon of [-45, 0, 314, 315, 359.9, 360, 720 + 45]) {
      const { index, blend } = seasonOf(lon)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(8)
      expect(blend).toBeGreaterThanOrEqual(0)
      expect(blend).toBeLessThanOrEqual(1)
    }
  })

  it('混合权重在节气中点上取 0.5 附近', () => {
    const middle = seasonOf(315 + 22.5)
    expect(middle.blend).toBeGreaterThan(0.4)
    expect(middle.blend).toBeLessThan(0.6)
  })
})

describe('外观', () => {
  it('夏至是白天，冬至的同一 UTC 时刻是夜里', () => {
    const summer = pastoralState({ ...base, solarLongitude: 90 })
    expect(summer.weights.day).toBe(1)
    const winterNight = pastoralState({ ...base, solarLongitude: 270, sun: { alt: -30, az: 20 } })
    expect(winterNight.weights.night).toBe(1)
  })

  // `term` is `floor(solarLongitude / 15) % 24`, so term 0 is 春分 (0°) and 立春 is term 21 (315°).
  it('物候通道跟着节气走：春分有花瓣，秋季有落叶，盛夏有蝉', () => {
    expect(pastoralState({ ...base, solarLongitude: 10 }).channels.petals).toBe(1)
    expect(pastoralState({ ...base, solarLongitude: 200 }).channels.leaves).toBe(1)
    expect(pastoralState({ ...base, solarLongitude: 105 }).channels.aCicada).toBeGreaterThan(0)
  })

  it('立春的黄经取的是立春那张图，不是冬至', () => {
    // 315° 是这个八时段循环的起点。
    expect(pastoralState({ ...base, solarLongitude: 315 }).currentKey).toBe('lichun')
  })

  it('冬天池塘结冰，其他季节不结冰', () => {
    expect(pastoralState({ ...base, solarLongitude: 285, sun: { alt: -10, az: 30 } }).pondFrozen).toBe(1)
    expect(pastoralState({ ...base, solarLongitude: 90 }).pondFrozen).toBe(0)
  })

  it('南半球由调用方把黄经加 180° 后再传入，这里只认黄经', () => {
    const north = pastoralState({ ...base, solarLongitude: 90 })
    const south = pastoralState({ ...base, solarLongitude: 270 })
    expect(north.foliage).not.toBe(south.foliage)
  })
})

describe('天气映射', () => {
  it('天气不可用时全部归零，只剩中性的风', () => {
    const targets = weatherTargets({ ...base.weather, availability: 'unavailable', rain: 0.9, fog: 0.8 })
    expect(targets).toEqual(NEUTRAL_WEATHER)
    const state = pastoralState({ ...base, weather: { ...base.weather, availability: 'unavailable', rain: 0.9 } })
    expect(state.weather.rain).toBe(0)
    expect(state.weather.fog).toBe(0)
    expect(state.weather.thunder).toBe(false)
  })

  it('天气不可用时日月水面反光减半，不假装晴天', () => {
    const known = pastoralState(base)
    const unknown = pastoralState({ ...base, weather: { ...base.weather, availability: 'unavailable' } })
    expect(known.reflection).toBe(1)
    expect(unknown.reflection).toBe(UNKNOWN_WEATHER_REFLECTION)
    expect(UNKNOWN_WEATHER_REFLECTION).toBe(0.5)
  })

  it('可用时原样透传，不放大也不衰减', () => {
    const targets = weatherTargets({ ...base.weather, rain: 0.42, fog: 0.17, thunder: true })
    expect(targets.rain).toBe(0.42)
    expect(targets.fog).toBe(0.17)
    expect(targets.thunder).toBe(true)
  })

  it('下雨下雪时没有霜，天气不可用时也没有霜', () => {
    // 霜降 (term 17–18) 的清晨：黄经 210° 左右。
    const morning = { ...base, solarLongitude: 212, instantMs: Date.parse('2026-10-24T22:00:00Z') }
    const dry = pastoralState({ ...morning, sun: { alt: -8, az: 95 } })
    const wet = pastoralState({ ...morning, sun: { alt: -8, az: 95 },
      weather: { ...base.weather, rain: 0.5 } })
    const unknown = pastoralState({ ...morning, sun: { alt: -8, az: 95 },
      weather: { ...base.weather, availability: 'unavailable' } })
    expect(dry.weather.frost).toBeGreaterThan(0)
    expect(wet.weather.frost).toBe(0)
    expect(unknown.weather.frost).toBe(0)
  })

  it('减少动态时画面仍然成立，只是风更小', () => {
    const calm = pastoralState({ ...base, reducedMotion: true })
    const normal = pastoralState({ ...base, reducedMotion: false })
    expect(calm.wind).toBeLessThan(normal.wind)
    expect(calm.wind).toBeGreaterThan(0)
  })
})
