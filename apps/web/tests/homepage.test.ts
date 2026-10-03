/**
 * Homepage rules from the M1 plan §5.1:
 *   - the long-press peek reads the device clock and nothing else;
 *   - the homepage carries none of the preview's time or weather controls.
 *
 * The second is checked on the import graph and on the rendered markup of the components the homepage
 * mounts, because mounting the full App needs WebGL, which happy-dom does not have.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

import { formatClockTime, type RealClock } from '../src/clock/real.ts'
import { createLongPress, HOLD_MS, isBlankTarget } from '../src/peek/longPress.ts'
import TimePeek from '../src/peek/TimePeek.vue'
import AmbientControls from '../src/scene/AmbientControls.vue'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src')

/** Every source file reachable from `entry` through relative imports. */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>()
  const queue = [resolve(SRC, entry)]
  const pattern = /(?:import|export)[^'"`]*?from\s*['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]/g
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    for (const match of readFileSync(file, 'utf8').matchAll(pattern)) {
      const spec = match[1] ?? match[2]
      if (spec) queue.push(resolve(dirname(file), spec))
    }
  }
  return seen
}

const relative = (files: Set<string>): string[] => [...files].map((file) => file.slice(SRC.length + 1)).sort()

function mount(component: Parameters<typeof h>[0], props: Record<string, unknown> = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const exposed = ref<Record<string, unknown> | null>(null)
  const app = createApp({ render: () => h(component as never, { ...props, ref: exposed }) })
  app.mount(host)
  return {
    host,
    exposed: () => exposed.value as unknown as { show(p: { x: number; y: number }): void; dismiss(): void },
    unmount: () => {
      app.unmount()
      host.remove()
    },
  }
}

describe('长按查时只读真实时钟', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // The system clock and the injected device clock disagree on purpose.
    vi.setSystemTime(new Date(2026, 0, 1, 3, 3))
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('显示的是注入的设备时钟，而不是任何别的时间', async () => {
    const device = new Date(2026, 9, 2, 14, 37).getTime()
    const clock: RealClock = { now: () => device }
    const view = mount(TimePeek, { clock })
    view.exposed().show({ x: 200, y: 300 })
    await nextTick()
    expect(view.host.textContent?.trim()).toBe(formatClockTime(device))
    expect(view.host.textContent).not.toContain('3:03')
    view.unmount()
  })

  it('三秒后自动消失', async () => {
    const view = mount(TimePeek, { clock: { now: () => 0 } })
    view.exposed().show({ x: 10, y: 10 })
    await nextTick()
    expect(view.host.querySelector('.peek')).not.toBeNull()
    vi.advanceTimersByTime(3000)
    await nextTick()
    // Leave transition keeps the node a moment in a real browser; happy-dom drops it at once or marks it leaving.
    const node = view.host.querySelector('.peek')
    expect(node === null || node.className.includes('leave')).toBe(true)
    view.unmount()
  })

  it('查时组件的依赖里没有日程时钟、场景时钟或服务端数据', () => {
    const files = relative(reachable('peek/TimePeek.vue'))
    expect(files).toContain('clock/real.ts')
    for (const file of files) {
      expect(file).not.toMatch(/^(clock\/(schedule|scene)|schedule\/|api\/|environment\/)/)
    }
  })

  it('按住不动才算长按，移动超出容差或松手都会取消', () => {
    vi.useFakeTimers()
    const held: unknown[] = []
    const press = createLongPress((point) => held.push(point))
    press.down({ x: 0, y: 0 }, true)
    vi.advanceTimersByTime(HOLD_MS - 1)
    expect(held).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(held).toHaveLength(1)

    press.down({ x: 0, y: 0 }, true)
    press.move({ x: 40, y: 0 })
    vi.advanceTimersByTime(HOLD_MS)
    expect(held).toHaveLength(1)

    press.down({ x: 0, y: 0 }, false)
    vi.advanceTimersByTime(HOLD_MS)
    expect(held).toHaveLength(1)
  })

  it('按在按钮或对话框上不算空白处', () => {
    document.body.innerHTML = '<div id="blank"></div><button id="b"><span id="inner"></span></button><div role="dialog"><p id="d"></p></div>'
    expect(isBlankTarget(document.getElementById('blank'))).toBe(true)
    expect(isBlankTarget(document.getElementById('inner'))).toBe(false)
    expect(isBlankTarget(document.getElementById('d'))).toBe(false)
  })
})

