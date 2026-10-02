import { describe, expect, it } from 'vitest'

import { formatClockDate, formatClockTime, type RealClock } from '../src/clock/real.ts'
import { createSceneClock, SOLAR_TERM_MS } from '../src/clock/scene.ts'
import { createScheduleClock } from '../src/clock/schedule.ts'

/** A clock the test moves by hand. */
function fakeClock(start: number): RealClock & { set(value: number): void; advance(ms: number): void } {
  let value = start
  return {
    now: () => value,
    set(next) {
      value = next
    },
    advance(ms) {
      value += ms
    },
  }
}

const NOON = Date.parse('2026-10-02T04:00:00Z')

describe('真实时钟', () => {
  it('时间不掉零，分钟补零', () => {
    // 本地时区由 happy-dom 决定，这里只断言格式：H:MM 或 HH:MM。
    const text = formatClockTime(NOON)
    expect(text).toMatch(/^\d{1,2}:[0-5]\d$/)
  })

  it('日期写成中文，星期是汉字', () => {
    expect(formatClockDate(NOON)).toMatch(/^\d{4}年\d{1,2}月\d{1,2}日 星期[日一二三四五六]$/)
  })
})

describe('场景时钟', () => {
  it('实时模式下逐帧读设备时间，不做累加', () => {
    const device = fakeClock(NOON)
    const clock = createSceneClock(device)
    device.advance(5000)
    expect(clock.instant()).toBe(NOON + 5000)
    clock.advance(16)
    expect(clock.instant()).toBe(NOON + 5000)
  })

  it('“一日”档一分钟走完一天，季节同步推进', () => {
    const device = fakeClock(NOON)
    const clock = createSceneClock(device)
    clock.setSpeed('day')
    // 1440 倍速：60 秒真实时间 = 一整天场景时间；此时设备时间不动也不影响。
    for (let i = 0; i < 60; i++) clock.advance(1000)
    expect(clock.instant() - NOON).toBeCloseTo(86_400_000, 0)
    expect(clock.season()).toBeCloseTo(clock.instant(), 0)
  })

  it('“一年”档时辰与季节用不同倍率，季节走的更快', () => {
    const device = fakeClock(NOON)
    const clock = createSceneClock(device)
    clock.setSpeed('year')
    for (let i = 0; i < 120; i++) clock.advance(1000)
    // 两分钟真实时间 = 一年季节时间，同时时辰走了 40 天。
    expect(clock.season() - NOON).toBeCloseTo(365.2422 * 86_400_000, -5)
    expect(clock.instant() - NOON).toBeCloseTo(2160 * 120_000, -3)
  })

  it('离开“一年”档时按季节日期对齐，画面不会倒退', () => {
    const device = fakeClock(NOON)
    const clock = createSceneClock(device)
    clock.setSpeed('year')
    for (let i = 0; i < 60; i++) clock.advance(1000)
    const season = clock.season()
    const instant = clock.instant()
    clock.setSpeed('day')
    // 季节停在同一个日历日（最多差一天），没有退回到设备时钟的日期；时辰保留离开前的那一刻。
    expect(Math.abs(clock.season() - season)).toBeLessThan(86_400_000)
    const timeOfDay = (ms: number): number => (((ms - NOON) % 86_400_000) + 86_400_000) % 86_400_000
    expect(timeOfDay(clock.instant())).toBe(timeOfDay(instant))
    expect(clock.instant()).toBe(clock.season())
  })

  it('回到“实时”就是回到设备时钟此刻', () => {
    const device = fakeClock(NOON)
    const clock = createSceneClock(device)
    clock.setSpeed('year')
    clock.advance(60_000)
    device.advance(1000)
    clock.setSpeed('live')
    expect(clock.speed).toBe('live')
    expect(clock.instant()).toBe(NOON + 1000)
    expect(clock.season()).toBe(NOON + 1000)
  })

  it('切换倍率不会让画面跳动', () => {
    const device = fakeClock(NOON)
    const clock = createSceneClock(device)
    device.advance(3000)
    clock.setSpeed('year')
    expect(clock.instant()).toBe(NOON + 3000)
    expect(clock.speed).toBe('year')
  })

  it('节气步进走的是黄经而不是日历月', () => {
    expect(SOLAR_TERM_MS).toBeCloseTo((365.2422 / 24) * 86_400_000, 0)
  })

  it('回此刻重新跟随设备', () => {
    const device = fakeClock(NOON)
    const clock = createSceneClock(device)
    clock.shift(SOLAR_TERM_MS)
    expect(clock.speed).not.toBe('live')
    device.advance(2000)
    clock.followNow()
    expect(clock.speed).toBe('live')
    expect(clock.instant()).toBe(NOON + 2000)
  })
})

describe('日程时钟', () => {
  it('未校准前偏移为 0，且标记未同步', () => {
    const clock = createScheduleClock(fakeClock(NOON))
    expect(clock.offset()).toBe(0)
    expect(clock.synced).toBe(false)
    expect(clock.now()).toBe(NOON)
  })

  it('用 server_now 与本地接收时刻之差校准', () => {
    const device = fakeClock(NOON)
    const clock = createScheduleClock(device)
    clock.calibrate({ serverNow: NOON + 7000, fetchedAt: NOON })
    expect(clock.offset()).toBe(7000)
    expect(clock.now()).toBe(NOON + 7000)
    device.advance(1000)
    expect(clock.now()).toBe(NOON + 8000)
  })

  it('离谱的偏差被忽略，宁可相信设备时钟', () => {
    const clock = createScheduleClock(fakeClock(NOON))
    clock.calibrate({ serverNow: NaN, fetchedAt: NOON })
    clock.calibrate({ serverNow: NOON + 40 * 86_400_000, fetchedAt: NOON })
    expect(clock.offset()).toBe(0)
    expect(clock.synced).toBe(false)
  })

  it('紧迫度与 presenter 的口径一致', () => {
    const clock = createScheduleClock(fakeClock(NOON))
    const start = NOON + 300_000
    expect(clock.urgency(start, 300)).toBe(0)
    expect(clock.urgency(start - 150_000, 300)).toBeCloseTo(0.5, 5)
    expect(clock.urgency(NOON, 300)).toBe(1)
  })

  it('到目标时刻的剩余时间可以为负', () => {
    const clock = createScheduleClock(fakeClock(NOON))
    expect(clock.until(NOON - 5000)).toBe(-5000)
  })
})
