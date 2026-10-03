<script setup lang="ts">
/**
 * Saved tasks in the scene: who is on the bank (every `active` task, plus planned ones the rhythm
 * has brought out), a finger-sized target over each, and the detail when one is tapped.
 *
 * Expiry of a visit only takes the animal away; a detail already open stays open (plan §2.1).
 */
import { computed, ref, watch } from 'vue'

import type { Lifecycle } from '../api/tasks.ts'
import { waterRegion } from '../scene/pastoral/geometry.ts'
import type { TaskStore } from '../tasks/store.ts'
import MarkTarget from './MarkTarget.vue'
import TaskDetail from './TaskDetail.vue'
import { layoutShore, type MarkSpot } from './markLayout.ts'

const MARK_SIZE = 48
const RADIUS = 20

const props = defineProps<{
  store: TaskStore
  /** Planned tasks the rhythm has brought out right now. */
  visiting: readonly string[]
  /** Where the event residents already stand, so the two sets keep apart. */
  taken: readonly MarkSpot[]
  viewport: { width: number; height: number }
}>()
const emit = defineEmits<{
  marks: [marks: { id: string; x: number; y: number; kind: 'task' }[]]
  /** The user paused a planned visitor; it leaves the visit at once. */
  dismissed: [taskId: string]
}>()

const opened = ref<string | null>(null)

const shown = computed(() => {
  const visiting = new Set(props.visiting)
  return props.store.state.items.filter((task) =>
    task.lifecycle === 'active' || (task.lifecycle === 'planned' && visiting.has(task.taskId)))
})

const spots = computed(() => {
  const placed = layoutShore(waterRegion(props.viewport), shown.value.length, props.taken, RADIUS)
  return shown.value.flatMap((task, index) => {
    const spot = placed[index]
    return spot ? [{ task, spot }] : []
  })
})

watch(spots, (list) => emit('marks', list.map(({ task, spot }) => ({ id: `task:${task.taskId}`, ...spot, kind: 'task' }))),
  { immediate: true, deep: true })

const detail = computed(() => props.store.state.items.find((task) => task.taskId === opened.value) ?? null)

async function move(taskId: string, target: Lifecycle): Promise<void> {
  const ok = await props.store.move(taskId, target)
  if (ok && target === 'planned') {
    emit('dismissed', taskId)
    opened.value = null
  }
}
</script>

<template>
  <MarkTarget v-for="{ task, spot } in spots" :key="task.taskId" :x="spot.x" :y="spot.y" :size="MARK_SIZE"
    :title="task.title" @open="opened = task.taskId" />
  <Transition name="detail">
    <TaskDetail v-if="detail" :key="detail.taskId" :task="detail" :busy="props.store.state.busy === detail.taskId"
      :error="props.store.state.error" @move="move" @close="opened = null" />
  </Transition>
</template>

<style scoped>
.detail-enter-active, .detail-leave-active { transition: opacity 0.6s ease; }
.detail-enter-from, .detail-leave-to { opacity: 0; }
</style>
