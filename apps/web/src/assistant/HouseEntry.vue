<script setup lang="ts">
/**
 * The way into the assistant: tapping the farmhouse. Like the residents' targets it draws nothing —
 * the house is already in the picture — so the homepage still shows only its two controls.
 *
 * The rectangle is fixed in the 1536×1024 illustration (roof eaves to the foot of the walls) and
 * mapped onto the screen with the same cover-fit the scene uses.
 */
import { computed } from 'vue'

import { coverFit } from '../scene/pastoral/geometry.ts'
import type { Viewport } from '../ui/viewport.ts'

/** Farmhouse body in illustration pixels. */
const HOUSE = { left: 95, top: 425, right: 470, bottom: 605 }

const props = defineProps<{ viewport: Viewport }>()
const emit = defineEmits<{ open: [] }>()

const style = computed(() => {
  const fit = coverFit(props.viewport.width, props.viewport.height)
  return {
    left: `${fit.offsetX + HOUSE.left * fit.scale}px`,
    top: `${fit.offsetY + HOUSE.top * fit.scale}px`,
    width: `${(HOUSE.right - HOUSE.left) * fit.scale}px`,
    height: `${(HOUSE.bottom - HOUSE.top) * fit.scale}px`,
  }
})
</script>

<template>
  <button type="button" class="house" :style="style" aria-label="打开助手" title="助手" @click="emit('open')" />
</template>

<style scoped>
.house {
  position: fixed;
  padding: 0;
  border: 0;
  border-radius: 12px;
  background: transparent;
  cursor: pointer;
  z-index: 2;
}
.house:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.75);
  outline-offset: 2px;
  background: rgba(255, 255, 255, 0.06);
}
</style>
