/**
 * Assistant session rules from the M2 plan:
 *   - the browser keeps only the conversation ID; transcript and draft come back from the server;
 *   - a failed send is retried with the same client message ID, never a fresh one;
 *   - a draft is saved only by confirm(), with one idempotency key across retries;
 *   - an overlap asks for review, and accepting it sends the server's own token back.
 */
import { describe, expect, it } from 'vitest'

import type { ChatMessage, Draft, History, Turn } from '../src/api/assistant.ts'
import { ApiError } from '../src/api/errors.ts'
import { conversationStorageKey, createAssistantSession, type AssistantApi } from '../src/assistant/session.ts'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  }
}

const draft = (overrides: Partial<Draft> = {}): Draft => ({
  draftId: 'd1', kind: 'create', before: null, status: 'ready', digest: 'dig', title: '组会', location: null, timezone: 'Asia/Shanghai',
  startAt: 1, endAt: 2, recurring: false, missing: [], basisPhrase: '周三三点组会',
  expiresAt: Date.now() + 3_600_000, confirmable: true, ...overrides,
})

const message = (id: string, role: ChatMessage['role'], content: string, draftId: string | null = null): ChatMessage =>
  ({ id, role, content, tools: [], draftId })

type Calls = { send: Parameters<AssistantApi['sendMessage']>[1][]; commit: unknown[][]; started: number }

function fakeApi(overrides: Partial<AssistantApi> = {}): AssistantApi & { calls: Calls } {
  const calls: Calls = { send: [], commit: [], started: 0 }
  let current: Draft | null = null
  const api: AssistantApi = {
    assistantAvailable: async () => true,
    startConversation: async () => {
      calls.started += 1
      return `c${calls.started}`
    },
    fetchHistory: async (): Promise<History> => ({ revision: 0, messages: [], pendingClientMessageId: null, draft: null }),
    sendMessage: async (_id, body): Promise<Turn> => {
      calls.send.push(body)
      current = draft()
      return {
        revision: body.expectedRevision + 2,
        user: message(`u${calls.send.length}`, 'user', body.content),
        assistant: message(`a${calls.send.length}`, 'assistant', '这是草稿', 'd1'),
        draft: current,
      }
    },
    fetchDraft: async () => current ?? draft(),
    commitDraft: async (...args) => {
      calls.commit.push(args)
      current = draft({ status: 'committed', confirmable: false })
      return { eventId: 'evt' }
    },
    discardDraft: async () => {
      current = draft({ status: 'discarded', confirmable: false })
    },
    ...overrides,
  }
  return Object.assign(api, { calls })
}

