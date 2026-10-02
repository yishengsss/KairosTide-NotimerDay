<script setup lang="ts">
/**
 * The card shown while a rigid event is in progress: name, place, “知道了” and “例外”.
 * Untouched, it folds itself into a red ring after 3.2 s; touching it restarts that pause.
 */
import { onBeforeUnmount, onMounted } from 'vue'

import { createDebounce } from '../ui/delay.ts'
import type { CardView } from './presenter.ts'

const AUTO_FOLD_MS = 3200

const props = defineProps<{ card: CardView }>()
const emit = defineEmits<{ fold: [occurrenceId: string]; excuse: [occurrenceId: string, version: number] }>()

const autoFold = createDebounce(AUTO_FOLD_MS, () => emit('fold', props.card.occurrenceId))

onMounted(() => {
  // An unsynced card stays open so the user sees why; it folds once they act on it again.
  if (!props.card.unsynced) autoFold.restart()
})
onBeforeUnmount(() => autoFold.cancel())
</script>

<template>
  <section class="card" data-interactive role="dialog" :aria-label="props.card.title"
    @pointerdown="autoFold.restart()" @focusin="autoFold.restart()">
    <p class="title">{{ props.card.title }}</p>
    <p v-if="props.card.location" class="place">{{ props.card.location }}</p>
    <p v-if="props.card.unsynced" class="unsynced" role="alert">未同步</p>
    <div class="actions">
      <button type="button" @click="emit('fold', props.card.occurrenceId)">知道了</button>
      <button type="button" class="quiet" @click="emit('excuse', props.card.occurrenceId, props.card.version)">
        例外
      </button>
    </div>
  </section>
</template>

<style scoped>
.card {
  min-width: 240px;
  max-width: min(420px, calc(100vw - 32px));
  padding: 16px 20px 14px;
  border-radius: 20px;
  background: rgba(30, 28, 24, 0.5);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: #fbf7f1;
  text-align: center;
  box-shadow: 0 0 0 1.5px rgba(214, 70, 52, 0.55);
}
.title {
  margin: 0;
  font: 600 19px/1.35 'PingFang SC', system-ui, sans-serif;
}
.place {
  margin: 4px 0 0;
  font: 400 14px/1.4 'PingFang SC', system-ui, sans-serif;
  opacity: 0.8;
}
.unsynced {
  margin: 6px 0 0;
  font: 500 13px/1.4 'PingFang SC', system-ui, sans-serif;
  color: #ffc9b8;
}
.actions {
  margin-top: 12px;
  display: flex;
  justify-content: center;
  gap: 10px;
}
button {
  padding: 6px 18px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  color: inherit;
  font: 500 14px/1.4 'PingFang SC', system-ui, sans-serif;
  cursor: pointer;
}
button.quiet {
  background: transparent;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28);
}
button:hover {
  background: rgba(255, 255, 255, 0.28);
}
button:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.7);
  outline-offset: 2px;
}
</style>
