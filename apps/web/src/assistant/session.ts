/**
 * Assistant session: one conversation, its transcript and the draft awaiting confirmation.
 *
 * What the browser keeps is deliberately tiny: the conversation ID in localStorage. The transcript,
 * the unfinished turn and the live draft are read back from the server on open, so a refresh or a
 * second tab never invents state, and reopening never re-runs anything.
 *
 * Sending is resumable. A message gets its client ID before the request; if the request fails the
 * same ID is retried, and the server returns the stored result instead of talking to the model again.
 */

import { reactive } from 'vue'

import * as defaultApi from '../api/assistant.ts'
import type { ChatMessage, ConflictPair, Draft, History, Turn } from '../api/assistant.ts'
import { ApiError } from '../api/errors.ts'
import { newIdempotencyKey } from '../api/client.ts'

const STORAGE_KEY = 'kairos.conversation'

export type AssistantApi = {
  assistantAvailable(): Promise<boolean>
  startConversation(): Promise<string>
  fetchHistory(conversationId: string): Promise<History>
  sendMessage(
    conversationId: string,
    body: { clientMessageId: string; content: string; timezone: string; expectedRevision: number },
  ): Promise<Turn>
  fetchDraft(draftId: string): Promise<Draft>
  commitDraft(draftId: string, digest: string, acceptance: string | null, options: { idempotencyKey: string }):
    Promise<{ eventId: string }>
  discardDraft(draftId: string, options: { idempotencyKey: string }): Promise<void>
}

export type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type Phase = 'closed' | 'loading' | 'unavailable' | 'idle' | 'sending' | 'failed'

export type ConflictReview = { pairs: ConflictPair[]; token: string }

export type AssistantSession = ReturnType<typeof createAssistantSession>

type Unsent = {
  clientMessageId: string
  content: string
  revision: number
  /** True when the server already stored the user's sentence, so the transcript shows it. */
  stored: boolean
}

