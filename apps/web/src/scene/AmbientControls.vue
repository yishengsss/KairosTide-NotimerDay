<script setup lang="ts">
/**
 * The homepage's only two controls: ambient sound (off by default) and fullscreen. They fade out
 * after three seconds without input and return on any movement, touch or key.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { createDebounce } from '../ui/delay.ts'

const IDLE_MS = 3000

const props = defineProps<{ sound: boolean }>()
const emit = defineEmits<{ toggleSound: [] }>()

const idle = ref(false)
const fullscreen = ref(false)
const canFullscreen = ref(false)

const hide = createDebounce(IDLE_MS, () => {
  idle.value = true
  document.body.classList.add('idle')
})

function wake(): void {
  idle.value = false
  document.body.classList.remove('idle')
  hide.restart()
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void document.documentElement.requestFullscreen?.().catch(() => undefined)
}

function onFullscreenChange(): void {
  fullscreen.value = document.fullscreenElement !== null
}

function onKey(event: KeyboardEvent): void {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
  if (event.key === 'm' || event.key === 'M') emit('toggleSound')
  else if (event.key === 'f' || event.key === 'F') toggleFullscreen()
  else return
  wake()
}

const WAKE_EVENTS = ['mousemove', 'pointerdown', 'touchstart'] as const

onMounted(() => {
  canFullscreen.value = typeof document.documentElement.requestFullscreen === 'function'
  for (const type of WAKE_EVENTS) window.addEventListener(type, wake, { passive: true })
  window.addEventListener('keydown', onKey)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  wake()
})

onBeforeUnmount(() => {
  hide.cancel()
  for (const type of WAKE_EVENTS) window.removeEventListener(type, wake)
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  document.body.classList.remove('idle')
})
</script>

<template>
  <div class="ambient" :class="{ idle }" @focusin="wake">
    <button
      type="button"
      :title="props.sound ? '关闭环境音（M）' : '打开环境音（M）'"
      :aria-label="props.sound ? '关闭环境音' : '打开环境音'"
      :aria-pressed="props.sound"
      @click="emit('toggleSound')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 10v4h3.5L12 18V6L7.5 10z" />
        <path v-if="props.sound" d="M15.5 9.5a3.5 3.5 0 010 5M18 7a7 7 0 010 10" />
        <path v-else d="M16 9.5l5 5M21 9.5l-5 5" />
      </svg>
    </button>
    <button
      v-if="canFullscreen"
      type="button"
      :title="fullscreen ? '退出全屏（F）' : '全屏（F）'"
      :aria-label="fullscreen ? '退出全屏' : '全屏'"
      :aria-pressed="fullscreen"
      @click="toggleFullscreen"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path v-if="fullscreen" d="M9 5v4H5M15 5v4h4M9 19v-4H5M15 19v-4h4" />
        <path v-else d="M5 9V5h4M19 9V5h-4M5 15v4h4M19 15v4h-4" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.ambient {
  position: fixed;
  left: 50%;
  bottom: calc(22px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  display: flex;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 999px;
  background: rgba(30, 28, 24, 0.32);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  transition: opacity 0.6s ease;
  z-index: 2;
}
.ambient.idle {
  opacity: 0;
  pointer-events: none;
}
button {
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #fbf7f1;
  cursor: pointer;
  display: grid;
  place-items: center;
  padding: 0;
  opacity: 0.85;
  transition:
    background 0.2s ease,
    opacity 0.2s ease;
}
button:hover {
  background: rgba(255, 255, 255, 0.16);
  opacity: 1;
}
button:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.7);
  outline-offset: 1px;
}
svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
