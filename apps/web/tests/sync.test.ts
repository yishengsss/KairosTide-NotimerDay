import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '../src/api/errors.ts'
import type { Occurrence, ScheduleSnapshot } from '../src/api/schedule.ts'
import type { RealClock } from '../src/clock/real.ts'
import { createScheduleClock } from '../src/clock/schedule.ts'
import { createScheduleStore } from '../src/schedule/store.ts'
import { createSyncEngine, type SyncApi, type SyncDocument, type SyncTimers } from '../src/schedule/sync.ts'

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

/** Timers the test fires by hand, so nothing waits on real time. */
function fakeTimers(): SyncTimers & { run(): void; pending(): number } {
  const queue: (() => void)[] = []
  return {
    set(callback) {
      queue.push(callback)
      return callback
    },
    clear(handle) {
      const index = queue.indexOf(handle as () => void)
      if (index >= 0) queue.splice(index, 1)
    },
    run() {
      const next = queue.shift()
      next?.()
    },
    pending() {
      return queue.length
    },
  }
}

function fakeDocument(): SyncDocument & { setHidden(value: boolean): void } {
  const listeners = new Set<() => void>()
  let hidden = false
  return {
    get hidden() {
      return hidden
    },
    addEventListener(_type, listener) {
      listeners.add(listener)
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener)
    },
    setHidden(value) {
      hidden = value
      for (const listener of listeners) listener()
    },
  }
}

const fakeClock = (value = T0): RealClock => ({ now: () => value })

function harness(api: Partial<SyncApi> = {}, fetchImpl?: () => Promise<ScheduleSnapshot>) {
  const store = createScheduleStore()
  const timers = fakeTimers()
  const document = fakeDocument()
  const calls: string[] = []
  const failures: string[] = []
  const full: SyncApi = {
    fetchState: vi.fn(async () => (fetchImpl ? fetchImpl() : snapshot())),
    acknowledgeReminder: vi.fn(async () => {
      calls.push('ack')
      return { occurrenceId: 'a', occurrenceVersion: 1, acknowledgedAt: T0 }
    }),
    excuseOccurrence: vi.fn(async () => {
      calls.push('excuse')
      return occ({ occurrenceId: 'a', disposition: 'excused' })
    }),
    decideConflict: vi.fn(async () => {
      calls.push('decide')
      return { chosenOccurrenceId: 'a', missedOccurrenceIds: ['b'], stateRevision: 2 }
    }),
    ...api,
  }
  const engine = createSyncEngine({
    store,
    clock: createScheduleClock(fakeClock()),
    api: full,
    timers,
    document,
    onExceptionFailed: (id) => failures.push(id),
  })
  return { store, timers, document, engine, api: full, calls, failures }
}

