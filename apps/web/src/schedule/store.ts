/**
 * Schedule store: the last snapshot the server sent, plus the user's unreconciled actions.
 *
 * Two kinds of truth live here. The snapshot is the server's; the overlay is the user's, applied the
 * instant they act so the interface never waits on the network. An overlay entry is only honoured
 * while it still describes the instance the user actually saw — a rescheduled instance gets a new
 * version and its stale acknowledgement is dropped, which is what makes a moved event remind again.
 *
 * No fetching and no timers in this file. `sync.ts` owns both.
 */

import { reactive, ref, shallowRef } from 'vue'
import type { Occurrence, ScheduleSnapshot } from '../api/schedule.ts'

/** A write the server has not confirmed yet. The key survives retries so a retry is not a second write. */
export type PendingOp =
  | { key: string; kind: 'ack'; occurrenceId: string; version: number; attempts: number }
  | { key: string; kind: 'exception'; occurrenceId: string; version: number; attempts: number }
  | {
      key: string
      kind: 'conflict'
      groupKey: string
      group: string[]
      chosen: string
      revision: number
      attempts: number
    }

/**
 * Identity of a conflict group. The backend sends the same member ids in a stable order, but the key
 * is order-independent anyway so a presenter and a store can never disagree about which group they
 * are looking at.
 */
export function conflictKey(group: readonly string[]): string {
  return [...group].sort().join('|')
}

export function createScheduleStore() {
  const snapshot = shallowRef<ScheduleSnapshot | null>(null)
  const pending = ref<PendingOp[]>([])
  const lastError = ref<string | null>(null)
  const syncing = ref(false)
  const lastSyncAt = ref(0)

  /** The user's own view of the world, layered over the server's. */
  const overlay = reactive({
    /** occurrenceId → the version that was acknowledged. */
    ack: {} as Record<string, { version: number; at: number }>,
    /** occurrenceId → the version the user excused. */
    excuse: {} as Record<string, number>,
    /** groupKey → the instance the user chose. */
    chosen: {} as Record<string, string>,
    /** occurrenceIds the user has consigned to missed by choosing someone else. */
    missed: {} as Record<string, true>,
  })

  /**
   * Drop local notes the server has contradicted, and only those.
   *
   * An instance the snapshot does not mention is not evidence of anything: it may be outside the
   * window `active` and `reminders` cover. So absence only retires a note when that note is not
   * still on its way to the server — otherwise a write that could not be delivered would erase
   * itself while it waits, and the user's action would visibly come undone.
   */
  function forgetStale(occurrences: readonly Occurrence[], groups: readonly string[][]): void {
    const live = new Map(occurrences.map((item) => [item.occurrenceId, item]))
    const queued = new Set<string>()
    for (const op of pending.value) {
      if (op.kind !== 'conflict') queued.add(op.occurrenceId)
    }
    for (const [id, held] of Object.entries(overlay.ack)) {
      const current = live.get(id)
      if (current ? current.version !== held.version : !queued.has(id)) delete overlay.ack[id]
    }
    for (const [id, version] of Object.entries(overlay.excuse)) {
      const current = live.get(id)
      // The server agreeing the instance is excused, or a new version, both retire the local note.
      if (current) {
        if (current.version !== version || current.disposition !== 'scheduled') delete overlay.excuse[id]
      } else if (!queued.has(id)) {
        delete overlay.excuse[id]
      }
    }
    const open = new Set(groups.map(conflictKey))
    for (const key of Object.keys(overlay.chosen)) if (!open.has(key)) delete overlay.chosen[key]
    for (const id of Object.keys(overlay.missed)) {
      const current = live.get(id)
      if (current ? current.disposition !== 'scheduled' : !queued.has(id)) delete overlay.missed[id]
    }
  }

  return {
    snapshot,
    pending,
    lastError,
    syncing,
    lastSyncAt,
    overlay,

    /** Whether the schedule clock has ever been calibrated. */
    get calibrated(): boolean {
      return snapshot.value !== null
    },

    applySnapshot(next: ScheduleSnapshot): void {
      // Prune against the union: an instance the server still lists has to keep its overlay even when
      // it has just left the active window.
      const all = [...next.active, ...next.reminders]
      snapshot.value = next
      lastSyncAt.value = Date.now()
      forgetStale(all, next.conflicts)
    },

    /**
     * Record a sync problem. `sync.ts` decides what counts as one: a snapshot that arrived cleanly
     * clears it, a write that was given up on does not — the two are separate facts.
     */
    fail(message: string): void {
      lastError.value = message
    },

    clearError(): void {
      lastError.value = null
    },

    acknowledge(occurrenceId: string, version: number, key: string): void {
      overlay.ack[occurrenceId] = { version, at: Date.now() }
      pending.value = [...pending.value, { key, kind: 'ack', occurrenceId, version, attempts: 0 }]
    },

    excuse(occurrenceId: string, version: number, key: string): void {
      overlay.excuse[occurrenceId] = version
      pending.value = [...pending.value, { key, kind: 'exception', occurrenceId, version, attempts: 0 }]
    },

    /** Choosing one instance also, locally, marks its group as answered and the others as missed. */
    decide(group: string[], chosen: string, revision: number, key: string): void {
      const groupKey = conflictKey(group)
      overlay.chosen[groupKey] = chosen
      for (const id of group) {
        if (id === chosen) delete overlay.missed[id]
        else overlay.missed[id] = true
      }
      pending.value = [
        ...pending.value,
        { key, kind: 'conflict', groupKey, group: [...group], chosen, revision, attempts: 0 },
      ]
    },

    /** Undo a local-only change when the server refused it. */
    rollback(op: PendingOp): void {
      if (op.kind === 'ack') delete overlay.ack[op.occurrenceId]
      if (op.kind === 'exception') delete overlay.excuse[op.occurrenceId]
      if (op.kind === 'conflict') {
        delete overlay.chosen[op.groupKey]
        for (const id of op.group) delete overlay.missed[id]
      }
    },

    /** Take a write off the queue, whether the server accepted it or it was given up on. */
    settle(op: PendingOp): void {
      pending.value = pending.value.filter((item) => item.key !== op.key)
    },

    pendingCount(kind: PendingOp['kind']): number {
      return pending.value.filter((item) => item.kind === kind).length
    },
  }
}

export type ScheduleStore = ReturnType<typeof createScheduleStore>

/** The application's single store. Tests build their own with `createScheduleStore()`. */
export const scheduleStore = createScheduleStore()
