/**
 * The scene engine. It owns the canvases, the frame loop and everything that moves; it knows
 * nothing about Vue, the API or the schedule. The caller hands in a function returning the current
 * environment, and gets back the handles the rest of the app needs to draw on top of the scene.
 *
 * One frame, in order: composite the illustration from the two seasons in view, run the shader over
 * it, paint the sky bodies, then the weather wash and the living layers. Terrain occludes the sun
 * and the moon through the mask — the shader samples the mask, and the 2D fallback draws through it.
 */

import { ImageStore, isReady, layersFor } from './assets.ts'
import { H, W, coverFit, skyXY, waterRegion, type WaterRegion } from './geometry.ts'
import {
  NEUTRAL_WEATHER, PHASES, pastoralState, weatherTargets,
  type PastoralInput, type PastoralState, type WeatherChannels,
} from './model.ts'
import { clamp, smooth } from './math.ts'
import { windLull } from './wind.ts'
import { createAudioEngine, type AudioEngine } from './audio.ts'
import { BaseComposer } from './render/base.ts'
import { createGlLayer, type GlLayer } from './render/gl.ts'
import { createOccluder, type MaskState } from './render/occluder.ts'
import { createSkyRenderer, type SkyInput } from './render/sky.ts'
import { drawAtmosphere } from './render/atmosphere.ts'
import { createWaterLayer } from './render/water.ts'
import { createHouseLayer } from './render/house.ts'
import { createCreatureLayer } from './render/creatures.ts'
import { createPrecipitationLayer } from './render/precipitation.ts'
import { createResidentLayer, type ResidentMark } from './residents.ts'
import type { SpeciesKey } from '../fauna/species.ts'

/** A backgrounded tab or a long GC pause must not fast-forward the particles. */
const MAX_STEP_SECONDS = 0.05
/** Weather eases in over about a second, so an observation arriving never snaps the scene. */
const WEATHER_TAU = 1.1
/** Shade under the clouds: heavier while the rains are in, lighter in the dry season. */
const CLOUD_SHADE = { wet: 0.17, dry: 0.12 }
/** Seconds between flashes while a real thunderstorm is overhead. */
const THUNDER_GAP = [9, 22] as const
/** Particles seeded before the first frame, so the chimney is already smoking. */
const PRIMED_PUFFS = 160
/** Cloud drift, in art pixels per second, at wind strength 1. */
const CLOUD_DRIFT = 6
const CLOUD_FIELD = W + 640

export type PastoralEngine = {
  /** Latest computed state, or null before the first step. */
  readonly state: PastoralState | null
  /** True once the opening layers are decoded and the canvas is fading in. */
  readonly ready: boolean
  /** Who is standing on the pond now, including residents still fading out. */
  residents(): { id: string; species: SpeciesKey; presence: number }[]
  /** True when the shader is live; false means the still illustration plus the 2D layers. */
  readonly live: boolean
  readonly maskState: MaskState
  /** Pond geometry in screen pixels, for placing markers on the water. */
  readonly waterRegion: WaterRegion
  readonly audio: AudioEngine
  /** Where residents should stand, in CSS pixels at the waterline. The engine picks the animal. */
  setMarks(marks: readonly ResidentMark[]): void
  /** Push a ripple at a CSS-pixel point. False when that point is not over the pond. */
  rippleAt(x: number, y: number): boolean
  /** Resolve once the two seasons in view have every layer decoded. */
  preload(onProgress?: (done: number, total: number) => void): Promise<void>
  /** Freeze the scene's own animation clock. The environment keeps being read every frame. */
  setPaused(paused: boolean): void
  resize(): void
  destroy(): void
}

export type MountOptions = {
  canvas: HTMLCanvasElement
  /** Read the current environment. Called once per frame. */
  getInput: () => PastoralInput
  /** Called after the first frame is on screen. */
  onFirstFrame?: () => void
  /** Called when WebGL turned out to be unusable, so the app can say so. */
  onFallback?: () => void
}

const viewport = (): { width: number; height: number } => {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  return {
    width: Math.max(1, Math.round(window.innerWidth * dpr)),
    height: Math.max(1, Math.round(window.innerHeight * dpr)),
  }
}

