/**
 * Which living thing stands for “something is under way here”. The choice is a pure function of the
 * season, the hour and the weather, and it reuses the scene's own phenology windows (`model.ts`), so
 * an event can never put a butterfly on the water in the rain or a firefly there at noon.
 *
 * Nothing here knows about events, reminders or the API: this file answers one question — what is
 * alive right now.
 */

import { inTerms } from '../pastoral/math.ts'
import type { PastoralState } from '../pastoral/model.ts'

export const SPECIES = ['duck', 'butterfly', 'dragonfly', 'egret', 'frog', 'firefly', 'crane'] as const
export type SpeciesKey = (typeof SPECIES)[number]

/** Below this the scene reads as night: the same daylight value the firefly and cricket channels use. */
export const NIGHT_DAY = 0.35

export type SpeciesContext = {
  /** Scene daylight, 0 at night, 1 in full day. */
  day: number
  /** Solar-term index, 0 = 春分. */
  term: number
  frozen: boolean
  /** Rain or snow is falling. */
  wet: boolean
}

export function speciesContext(state: PastoralState): SpeciesContext {
  return {
    day: state.day,
    term: state.term,
    frozen: state.pondFrozen > 0.5,
    wet: Math.max(state.weather.rain, state.weather.snow) > 0.05,
  }
}

/**
 * Who could stand on this water right now, best match first. Never empty — the duck is a resident.
 * The windows are `model.ts`'s own: butterflies 清明–小满, fireflies 夏至–处暑, frogs 立夏–立秋.
 */
export function candidates(ctx: SpeciesContext): SpeciesKey[] {
  // Ice takes the water birds and the insects alike; only the crane winters here.
  if (ctx.frozen) return ['crane']
  const dry = !ctx.wet
  if (ctx.day < NIGHT_DAY) {
    const night: SpeciesKey[] = []
    if (dry && inTerms(ctx.term, 6, 10)) night.push('firefly')
    if (inTerms(ctx.term, 3, 9)) night.push('frog')
    night.push('duck')
    return night
  }
  const day: SpeciesKey[] = []
  if (dry && inTerms(ctx.term, 1, 4)) day.push('butterfly')
  if (dry && inTerms(ctx.term, 5, 10)) day.push('dragonfly')
  if (inTerms(ctx.term, 11, 16)) day.push('egret')
  day.push('duck')
  return day
}

/**
 * `index` is the mark's ordinal, so two events at once get two different residents whenever the
 * moment offers more than one, instead of two identical silhouettes side by side.
 */
export function pickSpecies(ctx: SpeciesContext, index: number): SpeciesKey {
  const list = candidates(ctx)
  return list[((index % list.length) + list.length) % list.length] ?? 'duck'
}
