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
/** Flexible tasks get their own residents, on the shore and in the air (M3 plan §2.6). */
export const TASK_SPECIES = ['sparrow', 'cicada', 'squirrel', 'tit', 'cricket', 'owl', 'snail'] as const
export type TaskSpeciesKey = (typeof TASK_SPECIES)[number]
export type SpeciesKey = (typeof SPECIES)[number] | TaskSpeciesKey
export type MarkKind = 'event' | 'task'

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
  /** Snow, specifically: the tit keeps the shore then, where rain brings out the snail. */
  snow: boolean
}

export function speciesContext(state: PastoralState): SpeciesContext {
  return {
    day: state.day,
    term: state.term,
    frozen: state.pondFrozen > 0.5,
    wet: Math.max(state.weather.rain, state.weather.snow) > 0.05,
    snow: state.weather.snow > 0.05,
  }
}

/**
 * Who could stand on this water right now, best match first. Never empty — the duck is a resident.
 * The windows are `model.ts`'s own: butterflies 清明–小满, fireflies 夏至–处暑, frogs 立夏–立秋.
 */
/**
 * The one shore resident for a task right now. Seasons by solar term (0 = 春分): 清明–小满 sparrow,
 * 立夏–处暑 cicada, 立秋–霜降 squirrel, otherwise tit; nights are crickets in the summer half and
 * an owl in the winter half. Weather wins over season.
 */
export function taskSpecies(ctx: SpeciesContext): TaskSpeciesKey {
  if (ctx.snow) return 'tit'
  if (ctx.wet) return 'snail'
  const summerHalf = inTerms(ctx.term, 0, 11)
  if (ctx.day < NIGHT_DAY) return summerHalf ? 'cricket' : 'owl'
  if (inTerms(ctx.term, 1, 4)) return 'sparrow'
  if (inTerms(ctx.term, 5, 10)) return 'cicada'
  if (inTerms(ctx.term, 11, 17)) return 'squirrel'
  return 'tit'
}

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
export function pickSpecies(ctx: SpeciesContext, index: number, kind: MarkKind = 'event'): SpeciesKey {
  if (kind === 'task') return taskSpecies(ctx)
  const list = candidates(ctx)
  return list[((index % list.length) + list.length) % list.length] ?? 'duck'
}