export function createAssistantSession(options: {
  api?: AssistantApi
  storage?: SessionStorage
  timezone?: () => string
  /** Called after a draft becomes a real event, so the schedule can refresh right away. */
  onCommitted?: (eventId: string) => void
} = {}) {
  const api: AssistantApi = options.api ?? (defaultApi as unknown as AssistantApi)
  const storage = options.storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
  const timezone = options.timezone ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone)

  const state = reactive({
    phase: 'closed' as Phase,
    messages: [] as ChatMessage[],
    draft: null as Draft | null,
    review: null as ConflictReview | null,
    /** Server-sent explanation of the last failure; shown inline, never as a modal. */
    error: null as string | null,
    /** The last message that did not get an answer; `retry()` resends it with the same ID. */
    unsent: null as Unsent | null,
    committing: false,
  })
  let conversationId: string | null = null
  let revision = 0
  /** Same key for every retry of one confirmation, so a double tap is one write. */
  let commitKey: string | null = null

  const remember = (id: string | null): void => {
    try {
      if (id) storage?.setItem(STORAGE_KEY, id)
      else storage?.removeItem(STORAGE_KEY)
    } catch {
      // Private mode: the conversation just will not survive a reload.
    }
  }

  const describe = (error: unknown): string =>
    error instanceof ApiError ? error.message : '出了点问题，请稍后再试'

  function apply(history: History): void {
    revision = history.revision
    state.messages = history.messages
    setDraft(history.draft)
  }

  function setDraft(next: Draft | null): void {
    if (next?.draftId !== state.draft?.draftId) {
      state.review = null
      commitKey = null
    }
    state.draft = next
  }

  async function begin(): Promise<void> {
    conversationId = await api.startConversation()
    revision = 0
    remember(conversationId)
    state.messages = []
    setDraft(null)
  }

  async function open(): Promise<void> {
    if (state.phase !== 'closed' && state.phase !== 'unavailable') return
    state.phase = 'loading'
    state.error = null
    try {
      if (!(await api.assistantAvailable())) {
        state.phase = 'unavailable'
        return
      }
      const stored = storage?.getItem(STORAGE_KEY) ?? null
      if (stored) {
        try {
          conversationId = stored
          const history = await api.fetchHistory(stored)
          apply(history)
          if (history.pendingClientMessageId) {
            const last = [...history.messages].reverse().find((message) => message.role === 'user')
            if (last) {
              // The reservation bumped the revision; the retry must repeat the original request exactly.
              state.unsent = { clientMessageId: history.pendingClientMessageId, content: last.content,
                revision: Math.max(0, revision - 1), stored: true }
            }
          }
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 404)) throw error
          await begin()
        }
      } else {
        await begin()
      }
      state.phase = 'idle'
    } catch (error) {
      state.error = describe(error)
      state.phase = 'failed'
    }
  }

  function close(): void {
    // Closing keeps the conversation and any draft; reopening reads them back.
    state.phase = 'closed'
  }

  async function deliver(unsent: Unsent): Promise<void> {
    if (!conversationId) return
    state.phase = 'sending'
    state.error = null
    state.unsent = unsent
    try {
      const turn = await api.sendMessage(conversationId, {
        clientMessageId: unsent.clientMessageId,
        content: unsent.content,
        timezone: timezone(),
        expectedRevision: unsent.revision,
      })
      state.unsent = null
      revision = turn.revision
      const known = new Set(state.messages.map((message) => message.id))
      for (const message of [turn.user, turn.assistant]) if (!known.has(message.id)) state.messages.push(message)
      if (turn.draft) setDraft(turn.draft)
      state.phase = 'idle'
    } catch (error) {
      state.error = describe(error)
      // Out of date: re-read the transcript; the unanswered sentence stays offered for a retry.
      if (error instanceof ApiError && error.serverCode === 'VERSION_CONFLICT' && conversationId) {
        try {
          apply(await api.fetchHistory(conversationId))
          state.unsent = { ...unsent, clientMessageId: newIdempotencyKey(), revision, stored: false }
        } catch {
          // Keep what we have; the error line already says what went wrong.
        }
      }
      state.phase = 'failed'
    }
  }

  async function send(text: string): Promise<void> {
    const content = text.trim()
    if (!content || state.phase === 'sending' || !conversationId) return
    await deliver({ clientMessageId: newIdempotencyKey(), content, revision, stored: false })
  }

  async function retry(): Promise<void> {
    if (state.unsent && state.phase !== 'sending') await deliver(state.unsent)
  }

  async function confirm(): Promise<void> {
    const current = state.draft
    if (!current || !current.confirmable || state.committing) return
    state.committing = true
    state.error = null
    commitKey ??= newIdempotencyKey()
    try {
      const result = await api.commitDraft(current.draftId, current.digest, state.review?.token ?? null,
        { idempotencyKey: commitKey })
      setDraft(await api.fetchDraft(current.draftId))
      options.onCommitted?.(result.eventId)
    } catch (error) {
      if (error instanceof ApiError && error.serverCode === 'CONFLICT_REVIEW_REQUIRED') {
        const pairs = Array.isArray(error.details.conflicts) ? (error.details.conflicts as unknown[]) : []
        state.review = {
          pairs: pairs.map((pair) => {
            const item = pair as { slot?: unknown; occurrence_id?: unknown }
            return { slot: String(item.slot ?? ''), occurrenceId: String(item.occurrence_id ?? '') }
          }),
          token: String(error.details.acceptance_token ?? ''),
        }
        // Accepting is a new decision, so it gets its own key.
        commitKey = null
      } else {
        state.error = describe(error)
        try {
          setDraft(await api.fetchDraft(current.draftId))
        } catch {
          // The error line already explains it.
        }
      }
    } finally {
      state.committing = false
    }
  }

  async function discard(): Promise<void> {
    const current = state.draft
    if (!current || state.committing) return
    try {
      await api.discardDraft(current.draftId, { idempotencyKey: newIdempotencyKey() })
      setDraft(await api.fetchDraft(current.draftId))
    } catch (error) {
      state.error = describe(error)
    }
  }

  async function restart(): Promise<void> {
    state.error = null
    state.unsent = null
    try {
      await begin()
      state.phase = 'idle'
    } catch (error) {
      state.error = describe(error)
      state.phase = 'failed'
    }
  }

  return { state, open, close, send, retry, confirm, discard, restart }
}

export const conversationStorageKey = STORAGE_KEY
