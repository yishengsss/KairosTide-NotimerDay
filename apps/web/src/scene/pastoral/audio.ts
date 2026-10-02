/**
 * Ambient sound, synthesized live with Web Audio: a wind bed, a rain bed, cicadas, and occasional
 * birds, frogs and crickets. Nothing is a recorded file, so the mix always matches the scene.
 *
 * Default is off; the browser only lets audio start from a gesture, so the context is created on
 * the first toggle. Thunder is triggered by the caller, which only does so for a real thunderstorm.
 */

import { after } from '../../ui/delay.ts'
import { rnd } from './math.ts'
import { gustAt } from './wind.ts'
import type { PastoralState } from './model.ts'

const TICK_MS = 220

type Chain = GainNode & { level: number }

export type AudioEngine = {
  readonly enabled: boolean
  /** Returns the new state: true means sound is on. */
  toggle(): boolean
  /** Push the current scene channels; called once per frame or on state change. */
  update(state: PastoralState, time: number): void
  /** A distant rumble, only from a real thunderstorm. */
  thunder(): void
  dispose(): void
}

type AudioContextConstructor = new () => AudioContext

export function createAudioEngine(): AudioEngine {
  let context: AudioContext | null = null
  let master: GainNode | null = null
  let noise: AudioBufferSourceNode | null = null
  let wind: Chain | null = null
  let rain: Chain | null = null
  let cicada: Chain | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let state: PastoralState | null = null
  let clock = 0
  let enabled = false

  const initialize = (): void => {
    const Constructor: AudioContextConstructor | undefined =
      (window as unknown as { AudioContext?: AudioContextConstructor; webkitAudioContext?: AudioContextConstructor })
        .AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext
    if (!Constructor) return
    context = new Constructor()
    master = context.createGain()
    master.gain.value = 0
    master.connect(context.destination)
    // Brown-ish noise: one long buffer, looped, filtered into each bed.
    const buffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1
      last = last * 0.5 + white * 0.5
      data[i] = last
    }
    noise = context.createBufferSource()
    noise.buffer = buffer
    noise.loop = true
    noise.start()
    const chain = (filters: [BiquadFilterType, number, number?][], level: number): Chain => {
      let node: AudioNode = noise as AudioNode
      for (const [type, frequency, q] of filters) {
        const biquad = context?.createBiquadFilter()
        if (!biquad) continue
        biquad.type = type
        biquad.frequency.value = frequency
        if (q !== undefined) biquad.Q.value = q
        node.connect(biquad)
        node = biquad
      }
      const gain = context?.createGain() as Chain
      gain.gain.value = 0
      gain.level = level
      node.connect(gain)
      gain.connect(master as GainNode)
      return gain
    }
    wind = chain([['bandpass', 420, 0.4], ['lowpass', 900]], 0.5)
    rain = chain([['highpass', 1400], ['lowpass', 9000]], 0.42)
    // Cicadas: narrow-band noise with a fast tremolo on top.
    const band = context.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 5200
    band.Q.value = 9
    noise.connect(band)
    const tremolo = context.createGain()
    tremolo.gain.value = 0.5
    band.connect(tremolo)
    const lfo = context.createOscillator()
    lfo.frequency.value = 42
    const lfoGain = context.createGain()
    lfoGain.gain.value = 0.5
    lfo.connect(lfoGain)
    lfoGain.connect(tremolo.gain)
    lfo.start()
    cicada = context.createGain() as Chain
    cicada.gain.value = 0
    cicada.level = 0.11
    tremolo.connect(cicada)
    cicada.connect(master)
    timer = setInterval(tick, TICK_MS)
  }

  const tone = (type: OscillatorType, from: number, to: number, at: number, duration: number, peak: number,
    filter?: number): void => {
    if (!context || !master) return
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(from, at)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + duration)
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(peak, at + duration * 0.25)
    gain.gain.linearRampToValueAtTime(0, at + duration)
    if (filter !== undefined) {
      const biquad = context.createBiquadFilter()
      biquad.type = 'bandpass'
      biquad.frequency.value = filter
      biquad.Q.value = 3
      oscillator.connect(biquad)
      biquad.connect(gain)
    } else {
      oscillator.connect(gain)
    }
    gain.connect(master)
    oscillator.start(at)
    oscillator.stop(at + duration + 0.05)
  }

  const tick = (): void => {
    if (!enabled || !context || !state) return
    const now = context.currentTime
    const channels = state.channels
    wind?.gain.setTargetAtTime((wind.level) * channels.aWind * (0.35 + 1.1 * gustAt(768, clock)), now, 1.2)
    rain?.gain.setTargetAtTime((rain.level) * state.weather.rain, now, 0.8)
    cicada?.gain.setTargetAtTime((cicada.level) * channels.aCicada * rnd(0.7, 1), now, 1.5)
    if (Math.random() < channels.aBirds * 0.11) {
      const base = rnd(2300, 4300)
      const count = 2 + Math.floor(rnd(4))
      for (let i = 0; i < count; i++) {
        tone('sine', base * rnd(0.9, 1.15), base * rnd(1.05, 1.5), now + i * rnd(0.09, 0.15), rnd(0.05, 0.11), 0.035)
      }
    }
    if (Math.random() < channels.aFrogs * 0.1) {
      const base = rnd(95, 150)
      const count = 3 + Math.floor(rnd(4))
      const filter = rnd(550, 900)
      for (let i = 0; i < count; i++) tone('square', base, base * 0.92, now + i * 0.085, 0.06, 0.03, filter)
    }
    if (Math.random() < channels.aCrickets * 0.3) {
      const base = rnd(4200, 4800)
      for (let i = 0; i < 3; i++) tone('sine', base, base * 1.01, now + i * 0.05, 0.032, 0.014)
    }
  }

  return {
    get enabled() {
      return enabled
    },
    toggle() {
      if (!context) initialize()
      if (!context || !master) return false
      enabled = !enabled
      if (enabled) void context.resume()
      master.gain.setTargetAtTime(enabled ? 0.9 : 0, context.currentTime, 0.5)
      return enabled
    },
    update(next, time) {
      state = next
      clock = time
    },
    thunder() {
      if (!enabled || !context || !master || !noise) return
      const at = context.currentTime + rnd(0.6, 1.6)
      const biquad = context.createBiquadFilter()
      const gain = context.createGain()
      biquad.type = 'lowpass'
      biquad.frequency.value = 130
      noise.connect(biquad)
      biquad.connect(gain)
      gain.connect(master)
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(0.5, at + 0.3)
      gain.gain.exponentialRampToValueAtTime(0.001, at + 3.6)
      after(6500, () => {
        try {
          noise?.disconnect(biquad)
        } catch {
          /* already gone */
        }
      })
    },
    dispose() {
      if (timer) clearInterval(timer)
      timer = null
      enabled = false
      state = null
      void context?.close()
      context = null
      master = null
      noise = null
      wind = null
      rain = null
      cicada = null
    },
  }
}
