<script setup lang="ts">
/**
 * Hosts the pastoral engine. Receives an environment frame getter and a mood; knows nothing about
 * events. The getter is read every animation frame, so it must be cheap and must not allocate a
 * network request.
 */
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'

import type { EnvironmentFrame } from '../environment/types.ts'
import { mountPastoral, type PastoralEngine } from './pastoral/engine.ts'
import { pastoralInput, type SceneMood } from './input.ts'

const props = withDefaults(defineProps<{ frame: () => EnvironmentFrame; mood?: SceneMood }>(), {
  mood: 'free',
})

const emit = defineEmits<{ ready: []; fallback: []; failed: [message: string] }>()

const canvas = ref<HTMLCanvasElement | null>(null)
const engine = shallowRef<PastoralEngine | null>(null)
// The engine toggles `ready` on the canvas itself, but Vue rewrites the class attribute whenever the
// mood changes; mirroring it here keeps the fade-in from being undone by a re-render.
const shown = ref(false)

onMounted(() => {
  const element = canvas.value
  if (!element) return
  try {
    engine.value = mountPastoral({
      canvas: element,
      getInput: () => pastoralInput(props.frame()),
      onFirstFrame: () => {
        shown.value = true
        emit('ready')
      },
      onFallback: () => emit('fallback'),
    })
  } catch (error) {
    emit('failed', error instanceof Error ? error.message : '场景无法启动')
  }
})

onBeforeUnmount(() => {
  engine.value?.destroy()
  engine.value = null
})

defineExpose({ engine })
</script>

<template>
  <canvas ref="canvas" class="pastoral" :class="{ ready: shown, work: props.mood === 'work' }" aria-hidden="true" />
</template>

<style scoped>
.pastoral {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  opacity: 0;
  filter: saturate(1) contrast(1);
  transition:
    opacity 1.6s ease,
    filter 1.2s ease;
}
.pastoral.ready {
  opacity: 1;
}
/* Work mood: a barely-there lift, reversible the moment the event ends. */
.pastoral.work {
  filter: saturate(1.06) contrast(1.035);
}
@media (prefers-reduced-motion: reduce) {
  .pastoral {
    transition: opacity 0.4s ease;
  }
}
</style>
