/**
 * CSS pixels in, art pixels out. Mark positions are kept in CSS pixels by the caller so a resize
 * re-projects them instead of stranding them off the pond; this is that one conversion, shared with
 * the gesture code's own conversion in the engine.
 */

import type { FaunaMark } from './layer.ts'

export type MarkProjection = {
  /** Device pixels per CSS pixel. */
  dpr: number
  /** The illustration's cover-fit scale. */
  scale: number
  offsetX: number
  offsetY: number
}

export function projectMarks(marks: readonly FaunaMark[], projection: MarkProjection): FaunaMark[] {
  const { dpr, scale, offsetX, offsetY } = projection
  const safe = scale || 1
  return marks.map((mark) => ({
    id: mark.id,
    x: (mark.x * dpr - offsetX) / safe,
    y: (mark.y * dpr - offsetY) / safe,
  }))
}