describe('同步引擎', () => {
  it('启动后立刻拉一次，并校准日程时钟', async () => {
    const { engine, store } = harness({}, async () => snapshot({ serverNow: T0 + 4000 }))
    engine.start()
    await engine.refresh()
    expect(store.calibrated).toBe(true)
    expect(store.snapshot.value?.serverNow).toBe(T0 + 4000)
  })

  it('页面隐藏时不再定时拉取', async () => {
    const { engine, timers, document } = harness()
    engine.start()
    await engine.refresh()
    document.setHidden(true)
    expect(timers.pending()).toBe(0)
  })

  it('回到可见立刻拉取并重新排定计时', async () => {
    const { engine, timers, document, api } = harness()
    engine.start()
    await engine.refresh()
    document.setHidden(true)
    document.setHidden(false)
    await engine.refresh()
    // One at start, one for coming back; the awaited refreshes join those instead of asking again.
    expect(api.fetchState).toHaveBeenCalledTimes(2)
    expect(timers.pending()).toBeGreaterThan(0)
  })

  it('写操作先落到本地，再发出去', async () => {
    const { engine, store, api } = harness()
    engine.start()
    await engine.refresh()
    engine.acknowledge('a', 1)
    expect(store.overlay.ack.a?.version).toBe(1)
    await engine.refresh()
    expect(api.acknowledgeReminder).toHaveBeenCalledWith('a', 1, expect.objectContaining({
      idempotencyKey: expect.stringMatching(/^kairos-/),
    }))
    expect(store.pendingCount('ack')).toBe(0)
  })

  it('网络失败时本地结果保留，下一次同步重试并复用同一个幂等键', async () => {
    let fail = true
    const keys: string[] = []
    const { engine, store } = harness({
      acknowledgeReminder: vi.fn(async (_id, _version, options) => {
        keys.push(options.idempotencyKey ?? '')
        if (fail) throw new ApiError('NETWORK', '网络不可用', 0)
        return { occurrenceId: 'a', occurrenceVersion: 1, acknowledgedAt: T0 }
      }),
    })
    engine.start()
    await engine.refresh()
    engine.acknowledge('a', 1)
    await engine.refresh()
    expect(store.overlay.ack.a?.version).toBe(1)
    expect(store.pendingCount('ack')).toBe(1)
    fail = false
    await engine.refresh()
    expect(store.pendingCount('ack')).toBe(0)
    expect(keys[0]).toBe(keys[1])
  })

  it('例外被拒绝时回滚并通知调用方', async () => {
    const { engine, store, failures } = harness({
      excuseOccurrence: vi.fn(async () => {
        throw new ApiError('CONFLICT', '版本已过期', 409, 'version_mismatch')
      }),
    })
    engine.start()
    await engine.refresh()
    engine.excuse('a', 1)
    expect(store.overlay.excuse.a).toBe(1)
    await engine.refresh()
    // 卡片恢复原样：服务端不接受这次例外，界面不能假装已经请假。
    expect(store.overlay.excuse.a).toBeUndefined()
    expect(store.pendingCount('exception')).toBe(0)
    expect(failures).toEqual(['a'])
  })

  it('确认提醒会重试，重试用尽后交还给服务端裁决', async () => {
    let calls = 0
    const { engine, store } = harness({
      acknowledgeReminder: vi.fn(async () => {
        calls += 1
        throw new ApiError('SERVER', '服务器错误', 500)
      }),
    })
    engine.start()
    await engine.refresh()
    engine.acknowledge('a', 1)
    for (let i = 0; i < 6; i++) await engine.refresh()
    expect(calls).toBe(5)
    expect(store.pendingCount('ack')).toBe(0)
    // 服务端始终没有记下这次确认，本地标记必须让位，让提醒回到屏幕上。
    expect(store.overlay.ack.a).toBeUndefined()
  })

  it('确认提醒在重试期间一直有效，界面不会闪回', async () => {
    let fail = true
    const { engine, store } = harness({
      acknowledgeReminder: vi.fn(async () => {
        if (fail) throw new ApiError('SERVER', '服务器错误', 500)
        return { occurrenceId: 'a', occurrenceVersion: 1, acknowledgedAt: T0 }
      }),
    })
    engine.start()
    await engine.refresh()
    engine.acknowledge('a', 1)
    await engine.refresh()
    expect(store.overlay.ack.a?.version).toBe(1)
    fail = false
    await engine.refresh()
    expect(store.pendingCount('ack')).toBe(0)
    // 送达之后服务端自己就不再把它列进 reminders，本地标记完成使命，可以放下。
  })

  it('拉取进行中发出的写入，会等到带上它的那一轮结束', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    let first = true
    const { engine, calls, api } = harness({}, async () => {
      if (first) {
        first = false
        await gate
      }
      return snapshot()
    })
    engine.start()
    await Promise.resolve()
    await Promise.resolve()
    engine.acknowledge('a', 1)
    expect(calls).toEqual([])
    release?.()
    await engine.refresh()
    expect(calls).toEqual(['ack'])
    expect(api.fetchState).toHaveBeenCalledTimes(2)
  })

  it('冲突决定按快照版本提交', async () => {
    const { engine, api } = harness()
    engine.start()
    await engine.refresh()
    engine.decide(['a', 'b'], 'a', 5)
    await engine.refresh()
    expect(api.decideConflict).toHaveBeenCalledWith(['a', 'b'], 'a', 5, expect.anything())
  })

  it('停止后清理计时器和监听', async () => {
    const { engine, timers, document } = harness()
    engine.start()
    await engine.refresh()
    engine.stop()
    expect(timers.pending()).toBe(0)
    document.setHidden(true)
    expect(timers.pending()).toBe(0)
  })

  it('拉取失败时记下错误，快照保持不变', async () => {
    const { engine, store } = harness({}, async () => {
      throw new ApiError('NETWORK', '网络不可用', 0)
    })
    engine.start()
    await engine.refresh()
    expect(store.lastError.value).toBe('网络不可用')
    expect(store.snapshot.value).toBeNull()
  })
})
