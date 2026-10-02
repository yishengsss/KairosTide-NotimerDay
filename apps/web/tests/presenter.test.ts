import { describe, expect, it } from 'vitest'

import type { Occurrence, ScheduleSnapshot } from '../src/api/schedule.ts'
import { present, urgencyAt, type Interaction, type Overlay } from '../src/presentation/presenter.ts'

const T0 = Date.parse('2026-10-02T09:00:00Z')

const occ = (patch: Partial<Occurrence> & { occurrenceId: string }): Occurrence => ({
  eventId: `e-${patch.occurrenceId}`,
  title: `事件 ${patch.occurrenceId}`,
  location: null,
  startAt: T0,
  endAt: T0 + 3_600_000,
  version: 1,
  disposition: 'scheduled',
  ...patch,
})

const snapshot = (patch: Partial<ScheduleSnapshot> = {}): ScheduleSnapshot => ({
  serverNow: T0,
  fetchedAt: T0,
  active: [],
  reminders: [],
  conflicts: [],
  stateRevision: 1,
  nextTransitionAt: null,
  reminderLeadSeconds: 300,
  ...patch,
})

const NO_OVERLAY: Overlay = { ack: {}, excuse: {}, chosen: {}, missed: {} }
const NO_INTERACTION: Interaction = { folded: new Set(), unsynced: new Set() }

describe('紧迫度', () => {
  it('提前量之外是 0，到点是 1，中间线性增长', () => {
    const start = T0 + 300_000
    expect(urgencyAt(start, T0, 300)).toBe(0)
    expect(urgencyAt(start, T0 + 150_000, 300)).toBeCloseTo(0.5, 5)
    expect(urgencyAt(start, start, 300)).toBe(1)
    expect(urgencyAt(start, start + 60_000, 300)).toBe(1)
  })

  it('提前量为 0 时不出现除零，只在到点后算紧迫', () => {
    expect(urgencyAt(T0 + 1000, T0, 0)).toBe(0)
    expect(urgencyAt(T0 - 1, T0, 0)).toBe(1)
  })
})

describe('没有快照', () => {
  it('什么都不显示，氛围是自由', () => {
    const view = present(null, NO_OVERLAY, NO_INTERACTION, T0)
    expect(view).toEqual({ mood: 'free', reminder: null, cards: [], conflict: null })
  })
})

describe('提醒', () => {
  const soon = occ({ occurrenceId: 'a', startAt: T0 + 120_000, endAt: T0 + 3_600_000 })
  const later = occ({ occurrenceId: 'b', startAt: T0 + 240_000, endAt: T0 + 3_600_000 })

  it('同时有多条时只显示最早开始的一条', () => {
    const view = present(snapshot({ reminders: [later, soon] }), NO_OVERLAY, NO_INTERACTION, T0)
    expect(view.reminder?.occurrenceId).toBe('a')
    expect(view.reminder?.urgency).toBeCloseTo(0.6, 5)
  })

  it('已经确认过的实例不再提醒', () => {
    const overlay: Overlay = { ...NO_OVERLAY, ack: { a: { version: 1 } } }
    const view = present(snapshot({ reminders: [soon, later] }), overlay, NO_INTERACTION, T0)
    expect(view.reminder?.occurrenceId).toBe('b')
  })

  it('改期后版本变了，旧的确认失效，重新提醒', () => {
    const moved = occ({ occurrenceId: 'a', version: 2, startAt: T0 + 60_000 })
    const overlay: Overlay = { ...NO_OVERLAY, ack: { a: { version: 1 } } }
    const view = present(snapshot({ reminders: [moved] }), overlay, NO_INTERACTION, T0)
    expect(view.reminder?.occurrenceId).toBe('a')
  })

  it('已经开始的实例不再提醒，改为显示卡片', () => {
    const started = occ({ occurrenceId: 'a', startAt: T0 - 60_000, endAt: T0 + 3_600_000 })
    const view = present(snapshot({ reminders: [started], active: [started] }), NO_OVERLAY, NO_INTERACTION, T0)
    expect(view.reminder).toBeNull()
    expect(view.cards.map((card) => card.occurrenceId)).toEqual(['a'])
  })

  it('测试数据里过期很久的提醒不会冒出来', () => {
    const stale = occ({ occurrenceId: 'a', startAt: T0 - 600_000, endAt: T0 + 60_000 })
    const view = present(snapshot({ reminders: [stale], active: [stale] }), NO_OVERLAY, NO_INTERACTION, T0)
    expect(view.reminder).toBeNull()
  })
})

