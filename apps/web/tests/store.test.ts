import { describe, expect, it } from 'vitest'

import type { Occurrence, ScheduleSnapshot } from '../src/api/schedule.ts'
import { conflictKey, createScheduleStore } from '../src/schedule/store.ts'

const T0 = Date.parse('2026-10-02T09:00:00Z')

const occ = (patch: Partial<Occurrence> & { occurrenceId: string }): Occurrence => ({
  eventId: `e-${patch.occurrenceId}`,
  title: patch.occurrenceId,
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

describe('冲突分组标识', () => {
  it('与成员顺序无关', () => {
    expect(conflictKey(['b', 'a'])).toBe(conflictKey(['a', 'b']))
  })

  it('不同组合不同', () => {
    expect(conflictKey(['a', 'b'])).not.toBe(conflictKey(['a', 'c']))
  })
})

describe('本地叠加', () => {
  it('确认提醒立刻生效，写入失败也能保留', () => {
    const store = createScheduleStore()
    store.acknowledge('a', 1, 'key-1')
    expect(store.overlay.ack.a).toEqual({ version: 1, at: expect.any(Number) })
    expect(store.pendingCount('ack')).toBe(1)
  })

  it('实例改期后版本变化，旧的确认被丢弃', () => {
    const store = createScheduleStore()
    store.acknowledge('a', 1, 'key-1')
    store.applySnapshot(snapshot({ reminders: [occ({ occurrenceId: 'a', version: 2 })] }))
    expect(store.overlay.ack.a).toBeUndefined()
  })

  it('版本没变时确认继续有效', () => {
    const store = createScheduleStore()
    store.acknowledge('a', 1, 'key-1')
    store.applySnapshot(snapshot({ reminders: [occ({ occurrenceId: 'a' })] }))
    expect(store.overlay.ack.a).toEqual({ version: 1, at: expect.any(Number) })
  })

  it('服务端已经记为 excused 后，本地标记退场', () => {
    const store = createScheduleStore()
    store.excuse('a', 1, 'key-1')
    store.applySnapshot(snapshot({ active: [occ({ occurrenceId: 'a', disposition: 'excused' })] }))
    expect(store.overlay.excuse.a).toBeUndefined()
  })

  it('本地例外在服务端确认前一直保留', () => {
    const store = createScheduleStore()
    store.excuse('a', 1, 'key-1')
    store.applySnapshot(snapshot({ active: [occ({ occurrenceId: 'a' })] }))
    expect(store.overlay.excuse.a).toBe(1)
  })

  it('选择冲突后同组其余记为错过，且组成员消失时清掉', () => {
    const store = createScheduleStore()
    store.decide(['a', 'b'], 'a', 3, 'key-1')
    expect(store.overlay.chosen[conflictKey(['a', 'b'])]).toBe('a')
    expect(store.overlay.missed.b).toBe(true)
    expect(store.overlay.missed.a).toBeUndefined()
    store.applySnapshot(snapshot({ active: [occ({ occurrenceId: 'a' })] }))
    // b 不在快照里了：本地的错过标记清掉，避免无限增长。
    expect(store.overlay.missed.b).toBeUndefined()
    expect(store.overlay.chosen[conflictKey(['a', 'b'])]).toBeUndefined()
  })
})

describe('待同步队列', () => {
  it('写操作带幂等键，重试复用同一个键', () => {
    const store = createScheduleStore()
    store.acknowledge('a', 1, 'key-1')
    const op = store.pending.value[0]
    expect(op?.key).toBe('key-1')
    // 重试不改键；这是服务端识别重复请求的唯一依据。
    expect(store.pending.value[0]?.key).toBe('key-1')
  })

  it('结算后从队列移除', () => {
    const store = createScheduleStore()
    store.excuse('a', 1, 'key-1')
    const op = store.pending.value[0]
    expect(op).toBeDefined()
    if (op) store.settle(op)
    expect(store.pendingCount('exception')).toBe(0)
  })

  it('回滚把本地改动撤销', () => {
    const store = createScheduleStore()
    store.excuse('a', 1, 'key-1')
    const op = store.pending.value[0]
    if (op) {
      store.settle(op)
      store.rollback(op)
    }
    expect(store.overlay.excuse.a).toBeUndefined()
  })

  it('回滚冲突决定会把同组成员一起放开', () => {
    const store = createScheduleStore()
    store.decide(['a', 'b'], 'a', 1, 'key-1')
    const op = store.pending.value[0]
    if (op) store.rollback(op)
    expect(store.overlay.chosen[conflictKey(['a', 'b'])]).toBeUndefined()
    expect(store.overlay.missed.b).toBeUndefined()
  })

  it('错误状态由同步引擎决定何时清除，快照本身不悄悄清掉它', () => {
    const store = createScheduleStore()
    store.fail('未同步')
    store.applySnapshot(snapshot())
    expect(store.lastError.value).toBe('未同步')
    expect(store.calibrated).toBe(true)
    store.clearError()
    expect(store.lastError.value).toBeNull()
  })

  it('还没发出去的本地标记不会因为快照里没提到就被清掉', () => {
    const store = createScheduleStore()
    store.acknowledge('a', 1, 'key-1')
    // 快照是空的：可能只是该实例不在 active / reminders 窗口内，不能当成服务端否认。
    store.applySnapshot(snapshot())
    expect(store.overlay.ack.a?.version).toBe(1)
  })

  it('已经放弃的本地标记则让位给服务端的事实', () => {
    const store = createScheduleStore()
    store.acknowledge('a', 1, 'key-1')
    const op = store.pending.value[0]
    if (op) store.settle(op)
    store.applySnapshot(snapshot())
    expect(store.overlay.ack.a).toBeUndefined()
  })
})
