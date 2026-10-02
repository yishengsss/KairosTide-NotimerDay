/**
 * The bridge between the schedule and the pond: it takes *where* the residents should stand, in CSS
 * pixels, and keeps them standing there as the viewport changes. The scene's `fauna` layer decides
 * *who* and paints it; this only holds the marks and re-projects them.
 *
 * Marks stay in CSS pixels at this level on purpose. A resize changes the illustration's cover fit,
 * so a mark kept in art pixels would slide off the pond; keeping the caller's coordinates and
 * converting on every change means a rotation puts the resident back on the water.
 */

import { createFaunaLayer, type FaunaMark } from '../fauna/layer.ts'
import { projectMarks, type MarkProjection } from '../fauna/project.ts'
import { speciesContext, type SpeciesKey } from '../fauna/species.ts'
import type { PastoralState } from './model.ts'

export type ResidentMark = FaunaMark
export type ResidentView = { id: string; species: SpeciesKey; presence: number }

export type ResidentLayer = {
  /** Where residents should stand, in CSS pixels at the waterline. Empty clears the pond. */
  setMarks(marks: readonly ResidentMark[]): void
  /** The cover fit changed (resize, rotation): re-place the marks already standing. */
  reproject(projection: MarkProjection): void
  /** Advance fades and glides, then draw. The context is already in art space. */
  draw(
    context: CanvasRenderingContext2D,
    state: PastoralState,
    time: number,
    reducedMotion: boolean,
    deltaSeconds: number,
  ): void
  /** Who is standing now, including residents still fading out. For tests and tooling. */
  residents(): ResidentView[]
}

export function createResidentLayer(): ResidentLayer {
  const fauna = createFaunaLayer()
  let marks: readonly ResidentMark[] = []
  let projection: MarkProjection = { dpr: 1, scale: 1, offsetX: 0, offsetY: 0 }

  const apply = (): void => {
    fauna.setMarks(projectMarks(marks, projection))
  }

  return {
    setMarks(next) {
      marks = next
      apply()
    },
    reproject(next) {
      projection = next
      apply()
    },
    draw(context, state, time, reducedMotion, deltaSeconds) {
      fauna.draw(
        context,
        { time, day: state.day, species: speciesContext(state), reducedMotion },
        deltaSeconds,
      )
    },
    residents: () => fauna.residents(),
  }
}
