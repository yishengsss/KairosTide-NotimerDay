/**
 * The residents standing on the pond. The caller says *where* (marks, in art pixels); this layer
 * decides *who* — from the season, the hour and the weather — and lets each one arrive, change with
 * the light and leave with a short fade instead of popping.
 *
 * A mark is anonymous here: an id and a point. What it stands for is the caller's business.
 */

import { hash } from '../pastoral/math.ts'
import { drawSpecies } from './draw.ts'
import { pickSpecies, type MarkKind, type SpeciesContext, type SpeciesKey } from './species.ts'

export type FaunaMark = { id: string; x: number; y: number; kind?: MarkKind }

/** Arrivals, departures and species changes all fade over this long. */
export const FADE_SECONDS = 0.6
/**
 * A new species has to stay right for this long before the animal changes. Rain easing in and out
 * around its threshold must not make a dragonfly and a duck trade places every few frames.
 */
export const SETTLE_SECONDS = 2
/** How quickly a resident glides to a new spot when the layout moves it (per second, exponential). */
const GLIDE_RATE = 3

type Resident = {
  id: string
  kind: MarkKind
  x: number
  y: number
  targetX: number
  targetY: number
  species: SpeciesKey
  /** The species fading out while `species` fades in, if any. */
  previous: SpeciesKey | null
  /** 0→1 for the current species. */
  blend: number
  /** 0→1 on arrival, 1→0 on departure. */
  presence: number
  leaving: boolean
  /** A different species the moment wants, and how long it has wanted it. */
  wanted: SpeciesKey | null
  wantedFor: number
  phase: number
  scale: number
  facing: 1 | -1
}

export type FaunaInput = {
  time: number
  day: number
  species: SpeciesContext
  reducedMotion: boolean
}

export type FaunaLayer = {
  setMarks(marks: readonly FaunaMark[]): void
  /** Advance fades and glides, then draw. The context is already in art space. */
  draw(context: CanvasRenderingContext2D, input: FaunaInput, deltaSeconds: number): void
  /** Who is standing where right now, including residents still fading out. For tests and tooling. */
  residents(): { id: string; species: SpeciesKey; presence: number }[]
}

const idSeed = (id: string): number => {
  let value = 0
  for (let i = 0; i < id.length; i++) value = (value * 31 + id.charCodeAt(i)) % 100_003
  return value
}

export function createFaunaLayer(): FaunaLayer {
  const residents = new Map<string, Resident>()
  let order: string[] = []
  let context: SpeciesContext | null = null

  const arrive = (mark: FaunaMark, index: number): Resident => {
    const seed = idSeed(mark.id)
    return {
      id: mark.id,
      kind: mark.kind ?? 'event',
      x: mark.x,
      y: mark.y,
      targetX: mark.x,
      targetY: mark.y,
      species: context ? pickSpecies(context, index, mark.kind) : 'duck',
      previous: null,
      blend: 1,
      presence: 0,
      leaving: false,
      wanted: null,
      wantedFor: 0,
      phase: hash(seed),
      scale: 0.9 + hash(seed + 7) * 0.2,
      facing: hash(seed + 13) < 0.5 ? 1 : -1,
    }
  }

  return {
    setMarks(marks) {
      const seen = new Set<string>()
      order = marks.map((mark) => mark.id)
      marks.forEach((mark, index) => {
        seen.add(mark.id)
        const found = residents.get(mark.id)
        if (!found) {
          residents.set(mark.id, arrive(mark, index))
          return
        }
        found.targetX = mark.x
        found.targetY = mark.y
        // Asked back before it finished leaving: turn round where it stands.
        found.leaving = false
      })
      for (const resident of residents.values()) if (!seen.has(resident.id)) resident.leaving = true
    },

    draw(canvas, input, deltaSeconds) {
      context = input.species
      const fade = input.reducedMotion ? 1 : Math.min(1, deltaSeconds / FADE_SECONDS)
      const glide = 1 - Math.exp(-deltaSeconds * GLIDE_RATE)
      // Draw from the back of the pond forwards, so a nearer animal overlaps a farther one.
      const ordered = [...residents.values()].sort((left, right) => left.y - right.y)
      for (const resident of ordered) {
        resident.presence = Math.min(1, Math.max(0, resident.presence + (resident.leaving ? -fade : fade)))
        if (resident.leaving && resident.presence <= 0) {
          residents.delete(resident.id)
          continue
        }
        resident.x += (resident.targetX - resident.x) * glide
        resident.y += (resident.targetY - resident.y) * glide

        const index = Math.max(0, order.indexOf(resident.id))
        const wanted = pickSpecies(input.species, index, resident.kind)
        if (wanted === resident.species) {
          resident.wanted = null
          resident.wantedFor = 0
        } else if (wanted !== resident.wanted) {
          resident.wanted = wanted
          resident.wantedFor = 0
        } else if ((resident.wantedFor += deltaSeconds) >= SETTLE_SECONDS) {
          resident.previous = resident.species
          resident.species = wanted
          resident.blend = 0
          resident.wanted = null
          resident.wantedFor = 0
        }
        if (resident.blend < 1) {
          resident.blend = Math.min(1, resident.blend + fade)
          if (resident.blend >= 1) resident.previous = null
        }

        canvas.save()
        canvas.translate(resident.x, resident.y)
        canvas.scale(resident.scale * resident.facing, resident.scale)
        const base = { context: canvas, time: input.time, phase: resident.phase, day: input.day }
        if (resident.previous) {
          drawSpecies(resident.previous, { ...base, alpha: resident.presence * (1 - resident.blend) })
        }
        drawSpecies(resident.species, { ...base, alpha: resident.presence * resident.blend })
        canvas.restore()
      }
    },

    residents() {
      return [...residents.values()].map(({ id, species, presence }) => ({ id, species, presence }))
    },
  }
}
