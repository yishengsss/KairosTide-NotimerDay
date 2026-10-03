/** Flexible tasks on the homepage: the visit rhythm, the shore species, and read failure ≠ empty. */
import { describe, expect, it } from 'vitest'

import { speciesContext, taskSpecies } from '../src/scene/fauna/species.ts'
import type { PastoralState } from '../src/scene/pastoral/model.ts'
import { createMotivation, GAP_MAX_MS, GAP_MIN_MS, HOUR_MS, STAY_MAX_MS } from '../src/tasks/motivation.ts'
import { createTaskStore } from '../src/tasks/store.ts'

const MIN = 60_000

describe('激励节奏', () => {
  it('45 分钟内不出现，空闲时 90 分钟内一定出现，停留不超过 10 分钟', () => {
    const m = createMotivation(0, () => 0.5)
    expect(m.tick(GAP_MIN_MS - 1, true, ['a'])).toEqual([])
    const at = (GAP_MIN_MS + GAP_MAX_MS) / 2
    expect(m.tick(at, true, ['a'])).toEqual(['a'])
    expect(m.tick(at + STAY_MAX_MS, true, ['a'])).toEqual([])
  })

  it('不空闲时不排期，空闲后补上；一小时内最多开始一次', () => {
    const m = createMotivation(0, () => 0)
    expect(m.tick(GAP_MIN_MS, false, ['a'])).toEqual([])
    expect(m.tick(GAP_MIN_MS + MIN, true, ['a'])).toEqual(['a'])
    expect(m.tick(GAP_MIN_MS + MIN + HOUR_MS - 1, true, ['a'])).toEqual([])
  })

  it('暂停或开始后立刻离场', () => {
    const m = createMotivation(0, () => 0)
    expect(m.tick(GAP_MIN_MS, true, ['a', 'b'])).toHaveLength(2)
    m.dismiss('a')
    expect(m.tick(GAP_MIN_MS + 1, true, ['a', 'b'])).toEqual(['b'])
    expect(m.tick(GAP_MIN_MS + 2, true, [])).toEqual([])
  })
})

describe('柔性任务的生灵', () => {
  const ctx = (over: Partial<PastoralState>) => speciesContext({
    day: 1, term: 2, pondFrozen: 0,
    weather: { rain: 0, snow: 0, fog: 0, cloud: 0, wind: 0, thunder: false, frost: 0 }, ...over,
  } as PastoralState)
  it('按季节、昼夜、天气换', () => {
    expect(taskSpecies(ctx({ term: 2 }))).toBe('sparrow')
    expect(taskSpecies(ctx({ term: 8 }))).toBe('cicada')
    expect(taskSpecies(ctx({ term: 14 }))).toBe('squirrel')
    expect(taskSpecies(ctx({ term: 20 }))).toBe('tit')
    expect(taskSpecies(ctx({ term: 8, day: 0 }))).toBe('cricket')
    expect(taskSpecies(ctx({ term: 20, day: 0 }))).toBe('owl')
    expect(taskSpecies(ctx({ weather: { rain: 0.5, snow: 0, fog: 0, cloud: 1, wind: 0, thunder: false, frost: 0 } })))
      .toBe('snail')
  })
})

describe('任务列表', () => {
  it('读取失败和空列表分得开', async () => {
    const failed = createTaskStore({ fetchTasks: () => Promise.reject(new Error('x')), moveTask: () => Promise.reject() })
    await failed.refresh()
    expect(failed.state.status).toBe('failed')
    const empty = createTaskStore({ fetchTasks: async () => [], moveTask: () => Promise.reject() })
    await empty.refresh()
    expect(empty.state.status).toBe('ready')
    expect(empty.state.items).toEqual([])
  })
})
