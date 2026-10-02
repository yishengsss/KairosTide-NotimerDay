<script setup lang="ts">
/**
 * Two or more events are in progress at once. The user picks which one they are doing; the others
 * become missed. The system never chooses, and the picker has no close button — it stays until
 * answered, or until the overlap itself ends.
 */
import type { ConflictView } from './presenter.ts'

const props = defineProps<{ conflict: ConflictView }>()
const emit = defineEmits<{ choose: [group: string[], chosen: string, revision: number] }>()
</script>

<template>
  <section class="picker" role="dialog" aria-modal="false" aria-labelledby="conflict-heading" data-interactive>
    <p id="conflict-heading" class="heading">这几件事撞在一起了，现在做哪一件？</p>
    <ul>
      <li v-for="option in props.conflict.options" :key="option.occurrenceId">
        <button type="button"
          @click="emit('choose', props.conflict.group, option.occurrenceId, props.conflict.stateRevision)">
          <span class="title">{{ option.title }}</span>
          <span v-if="option.location" class="place">{{ option.location }}</span>
        </button>
      </li>
    </ul>
    <p class="note">没选的会记为错过。</p>
  </section>
</template>

<style scoped>
.picker {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -60%);
  width: min(380px, calc(100vw - 32px));
  padding: 18px 18px 14px;
  border-radius: 22px;
  background: rgba(30, 28, 24, 0.55);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  color: #fbf7f1;
  z-index: 5;
  box-shadow: 0 0 0 1.5px rgba(214, 70, 52, 0.5);
}
.heading {
  margin: 0 0 12px;
  text-align: center;
  font: 600 16px/1.45 'PingFang SC', system-ui, sans-serif;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
button {
  width: 100%;
  padding: 10px 14px;
  border: 0;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.14);
  color: inherit;
  text-align: left;
  cursor: pointer;
  display: grid;
  gap: 2px;
}
button:hover {
  background: rgba(255, 255, 255, 0.24);
}
button:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.7);
  outline-offset: 2px;
}
.title {
  font: 600 15px/1.4 'PingFang SC', system-ui, sans-serif;
}
.place {
  font: 400 13px/1.4 'PingFang SC', system-ui, sans-serif;
  opacity: 0.78;
}
.note {
  margin: 10px 0 0;
  text-align: center;
  font: 400 12px/1.4 'PingFang SC', system-ui, sans-serif;
  opacity: 0.7;
}
</style>
