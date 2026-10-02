/**
 * The single sync engine. This is the only file in the app allowed to call `setTimeout`.
 *
 * It decides when to ask the server for `/state`:
 *   - every 30 s while the page is visible, never while it is hidden;
 *   - immediately when the page becomes visible again;
 *   - at `next_transition_at`, so a reminder or a start lands on the second it is due;
 *   - right after any write, so the screen converges on the server's answer.
 *
 * Writes flow through here too. Each is applied to the store first (the user sees the effect at once),
 * then sent with an idempotency key that survives retries. A refused write rolls the overlay back; a
 * network failure keeps the local result and retries on the next pass.
 */

import { ApiError } from '../api/errors.ts'
import { newIdempotencyKey } from '../api/client.ts'
import {
  acknowledgeReminder,
  decideConflict,
  excuseOccurrence,
  fetchState,
} from '../api/schedule.ts'
import type { ScheduleClock } from '../clock/schedule.ts'
import type { PendingOp, ScheduleStore } from './store.ts'

export const POLL_MS = 30_000
/** Ask a beat after a transition so the server's own clock is certainly past it. */
const TRANSITION_SLACK_MS = 400
/** Never schedule tighter than this, whatever the server says. */
const MIN_DELAY_MS = 1_000
const MAX_ATTEMPTS = 5

export type SyncApi = {
  fetchState: typeof fetchState
  acknowledgeReminder: typeof acknowledgeReminder
  excuseOccurrence: typeof excuseOccurrence
  decideConflict: typeof decideConflict
}

export type SyncTimers = {
  set(callback: () => void, delay: number): unknown
  clear(handle: unknown): void
}

export type SyncDocument = {
  readonly hidden: boolean
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

export type SyncOptions = {
  store: ScheduleStore
  clock: ScheduleClock
  api?: SyncApi
  timers?: SyncTimers
  document?: SyncDocument
  /** Called when an exception could not be recorded; the event card shows “未同步”. */
  onExceptionFailed?: (occurrenceId: string) => void
}

export type SyncEngine = {
  start(): void
  stop(): void
  /** Fetch now, coalescing with any request already in flight. */
  refresh(): Promise<void>
  acknowledge(occurrenceId: string, version: number): void
  excuse(occurrenceId: string, version: number): void
  decide(group: string[], chosen: string, revision: number): void
}

const defaultApi: SyncApi = { fetchState, acknowledgeReminder, excuseOccurrence, decideConflict }

const defaultTimers: SyncTimers = {
  set: (callback, delay) => setTimeout(callback, delay),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export function createSyncEngine(options: SyncOptions): SyncEngine {
  const { store, clock } = options
  const api = options.api ?? defaultApi
  const timers = options.timers ?? defaultTimers
  const doc: SyncDocument | null = options.document ?? (typeof document === 'undefined' ? null : document)

  let running = false
  let handle: unknown = null
  let inflight: Promise<void> | null = null
  /** A write arrived while a pull was running: pull once more after it. */
  let again = false

  const hidden = (): boolean => doc?.hidden ?? false

  function nextDelay(): number {
    const snapshot = store.snapshot.value
    let delay = POLL_MS
    const transition = snapshot?.nextTransitionAt
    if (transition !== null && transition !== undefined && Number.isFinite(transition)) {
      delay = Math.min(delay, clock.until(transition) + TRANSITION_SLACK_MS)
    }
    return Math.max(MIN_DELAY_MS, delay)
  }

  function schedule(): void {
    if (handle !== null) timers.clear(handle)
    handle = null
    if (!running || hidden()) return
    handle = timers.set(() => {
      handle = null
      void refresh()
    }, nextDelay())
  }

  /** The message from the last write that was refused or given up on, for the current pass. */
  let writeError: string | null = null

  async function send(op: PendingOp): Promise<void> {
    const request = { idempotencyKey: op.key }
    try {
      if (op.kind === 'ack') await api.acknowledgeReminder(op.occurrenceId, op.version, request)
      else if (op.kind === 'exception') await api.excuseOccurrence(op.occurrenceId, op.version, request)
      else await api.decideConflict(op.group, op.chosen, op.revision, request)
      store.settle(op)
    } catch (error) {
      const retryable = error instanceof ApiError ? error.retryable : true
      op.attempts += 1
      if (retryable && op.attempts < MAX_ATTEMPTS) return
      // Refused, or out of retries: drop it and, for anything but an acknowledgement, put things back.
      // An ack the server will not take is harmless locally — the reminder simply returns on the next
      // snapshot if the server still considers it due.
      store.settle(op)
      if (op.kind !== 'ack') store.rollback(op)
      if (op.kind === 'exception') options.onExceptionFailed?.(op.occurrenceId)
      writeError = error instanceof Error ? error.message : '未同步'
    }
  }

  async function flush(): Promise<string | null> {
    // Sequential on purpose: a conflict decision must not race the ack for the same instance.
    writeError = null
    for (const op of [...store.pending.value]) await send(op)
    return writeError
  }

  async function pull(): Promise<void> {
    store.syncing.value = true
    try {
      const refused = await flush()
      const snapshot = await api.fetchState()
      clock.calibrate(snapshot)
      store.applySnapshot(snapshot)
      // A fresh snapshot settles everything the server knows about, but it cannot excuse a write the
      // server never received: that message has to survive until the retry succeeds.
      if (refused === null) store.clearError()
      else store.fail(refused)
    } catch (error) {
      store.fail(error instanceof Error ? error.message : '未同步')
    } finally {
      store.syncing.value = false
    }
  }

  /**
   * Run pulls until every write issued meanwhile has been carried by one of them.
   *
   * A pass reads the pending queue when it begins, so a write arriving mid-pass is not in it. Such a
   * write raises `again`, and the promise everyone is waiting on only resolves once a pass that
   * includes it has finished. A plain refresh arriving mid-pass just joins: the answer already on
   * its way is as fresh as a second request would be.
   */
  async function drain(): Promise<void> {
    try {
      do {
        again = false
        await pull()
      } while (again)
    } finally {
      inflight = null
      schedule()
    }
  }

  function request(carriesWrite: boolean): Promise<void> {
    if (inflight) {
      if (carriesWrite) again = true
      return inflight
    }
    inflight = drain()
    return inflight
  }

  const refresh = (): Promise<void> => request(false)

  function onVisibility(): void {
    if (!running) return
    if (hidden()) schedule()
    else void refresh()
  }

  /** Apply locally, then reconcile with the server at once. */
  function write(apply: (key: string) => void): void {
    apply(newIdempotencyKey())
    void request(true)
  }

  return {
    start() {
      if (running) return
      running = true
      doc?.addEventListener('visibilitychange', onVisibility)
      void refresh()
    },
    stop() {
      running = false
      doc?.removeEventListener('visibilitychange', onVisibility)
      if (handle !== null) timers.clear(handle)
      handle = null
    },
    refresh,
    acknowledge(occurrenceId, version) {
      write((key) => store.acknowledge(occurrenceId, version, key))
    },
    excuse(occurrenceId, version) {
      write((key) => store.excuse(occurrenceId, version, key))
    },
    decide(group, chosen, revision) {
      write((key) => store.decide(group, chosen, revision, key))
    },
  }
}