describe('首页不包含预览控件', () => {
  it('首页的依赖图里没有 preview/ 和 place/', () => {
    const files = relative(reachable('app/main.ts'))
    expect(files).toContain('app/App.vue')
    expect(files.filter((file) => /^(preview|place)\//.test(file))).toEqual([])
  })

  it('首页源码里没有调速、跳节气、回到现在之类的操作', () => {
    const forbidden = /setSpeed|\bshift\(|setInstant|followNow|speed=|节气|回到现在|暂停|倍速/
    const homepage = relative(reachable('app/main.ts')).filter((file) => file.endsWith('.vue'))
    for (const file of homepage) {
      const template = readFileSync(resolve(SRC, file), 'utf8')
      expect({ file, hit: forbidden.exec(template)?.[0] ?? null }).toEqual({ file, hit: null })
    }
  })

  it('首页常驻控件只有环境音和全屏两个，且环境音默认关闭', async () => {
    // happy-dom has no Fullscreen API; give the document one so both controls render.
    const root = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> }
    const original = root.requestFullscreen
    root.requestFullscreen = () => Promise.resolve()
    const view = mount(AmbientControls, { sound: false })
    await nextTick()
    const labels = [...view.host.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'))
    expect(labels).toEqual(['打开环境音', '全屏'])
    expect(view.host.querySelector('button')?.getAttribute('aria-pressed')).toBe('false')
    view.unmount()
    root.requestFullscreen = original
  })

  it('浏览器不支持全屏时只剩环境音一个控件，不出现失效按钮', async () => {
    const root = document.documentElement as unknown as { requestFullscreen?: unknown }
    const original = root.requestFullscreen
    root.requestFullscreen = undefined
    const view = mount(AmbientControls, { sound: false })
    await nextTick()
    expect([...view.host.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['打开环境音'])
    view.unmount()
    root.requestFullscreen = original
  })
})

describe('事件生灵接入首页', () => {
  const read = (file: string): string => readFileSync(resolve(SRC, file), 'utf8')

  it('助手入口是农舍上的透明按钮，不是第三个常驻控件', () => {
    expect(read('scene/AmbientControls.vue')).not.toMatch(/助手|assistant/i)
    const entry = read('assistant/HouseEntry.vue')
    expect(entry).toMatch(/position: fixed/)
    expect(entry).toMatch(/background: transparent/)
    expect(read('app/App.vue')).toMatch(/<HouseEntry/)
    // The panel is a dialog, so presses inside it never start the time peek.
    expect(read('assistant/AssistantPanel.vue')).toMatch(/role="dialog"/)
  })

  it('事件不再画圆环，EventRing 已删除', () => {
    const layer = read('presentation/ScheduleLayer.vue')
    expect(layer).not.toMatch(/EventRing|name="ring"/)
    expect(() => read('presentation/EventRing.vue')).toThrow()
  })

  it('收起的卡片由场景画生灵，圆环位置只叠一层透明按钮', () => {
    const layer = read('presentation/ScheduleLayer.vue')
    // 卡片收起 = 事件进行中：由 marks 交给场景画，点同一位置重新展开。
    expect(layer).toMatch(/emit\('marks',/)
    expect(layer).toMatch(/<MarkTarget/)
    expect(read('presentation/MarkTarget.vue')).toMatch(/position: fixed/)
    expect(read('presentation/MarkTarget.vue')).toMatch(/background: transparent/)
  })

  it('首页把站位交给场景，场景不知道它是事件', () => {
    expect(read('app/App.vue')).toMatch(/@marks="onMarks"/)
    expect(read('app/App.vue')).toMatch(/engine\?\.setMarks\(\[...eventMarks.value, ...taskMarks.value\]\)/)
    // 业务词汇不得进入 scene/：引擎只认「标记」，不认事件、提醒或日程。注释里说明"不认识"不算。
    const code = read('scene/pastoral/engine.ts')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n')
    expect(code).not.toMatch(/\bevent|\bschedule|occurrence/i)
  })
})
