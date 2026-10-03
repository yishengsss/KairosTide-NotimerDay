<script setup lang="ts">
/**
 * The conversation, opened by tapping the farmhouse. Not a homepage control: it is never shown until
 * asked for, and closing it leaves the scene exactly as it was.
 *
 * It is a dialog, so presses inside it never start the long-press time peek or a ripple.
 */
import { nextTick, ref, watch } from 'vue'

import DraftCard from './DraftCard.vue'
import type { AssistantSession } from './session.ts'

const props = defineProps<{ session: AssistantSession }>()

const text = ref('')
const list = ref<HTMLElement | null>(null)
const input = ref<HTMLTextAreaElement | null>(null)

const state = props.session.state

async function submit(): Promise<void> {
  const value = text.value
  if (!value.trim() || state.phase === 'sending') return
  text.value = ''
  await props.session.send(value)
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') props.session.close()
  // Enter sends; Shift+Enter or an IME composition keeps typing.
  else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    void submit()
  }
}

watch(
  () => [state.messages.length, state.draft?.draftId, state.phase],
  async () => {
    await nextTick()
    list.value?.scrollTo({ top: list.value.scrollHeight })
    if (state.phase === 'idle') input.value?.focus()
  },
)
</script>

<template>
  <section class="panel" role="dialog" aria-label="助手" data-interactive @keydown.esc="props.session.close()">
    <header>
      <p class="name">助手</p>
      <button v-if="state.phase !== 'unavailable'" type="button" class="quiet" @click="props.session.restart()">
        新对话
      </button>
      <button type="button" class="quiet" aria-label="关闭助手" @click="props.session.close()">关闭</button>
    </header>

    <p v-if="state.phase === 'loading'" class="hint">正在打开…</p>
    <p v-else-if="state.phase === 'unavailable'" class="hint">助手未配置。日程和天气照常可用。</p>

    <template v-else>
      <ol ref="list" class="messages" aria-live="polite">
        <li v-if="state.messages.length === 0" class="hint">
          说一件固定时间的安排，比如「周三下午三点到四点在图书馆开组会」。也可以问日程或天气。
        </li>
        <li v-for="message in state.messages" :key="message.id" :class="message.role">
          <p>{{ message.content }}</p>
          <DraftCard
            v-if="message.draftId && state.draft && message.draftId === state.draft.draftId"
            :draft="state.draft"
            :review="state.review"
            :busy="state.committing"
            @confirm="props.session.confirm()"
            @discard="props.session.discard()"
          />
        </li>
        <li v-if="state.unsent && !state.unsent.stored" class="user pending"><p>{{ state.unsent.content }}</p></li>
        <li v-if="state.phase === 'sending'" class="assistant pending"><p>…</p></li>
      </ol>

      <p v-if="state.error" class="error" role="alert">
        {{ state.error }}
        <button v-if="state.unsent && state.phase !== 'sending'" type="button" class="quiet"
          @click="props.session.retry()">重试</button>
      </p>

      <form @submit.prevent="submit">
        <textarea ref="input" v-model="text" rows="2" maxlength="4000" placeholder="说点什么…"
          aria-label="给助手的消息" :disabled="state.phase === 'sending'" @keydown="onKey" />
        <button type="submit" :disabled="!text.trim() || state.phase === 'sending'">发送</button>
      </form>
    </template>
  </section>
</template>

<style scoped>
.panel {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  width: min(380px, calc(100vw - 32px));
  max-height: min(560px, calc(100vh - 32px));
  padding: 12px 14px;
  border-radius: 20px;
  background: rgba(30, 28, 24, 0.62);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: #fbf7f1;
  font: 400 14px/1.5 'PingFang SC', system-ui, sans-serif;
  user-select: text;
  -webkit-user-select: text;
  touch-action: auto;
}
header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.name {
  flex: 1;
  margin: 0;
  font-weight: 600;
  font-size: 15px;
}
.messages {
  flex: 1;
  min-height: 80px;
  margin: 8px 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
}
.messages li {
  margin: 6px 0;
}
.messages p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.user p {
  margin-left: auto;
  width: fit-content;
  max-width: 85%;
  padding: 6px 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.18);
}
.pending {
  opacity: 0.6;
}
.hint {
  margin: 8px 0;
  opacity: 0.75;
}
.error {
  margin: 0 0 6px;
  color: #ffc9b8;
  font-size: 13px;
}
form {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
textarea {
  flex: 1;
  resize: none;
  padding: 8px 10px;
  border: 0;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.12);
  color: inherit;
  font: inherit;
}
textarea::placeholder {
  color: rgba(251, 247, 241, 0.55);
}
button {
  padding: 6px 14px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.22);
  color: inherit;
  font: 500 14px/1.4 'PingFang SC', system-ui, sans-serif;
  cursor: pointer;
}
button.quiet {
  padding: 4px 10px;
  background: transparent;
  font-size: 13px;
  opacity: 0.85;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
