/**
 * The residents that stand for "something is under way here".
 *
 * Three things are checked: who may appear (season × hour × weather, and never a butterfly in the
 * rain), that two events at once never get two identical silhouettes, and that arrivals, departures
 * and species changes are gradual rather than popping.
 */
import { describe, expect, it } from 'vitest'

import { createFaunaLayer, FADE_SECONDS, SETTLE_SECONDS } from '../src/scene/fauna/layer.ts'
import { projectMarks } from '../src/scene/fauna/project.ts'
import { candidates, NIGHT_DAY, pickSpecies, SPECIES, speciesContext } from '../src/scene/fauna/species.ts'
import type { PastoralState } from '../src/scene/pastoral/model.ts'

const state = (over: Partial<PastoralState> = {}): PastoralState => ({
  day: 1,
  term: 8,
  pondFrozen: 0,
  weather: { rain: 0, snow: 0, fog: 0, cloud: 0, wind: 0, thunder: false, frost: 0 },
  ...over,
} as PastoralState)

/** A 2D context that records nothing and answers every call; enough to run the layer headless. */
const stub = (): CanvasRenderingContext2D => {
  const noop = (): undefined => undefined
  // The gradient builders return an object you can add stops to, not a plain function.
  const gradient = { addColorStop: noop }
  return new Proxy({} as CanvasRenderingContext2D, {
    get: (_target, key) =>
      typeof key === 'string' && key.startsWith('create') ? () => gradient : noop,
    set: () => true,
  })
}

const context = (over: Partial<PastoralState> = {}) => speciesContext(state(over))

describe('生灵的物候窗口', () => {
  it('结冰时只有白鹤', () => {
    expect(candidates(context({ pondFrozen: 1, day: 1, term: 19 }))).toEqual(['crane'])
    expect(candidates(context({ pondFrozen: 0.9, day: 0, term: 19 }))).toEqual(['crane'])
  })

  it('白天按清明–小满出蝴蝶、芒种–处暑出蜻蜓、白露出白鹭，末位兜底是野鸭', () => {
    expect(candidates(context({ term: 2 }))[0]).toBe('butterfly')
    expect(candidates(context({ term: 7 }))[0]).toBe('dragonfly')
    expect(candidates(context({ term: 13 }))[0]).toBe('egret')
    // 大寒的白天：三样都不在窗口里，只剩野鸭，列表永不为空。
    expect(candidates(context({ term: 20 }))).toEqual(['duck'])
  })

  it('夜间的次序是萤火虫 → 青蛙 → 野鸭', () => {
    expect(candidates(context({ term: 8, day: NIGHT_DAY - 0.01 }))).toEqual(['firefly', 'frog', 'duck'])
    expect(candidates(context({ term: 5, day: 0 }))).toEqual(['frog', 'duck'])
  })

  it('雨雪天蝶、蜻蜓、萤火虫都不出现，只留本来就在水里的', () => {
    const rain = { weather: { rain: 0.4, snow: 0, fog: 0, cloud: 0.6, wind: 0.3, thunder: false, frost: 0 } }
    expect(candidates(context({ term: 2, ...rain }))).toEqual(['duck'])
    expect(candidates(context({ term: 7, ...rain }))).toEqual(['duck'])
    expect(candidates(context({ term: 8, day: 0, ...rain }))).toEqual(['frog', 'duck'])
    const snow = { weather: { rain: 0, snow: 0.5, fog: 0, cloud: 0.7, wind: 0.2, thunder: false, frost: 0 } }
    expect(candidates(context({ term: 13, ...snow }))).toEqual(['egret', 'duck'])
  })

  it('同一时刻两个事件拿到两只不一样的生灵', () => {
    const ctx = context({ term: 8 })
    expect(pickSpecies(ctx, 0)).not.toBe(pickSpecies(ctx, 1))
    // 只有一种可选时用同一个物种；序号超界不越界。
    const winterDay = context({ term: 20 })
    expect(pickSpecies(winterDay, 0)).toBe('duck')
    expect(pickSpecies(winterDay, 5)).toBe('duck')
    expect(SPECIES).toContain(pickSpecies(ctx, 2))
  })
})

describe('生灵的来去与换物种', () => {
  it('入场是渐显的，不是突然出现', () => {
    const fauna = createFaunaLayer()
    fauna.setMarks([{ id: 'a', x: 0, y: 0 }])
    fauna.draw(stub(), { time: 0, day: 1, species: context(), reducedMotion: false }, FADE_SECONDS / 2)
    expect(fauna.residents()[0]?.presence).toBeCloseTo(0.5, 1)
  })

  it('离场后从名单里消失', () => {
    const fauna = createFaunaLayer()
    fauna.setMarks([{ id: 'a', x: 0, y: 0 }])
    fauna.draw(stub(), { time: 0, day: 1, species: context(), reducedMotion: false }, FADE_SECONDS)
    fauna.setMarks([])
    fauna.draw(stub(), { time: 0, day: 1, species: context(), reducedMotion: false }, FADE_SECONDS)
    expect(fauna.residents()).toHaveLength(0)
  })

  it('物种不会因为傍晚的雨时断时续而反复换', () => {
    const fauna = createFaunaLayer()
    const day = context({ term: 8, day: 1 })
    fauna.setMarks([{ id: 'a', x: 0, y: 0 }])
    fauna.draw(stub(), { time: 0, day: 1, species: day, reducedMotion: false }, FADE_SECONDS)
    const dragonfly = fauna.residents()[0]?.species
    // 黄昏：新物种只被"想要"了一小会儿，还不到换的时候。
    const night = context({ term: 8, day: 0 })
    fauna.draw(stub(), { time: 1, day: 0, species: night, reducedMotion: false }, SETTLE_SECONDS / 2)
    expect(fauna.residents()[0]?.species).toBe(dragonfly)
    fauna.draw(stub(), { time: 2, day: 0, species: night, reducedMotion: false }, SETTLE_SECONDS)
    expect(fauna.residents()[0]?.species).toBe('firefly')
  })

  it('减动效时来去是即时的', () => {
    const fauna = createFaunaLayer()
    fauna.setMarks([{ id: 'a', x: 0, y: 0 }])
    fauna.draw(stub(), { time: 0, day: 1, species: context(), reducedMotion: true }, 0.001)
    expect(fauna.residents()[0]?.presence).toBe(1)
  })
})

describe('CSS 像素到 art 像素', () => {
  it('按 dpr、缩放和偏移换算', () => {
    const [mark] = projectMarks([{ id: 'a', x: 100, y: 50 }], { dpr: 2, scale: 2, offsetX: 10, offsetY: 4 })
    expect(mark).toEqual({ id: 'a', x: 95, y: 48 })
  })

  it('缩放为 0 时按 1 处理，不产生 NaN', () => {
    const [mark] = projectMarks([{ id: 'a', x: 3, y: 4 }], { dpr: 1, scale: 0, offsetX: 0, offsetY: 0 })
    expect(mark).toEqual({ id: 'a', x: 3, y: 4 })
  })
})
