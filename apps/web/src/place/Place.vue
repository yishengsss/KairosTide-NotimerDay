<script setup lang="ts">
/**
 * Place settings. Search a city or, only when the user asks, use the device's position. The choice
 * is stored on this device and never sent anywhere except as coordinates for the weather lookup.
 */
import { onBeforeUnmount, ref } from 'vue'

import { ApiError } from '../api/errors.ts'
import { fetchPlaces, fetchWeatherReport, type Place, type WeatherReport } from '../api/weather.ts'
import { deviceLocation, forgetDenial, readPosition } from '../environment/geolocate.ts'
import { clearLocation, loadLocation, makeLocation, saveLocation } from '../environment/location.ts'
import type { SceneLocation } from '../environment/types.ts'
import { createDebounce } from '../ui/delay.ts'

const current = ref<SceneLocation>(loadLocation())
const query = ref('')
const results = ref<Place[]>([])
const status = ref('')
const busy = ref(false)
const report = ref<WeatherReport | null>(null)
let controller: AbortController | null = null

const zone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

async function loadReport(): Promise<void> {
  report.value = null
  if (current.value.accuracy !== 'precise') return
  try {
    report.value = await fetchWeatherReport(current.value.latitude, current.value.longitude)
  } catch {
    report.value = null
  }
}

async function search(): Promise<void> {
  const text = query.value.trim()
  controller?.abort()
  if (text.length < 1) {
    results.value = []
    status.value = ''
    return
  }
  controller = new AbortController()
  busy.value = true
  status.value = ''
  try {
    results.value = await fetchPlaces(text, { signal: controller.signal })
    if (!results.value.length) status.value = '没有找到这个地方'
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    results.value = []
    status.value = error instanceof ApiError && error.code === 'NETWORK' ? '网络不可用' : '搜索暂时不可用'
  } finally {
    busy.value = false
  }
}

const debounced = createDebounce(350, () => void search())

function choose(place: Place): void {
  const label = [place.name, place.admin1, place.country].filter(Boolean).join(' · ')
  const location = makeLocation({ latitude: place.latitude, longitude: place.longitude,
    timezone: place.timezone || zone(), label, source: 'chosen' })
  saveLocation(location)
  current.value = location
  results.value = []
  query.value = ''
  status.value = '已保存'
  void loadReport()
}

async function useDevice(): Promise<void> {
  if (!navigator.geolocation) {
    status.value = '这台设备不支持定位'
    return
  }
  status.value = '正在定位…'
  // The shared reader rounds to two decimals and tells a refusal apart from a missing fix.
  const read = await readPosition(navigator.geolocation, 10_000)
  if (!read.ok) {
    status.value = read.denied ? '没有拿到位置，可以改用搜索' : '暂时没有定位，可以改用搜索'
    return
  }
  // Asking here on purpose lifts an earlier refusal, so the homepage may ask again.
  forgetDenial()
  const location = deviceLocation(read.point, zone())
  saveLocation(location)
  current.value = location
  status.value = '已保存'
  void loadReport()
}

function reset(): void {
  clearLocation()
  forgetDenial()
  current.value = loadLocation()
  report.value = null
  status.value = '已清除，场景将按时区估算'
}

void loadReport()
onBeforeUnmount(() => {
  debounced.cancel()
  controller?.abort()
})
</script>

<template>
  <main class="place">
    <h1>设置地点</h1>
    <section class="now">
      <p class="label">{{ current.label }}</p>
      <p class="detail">
        {{ current.latitude.toFixed(2) }}°, {{ current.longitude.toFixed(2) }}° ·
        {{ current.accuracy === 'precise' ? '日月与天气按此地计算' : '按时区估算，不请求天气' }}
      </p>
      <p v-if="report" class="detail">
        天气：{{ report.atmosphere.availability === 'available' ? report.atmosphere.condition : '暂不可用' }}
        <span v-if="report.attribution"> · {{ report.attribution }}</span>
      </p>
    </section>

    <label class="search">
      <span>搜索城市</span>
      <input v-model="query" type="search" autocomplete="off" placeholder="例如：西安" @input="debounced.restart()"
        @keydown.enter.prevent="search" />
    </label>
    <ul v-if="results.length" class="results">
      <li v-for="place in results" :key="`${place.latitude},${place.longitude},${place.name}`">
        <button type="button" @click="choose(place)">
          <strong>{{ place.name }}</strong>
          <span>{{ [place.admin1, place.country].filter(Boolean).join(' · ') }}</span>
        </button>
      </li>
    </ul>

    <div class="actions">
      <button type="button" @click="useDevice">使用当前位置</button>
      <button type="button" class="quiet" @click="reset">清除</button>
      <a href="./">回到首页</a>
    </div>
    <p class="status" role="status" aria-live="polite">{{ busy ? '搜索中…' : status }}</p>
  </main>
</template>

<style scoped>
.place {
  box-sizing: border-box;
  height: 100%;
  overflow: auto;
  max-width: 520px;
  margin: 0 auto;
  padding: 32px 20px;
  color: #f3eee6;
  font: 15px/1.5 'PingFang SC', system-ui, sans-serif;
}
h1 {
  margin: 0 0 16px;
  font-size: 22px;
}
.now {
  padding: 14px 16px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.07);
}
.label {
  margin: 0;
  font-weight: 600;
}
.detail {
  margin: 4px 0 0;
  font-size: 13px;
  opacity: 0.75;
}
.search {
  display: grid;
  gap: 6px;
  margin-top: 20px;
}
input {
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.25);
  color: inherit;
  font: inherit;
}
.results {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: grid;
  gap: 6px;
}
.results button {
  width: 100%;
  display: grid;
  gap: 2px;
  text-align: left;
  border-radius: 10px;
}
.results span {
  font-size: 13px;
  opacity: 0.75;
}
button,
a {
  padding: 8px 14px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  color: inherit;
  font: inherit;
  text-decoration: none;
  cursor: pointer;
}
button.quiet {
  background: transparent;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
}
button:focus-visible,
a:focus-visible,
input:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.7);
  outline-offset: 2px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
}
.status {
  min-height: 1.5em;
  margin: 12px 0 0;
  font-size: 13px;
  opacity: 0.8;
}
</style>
