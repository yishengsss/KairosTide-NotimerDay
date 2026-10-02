<script setup lang="ts">
/**
 * Advance reminder: the event's name and place with a single “知道了”, plus an edge glow that deepens
 * as the start approaches. No countdown is ever shown — urgency is felt, not read.
 */
import { computed } from 'vue'

import type { ReminderView } from './presenter.ts'

const props = defineProps<{ reminder: ReminderView | null }>()
const emit = defineEmits<{ acknowledge: [occurrenceId: string, version: number] }>()

/** Glow strength. The CSS transition is long, so the 1-second urgency steps read as one swell. */
const glow = computed(() => (props.reminder ? 0.18 + 0.82 * props.reminder.urgency : 0))
</script>

<template>
  <div class="edge" :style="{ '--glow': glow }" aria-hidden="true" />
  <Transition name="reminder">
    <section v-if="props.reminder" :key="props.reminder.occurrenceId" class="reminder" data-interactive
      role="status" aria-live="polite">
      <p class="title">{{ props.reminder.title }}</p>
      <p v-if="props.reminder.location" class="place">{{ props.reminder.location }}</p>
      <button type="button" @click="emit('acknowledge', props.reminder.occurrenceId, props.reminder.version)">
        知道了
      </button>
    </section>
  </Transition>
</template>

<style scoped>
.edge {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 3;
  opacity: var(--glow);
  box-shadow:
    inset 0 0 calc(40px + 80px * var(--glow)) rgba(214, 86, 52, 0.55),
    inset 0 0 calc(10px + 24px * var(--glow)) rgba(240, 150, 90, 0.35);
  transition: opacity 60s linear, box-shadow 60s linear;
}
.reminder {
  position: fixed;
  top: calc(28px + env(safe-area-inset-top, 0px));
  left: 50%;
  transform: translateX(-50%);
  min-width: 220px;
  max-width: min(420px, calc(100vw - 32px));
  padding: 14px 18px 12px;
  border-radius: 18px;
  background: rgba(30, 28, 24, 0.46);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: #fbf7f1;
  text-align: center;
  z-index: 4;
}
.title {
  margin: 0;
  font: 600 18px/1.35 'PingFang SC', system-ui, sans-serif;
}
.place {
  margin: 4px 0 0;
  font: 400 14px/1.4 'PingFang SC', system-ui, sans-serif;
  opacity: 0.8;
}
button {
  margin-top: 10px;
  padding: 6px 18px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  color: inherit;
  font: 500 14px/1.4 'PingFang SC', system-ui, sans-serif;
  cursor: pointer;
}
button:hover {
  background: rgba(255, 255, 255, 0.26);
}
button:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.7);
  outline-offset: 2px;
}
.reminder-enter-active,
.reminder-leave-active {
  transition: opacity 0.5s ease, transform 0.5s ease;
}
.reminder-enter-from,
.reminder-leave-to {
  opacity: 0;
  transform: translate(-50%, -8px);
}
@media (prefers-reduced-motion: reduce) {
  .edge {
    transition: opacity 2s linear;
  }
}
</style>
