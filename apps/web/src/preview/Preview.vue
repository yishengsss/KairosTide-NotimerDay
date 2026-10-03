<script setup lang="ts">
/**
 * Preview page: the scene with the time controls the homepage must never have — pause, speed,
 * back-to-now, solar-term and hour jumps — plus weather presets.
 *
 * Query parameters, for reproducible screenshots:
 *   t=2026-06-21T05:10   start instant (device zone)        lat, lon   place
 *   speed=live|day|year  weather=clear|rain|snow|fog|…      shot       no fade-in, no UI
 *   marks=2, tasks=2     stand N anonymous residents on the pond, so the residents of an event can
 *                        be photographed across the year without seeding a schedule
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { formatClockDate, formatClockTime, realClock } from '../clock/real.ts'
import { SCENE_SPEEDS, SOLAR_TERM_MS, SPEED_LABEL, createSceneClock, type SceneSpeed } from '../clock/scene.ts'
import { createLiveEnvironment } from '../environment/live.ts'
import { loadLocation, makeLocation } from '../environment/location.ts'
import { controlsBox, layoutMarks, layoutShore } from '../presentation/markLayout.ts'
import { waterRegion } from '../scene/pastoral/geometry.ts'
import PastoralScene from '../scene/PastoralScene.vue'
import { every, type Cancel } from '../ui/delay.ts'
import { PREVIEW_WEATHERS, WEATHER_LABEL, isPreviewWeather, previewAtmosphere, type PreviewWeather }
  from './weather.ts'

const HOUR_MS = 3_600_000
const TERMS = ['立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至', '小暑', '大暑',
  '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至', '小寒', '大寒']

const query = new URLSearchParams(window.location.search)
const shot = query.has('shot')

function initialLocation() {
  const lat = Number(query.get('lat'))
  const lon = Number(query.get('lon'))
  if (query.has('lat') && query.has('lon') && Number.isFinite(lat) && Number.isFinite(lon)) {
    try {
      return makeLocation({ latitude: lat, longitude: lon, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        label: `${lat.toFixed(2)}, ${lon.toFixed(2)}`, source: 'chosen' })
    } catch {
      return loadLocation()
    }
  }
  return loadLocation()
}

const clock = createSceneClock(realClock)
const start = Date.parse(query.get('t') ?? '')
if (Number.isFinite(start)) clock.setInstant(start)
const speedParam = query.get('speed')
if ((SCENE_SPEEDS as readonly string[]).includes(speedParam ?? '')) clock.setSpeed(speedParam as SceneSpeed)
else if (Number.isFinite(start)) clock.setSpeed('day')

const environment = createLiveEnvironment(clock, initialLocation())
const weatherParam = query.get('weather')
const weather = ref<PreviewWeather>(isPreviewWeather(weatherParam) ? weatherParam : 'live')
environment.overrideAtmosphere(previewAtmosphere(weather.value))

const paused = ref(Number.isFinite(start) && !query.has('speed'))
const speed = ref<SceneSpeed>(clock.speed)
const scene = ref<InstanceType<typeof PastoralScene> | null>(null)
const sound = ref(false)
const readout = ref({ date: '', time: '', term: '', sun: '' })
/** What the scene decided to put on the water; for the preview panel and the screenshot tooling. */
const residents = ref<string[]>([])

let last = performance.now()
let raf = 0
let refresh: Cancel | null = null

function loop(now: number): void {
  if (!paused.value) clock.advance(now - last)
  last = now
  raf = requestAnimationFrame(loop)
}

function updateReadout(): void {
  const frame = environment.frame()
  residents.value = [...new Set((scene.value?.engine?.residents() ?? [])
    .filter((one) => one.presence > 0.5)
    .map((one) => one.species))]
  // The screenshot tooling reads who actually turned up, not who was asked for.
  document.body.dataset.residents = residents.value.join(',')
  readout.value = {
    date: formatClockDate(frame.instant),
    time: formatClockTime(frame.instant),
    term: TERMS[Math.floor(((frame.astro.solarLongitude - 315 + 360) % 360) / 15)] ?? '',
    sun: `日 ${frame.astro.sun.alt.toFixed(1)}° · 月 ${frame.astro.moon.alt.toFixed(1)}° ${Math.round(frame.astro.moon.lit * 100)}%`,
  }
}

function setSpeed(next: SceneSpeed): void {
  clock.setSpeed(next)
  speed.value = clock.speed
  paused.value = false
}

function shift(ms: number): void {
  clock.shift(ms)
  speed.value = clock.speed
  updateReadout()
}

function backToNow(): void {
  clock.followNow()
  speed.value = clock.speed
  paused.value = false
}

function chooseWeather(choice: PreviewWeather): void {
  weather.value = choice
  environment.overrideAtmosphere(previewAtmosphere(choice))
}

function toggleSound(): void {
  const engine = scene.value?.engine
  if (engine) sound.value = engine.audio.toggle()
}

/** Screenshot tooling waits on this attribute rather than guessing with a sleep. */
function markReady(): void {
  document.body.dataset.ready = '1'
  placeMarks()
}

