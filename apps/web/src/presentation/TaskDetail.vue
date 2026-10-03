<script setup lang="ts">
/**
 * The detail of one saved task, opened by tapping its resident. The only place lifecycle moves:
 * 开始 / 暂停 / 完成 / 撤销完成 are buttons the user presses; nothing here is the assistant's.
 * No countdown, no nagging copy — an overdue deadline is stated once, plainly.
 */
import { computed } from 'vue'

import type { FlexibleTask, Lifecycle } from '../api/tasks.ts'

const props = defineProps<{ task: FlexibleTask; busy: boolean; error: string | null }>()
const emit = defineEmits<{ move: [taskId: string, target: Lifecycle]; close: [] }>()

const due = computed(() => {
  const { deadline, precision, timezone } = props.task
  if (deadline === null) return null
  const text = new Date(deadline).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', weekday: 'short', timeZone: timezone,
    ...(precision === 'instant' ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
  return precision === 'date' ? `${text} 之前` : text
})

const ACTIONS: Record<Lifecycle, { label: string; target: Lifecycle }[]> = {
  planned: [{ label: '开始', target: 'active' }, { label: '完成', target: 'done' }],
  active: [{ label: '完成', target: 'done' }, { label: '暂停', target: 'planned' }],
  done: [{ label: '撤销完成', target: 'active' }],
}
</script>

<template>
  <section class="detail" data-interactive role="dialog" :aria-label="props.task.title">
    <p class="title">{{ props.task.title }}</p>
    <p v-if="due" class="due">截止：{{ due }}<span v-if="props.task.overdue">（已过期）</span></p>
    <p v-if="props.task.lifecycle === 'done'" class="due">已完成</p>
    <p v-if="props.error" class="error" role="alert">{{ props.error }}</p>
    <div class="actions">
      <button v-for="(action, index) in ACTIONS[props.task.lifecycle]" :key="action.target" type="button"
        :class="{ quiet: index > 0 }" :disabled="props.busy" @click="emit('move', props.task.taskId, action.target)">
        {{ action.label }}
      </button>
      <button type="button" class="quiet" @click="emit('close')">收起</button>
    </div>
  </section>
</template>

<style scoped>
.detail {
  position: fixed;
  left: 50%;
  top: 34%;
  transform: translate(-50%, -50%);
  z-index: 4;
  min-width: 240px;
  max-width: min(420px, calc(100vw - 32px));
  padding: 16px 20px 14px;
  border-radius: 20px;
  background: rgba(30, 28, 24, 0.5);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: #fbf7f1;
  text-align: center;
  box-shadow: 0 0 0 1.5px rgba(150, 190, 120, 0.55);
}
.title { margin: 0; font: 600 19px/1.35 'PingFang SC', system-ui, sans-serif; }
.due { margin: 4px 0 0; font: 400 14px/1.4 'PingFang SC', system-ui, sans-serif; opacity: 0.8; }
.error { margin: 6px 0 0; font: 500 13px/1.4 'PingFang SC', system-ui, sans-serif; color: #ffc9b8; }
.actions { margin-top: 12px; display: flex; justify-content: center; flex-wrap: wrap; gap: 10px; }
button {
  padding: 6px 18px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  color: inherit;
  font: 500 14px/1.4 'PingFang SC', system-ui, sans-serif;
  cursor: pointer;
}
button.quiet { background: transparent; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28); }
button:hover { background: rgba(255, 255, 255, 0.28); }
button:disabled { opacity: 0.5; cursor: default; }
button:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.7); outline-offset: 2px; }
</style>
