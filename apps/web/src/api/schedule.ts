/**
 * Schedule resource. The contract carries ISO strings; this module turns them into instants once,
 * here, so nothing downstream has to parse a date again.
 */

import type { components } from '../../../../contracts/api.d.ts'
import { getJson, postJson, type RequestOptions } from './client.ts'

type OccurrenceDto = components['schemas']['Occurrence']
type StateDto = components['schemas']['ScheduleState']
type AckDto = components['schemas']['ReminderAck']
type DecisionDto = components['schemas']['ConflictDecision']

export type Disposition = OccurrenceDto['disposition']

/** One materialized instance of an event series. */
export type Occurrence = {
  occurrenceId: string
  eventId: string
  title: string
  location: string | null
  startAt: number
  endAt: number
  version: number
  disposition: Disposition
}

export type ScheduleSnapshot = {
  /** Server time when the snapshot was produced; the schedule clock calibrates against it. */
  serverNow: number
  /** Received at, from this device's clock. Used to age the snapshot without re-parsing. */
  fetchedAt: number
  active: Occurrence[]
  reminders: Occurrence[]
  conflicts: string[][]
  stateRevision: number
  nextTransitionAt: number | null
  reminderLeadSeconds: number
}

export type ReminderAck = {
  occurrenceId: string
  occurrenceVersion: number
  acknowledgedAt: number
}

export type ConflictDecision = {
  chosenOccurrenceId: string
  missedOccurrenceIds: string[]
  stateRevision: number
}

const instant = (value: string): number => {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : NaN
}

function occurrence(dto: OccurrenceDto): Occurrence {
  return {
    occurrenceId: dto.occurrence_id,
    eventId: dto.event_id,
    title: dto.title,
    location: dto.location,
    startAt: instant(dto.start_at),
    endAt: instant(dto.end_at),
    version: dto.version,
    disposition: dto.disposition,
  }
}

export async function fetchState(options: RequestOptions = {}): Promise<ScheduleSnapshot> {
  const dto = (await getJson('/state', options)) as StateDto
  return {
    serverNow: instant(dto.server_now),
    fetchedAt: Date.now(),
    active: dto.active.map(occurrence),
    reminders: dto.reminders.map(occurrence),
    conflicts: dto.conflicts.map((group) => [...group]),
    stateRevision: dto.state_revision,
    nextTransitionAt: dto.next_transition_at === null ? null : instant(dto.next_transition_at),
    reminderLeadSeconds: dto.reminder_lead_seconds,
  }
}

/** Acknowledge the reminder for one instance at the version the user actually saw. */
export async function acknowledgeReminder(
  occurrenceId: string,
  occurrenceVersion: number,
  options: RequestOptions,
): Promise<ReminderAck> {
  const dto = (await postJson(
    `/reminders/${encodeURIComponent(occurrenceId)}/ack`,
    { occurrence_version: occurrenceVersion },
    options,
  )) as AckDto
  return {
    occurrenceId: dto.occurrence_id,
    occurrenceVersion: dto.occurrence_version,
    acknowledgedAt: instant(dto.acknowledged_at),
  }
}

/** Record the current instance as excused. Other instances of the series are untouched. */
export async function excuseOccurrence(
  occurrenceId: string,
  expectedVersion: number,
  options: RequestOptions,
): Promise<Occurrence> {
  const dto = (await postJson(
    `/occurrences/${encodeURIComponent(occurrenceId)}/exception`,
    { expected_version: expectedVersion },
    options,
  )) as OccurrenceDto
  return occurrence(dto)
}

/** Record the user's chosen instance; every other member of the group becomes missed. */
export async function decideConflict(
  group: string[],
  chosenOccurrenceId: string,
  stateRevision: number,
  options: RequestOptions,
): Promise<ConflictDecision> {
  const dto = (await postJson(
    '/conflict-decisions',
    { group, chosen_occurrence_id: chosenOccurrenceId, state_revision: stateRevision },
    options,
  )) as DecisionDto
  return {
    chosenOccurrenceId: dto.chosen_occurrence_id,
    missedOccurrenceIds: [...dto.missed_occurrence_ids],
    stateRevision: dto.state_revision,
  }
}
