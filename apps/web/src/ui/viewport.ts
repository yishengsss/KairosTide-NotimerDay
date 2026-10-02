/**
 * The viewport size as a ref, updated on resize. One listener for the whole app; the schedule layer
 * and the residents both need it, and neither should own it.
 */

import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export type Viewport = { width: number; height: number }

const read = (): Viewport => ({
  width: typeof window === 'undefined' ? 0 : window.innerWidth,
  height: typeof window === 'undefined' ? 0 : window.innerHeight,
})

export function useViewport(): Ref<Viewport> {
  const viewport = ref<Viewport>(read())
  const update = (): void => {
    viewport.value = read()
  }
  onMounted(() => window.addEventListener('resize', update))
  onBeforeUnmount(() => window.removeEventListener('resize', update))
  return viewport
}
