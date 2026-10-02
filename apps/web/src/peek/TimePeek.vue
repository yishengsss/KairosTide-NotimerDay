<script setup lang="ts">
/**
 * Long-press time peek. Shows the device time near the press for three seconds, refreshing each
 * second while visible. Reads `RealClock` and nothing else — never the schedule clock.
 */
import { computed, onBeforeUnmount, ref } from 'vue'

import { formatClockTime, realClock, type RealClock } from '../clock/real.ts'
import { after, every, type Cancel } from '../ui/delay.ts'
import type { PressPoint } from './longPress.ts'

const SHOW_MS = 3000

const props = withDefaults(defineProps<{ clock?: RealClock }>(), { clock: () => realClock })

const point = ref<PressPoint | null>(null)
const text = ref('')
let hide: Cancel | null = null
let tick: Cancel | null = null

function stop(): void {
  hide?.()
  tick?.()
  hide = null
  tick = null
}

function show(at: PressPoint): void {
  stop()
  const width = window.innerWidth
  const height = window.innerHeight
  // Keep the label on screen and above the finger, which would otherwise hide it.
  point.value = { x: Math.min(Math.max(at.x, 56), width - 56), y: Math.min(Math.max(at.y - 64, 40), height - 40) }
  text.value = formatClockTime(props.clock.now())
  tick = every(1000, () => {
    text.value = formatClockTime(props.clock.now())
  })
  hide = after(SHOW_MS, () => {
    stop()
    point.value = null
  })
}

function dismiss(): void {
  stop()
  point.value = null
}

const style = computed(() => (point.value ? { left: `${point.value.x}px`, top: `${point.value.y}px` } : {}))

onBeforeUnmount(stop)

defineExpose({ show, dismiss })
</script>

<template>
  <Transition name="peek">
    <div v-if="point" class="peek" :style="style" role="status" aria-live="polite">{{ text }}</div>
  </Transition>
</template>

<style scoped>
.peek {
  position: fixed;
  transform: translate(-50%, -50%);
  padding: 8px 16px;
  border-radius: 999px;
  background: rgba(30, 28, 24, 0.42);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  color: #fbf7f1;
  font: 500 22px/1.2 ui-rounded, 'PingFang SC', system-ui, sans-serif;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  user-select: none;
  z-index: 6;
}
.peek-enter-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.peek-leave-active {
  transition: opacity 0.6s ease;
}
.peek-enter-from {
  opacity: 0;
  transform: translate(-50%, -40%);
}
.peek-leave-to {
  opacity: 0;
}
</style>
