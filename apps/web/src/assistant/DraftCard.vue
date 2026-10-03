<script setup lang="ts">
/**
 * The draft awaiting the user's decision. Nothing here is saved until「确认保存」is pressed, and the
 * button is the only way to save: typing「确认」into the chat is just another message.
 *
 * Change, cancel and excuse drafts show the saved state next to the result (原来 → 改为) and say
 * whether one instance or the whole series is affected. Their button names the action.
 *
 * When the server reports an overlap, the card switches to a review step. Accepting saves the event
 * and leaves the overlap for the schedule's own conflict card; the assistant never picks a side.
 */
import { computed } from 'vue'

import type { Draft } from '../api/assistant.ts'
import type { ConflictReview } from './session.ts'

const props = defineProps<{ draft: Draft; review: ConflictReview | null; busy: boolean }>()
const emit = defineEmits<{ confirm: []; discard: [] }>()

const LABELS: Record<string, string> = { title: '标题', timezone: '时区', start_at: '开始时间', end_at: '结束时间' }

const when = (value: number | null): string =>
  value === null
    ? '—'
    : new Date(value).toLocaleString('zh-CN', {
        month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit',
        ...(props.draft.timezone ? { timeZone: props.draft.timezone } : {}),
      })

const KIND = {
  create: { label: '新安排', button: '确认保存', done: '已保存到日程' },
  change: { label: '修改', button: '确认修改', done: '已修改' },
  cancel: { label: '删除', button: '确认删除', done: '已删除' },
  excuse: { label: '请假', button: '确认请假', done: '已请假' },
  task_create: { label: '新待办', button: '确认保存', done: '已存成待办' },
  task_change: { label: '修改待办', button: '确认修改', done: '已修改' },
  task_cancel: { label: '取消待办', button: '确认取消', done: '已取消' },
} as const

const isTask = computed(() => props.draft.kind.startsWith('task_'))

/** A date-precision deadline shows only the day; an instant one shows the clock time too. */
const due = (value: number | null, precision: string | null): string => {
  if (value === null) return '不设截止'
  const day = { month: 'numeric', day: 'numeric', weekday: 'short' } as const
  const zone = props.draft.timezone ? { timeZone: props.draft.timezone } : {}
  const extra = precision === 'instant' ? { hour: '2-digit', minute: '2-digit' } as const : {}
  return new Date(value).toLocaleString('zh-CN', { ...day, ...extra, ...zone }) + (precision === 'date' ? ' 之前' : '')
}

const kind = computed(() => KIND[props.draft.kind])

const scope = computed(() => {
  const before = props.draft.before
  if (!before || !before.recurring) return null
  return before.wholeSeries ? '整个系列（以后每一次）' : '只这一次，其他次不变'
})

/** Rows that differ between the saved state and the result, for a change draft. */
const changes = computed(() => {
  const before = props.draft.before
  if (!before || props.draft.kind !== 'change') return []
  const rows: { label: string; from: string; to: string }[] = []
  if (before.title !== props.draft.title) rows.push({ label: '标题', from: before.title, to: props.draft.title ?? '—' })
  if (before.startAt !== props.draft.startAt) rows.push({ label: '开始', from: when(before.startAt), to: when(props.draft.startAt) })
  if (before.endAt !== props.draft.endAt) rows.push({ label: '结束', from: when(before.endAt), to: when(props.draft.endAt) })
  if (before.location !== props.draft.location) {
    rows.push({ label: '地点', from: before.location ?? '—', to: props.draft.location ?? '—' })
  }
  return rows
})

const missing = computed(() => props.draft.missing.map((item) => LABELS[item] ?? item).join('、'))

const closed = computed(() => {
  switch (props.draft.status) {
    case 'committed': return kind.value.done
    case 'discarded': return '已放弃'
    case 'superseded': return '已被新的草稿替换'
    default: return props.draft.expiresAt <= Date.now() ? '草稿已过期，请重新说一遍' : null
  }
})
</script>

