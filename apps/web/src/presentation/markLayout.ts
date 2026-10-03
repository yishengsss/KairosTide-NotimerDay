/**
 * Where the residents stand: on the pond, clear of the controls and of each other.
 *
 * Pure geometry over the scene's `WaterRegion`. When the pond cannot hold a resident (a narrow
 * portrait viewport, say) that spot is simply not placed; the caller keeps a fallback control so the
 * event can still be opened, which is the confirmed behaviour.
 */

import type { WaterRegion } from '../scene/pastoral/geometry.ts'

export type Box = { left: number; top: number; right: number; bottom: number }
export type MarkSpot = { x: number; y: number }

export type MarkLayoutOptions = {
  /** Clearance around a resident, in CSS pixels. */
  radius: number
  /** Areas residents must stay out of: the control pill, an open card. */
  avoid: readonly Box[]
  /** Minimum gap between two residents and between a resident and an avoided box. */
  gap?: number
  /** Candidate grid pitch; smaller is finer and slower. */
  step?: number
}

const distanceToBox = (x: number, y: number, box: Box): number => {
  const dx = Math.max(box.left - x, 0, x - box.right)
  const dy = Math.max(box.top - y, 0, y - box.bottom)
  return Math.hypot(dx, dy)
}

/**
 * Candidates are scored by closeness to the pond's horizontal middle and to its vertical centre line
 * at that column, so the first resident lands in open water and later ones spread outwards.
 */
export function layoutMarks(region: WaterRegion, count: number, options: MarkLayoutOptions): (MarkSpot | null)[] {
  const { radius, avoid } = options
  const gap = options.gap ?? 14
  const step = options.step ?? Math.max(6, Math.round(radius / 2))
  const { width, height } = region.viewport
  const candidates: { x: number; y: number; score: number }[] = []
  let minX = Infinity
  let maxX = -Infinity
  for (let x = radius; x <= width - radius; x += step) {
    const top = region.topAt(x)
    const bottom = region.bottomAt(x)
    if (top === null || bottom === null) continue
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    const lower = Math.min(bottom, height) - radius - gap
    for (let y = top + radius + gap; y <= lower; y += step) {
      if (!region.contains(x, y, radius + gap / 2)) continue
      if (avoid.some((box) => distanceToBox(x, y, box) < radius + gap)) continue
      const middle = (top + Math.min(bottom, height)) / 2
      candidates.push({ x, y, score: Math.abs(y - middle) * 2 })
    }
  }
  if (!candidates.length) return Array.from({ length: count }, () => null)
  const centreX = (minX + maxX) / 2
  for (const item of candidates) item.score += Math.abs(item.x - centreX)
  candidates.sort((left, right) => left.score - right.score || left.x - right.x || left.y - right.y)

  const placed: MarkSpot[] = []
  const spots: (MarkSpot | null)[] = []
  for (let i = 0; i < count; i++) {
    const spot = candidates.find((item) =>
      placed.every((other) => Math.hypot(item.x - other.x, item.y - other.y) >= radius * 2 + gap))
    if (spot) {
      const chosen = { x: Math.round(spot.x), y: Math.round(spot.y) }
      placed.push(chosen)
      spots.push(chosen)
    } else {
      spots.push(null)
    }
  }
  return spots
}

/** Box of the bottom-centre control pill, matching AmbientControls' CSS, in CSS pixels. */
export function controlsBox(viewport: { width: number; height: number }): Box {
  const width = 112
  const height = 52
  const bottom = viewport.height - 22
  return { left: viewport.width / 2 - width / 2, right: viewport.width / 2 + width / 2, top: bottom - height, bottom }
}

/**
 * Spots on the bank just above the pond's far shore, for flexible-task residents. Spread from the
 * middle outwards, clear of `taken` spots and of each other; a spot that does not fit is null.
 */
export function layoutShore(region: WaterRegion, count: number, taken: readonly MarkSpot[], radius: number,
  step = 12): (MarkSpot | null)[] {
  const { width } = region.viewport
  const spots: MarkSpot[] = []
  const xs: number[] = []
  for (let x = radius; x <= width - radius; x += step) if (region.topAt(x) !== null) xs.push(x)
  const mid = xs.length ? ((xs[0] ?? 0) + (xs[xs.length - 1] ?? 0)) / 2 : 0
  xs.sort((left, right) => Math.abs(left - mid) - Math.abs(right - mid))
  const result: (MarkSpot | null)[] = []
  for (let i = 0; i < count; i++) {
    let found: MarkSpot | null = null
    for (const x of xs) {
      const y = Math.round((region.topAt(x) ?? 0) - 6)
      if ([...taken, ...spots].every((other) => Math.hypot(x - other.x, y - other.y) >= radius * 2.6)) {
        found = { x, y }
        break
      }
    }
    if (found) spots.push(found)
    result.push(found)
  }
  return result
}