/**
 * Anonymous stand-ins for events under way, placed by the same code the homepage uses. Only the
 * preview page ever does this: the homepage gets its marks from the schedule, never from a URL.
 */
const clampCount = (value: number): number => Math.max(0, Math.min(6, value || 0))
const eventCount = ref(clampCount(Number(query.get('marks') ?? 0)))
const taskCount = ref(clampCount(Number(query.get('tasks') ?? 0)))

function adjust(which: 'event' | 'task', delta: number): void {
  const target = which === 'event' ? eventCount : taskCount
  target.value = clampCount(target.value + delta)
  placeMarks()
}

function placeMarks(): void {
  const count = eventCount.value
  const engine = scene.value?.engine
  if (!engine) return
  // CSS pixels, exactly as the schedule layer lays them out: the pond region it uses is the CSS one.
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const spots = layoutMarks(waterRegion(viewport), count, {
    radius: 26,
    avoid: [controlsBox(viewport)],
  })
  const events = spots.flatMap((spot, index) => (spot ? [{ id: `preview-${index}`, ...spot }] : []))
  const shore = layoutShore(waterRegion(viewport), taskCount.value, events, 20)
  const tasks = shore.flatMap((spot, index) => (spot ? [{ id: `preview-task-${index}`, ...spot, kind: 'task' as const }] : []))
  engine.setMarks([...events, ...tasks])
}

function onKey(event: KeyboardEvent): void {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const key = event.key
  if (key === ' ') { event.preventDefault(); paused.value = !paused.value }
  else if (key === '1' || key === '2' || key === '3') setSpeed(SCENE_SPEEDS[Number(key) - 1] ?? 'live')
  else if (key === '0') backToNow()
  else if (key === 'ArrowRight') shift(SOLAR_TERM_MS)
  else if (key === 'ArrowLeft') shift(-SOLAR_TERM_MS)
  else if (key === 'ArrowUp') shift(HOUR_MS)
  else if (key === 'ArrowDown') shift(-HOUR_MS)
  else if (key === 'm' || key === 'M') toggleSound()
}

const location = computed(() => environment.location)

onMounted(() => {
  if (weather.value === 'live') environment.start()
  window.addEventListener('keydown', onKey)
  raf = requestAnimationFrame(loop)
  updateReadout()
  refresh = every(250, updateReadout)
  if (shot) document.documentElement.classList.add('shot')
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  refresh?.()
  environment.stop()
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <PastoralScene ref="scene" :frame="environment.frame" @ready="markReady" />
  <aside v-if="!shot" class="panel">
    <p class="readout">{{ readout.date }} {{ readout.time }} · {{ readout.term }}</p>
    <p class="readout dim">{{ location.label }}（{{ location.accuracy === 'precise' ? '精确' : '估算' }}） · {{ readout.sun }}</p>
    <p v-if="residents.length" class="readout dim">生灵：{{ residents.join('、') }}</p>
    <div class="row">
      <button type="button" @click="paused = !paused">{{ paused ? '继续' : '暂停' }}</button>
      <button v-for="item in SCENE_SPEEDS" :key="item" type="button" :class="{ on: speed === item && !paused }"
        @click="setSpeed(item)">{{ SPEED_LABEL[item] }}</button>
      <button type="button" @click="backToNow">此刻</button>
    </div>
    <div class="row">
      <button type="button" @click="shift(-SOLAR_TERM_MS)">‹ 节气</button>
      <button type="button" @click="shift(SOLAR_TERM_MS)">节气 ›</button>
      <button type="button" @click="shift(-HOUR_MS)">‹ 时</button>
      <button type="button" @click="shift(HOUR_MS)">时 ›</button>
    </div>
    <div class="row">
      <button v-for="item in PREVIEW_WEATHERS" :key="item" type="button" :class="{ on: weather === item }"
        @click="chooseWeather(item)">{{ WEATHER_LABEL[item] }}</button>
    </div>
    <div class="row">
      <button type="button" @click="adjust('event', -1)">‹</button>
      <span class="readout">事件 {{ eventCount }}</span>
      <button type="button" @click="adjust('event', 1)">›</button>
      <button type="button" @click="adjust('task', -1)">‹</button>
      <span class="readout">待办 {{ taskCount }}</span>
      <button type="button" @click="adjust('task', 1)">›</button>
    </div>
    <div class="row">
      <button type="button" :class="{ on: sound }" @click="toggleSound">环境音</button>
    </div>
  </aside>
</template>

<style scoped>
.panel {
  position: fixed;
  left: 12px;
  bottom: 12px;
  max-width: min(560px, calc(100vw - 24px));
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(20, 18, 16, 0.55);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  color: #fbf7f1;
  font: 13px/1.4 'PingFang SC', system-ui, sans-serif;
  z-index: 10;
}
.readout {
  margin: 0 0 4px;
  font-variant-numeric: tabular-nums;
}
.dim {
  opacity: 0.75;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
button {
  padding: 4px 10px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
button.on {
  background: rgba(255, 255, 255, 0.4);
  color: #1d1a16;
}
</style>