<template>
  <section class="draft" data-interactive aria-label="待确认的草稿">
    <p class="title">
      <span v-if="props.draft.kind !== 'create'" class="kind">{{ kind.label }}</span>
      {{ props.draft.before?.title ?? props.draft.taskBefore?.title ?? props.draft.title ?? '（未命名）' }}
    </p>
    <dl v-if="isTask && props.draft.taskBefore && props.draft.kind === 'task_change'" class="diff">
      <template v-if="props.draft.taskBefore.title !== props.draft.title">
        <dt>标题</dt><dd><s>{{ props.draft.taskBefore.title }}</s> → {{ props.draft.title ?? '—' }}</dd>
      </template>
      <template v-if="props.draft.taskBefore.deadline !== props.draft.deadline">
        <dt>截止</dt>
        <dd><s>{{ due(props.draft.taskBefore.deadline, props.draft.taskBefore.precision) }}</s> → {{ due(props.draft.deadline, props.draft.precision) }}</dd>
      </template>
    </dl>
    <dl v-else-if="isTask && props.draft.taskBefore">
      <dt>截止</dt><dd>{{ due(props.draft.taskBefore.deadline, props.draft.taskBefore.precision) }}</dd>
    </dl>
    <dl v-else-if="isTask">
      <dt>截止</dt><dd>{{ due(props.draft.deadline, props.draft.precision) }}</dd>
    </dl>
    <dl v-else-if="props.draft.kind === 'change'" class="diff">
      <template v-for="row in changes" :key="row.label">
        <dt>{{ row.label }}</dt>
        <dd><s>{{ row.from }}</s> → {{ row.to }}</dd>
      </template>
      <template v-if="scope"><dt>范围</dt><dd>{{ scope }}</dd></template>
    </dl>
    <dl v-else-if="props.draft.before">
      <dt>时间</dt><dd>{{ when(props.draft.before.startAt) }} – {{ when(props.draft.before.endAt) }}</dd>
      <template v-if="props.draft.before.location"><dt>地点</dt><dd>{{ props.draft.before.location }}</dd></template>
      <template v-if="scope"><dt>范围</dt><dd>{{ scope }}</dd></template>
    </dl>
    <dl v-else>
      <dt>开始</dt><dd>{{ when(props.draft.startAt) }}</dd>
      <dt>结束</dt><dd>{{ when(props.draft.endAt) }}</dd>
      <template v-if="props.draft.location"><dt>地点</dt><dd>{{ props.draft.location }}</dd></template>
      <template v-if="props.draft.recurring"><dt>重复</dt><dd>是</dd></template>
    </dl>
    <p class="basis">依据：「{{ props.draft.basisPhrase }}」</p>
    <p v-if="missing && !closed" class="missing">还缺：{{ missing }}</p>

    <p v-if="closed" class="closed">{{ closed }}</p>
    <template v-else>
      <div v-if="props.review" class="review" role="alert">
        <p>{{ props.draft.kind === 'create' ? '这条安排' : '改后的时间' }}和已有日程有 {{ props.review.pairs.length }} 处重叠。保存后，重叠由日程里的冲突卡片让你选择。</p>
      </div>
      <div class="actions">
        <button type="button" :disabled="!props.draft.confirmable || props.busy" @click="emit('confirm')">
          {{ props.review ? '仍然保存' : kind.button }}
        </button>
        <button type="button" class="quiet" :disabled="props.busy" @click="emit('discard')">放弃</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.draft {
  margin: 8px 0;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.1);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
}
.title {
  margin: 0 0 6px;
  font: 600 16px/1.35 'PingFang SC', system-ui, sans-serif;
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 10px;
  margin: 0;
  font: 400 14px/1.45 'PingFang SC', system-ui, sans-serif;
}
dt {
  opacity: 0.65;
}
.kind {
  margin-right: 6px;
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(255, 217, 168, 0.25);
  font-size: 13px;
  font-weight: 500;
}
s {
  opacity: 0.6;
}
dd {
  margin: 0;
}
.basis,
.missing,
.closed,
.review p {
  margin: 6px 0 0;
  font: 400 13px/1.45 'PingFang SC', system-ui, sans-serif;
}
.basis {
  opacity: 0.7;
}
.missing,
.review p {
  color: #ffd9a8;
}
.closed {
  opacity: 0.8;
}
.actions {
  margin-top: 10px;
  display: flex;
  gap: 8px;
}
button {
  padding: 6px 16px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.22);
  color: inherit;
  font: 500 14px/1.4 'PingFang SC', system-ui, sans-serif;
  cursor: pointer;
}
button.quiet {
  background: transparent;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3);
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
