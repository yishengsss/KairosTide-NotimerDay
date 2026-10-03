/**
 * Assistant resource: conversations, turns and drafts. Converts the wire shape once, here.
 *
 * The browser never holds the model key and never sends history: the server owns the transcript and
 * this module only ever sends the one sentence the user just typed.
 */

import type { components } from '../../../../contracts/api.d.ts'
import { getJson, postJson, type RequestOptions } from './client.ts'

type DraftDto = components['schemas']['Draft']
type TurnDto = components['schemas']['TurnResult']
type PageDto = components['schemas']['MessagePage']
type ToolDto = components['schemas']['ToolResult']

export type DraftStatus = DraftDto['status']
export type DraftKind = DraftDto['kind']

/** What a change, cancel or excuse draft acts on, as it was when the draft was made. */
export type DraftBefore = {
  title: string
  location: string | null
  startAt: number
  endAt: number
  /** Whole series rather than this one instance. Only ever true when the user said so. */
  wholeSeries: boolean
  recurring: boolean
}

export type Precision = 'date' | 'instant'

/** The saved task a task_change or task_cancel draft acts on. */
export type TaskBefore = { title: string; deadline: number | null; precision: Precision | null }

export type Draft = {
  draftId: string
  kind: DraftKind
  /** The saved event before the change; null for a new event or any task draft. */
  before: DraftBefore | null
  /** The saved task before the change; null unless this is task_change or task_cancel. */
  taskBefore: TaskBefore | null
  deadline: number | null
  precision: Precision | null
  status: DraftStatus
  digest: string
  title: string | null
  location: string | null
  timezone: string | null
  startAt: number | null
  endAt: number | null
  recurring: boolean
  missing: string[]
  basisPhrase: string
  expiresAt: number
  confirmable: boolean
}

export type ToolResult = { name: string; status: ToolDto['status']; draftId: string | null }

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  tools: ToolResult[]
  draftId: string | null
}

export type Turn = {
  revision: number
  user: ChatMessage
  assistant: ChatMessage
  draft: Draft | null
}

export type History = {
  revision: number
  messages: ChatMessage[]
  pendingClientMessageId: string | null
  draft: Draft | null
}

export type ConflictPair = { slot: string; occurrenceId: string }

const instant = (value: string | null): number | null => (value === null ? null : Date.parse(value))

export function draft(dto: DraftDto): Draft {
  const target = dto.target
  const task = target !== null && 'task_id' in target ? target : null
  const event = target !== null && 'occurrence_id' in target ? target : null
  return {
    draftId: dto.draft_id,
    kind: dto.kind,
    taskBefore: task
      ? { title: task.title, deadline: instant(task.deadline), precision: task.precision }
      : null,
    deadline: instant(dto.fields.deadline ?? null),
    precision: dto.fields.precision ?? null,
    before: event
      ? {
          title: event.title,
          location: event.location,
          startAt: Date.parse(event.start_at),
          endAt: Date.parse(event.end_at),
          wholeSeries: event.scope === 'series',
          recurring: event.recurring,
        }
      : null,
    status: dto.status,
    digest: dto.digest,
    title: dto.fields.title,
    location: dto.fields.location,
    timezone: dto.fields.timezone,
    startAt: instant(dto.fields.start_at),
    endAt: instant(dto.fields.end_at),
    recurring: dto.fields.recurrence !== null || (event?.recurring ?? false),
    missing: [...dto.missing],
    basisPhrase: dto.basis_phrase,
    expiresAt: Date.parse(dto.expires_at),
    confirmable: dto.confirmable,
  }
}

const tool = (dto: ToolDto): ToolResult => ({ name: dto.name, status: dto.status, draftId: dto.draft_id })

export async function assistantAvailable(options: RequestOptions = {}): Promise<boolean> {
  const dto = (await getJson('/assistant/status', options)) as components['schemas']['AssistantStatus']
  return dto.available
}

export async function startConversation(options: RequestOptions = {}): Promise<string> {
  const dto = (await postJson('/conversations', {}, options)) as components['schemas']['ConversationCreated']
  return dto.conversation_id
}

export async function fetchHistory(conversationId: string, options: RequestOptions = {}): Promise<History> {
  const dto = (await getJson(`/conversations/${encodeURIComponent(conversationId)}/messages`, options)) as PageDto
  return {
    revision: dto.revision,
    messages: dto.items.map((item) => ({
      id: item.message_id,
      role: item.role,
      content: item.content,
      tools: item.action_results.map(tool),
      draftId: item.draft_id,
    })),
    pendingClientMessageId: dto.pending_client_message_id,
    draft: dto.draft ? draft(dto.draft) : null,
  }
}

export async function sendMessage(
  conversationId: string,
  body: { clientMessageId: string; content: string; timezone: string; expectedRevision: number },
  options: RequestOptions = {},
): Promise<Turn> {
  const dto = (await postJson(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      client_message_id: body.clientMessageId,
      content: body.content,
      timezone: body.timezone,
      expected_revision: body.expectedRevision,
    },
    options,
  )) as TurnDto
  const tools = dto.tool_results.map(tool)
  return {
    revision: dto.revision,
    user: { id: dto.user_message_id, role: 'user', content: body.content, tools: [], draftId: null },
    assistant: {
      id: dto.assistant_message_id,
      role: 'assistant',
      content: dto.answer,
      tools,
      draftId: dto.draft?.draft_id ?? null,
    },
    draft: dto.draft ? draft(dto.draft) : null,
  }
}

export async function fetchDraft(draftId: string, options: RequestOptions = {}): Promise<Draft> {
  return draft((await getJson(`/drafts/${encodeURIComponent(draftId)}`, options)) as DraftDto)
}

export async function commitDraft(
  draftId: string,
  digest: string,
  conflictAcceptance: string | null,
  options: RequestOptions,
): Promise<{ eventId: string }> {
  const dto = (await postJson(
    `/drafts/${encodeURIComponent(draftId)}/commit`,
    { digest, conflict_acceptance: conflictAcceptance },
    options,
  )) as components['schemas']['CommitResult']
  return { eventId: dto.event_id }
}

export async function discardDraft(draftId: string, options: RequestOptions): Promise<void> {
  await postJson(`/drafts/${encodeURIComponent(draftId)}/discard`, {}, options)
}
