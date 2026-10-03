/**
 * Flexible-task resource. Reading is free; the lifecycle only moves when the user presses a button,
 * never because the assistant said so — there is no model tool for it.
 */

import type { components } from '../../../../contracts/api.d.ts'
import { getJson, postJson, type RequestOptions } from './client.ts'

type TaskDto = components['schemas']['FlexibleTask']
type ListDto = components['schemas']['TaskList']
type ResultDto = components['schemas']['LifecycleResult']

export type Lifecycle = TaskDto['lifecycle']

export type FlexibleTask = {
  taskId: string
  version: number
  title: string
  timezone: string
  lifecycle: Lifecycle
  deadline: number | null
  precision: 'date' | 'instant' | null
  overdue: boolean
}

export type LifecycleResult = { taskId: string; lifecycle: Lifecycle; version: number }

function task(dto: TaskDto): FlexibleTask {
  return {
    taskId: dto.task_id,
    version: dto.version,
    title: dto.title,
    timezone: dto.timezone,
    lifecycle: dto.lifecycle,
    deadline: dto.deadline === null ? null : Date.parse(dto.deadline),
    precision: dto.precision,
    overdue: dto.overdue,
  }
}

export async function fetchTasks(options: RequestOptions = {}): Promise<FlexibleTask[]> {
  const dto = (await getJson('/tasks', options)) as ListDto
  return dto.items.map(task)
}

export async function moveTask(
  taskId: string,
  target: Lifecycle,
  expectedVersion: number,
  options: RequestOptions,
): Promise<LifecycleResult> {
  const dto = (await postJson(
    `/tasks/${encodeURIComponent(taskId)}/lifecycle`,
    { target, expected_version: expectedVersion },
    options,
  )) as ResultDto
  return { taskId: dto.task_id, lifecycle: dto.lifecycle, version: dto.version }
}