export function mountPastoral(options: MountOptions): PastoralEngine {
  const { canvas, getInput } = options
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2d canvas context unavailable')

  const store = new ImageStore()
  const composer = new BaseComposer()
  const gl: GlLayer | null = createGlLayer()
  const occluder = createOccluder(store.load('mask'))
  const sky = createSkyRenderer(store.load('moon'))
  const water = createWaterLayer()
  const house = createHouseLayer()
  const creatures = createCreatureLayer()
  const precipitation = createPrecipitationLayer()
  const residents = createResidentLayer()
  const audio = createAudioEngine()

  let raw: PastoralInput = getInput()
  let weather: WeatherChannels = { ...NEUTRAL_WEATHER }
  let state: PastoralState | null = null
  let size = viewport()
  let region = waterRegion(size)
  let fit = coverFit(size.width, size.height)
  let shader = !!gl
  let fallbackReported = !gl
  let ready = false
  let paused = false
  let reduced = false
  let lastKey = ''
  let frame = 0
  let last = 0
  let elapsed = 0
  let cloudOffset = 0
  let thunderIn = THUNDER_GAP[0]

  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  const readMotion = (): void => {
    reduced = media.matches
  }
  readMotion()
  media.addEventListener('change', readMotion)

  /** Start loading the layers for the two seasons in view; ignores keys already requested. */
  const requestLayers = (current: PastoralState): void => {
    const key = `${current.currentKey}|${current.nextKey}`
    if (key === lastKey) return
    lastKey = key
    for (const season of [current.currentKey, current.nextKey]) {
      for (const phase of PHASES) for (const id of layersFor(season, phase)) store.load(id)
    }
  }

  /** The opening frame needs the current season at every phase, plus the mask and the moon. */
  const canStart = (current: PastoralState): boolean =>
    isReady(store.get('mask')) && isReady(store.get('moon')) &&
    PHASES.every((phase) => layersFor(current.currentKey, phase).every((id) => store.ready(id)))

  const skyInput = (current: PastoralState): SkyInput => ({
    sun: { alt: raw.sun.alt, az: raw.sun.az },
    moon: { alt: raw.moon.alt, az: raw.moon.az, lit: raw.moon.lit },
    day: current.day,
    night: current.weights.night,
    twilight: current.weights.twilight,
    dawn: current.twilight === 'dawn',
    gold: current.gold,
    rain: current.weather.rain,
    snow: current.weather.snow,
    time: elapsed,
  })

  /** Sun or moon position in art space, with the reflection strength the shader wants. */
  const body = (current: PastoralState, which: 'sun' | 'moon'): { x: number; y: number; strength: number } => {
    const wet = Math.max(current.weather.rain, current.weather.snow)
    const point = skyXY(which === 'sun' ? raw.sun.alt : raw.moon.alt, which === 'sun' ? raw.sun.az : raw.moon.az)
    const strength = which === 'sun'
      ? 0.75 * smooth(-1, 4, raw.sun.alt) * (1 - wet)
      : 0.55 * smooth(-1, 4, raw.moon.alt) * raw.moon.lit * (1 - current.day) * (1 - wet)
    return { x: point.x, y: point.y, strength: clamp(strength * current.reflection, 0, 1) }
  }

  const step = (deltaSeconds: number): void => {
    raw = getInput()
    const target = weatherTargets(raw.weather)
    const ease = reduced ? 1 : 1 - Math.exp(-deltaSeconds / WEATHER_TAU)
    weather = {
      rain: weather.rain + (target.rain - weather.rain) * ease,
      snow: weather.snow + (target.snow - weather.snow) * ease,
      fog: weather.fog + (target.fog - weather.fog) * ease,
      cloud: weather.cloud + (target.cloud - weather.cloud) * ease,
      wind: weather.wind + (target.wind - weather.wind) * ease,
      thunder: target.thunder,
    }
    // The availability flag stays the observation's own: it decides frost, and it is what keeps the
    // scene neutral when there is no usable weather at all. Only the intensities are eased.
    state = pastoralState({
      ...raw,
      reducedMotion: raw.reducedMotion || reduced,
      weather: { ...raw.weather, ...weather },
    })
    requestLayers(state)
  }

  const paint = (deltaSeconds: number): void => {
    const current = state
    if (!current) return
    store.retain([current.currentKey, current.nextKey])
    composer.compose(current, store)
    context.setTransform(fit.scale, 0, 0, fit.scale, fit.offsetX, fit.offsetY)

    const wet = Math.max(current.weather.rain, current.weather.snow)
    cloudOffset = (cloudOffset + deltaSeconds * CLOUD_DRIFT * (0.6 + 0.8 * windLull(elapsed)) * current.wind) %
      CLOUD_FIELD

    // The celestial canvas is repainted after this draw, so the texture the shader samples carries
    // the previous frame's sun and moon — the reference demo's ordering, invisible at frame rate.
    let live = false
    if (shader && gl) {
      const uploaded = gl.upload(
        {
          base: composer.canvas,
          cloud: composer.cloudCanvas,
          plate: composer.plateCanvas,
          celestial: composer.celestialCanvas,
          mask: store.load('mask'),
        },
        { base: composer.key, sky: composer.skyReady ? composer.key : '', celestial: sky.key },
      )
      if (uploaded) {
        gl.draw({
          time: elapsed,
          wind: current.wind,
          rain: current.weather.rain,
          day: current.day,
          ice: current.pondFrozen,
          lull: windLull(elapsed),
          foliage: current.foliage,
          snowy: current.snowy,
          cloudOffset,
          shade: (current.term >= 3 && current.term <= 10 ? CLOUD_SHADE.wet : CLOUD_SHADE.dry) *
            current.day * (1 - wet),
          skyReady: composer.skyReady,
          sun: body(current, 'sun'),
          moon: body(current, 'moon'),
        })
        context.drawImage(gl.domElement, 0, 0, W, H)
        live = true
      } else if (!fallbackReported) {
        shader = false
        fallbackReported = true
        options.onFallback?.()
      }
    }
    if (!live) context.drawImage(composer.canvas, 0, 0)

    sky.draw(context, skyInput(current), {
      live,
      celestial: composer.celestialCanvas,
      celestialContext: composer.celestialContext,
      occluded: (x, y, width, height, paint_) => occluder.draw(context, x, y, width, height, paint_),
    })

    drawAtmosphere(context, {
      rain: current.weather.rain,
      snow: current.weather.snow,
      fog: current.weather.fog,
      frost: current.weather.frost,
      day: current.day,
    })
    water.draw(context, {
      time: elapsed,
      rain: current.weather.rain,
      snow: current.weather.snow,
      day: current.day,
      frozen: current.pondFrozen ? 0.25 : 1,
      reflection: current.reflection,
      sun: { alt: raw.sun.alt, az: raw.sun.az },
      moon: { alt: raw.moon.alt, az: raw.moon.az, lit: raw.moon.lit },
      live,
    }, deltaSeconds)
    house.draw(context, {
      smoke: current.channels.smoke,
      day: current.day,
      wind: current.wind,
      time: elapsed,
    }, deltaSeconds)
    residents.draw(context, current, elapsed, reduced, deltaSeconds)
    creatures.draw(context, {
      channels: current.channels,
      day: current.day,
      wind: current.wind,
      time: elapsed,
      reducedMotion: reduced,
    }, deltaSeconds)
    precipitation.draw(context, {
      rain: current.weather.rain,
      snow: current.weather.snow,
      thunder: current.weather.thunder,
      wind: current.wind,
      time: elapsed,
      reducedMotion: reduced,
    }, deltaSeconds)

    // Lightning only where the real observation reports a thunderstorm, and never for a viewer who
    // asked for reduced motion.
    if (current.weather.thunder && !reduced) {
      thunderIn -= deltaSeconds
      if (thunderIn <= 0) {
        thunderIn = THUNDER_GAP[0] + Math.random() * (THUNDER_GAP[1] - THUNDER_GAP[0])
        precipitation.flash()
        audio.thunder()
      }
    }
    audio.update(current, elapsed)
  }

  const tick = (now: number): void => {
    frame = requestAnimationFrame(tick)
    const wall = Math.max(0, now - last)
    last = now
    if (paused) return
    const deltaSeconds = Math.min(MAX_STEP_SECONDS, wall / 1000)
    elapsed += deltaSeconds
    step(deltaSeconds)
    const current = state
    if (!current) return
    if (!ready) {
      if (!canStart(current)) return
      house.prime(PRIMED_PUFFS)
      ready = true
      canvas.classList.add('ready')
      options.onFirstFrame?.()
    }
    paint(deltaSeconds)
  }

  const onResize = (): void => engine.resize()
  const onShow = (): void => { last = performance.now() }

  const engine: PastoralEngine = {
    get state() {
      return state
    },
    get ready() {
      return ready
    },
    get live() {
      return shader && !!gl && gl.ok
    },
    get maskState() {
      return occluder.state
    },
    get waterRegion() {
      return region
    },
    get audio() {
      return audio
    },
    setMarks: (marks) => residents.setMarks(marks),
    residents: () => residents.residents(),
    rippleAt(cssX, cssY) {
      // Callers speak CSS pixels; the canvas and its pond region are in device pixels.
      const dpr = size.width / Math.max(1, window.innerWidth)
      const x = cssX * dpr
      const y = cssY * dpr
      if (!region.contains(x, y, 6 * dpr)) return false
      const scale = fit.scale || 1
      water.rippleAt((x - fit.offsetX) / scale, (y - fit.offsetY) / scale)
      return true
    },
    async preload(onProgress) {
      step(0)
      const current = state as PastoralState
      await store.preload([current.currentKey, current.nextKey], onProgress)
    },
    setPaused(next) {
      paused = next
      last = performance.now()
    },
    resize() {
      size = viewport()
      canvas.width = size.width
      canvas.height = size.height
      region = waterRegion(size)
      fit = coverFit(size.width, size.height)
      gl?.resize()
      // Same conversion as `rippleAt`: CSS pixels → device pixels → art space.
      const dpr = size.width / Math.max(1, window.innerWidth)
      residents.reproject({ dpr, scale: fit.scale || 1, offsetX: fit.offsetX, offsetY: fit.offsetY })
    },
    destroy() {
      cancelAnimationFrame(frame)
      frame = 0
      media.removeEventListener('change', readMotion)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onShow)
      audio.dispose()
      sky.dispose()
      gl?.dispose()
      canvas.classList.remove('ready')
    },
  }

  engine.resize()
  window.addEventListener('resize', onResize)
  document.addEventListener('visibilitychange', onShow)
  // Compose once before the first frame so `state` is never null for a caller that asks early.
  step(0)
  last = performance.now()
  frame = requestAnimationFrame(tick)
  return engine
}
