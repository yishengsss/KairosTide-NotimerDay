<script setup lang="ts">
/**
 * A transparent, keyboard-reachable hit area over the resident the scene is drawing at `(x, y)`.
 *
 * The engine paints the animal on the canvas; this is only the finger-sized target on top of it, so
 * tapping works on a phone, focus rings show up, and screen readers have something to read. It draws
 * nothing: an empty button with a name is exactly what a sighted user sees as nothing at all.
 */
import { computed } from 'vue'

const props = withDefaults(defineProps<{ x: number; y: number; title: string; size?: number }>(), {
  size: 56,
})

const emit = defineEmits<{ open: [] }>()

// The animal is drawn with its feet at (x, y); the target is centred a little above the waterline,
// where the body actually is.
const style = computed(() => ({
  left: `${props.x}px`,
  top: `${props.y - props.size * 0.28}px`,
  width: `${props.size}px`,
  height: `${props.size}px`,
}))
</script>

<template>
  <button type="button" class="mark" :style="style" :aria-label="`展开：${props.title}`" :title="props.title"
    @click="emit('open')" />
</template>

<style scoped>
.mark {
  position: fixed;
  transform: translate(-50%, -50%);
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  z-index: 3;
}
.mark:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.75);
  outline-offset: 2px;
  background: rgba(255, 255, 255, 0.08);
}
</style>
