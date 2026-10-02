<script setup lang="ts">
/**
 * Everything the schedule puts over the scene: the reminder, open cards, the residents standing for
 * events under way, and the conflict picker. It renders a `ScheduleView` and owns only placement.
 *
 * Events are not drawn here. A card under way has an animal on the pond — the scene paints it — and
 * this layer only puts an invisible, finger-sized target over that spot so the card can be reopened.
 */
import { computed, watch } from 'vue'

import { waterRegion } from '../scene/pastoral/geometry.ts'
import ConflictPicker from './ConflictPicker.vue'
import EventCard from './EventCard.vue'
import MarkTarget from './MarkTarget.vue'
import ReminderLayer from './ReminderLayer.vue'
import type { ScheduleView } from './presenter.ts'
import { controlsBox, layoutMarks } from './markLayout.ts'

/** Target side in CSS pixels, matching MarkTarget's default. */
const MARK_SIZE = 56
/** Two residents must not stand on each other, so they claim spots at this spacing. */
const MARK_RADIUS = 26

const props = defineProps<{
  view: ScheduleView
  /** Live viewport, so marks follow a resize instead of drifting off the pond. */
  viewport: { width: number; height: number }
}>()
const emit = defineEmits<{
  acknowledge: [occurrenceId: string, version: number]
  fold: [occurrenceId: string]
  open: [occurrenceId: string]
  excuse: [occurrenceId: string, version: number]
  choose: [group: string[], chosen: string, revision: number]
  /** Where the residents stand, in CSS pixels, for the scene to draw them. */
  marks: [marks: { id: string; x: number; y: number }[]]
}>()

const open = computed(() => props.view.cards.filter((card) => !card.folded))
const standing = computed(() => props.view.cards.filter((card) => card.folded))

/**
 * Events under way get a spot on the pond, clear of the controls and of each other. A narrow
 * portrait viewport may not fit one; then `spot` is null and the pill below stands in, so the card
 * is always reachable.
 */
const spots = computed(() => {
  const region = waterRegion(props.viewport)
  const placed = layoutMarks(region, standing.value.length, {
    radius: MARK_RADIUS,
    avoid: [controlsBox(props.viewport)],
  })
  return standing.value.map((card, index) => ({ card, spot: placed[index] ?? null }))
})

watch(
  () => spots.value,
  (list) => {
    emit('marks', list.flatMap(({ card, spot }) => (spot ? [{ id: card.occurrenceId, ...spot }] : [])))
  },
  { immediate: true, deep: true },
)
</script>

<template>
  <ReminderLayer :reminder="props.view.reminder" @acknowledge="(id, version) => emit('acknowledge', id, version)" />

  <TransitionGroup name="card" tag="div" class="cards">
    <EventCard
      v-for="card in open"
      :key="card.occurrenceId"
      :card="card"
      @fold="(id) => emit('fold', id)"
      @excuse="(id, version) => emit('excuse', id, version)"
    />
  </TransitionGroup>

  <template v-for="{ card, spot } in spots" :key="card.occurrenceId">
    <MarkTarget v-if="spot" :x="spot.x" :y="spot.y" :size="MARK_SIZE" :title="card.title"
      @open="emit('open', card.occurrenceId)" />
    <!-- No room on the water: a slim pill keeps the card reachable. -->
    <button v-else type="button" class="stand-in" :aria-label="`展开：${card.title}`"
      @click="emit('open', card.occurrenceId)">
      {{ card.title }}
    </button>
  </template>

  <Transition name="picker">
    <ConflictPicker v-if="props.view.conflict" :key="props.view.conflict.key" :conflict="props.view.conflict"
      @choose="(group, chosen, revision) => emit('choose', group, chosen, revision)" />
  </Transition>
</template>

<style scoped>
.cards {
  position: fixed;
  left: 50%;
  top: 34%;
  transform: translate(-50%, -50%);
  display: grid;
  gap: 10px;
  justify-items: center;
  z-index: 4;
}
.stand-in {
  position: fixed;
  left: calc(16px + env(safe-area-inset-left, 0px));
  bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  max-width: 40vw;
  padding: 6px 12px;
  border: 1.5px solid rgba(214, 64, 46, 0.85);
  border-radius: 999px;
  background: rgba(30, 28, 24, 0.36);
  color: #fbf7f1;
  font: 500 13px/1.3 'PingFang SC', system-ui, sans-serif;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  z-index: 3;
}
.card-enter-active,
.card-leave-active,
.picker-enter-active,
.picker-leave-active {
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.card-enter-from,
.card-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
.picker-enter-from,
.picker-leave-to {
  opacity: 0;
}
</style>
