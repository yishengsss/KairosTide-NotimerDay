/**
 * Fixed positions in the 1536×1024 illustration, plus the cover-fit transform and the pond region
 * that layout code and the tap-ripple gesture both need.
 */

export const W = 1536
export const H = 1024
export const SKY_H = 448
export const PLATE_W = 192
export const PLATE_H = 56

export const CHIMNEY = { x: 141, y: 388 }
export const WINDOWS = [
  { x: 278, y: 548 },
  { x: 393, y: 551 },
]

export type Point = readonly [number, number]

export const RIDGE: readonly Point[] = [
  [0, 345], [120, 345], [260, 335], [365, 323], [470, 350], [590, 378], [690, 355], [800, 372],
  [930, 400], [1040, 388], [1150, 408], [1536, 420],
]

export const POND: readonly Point[] = [
  [395, 848], [470, 830], [600, 800], [760, 776], [900, 768], [1010, 766], [1100, 800], [1200, 812],
  [1300, 832], [1400, 880], [1536, 950], [1536, 1024], [820, 1024], [700, 960], [560, 900], [450, 872],
]

export const PADDY: readonly Point[] = [
  [90, 662], [640, 642], [1190, 652], [1200, 690], [1000, 715], [500, 735], [260, 740], [100, 700],
]

/** Screen position of a sky body. Facing south: x is the east–west projection, y is altitude. */
export const skyXY = (alt: number, az: number): { x: number; y: number } => ({
  x: W * (0.39 - 0.36 * Math.cos((alt * Math.PI) / 180) * Math.sin((az * Math.PI) / 180)),
  y: 368 - 330 * Math.sin((alt * Math.PI) / 180),
})

export type CoverFit = { scale: number; offsetX: number; offsetY: number }

/** cover-fit the fixed illustration onto a viewport, centered on both axes. */
export function coverFit(width: number, height: number): CoverFit {
  const scale = Math.max(width / W, height / H)
  return { scale, offsetX: (width - W * scale) / 2, offsetY: (height - H * scale) / 2 }
}

export type Viewport = { width: number; height: number }

function insidePolygon(polygon: readonly Point[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (a === undefined || b === undefined) continue
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

function edgesAt(polygon: readonly Point[], x: number): number[] {
  const hits: number[] = []
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (a === undefined || b === undefined) continue
    if (a[0] === b[0]) continue
    if (x >= Math.min(a[0], b[0]) && x <= Math.max(a[0], b[0])) {
      hits.push(a[1] + ((x - a[0]) * (b[1] - a[1])) / (b[0] - a[0]))
    }
  }
  return hits.sort((left, right) => left - right)
}

export type WaterRegion = {
  viewport: Viewport
  /** True when a circular marker of radius r at (x, y) sits inside the pond. */
  contains(x: number, y: number, r: number): boolean
  /** Top or bottom pond shore at a screen x, or null when the pond does not reach that column. */
  topAt(x: number): number | null
  bottomAt(x: number): number | null
  /** Sub-pixel vertical bob of the water surface at a screen x. */
  bobAt(x: number, t: number): number
}

const BOB_PX = 2

export function waterRegion(viewport: Viewport): WaterRegion {
  const fit = coverFit(viewport.width, viewport.height)
  const toArt = (x: number, y: number): { x: number; y: number } => ({
    x: (x - fit.offsetX) / fit.scale,
    y: (y - fit.offsetY) / fit.scale,
  })
  const shore = (x: number): number[] => {
    if (x < fit.offsetX || x > fit.offsetX + W * fit.scale) return []
    return edgesAt(POND, toArt(x, 0).x).map((y) => y * fit.scale + fit.offsetY)
  }
  return {
    viewport,
    contains(x, y, r) {
      const radius = r / fit.scale
      const probe = [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]]
      return probe.every(([dx, dy]) => {
        const point = toArt(x + (dx ?? 0), y + (dy ?? 0))
        return insidePolygon(POND, point.x, point.y)
      })
    },
    topAt(x) {
      return shore(x)[0] ?? null
    },
    bottomAt(x) {
      const hits = shore(x)
      return hits.length ? (hits[hits.length - 1] ?? null) : null
    },
    bobAt(x, t) {
      return Math.sin(x * 0.02 + t * 0.9) * BOB_PX * 0.5
    },
  }
}

/** Screen area the pond occupies, for layout decisions and tests. */
export function pondBounds(viewport: Viewport): { left: number; right: number; top: number; bottom: number } {
  const fit = coverFit(viewport.width, viewport.height)
  const xs = POND.map(([x]) => x)
  const ys = POND.map(([, y]) => y)
  return {
    left: Math.min(...xs) * fit.scale + fit.offsetX,
    right: Math.max(...xs) * fit.scale + fit.offsetX,
    top: Math.min(...ys) * fit.scale + fit.offsetY,
    bottom: Math.max(...ys) * fit.scale + fit.offsetY,
  }
}
