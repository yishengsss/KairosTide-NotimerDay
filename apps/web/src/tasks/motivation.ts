/**
 * When saved tasks show up in the scene. Confirmed rhythm (M3 plan §2.1, §2.5):
 *
 * - only while the homepage is idle: assistant closed, no reminder, conflict or open card, page visible;
 * - the next visit is 45–90 minutes after the last, and never two starts within an hour;
 * - a visit lasts 5–10 minutes; opening a detail does not pause it;
 * - `active` tasks are not part of the rhythm — they stay until the user pauses or finishes them.
 *
 * Pure: time and randomness come in from outside, so the rhythm is testable without waiting.
 */

export const GAP_MIN_MS = 45 * 60_000
export const GAP_MAX_MS = 90 * 60_000
export const HOUR_MS = 60 * 60_000
export const STAY_MIN_MS = 5 * 60_000
export const STAY_MAX_MS = 10 * 60_000
/** At most this many planned tasks per visit; the shore may hold fewer. */
export const VISIT_SIZE = 3

export type Motivation = {
  /**
   * Which planned tasks are visiting right now. `candidates` are the planned task ids; one that stops
   * being a candidate (started, finished, deleted) leaves the visit at once.
   */
  tick(now: number, idle: boolean, candidates: readonly string[]): string[]
  /** The user dismissed this task: it leaves the scene now and goes back into the pool. */
  dismiss(taskId: string): void
}

export function createMotivation(start: number, random: () => number = Math.random): Motivation {
  const between = (low: number, high: number): number => low + random() * (high - low)
  let nextAt = start + between(GAP_MIN_MS, GAP_MAX_MS)
  let lastStart = -Infinity
  let visit: { until: number; ids: string[] } | null = null

  return {
    tick(now, idle, candidates) {
      if (visit && now >= visit.until) visit = null
      if (visit) {
        const live = new Set(candidates)
        visit.ids = visit.ids.filter((id) => live.has(id))
        return [...visit.ids]
      }
      // A due visit waits for an idle moment rather than being skipped.
      if (!idle || now < nextAt || now - lastStart < HOUR_MS) return []
      nextAt = now + between(GAP_MIN_MS, GAP_MAX_MS)
      if (!candidates.length) return []
      const pool = [...candidates]
      const ids: string[] = []
      while (pool.length && ids.length < VISIT_SIZE) {
        ids.push(...pool.splice(Math.floor(random() * pool.length), 1))
      }
      lastStart = now
      visit = { until: now + between(STAY_MIN_MS, STAY_MAX_MS), ids }
      return [...ids]
    },
    dismiss(taskId) {
      if (visit) visit.ids = visit.ids.filter((id) => id !== taskId)
    },
  }
}
