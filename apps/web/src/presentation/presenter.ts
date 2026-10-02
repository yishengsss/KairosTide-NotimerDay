/**
 * Presenter: business snapshot + the user's local actions + interaction state → what to show.
 *
 * Pure. No Vue, no clock reads, no timers: every input is passed in, so each rule below is a plain
 * function of its arguments and is tested as such. Components render the view model and nothing else.
 *
 * Precedence, from the confirmed product rules:
 *   - an unanswered conflict shows the picker; its members get no cards until the user chooses;
 *   - an excused or missed instance disappears entirely, with no ring;
 *   - an active instance shows its card; once folded (by "知道了" or the auto-fold) it is a ring.
 *     Acknowledging the advance reminder does not pre-fold the card — the start is its own moment;
 *   - one reminder at a time, the earliest to start, until acknowledged or started.
 */

import type { Occurrence, ScheduleSnapshot } from '../api/schedule.ts'

export type Overlay = {
  ack: Readonly<Record<string, { version: number }>>
  excuse: Readonly<Record<string, number>>
  chosen: Readonly<Record<string, string>>
  missed: Readonly<Record<string, true>>
}

export type Interaction = {
  /** Cards the user (or the auto-fold) has folded into a ring. */
  folded: ReadonlySet<string>
  /** Instances whose exception could not be recorded. */
  unsynced: ReadonlySet<string>
}

export type ReminderView = {
  occurrenceId: string
  version: number
  title: string
  location: string | null
  startAt: number
  /** 0 → 1 across the lead window. Drives the edge glow; never shown as a number. */
  urgency: number
}

export type CardView = {
  occurrenceId: string
  version: number
  title: string
  location: string | null
  endAt: number
  folded: boolean
  unsynced: boolean
}

export type ConflictOption = { occurrenceId: string; title: string; location: string | null; endAt: number }

export type ConflictView = {
  key: string
  group: string[]
  stateRevision: number
  options: ConflictOption[]
}

export type ScheduleView = {
  mood: 'free' | 'work'
  reminder: ReminderView | null
  cards: CardView[]
  conflict: ConflictView | null
}

export const EMPTY_VIEW: ScheduleView = { mood: 'free', reminder: null, cards: [], conflict: null }

/** Same identity as the store's; duplicated here so the presenter does not import a Vue module. */
export function groupKey(group: readonly string[]): string {
  return [...group].sort().join('|')
}

export function urgencyAt(startAt: number, now: number, leadSeconds: number): number {
  const lead = Math.max(0, leadSeconds) * 1000
  const remaining = startAt - now
  if (remaining <= 0) return 1
  if (lead <= 0 || remaining >= lead) return 0
  return 1 - remaining / lead
}

const isGone = (item: Occurrence, overlay: Overlay): boolean =>
  item.disposition !== 'scheduled' ||
  overlay.excuse[item.occurrenceId] === item.version ||
  overlay.missed[item.occurrenceId] === true

const isAcked = (item: Occurrence, overlay: Overlay): boolean =>
  overlay.ack[item.occurrenceId]?.version === item.version

function pickReminder(snapshot: ScheduleSnapshot, overlay: Overlay, now: number): ReminderView | null {
  const due = snapshot.reminders
    .filter((item) => !isGone(item, overlay) && !isAcked(item, overlay) && item.startAt > now)
    .sort((left, right) => left.startAt - right.startAt || left.occurrenceId.localeCompare(right.occurrenceId))
  const first = due[0]
  if (!first) return null
  return {
    occurrenceId: first.occurrenceId,
    version: first.version,
    title: first.title,
    location: first.location,
    startAt: first.startAt,
    urgency: urgencyAt(first.startAt, now, snapshot.reminderLeadSeconds),
  }
}

function pickConflict(snapshot: ScheduleSnapshot, overlay: Overlay, live: Map<string, Occurrence>):
  ConflictView | null {
  for (const group of snapshot.conflicts) {
    const key = groupKey(group)
    if (overlay.chosen[key] !== undefined) continue
    const members = group.map((id) => live.get(id)).filter((item): item is Occurrence => item !== undefined)
    // A conflict needs two live members; one that has ended or been excused leaves nothing to choose.
    if (members.length < 2) continue
    return {
      key,
      group: [...group],
      stateRevision: snapshot.stateRevision,
      options: members
        .sort((left, right) => left.startAt - right.startAt || left.occurrenceId.localeCompare(right.occurrenceId))
        .map((item) => ({ occurrenceId: item.occurrenceId, title: item.title, location: item.location,
          endAt: item.endAt })),
    }
  }
  return null
}

export function present(
  snapshot: ScheduleSnapshot | null,
  overlay: Overlay,
  interaction: Interaction,
  now: number,
): ScheduleView {
  if (!snapshot) return EMPTY_VIEW
  // Active means started and not yet over by the schedule clock, which may be ahead of the snapshot:
  // an event that ended a second ago dissolves now, not at the next poll.
  const live = new Map(
    snapshot.active
      .filter((item) => !isGone(item, overlay) && item.startAt <= now && now < item.endAt)
      .map((item) => [item.occurrenceId, item]),
  )
  const conflict = pickConflict(snapshot, overlay, live)
  const blocked = new Set(conflict?.group ?? [])
  const cards = [...live.values()]
    .filter((item) => !blocked.has(item.occurrenceId))
    .sort((left, right) => left.startAt - right.startAt || left.occurrenceId.localeCompare(right.occurrenceId))
    .map((item) => ({
      occurrenceId: item.occurrenceId,
      version: item.version,
      title: item.title,
      location: item.location,
      endAt: item.endAt,
      folded: interaction.folded.has(item.occurrenceId),
      unsynced: interaction.unsynced.has(item.occurrenceId),
    }))
  return {
    mood: live.size > 0 ? 'work' : 'free',
    reminder: pickReminder(snapshot, overlay, now),
    cards,
    conflict,
  }
}
