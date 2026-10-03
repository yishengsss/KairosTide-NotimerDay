/**
 * The saved flexible tasks, as last read from the server, and the one write the homepage makes:
 * moving a task through planned → active → done when the user presses a button.
 *
 * A failed read and an empty list are different facts and stay different: `status` is `failed` for
 * the first, `ready` with no items for the second. Motivation only ever runs on `ready`.
 */

import { reactive } from 'vue'

import { newIdempotencyKey } from '../api/client.ts'
import { ApiError } from '../api/errors.ts'
import type { FlexibleTask, Lifecycle, LifecycleResult } from '../api/tasks.ts'

export type TaskApi = {
  fetchTasks(): Promise<FlexibleTask[]>
  moveTask(taskId: string, target: Lifecycle, version: number, options: { idempotencyKey: string }):
    Promise<LifecycleResult>
}

export type TaskStatus = 'loading' | 'ready' | 'failed'

export function createTaskStore(api: TaskApi) {
  const state = reactive({
    status: 'loading' as TaskStatus,
    items: [] as FlexibleTask[],
    /** The task whose button is being pressed, so it cannot be pressed twice. */
    busy: null as string | null,
    /** Why the last move did not go through, shown in the detail. */
    error: null as string | null,
  })

  async function refresh(): Promise<void> {
    try {
      state.items = await api.fetchTasks()
      state.status = 'ready'
    } catch {
      // Keep what was shown before; only a read that has never succeeded leaves the list unknown.
      if (state.status !== 'ready') state.status = 'failed'
    }
  }

  /**
   * One press, one key. A 409 means the task changed elsewhere; the list is re-read so the user
   * sees the current state instead of their stale one.
   */
  async function move(taskId: string, target: Lifecycle): Promise<boolean> {
    const current = state.items.find((item) => item.taskId === taskId)
    if (!current || state.busy) return false
    state.busy = taskId
    state.error = null
    try {
      const result = await api.moveTask(taskId, target, current.version, { idempotencyKey: newIdempotencyKey() })
      state.items = state.items.map((item) =>
        item.taskId === taskId ? { ...item, lifecycle: result.lifecycle, version: result.version } : item)
      return true
    } catch (error) {
      state.error = error instanceof ApiError && error.status === 409 ? '这条待办刚被改过，已刷新' : '没能保存，请再试一次'
      await refresh()
      return false
    } finally {
      state.busy = null
    }
  }

  return { state, refresh, move }
}

export type TaskStore = ReturnType<typeof createTaskStore>