describe('助手会话', () => {
  it('没有配置模型时显示未配置，不创建对话', async () => {
    const api = fakeApi({ assistantAvailable: async () => false })
    const session = createAssistantSession({ api, storage: memoryStorage() })
    await session.open()
    expect(session.state.phase).toBe('unavailable')
    expect(api.calls.started).toBe(0)
  })

  it('本地只存对话 ID，重新打开时从服务端读回记录和草稿', async () => {
    const storage = memoryStorage()
    const api = fakeApi()
    const first = createAssistantSession({ api, storage, timezone: () => 'Asia/Shanghai' })
    await first.open()
    await first.send('周三三点组会')
    expect([...storage.data.keys()]).toEqual([conversationStorageKey])
    expect(storage.data.get(conversationStorageKey)).toBe('c1')

    const restored = fakeApi({
      fetchHistory: async () => ({
        revision: 2, pendingClientMessageId: null, draft: draft(),
        messages: [message('u1', 'user', '周三三点组会'), message('a1', 'assistant', '这是草稿', 'd1')],
      }),
    })
    const second = createAssistantSession({ api: restored, storage })
    await second.open()
    expect(restored.calls.started).toBe(0)
    expect(second.state.messages.map((m) => m.id)).toEqual(['u1', 'a1'])
    expect(second.state.draft?.draftId).toBe('d1')
  })

  it('存的对话已不存在时新开一个', async () => {
    const api = fakeApi({ fetchHistory: async () => { throw new ApiError('SERVER', '没有', 404, 'NOT_FOUND') } })
    const storage = memoryStorage({ [conversationStorageKey]: 'gone' })
    const session = createAssistantSession({ api, storage })
    await session.open()
    expect(session.state.phase).toBe('idle')
    expect(storage.data.get(conversationStorageKey)).toBe('c1')
  })

  it('发送失败后重试沿用同一个 client message ID', async () => {
    let fail = true
    const base = fakeApi()
    const api = fakeApi({
      sendMessage: async (id, body) => {
        base.calls.send.push(body)
        if (fail) throw new ApiError('SERVER', '模型暂时不可用', 503, 'ASSISTANT_UNAVAILABLE')
        return base.sendMessage(id, body)
      },
    })
    const session = createAssistantSession({ api, storage: memoryStorage() })
    await session.open()
    await session.send('周三三点组会')
    expect(session.state.phase).toBe('failed')
    expect(session.state.error).toBe('模型暂时不可用')
    fail = false
    await session.retry()
    const ids = base.calls.send.map((body) => body.clientMessageId)
    expect(new Set(ids).size).toBe(1)
    expect(base.calls.send.at(-1)?.expectedRevision).toBe(0)
    expect(session.state.unsent).toBeNull()
    expect(session.state.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('重新打开时发现未完成的一轮，用原 ID 和原进度重试', async () => {
    const api = fakeApi({
      fetchHistory: async () => ({
        revision: 1, pendingClientMessageId: 'cm-old', draft: null, messages: [message('u1', 'user', '明早八点跑步')],
      }),
    })
    const session = createAssistantSession({ api, storage: memoryStorage({ [conversationStorageKey]: 'c9' }) })
    await session.open()
    expect(session.state.unsent).toMatchObject({ clientMessageId: 'cm-old', content: '明早八点跑步', revision: 0 })
    await session.retry()
    expect(api.calls.send[0]).toMatchObject({ clientMessageId: 'cm-old', expectedRevision: 0 })
  })

  it('只有点确认才保存，重复确认用同一个幂等键，保存后通知刷新日程', async () => {
    const committed: string[] = []
    let first = true
    const base = fakeApi()
    const api = fakeApi({
      commitDraft: async (...args) => {
        if (first) {
          first = false
          base.calls.commit.push(args)
          throw new ApiError('NETWORK', '网络不可用', 0)
        }
        return base.commitDraft(...args)
      },
      sendMessage: base.sendMessage,
      fetchDraft: base.fetchDraft,
    })
    const session = createAssistantSession({ api, storage: memoryStorage(), onCommitted: (id) => committed.push(id) })
    await session.open()
    await session.send('周三三点组会')
    expect(base.calls.commit).toHaveLength(0)
    expect(committed).toEqual([])
    await session.confirm()
    await session.confirm()
    const keys = base.calls.commit.map((args) => (args[3] as { idempotencyKey: string }).idempotencyKey)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
    expect(committed).toEqual(['evt'])
    expect(session.state.draft?.status).toBe('committed')
  })

  it('有重叠时先让用户复核，接受后带上服务端给的令牌', async () => {
    const tokens: (string | null)[] = []
    const api = fakeApi({
      commitDraft: async (_id, _digest, acceptance) => {
        tokens.push(acceptance)
        if (acceptance === null) {
          throw new ApiError('CONFLICT', '和已有日程重叠', 409, 'CONFLICT_REVIEW_REQUIRED', {
            conflicts: [{ slot: '2026-10-07T15:00:00+08:00', occurrence_id: 'occ-1' }],
            acceptance_token: 'tok',
          })
        }
        return { eventId: 'evt' }
      },
    })
    const session = createAssistantSession({ api, storage: memoryStorage() })
    await session.open()
    await session.send('周三三点组会')
    await session.confirm()
    expect(session.state.review).toEqual({ pairs: [{ slot: '2026-10-07T15:00:00+08:00', occurrenceId: 'occ-1' }],
      token: 'tok' })
    expect(session.state.error).toBeNull()
    await session.confirm()
    expect(tokens).toEqual([null, 'tok'])
  })

  it('缺字段的草稿不能确认', async () => {
    const api = fakeApi({
      sendMessage: async (): Promise<Turn> => ({
        revision: 2, user: message('u1', 'user', '组会'), assistant: message('a1', 'assistant', '还缺时间', 'd1'),
        draft: draft({ status: 'needs_clarification', confirmable: false, missing: ['start_at'] }),
      }),
    })
    const session = createAssistantSession({ api, storage: memoryStorage() })
    await session.open()
    await session.send('组会')
    await session.confirm()
    expect(api.calls.commit).toHaveLength(0)
  })

  it('放弃草稿后状态来自服务端', async () => {
    const session = createAssistantSession({ api: fakeApi(), storage: memoryStorage() })
    await session.open()
    await session.send('周三三点组会')
    await session.discard()
    expect(session.state.draft?.status).toBe('discarded')
  })
})
