/**
 * Composes the illustration the renderer samples: two adjacent key seasons crossed with
 * (day / dawn-or-dusk / night). Also produces the three sky layers the shader needs separately —
 * movable clouds, the clean sky plate the clouds are painted over, and the celestial layer
 * (sun, moon, stars) that goes underneath them.
 */

import { baseId, cloudId, isReady, plateId, type ImageStore } from '../assets.ts'
import { H, PLATE_H, PLATE_W, SKY_H, W } from '../geometry.ts'
import type { PastoralState, Phase } from '../model.ts'
import { KEYS } from '../model.ts'

const canvas = (width: number, height: number): HTMLCanvasElement => {
  const element = document.createElement('canvas')
  element.width = width
  element.height = height
  return element
}

export class BaseComposer {
  readonly canvas = canvas(W, H)
  readonly cloudCanvas = canvas(W, SKY_H)
  readonly plateCanvas = canvas(PLATE_W, PLATE_H)
  readonly celestialCanvas = canvas(W, SKY_H)

  /** False until every cloud and plate layer for the current blend has decoded. */
  skyReady = false
  /** Recompose key from the last compose() call; the shader uploads only when it changes. */
  key = ''

  private readonly context = this.canvas.getContext('2d') as CanvasRenderingContext2D
  private readonly scratch = canvas(W, H)
  private readonly scratchContext = this.scratch.getContext('2d') as CanvasRenderingContext2D
  private readonly cloudContext = this.cloudCanvas.getContext('2d') as CanvasRenderingContext2D
  private readonly plateContext = this.plateCanvas.getContext('2d') as CanvasRenderingContext2D
  readonly celestialContext = this.celestialCanvas.getContext('2d') as CanvasRenderingContext2D

  /** Blend one phase of both seasons onto a context; returns false when neither decoded. */
  private blend(context: CanvasRenderingContext2D, state: PastoralState, store: ImageStore, phase: Phase): boolean {
    const current = store.get(baseId(state.currentKey, phase))
    const next = store.get(baseId(state.nextKey, phase))
    const hasCurrent = isReady(current)
    const hasNext = isReady(next)
    context.globalAlpha = 1
    if (current) context.drawImage(current, 0, 0, W, H)
    if (next && state.seasonBlend > 0.001) {
      context.globalAlpha = hasCurrent ? state.seasonBlend : 1
      context.drawImage(next, 0, 0, W, H)
    }
    context.globalAlpha = 1
    return hasCurrent || hasNext
  }

  /** Rebuild the base bitmap and the sky layers when the state moved enough to change the key. */
  compose(state: PastoralState, store: ImageStore): void {
    const twilight: Phase = state.twilight
    const layers = (['night', twilight, 'day'] as Phase[])
      .map((phase): [Phase, number] =>
        [phase, state.weights[phase === 'night' ? 'night' : phase === 'day' ? 'day' : 'twilight']])
      .filter(([, weight]) => weight > 0.001)
    const loaded = layers
      .map(([phase]) => Number(isReady(store.get(baseId(state.currentKey, phase)))) +
        Number(isReady(store.get(baseId(state.nextKey, phase)))))
      .join('')
    const key = [
      state.currentKey, twilight, state.seasonBlend.toFixed(3),
      layers.map(([phase, weight]) => phase + weight.toFixed(3)).join(','), loaded,
    ].join('|')
    if (key === this.key) return
    this.key = key

    // Stacking with running alpha yields the weighted average of the layers.
    let accumulated = 0
    for (const [phase, weight] of layers) {
      if (accumulated === 0) {
        if (this.blend(this.context, state, store, phase)) accumulated = weight
        continue
      }
      if (!this.blend(this.scratchContext, state, store, phase)) continue
      accumulated += weight
      this.context.globalAlpha = weight / accumulated
      this.context.drawImage(this.scratch, 0, 0)
      this.context.globalAlpha = 1
    }

    const combined = layers
      .flatMap(([phase, weight]): [string, number][] => [
        [baseId(state.currentKey, phase), weight * (1 - state.seasonBlend)],
        [baseId(state.nextKey, phase), weight * state.seasonBlend],
      ])
      .filter(([, weight]) => weight > 0.001)
    this.skyReady = combined.every(([id]) => isReady(store.get(cloudIdFor(id))) && isReady(store.get(plateIdFor(id))))
    if (!this.skyReady) return
    const total = combined.reduce((sum, [, weight]) => sum + weight, 0)
    const targets: [CanvasRenderingContext2D, (id: string) => string, number, number][] = [
      [this.cloudContext, cloudIdFor, W, SKY_H],
      [this.plateContext, plateIdFor, PLATE_W, PLATE_H],
    ]
    for (const [context, toId, width, height] of targets) {
      context.globalCompositeOperation = 'source-over'
      context.globalAlpha = 1
      context.clearRect(0, 0, width, height)
      context.globalCompositeOperation = 'lighter'
      for (const [id, weight] of combined) {
        context.globalAlpha = weight / total
        context.drawImage(store.load(toId(id)), 0, 0, width, height)
      }
      context.globalCompositeOperation = 'source-over'
      context.globalAlpha = 1
    }
  }
}

/** The composers work from base ids; the sky layers map 1:1 onto them. */
const cloudIdFor = (base: string): string => {
  const [key, phase] = base.split('-')
  return cloudId(key as (typeof KEYS)[number], phase as Phase)
}

const plateIdFor = (base: string): string => {
  const [key, phase] = base.split('-')
  return plateId(key as (typeof KEYS)[number], phase as Phase)
}
