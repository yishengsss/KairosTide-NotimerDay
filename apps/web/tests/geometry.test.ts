import { describe, expect, it } from 'vitest'

import { POND, W, coverFit, skyXY, waterRegion } from '../src/scene/pastoral/geometry.ts'
import { layoutMarks, controlsBox } from '../src/presentation/markLayout.ts'

const viewports = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 2560, height: 1440 },
]

describe('cover-fit', () => {
  it('铺满视口且居中，不裁掉短边', () => {
    for (const viewport of viewports) {
      const fit = coverFit(viewport.width, viewport.height)
      expect(W * fit.scale).toBeGreaterThanOrEqual(viewport.width - 1e-6)
      expect(1024 * fit.scale).toBeGreaterThanOrEqual(viewport.height - 1e-6)
    }
  })

  it('天空位置在画面内', () => {
    const point = skyXY(90, 180)
    expect(point.y).toBeLessThan(100)
    const low = skyXY(0, 90)
    expect(low.y).toBeCloseTo(368, 5)
  })
})

describe('池塘区域', () => {
  it('池塘中心在区域内，岸上的点不在', () => {
    for (const viewport of viewports) {
      const region = waterRegion(viewport)
      const top = region.topAt(viewport.width / 2)
      const bottom = region.bottomAt(viewport.width / 2)
      expect(top).not.toBeNull()
      expect(bottom).not.toBeNull()
      const middle = ((top ?? 0) + (bottom ?? 0)) / 2
      expect(region.contains(viewport.width / 2, middle, 4)).toBe(true)
      // 高处是山和稻田，不是水。
      expect(region.contains(viewport.width / 2, viewport.height * 0.1, 4)).toBe(false)
    }
  })

  it('半径过大时即使圆心在水里也不算', () => {
    const region = waterRegion({ width: 1440, height: 900 })
    const top = region.topAt(720) ?? 0
    const bottom = region.bottomAt(720) ?? 0
    const middle = (top + bottom) / 2
    const tall = (bottom - top) / 2 + 50
    expect(region.contains(720, middle, 4)).toBe(true)
    expect(region.contains(720, middle, tall)).toBe(false)
  })

  it('竖屏时池塘仍然可达', () => {
    const region = waterRegion({ width: 390, height: 844 })
    const bounds = POND.map(([, y]) => y)
    expect(bounds.length).toBeGreaterThan(0)
    const top = region.topAt(195) ?? 0
    const bottom = region.bottomAt(195) ?? 0
    expect(bottom).toBeGreaterThan(top)
  })
})

describe('居民站位布局', () => {
  it('站位落在水面里，且避开底部控件', () => {
    const viewport = { width: 1440, height: 900 }
    const region = waterRegion(viewport)
    const spots = layoutMarks(region, 2, { radius: 15, avoid: [controlsBox(viewport)] })
    for (const spot of spots) {
      expect(spot).not.toBeNull()
      if (!spot) continue
      expect(region.contains(spot.x, spot.y, 15)).toBe(true)
      expect(spot.y).toBeLessThan(controlsBox(viewport).top - 15)
    }
  })

  it('两个站位之间留出间隔', () => {
    const viewport = { width: 1440, height: 900 }
    const spots = layoutMarks(waterRegion(viewport), 2, { radius: 15, avoid: [] })
    const [first, second] = spots
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    if (first && second) expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThan(30)
  })

  it('没有位置时返回 null，但数量与请求一致', () => {
    const region = waterRegion({ width: 200, height: 200 })
    const spots = layoutMarks(region, 3, { radius: 15, avoid: [{ left: 0, top: 0, right: 200, bottom: 200 }] })
    expect(spots).toHaveLength(3)
    expect(spots.every((spot) => spot === null)).toBe(true)
  })
})
