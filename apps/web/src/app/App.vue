<script setup lang="ts">
/**
 * The homepage. A living scene; the schedule appears over it only when something is due or under
 * way. No resident clock, timeline, countdown, task list or next event — by rule.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

import AssistantPanel from '../assistant/AssistantPanel.vue'
import HouseEntry from '../assistant/HouseEntry.vue'
import { createAssistantSession } from '../assistant/session.ts'
import { realClock } from '../clock/real.ts'
import { createSceneClock } from '../clock/scene.ts'
import { createScheduleClock } from '../clock/schedule.ts'
import { resolveLocationOnEntry } from '../environment/geolocate.ts'
import { createLiveEnvironment } from '../environment/live.ts'
import { loadLocation } from '../environment/location.ts'
import TimePeek from '../peek/TimePeek.vue'
import { createLongPress, isBlankTarget } from '../peek/longPress.ts'
import ScheduleLayer from '../presentation/ScheduleLayer.vue'
import TaskLayer from '../presentation/TaskLayer.vue'
import { fetchTasks, moveTask } from '../api/tasks.ts'
import { createMotivation } from '../tasks/motivation.ts'
import { createTaskStore } from '../tasks/store.ts'
import { present } from '../presentation/presenter.ts'
import AmbientControls from '../scene/AmbientControls.vue'
import PastoralScene from '../scene/PastoralScene.vue'
import { createSyncEngine } from '../schedule/sync.ts'
import { scheduleStore as store } from '../schedule/store.ts'
import { every, type Cancel } from '../ui/delay.ts'
import { useViewport } from '../ui/viewport.ts'

const sceneClock = createSceneClock(realClock)
const scheduleClock = createScheduleClock(realClock)
const storedPlace = loadLocation()
const environment = createLiveEnvironment(sceneClock, storedPlace)

/** Interaction state: cards folded back into their resident, exceptions the server refused. */
const interaction = reactive({ folded: new Set<string>(), unsynced: new Set<string>() })

const sync = createSyncEngine({
  store,
  clock: scheduleClock,
  onExceptionFailed: (id) => {
    interaction.unsynced.add(id)
  },
})

/** The assistant opens from the farmhouse; a saved draft shows up in the schedule at once. */
const tasks = createTaskStore({ fetchTasks: () => fetchTasks(), moveTask })
const motivation = createMotivation(Date.now())
const visiting = ref<string[]>([])

const assistant = createAssistantSession({
  onCommitted: () => {
    void sync.refresh()
    void tasks.refresh()
  },
})

/** Presenter time, refreshed once a second; the edge glow's CSS transition smooths the steps. */
const now = ref(scheduleClock.now())
let tick: Cancel | null = null

const view = computed(() => present(store.snapshot.value, store.overlay, interaction, now.value))

const scene = ref<InstanceType<typeof PastoralScene> | null>(null)
const viewport = useViewport()
const peek = ref<InstanceType<typeof TimePeek> | null>(null)
const sound = ref(false)

function toggleSound(): void {
  const engine = scene.value?.engine
  if (engine) sound.value = engine.audio.toggle()
}

function fold(id: string): void {
  interaction.folded.add(id)
}

function open(id: string): void {
  interaction.folded.delete(id)
}

function excuse(id: string, version: number): void {
  interaction.unsynced.delete(id)
  sync.excuse(id, version)
}

type Mark = { id: string; x: number; y: number; kind?: 'event' | 'task' }
const eventMarks = ref<Mark[]>([])
const taskMarks = ref<Mark[]>([])

/** The scene draws a resident wherever either layer has put a mark. */
function pushMarks(): void {
  scene.value?.engine?.setMarks([...eventMarks.value, ...taskMarks.value])
}

function onMarks(marks: Mark[]): void {
  eventMarks.value = marks
  pushMarks()
}

function onTaskMarks(marks: Mark[]): void {
  taskMarks.value = marks
  pushMarks()
}

/** The rhythm only runs over a list that was actually read; a failed read brings nobody out. */
function tickMotivation(): void {
  const v = view.value
  const idle = assistant.state.phase === 'closed' && !document.hidden && !v.reminder && !v.conflict
    && v.cards.every((card) => card.folded)
  const planned = tasks.state.status === 'ready'
    ? tasks.state.items.filter((task) => task.lifecycle === 'planned').map((task) => task.taskId)
    : []
  visiting.value = motivation.tick(Date.now(), idle, planned)
}

const press = createLongPress((point) => peek.value?.show(point))

function onPointerDown(event: PointerEvent): void {
  if (!event.isPrimary) return
  press.down({ x: event.clientX, y: event.clientY }, isBlankTarget(event.target))
}

function onPointerMove(event: PointerEvent): void {
  if (event.isPrimary) press.move({ x: event.clientX, y: event.clientY })
}

function onPointerUp(event: PointerEvent): void {
  if (!event.isPrimary) return
  // A short tap on the bare water leaves a ripple; anywhere else it does nothing.
  if (press.up() && isBlankTarget(event.target)) scene.value?.engine?.rippleAt(event.clientX, event.clientY)
}

function onVisibility(): void {
  if (document.hidden) {
    press.cancel()
    peek.value?.dismiss()
  } else {
    void tasks.refresh()
  }
}

onMounted(() => {
  environment.start()
  sync.start()
  tick = every(1000, () => {
    now.value = scheduleClock.now()
    tickMotivation()
  })
  void tasks.refresh()
  document.addEventListener('visibilitychange', onVisibility)
  // The homepage asks the device where it is, once, on the way in. No control, no guide card: the
  // browser's own prompt is the whole interface, and a refusal is remembered. Nothing waits on it.
  void resolveLocationOnEntry({ current: storedPlace, geolocator: navigator.geolocation }).then(
    (found) => {
      if (found) environment.setLocation(found)
    },
  )
})

onBeforeUnmount(() => {
  tick?.()
  sync.stop()
  environment.stop()
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <main
    class="home"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="press.cancel()"
    @contextmenu.prevent
  >
    <PastoralScene ref="scene" :frame="environment.frame" :mood="view.mood" />
    <ScheduleLayer
      :view="view"
      :viewport="viewport"
      @marks="onMarks"
      @acknowledge="(id, version) => sync.acknowledge(id, version)"
      @fold="fold"
      @open="open"
      @excuse="excuse"
      @choose="(group, chosen, revision) => sync.decide(group, chosen, revision)"
    />
    <TaskLayer :store="tasks" :visiting="visiting" :taken="eventMarks" :viewport="viewport"
      @marks="onTaskMarks" @dismissed="(id) => motivation.dismiss(id)" />
    <TimePeek ref="peek" />
    <HouseEntry v-if="assistant.state.phase === 'closed'" :viewport="viewport" @open="assistant.open()" />
    <AssistantPanel v-else :session="assistant" />
    <AmbientControls :sound="sound" @toggle-sound="toggleSound" />
  </main>
</template>

<style scoped>
.home {
  position: fixed;
  inset: 0;
  overflow: hidden;
  /* The whole page is one gesture surface and never scrolls; `manipulation` still lets iOS claim a
     held finger as a pan and fire pointercancel, which abandons the long press. */
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}
</style>