describe('卡片与红圈', () => {
  const running = occ({ occurrenceId: 'a', startAt: T0 - 60_000, endAt: T0 + 3_600_000 })

  it('进行中的事件显示卡片，氛围转为工作', () => {
    const view = present(snapshot({ active: [running] }), NO_OVERLAY, NO_INTERACTION, T0)
    expect(view.mood).toBe('work')
    expect(view.cards[0]?.folded).toBe(false)
  })

  it('收起后是红圈，卡片仍在列表里但标记为 folded', () => {
    const interaction: Interaction = { folded: new Set(['a']), unsynced: new Set() }
    const view = present(snapshot({ active: [running] }), NO_OVERLAY, interaction, T0)
    expect(view.cards[0]?.folded).toBe(true)
  })

  it('提前确认提醒不会让卡片一开始就是红圈', () => {
    const overlay: Overlay = { ...NO_OVERLAY, ack: { a: { version: 1 } } }
    const view = present(snapshot({ active: [running] }), overlay, NO_INTERACTION, T0)
    expect(view.cards[0]?.folded).toBe(false)
  })

  it('已结束的事件立刻散去，不等下一次轮询', () => {
    const over = occ({ occurrenceId: 'a', startAt: T0 - 7_200_000, endAt: T0 - 1000 })
    const view = present(snapshot({ active: [over] }), NO_OVERLAY, NO_INTERACTION, T0)
    expect(view.cards).toHaveLength(0)
    expect(view.mood).toBe('free')
  })

  it('记为例外的实例不显示卡片，也不留红圈', () => {
    const overlay: Overlay = { ...NO_OVERLAY, excuse: { a: 1 } }
    const view = present(snapshot({ active: [running] }), overlay, NO_INTERACTION, T0)
    expect(view.cards).toHaveLength(0)
    expect(view.mood).toBe('free')
  })

  it('服务端已经记为 excused 的实例同样不显示', () => {
    const excused = occ({ occurrenceId: 'a', disposition: 'excused' })
    const view = present(snapshot({ active: [excused] }), NO_OVERLAY, NO_INTERACTION, T0)
    expect(view.cards).toHaveLength(0)
  })

  it('例外没同步时卡片保留并带提示', () => {
    const interaction: Interaction = { folded: new Set(), unsynced: new Set(['a']) }
    const view = present(snapshot({ active: [running] }), NO_OVERLAY, interaction, T0)
    expect(view.cards[0]?.unsynced).toBe(true)
  })
})

describe('冲突', () => {
  const one = occ({ occurrenceId: 'a', startAt: T0 - 60_000, endAt: T0 + 3_600_000 })
  const two = occ({ occurrenceId: 'b', startAt: T0 - 30_000, endAt: T0 + 3_600_000 })

  it('列出冲突事件，由用户选择，成员先不显示卡片', () => {
    const view = present(snapshot({ active: [one, two], conflicts: [['a', 'b']] }), NO_OVERLAY, NO_INTERACTION, T0)
    expect(view.conflict?.options.map((option) => option.occurrenceId)).toEqual(['a', 'b'])
    expect(view.cards).toHaveLength(0)
    // 氛围仍然是工作：确实有事件在进行。
    expect(view.mood).toBe('work')
  })

  it('选择之后冲突消失，选中的显示卡片，没选中的记为错过', () => {
    const overlay: Overlay = { ...NO_OVERLAY, chosen: { 'a|b': 'a' }, missed: { b: true } }
    const view = present(snapshot({ active: [one, two], conflicts: [['a', 'b']] }), overlay, NO_INTERACTION, T0)
    expect(view.conflict).toBeNull()
    expect(view.cards.map((card) => card.occurrenceId)).toEqual(['a'])
  })

  it('成员只剩一个时不再需要选择', () => {
    const overlay: Overlay = { ...NO_OVERLAY, excuse: { b: 1 } }
    const view = present(snapshot({ active: [one, two], conflicts: [['a', 'b']] }), overlay, NO_INTERACTION, T0)
    expect(view.conflict).toBeNull()
    expect(view.cards.map((card) => card.occurrenceId)).toEqual(['a'])
  })

  it('组内成员的顺序不影响判定', () => {
    const overlay: Overlay = { ...NO_OVERLAY, chosen: { 'a|b': 'a' } }
    const view = present(snapshot({ active: [one, two], conflicts: [['b', 'a']] }), overlay, NO_INTERACTION, T0)
    expect(view.conflict).toBeNull()
  })

  it('提交时带的是当前快照版本', () => {
    const view = present(snapshot({ active: [one, two], conflicts: [['a', 'b']], stateRevision: 7 }),
      NO_OVERLAY, NO_INTERACTION, T0)
    expect(view.conflict?.stateRevision).toBe(7)
  })
})
