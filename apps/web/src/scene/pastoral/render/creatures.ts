/**
 * The living parts of the scene: swallows, the autumn goose formation, butterflies, fireflies and
 * the falling petals or leaves. Each group has its own channel in PastoralState.
 */

import { H, W } from '../geometry.ts'
import { rnd } from '../math.ts'
import { gustAt } from '../wind.ts'
import type { PastoralState } from '../model.ts'

type Swallow = { x: number; y: number; direction: 1 | -1; speed: number; phase: number; amplitude: number; wait: number }
type Butterfly = { x: number; y: number; phase: number; tint: string }
type Firefly = { x: number; y: number; phase: number; speed: number; vx: number; vy: number }
type Faller = { x: number; y: number; vx: number; vy: number; rotation: number; spin: number; scale: number; phase: number }

const SWALLOW_COUNT = 3
const BUTTERFLY_COUNT = 4
const FIREFLY_COUNT = 34
const FALLER_COUNT = 30

export type CreatureInput = {
  channels: PastoralState['channels']
  day: number
  wind: number
  time: number
  reducedMotion: boolean
}

export type CreatureLayer = { draw(context: CanvasRenderingContext2D, input: CreatureInput, deltaSeconds: number): void }

export function createCreatureLayer(): CreatureLayer {
  const newSwallow = (first: boolean): Swallow => {
    const direction: 1 | -1 = Math.random() < 0.5 ? 1 : -1
    return {
      x: first ? rnd(W) : (direction > 0 ? -40 : W + 40),
      y: rnd(380, 720),
      direction,
      speed: rnd(150, 230),
      phase: rnd(6.28),
      amplitude: rnd(20, 60),
      wait: first ? 0 : rnd(1, 7),
    }
  }
  const swallows = Array.from({ length: SWALLOW_COUNT }, () => newSwallow(true))
  const geese = { x: W + 200, y: 150, wait: 4 }
  const butterflies: Butterfly[] = Array.from({ length: BUTTERFLY_COUNT }, (_, i) => ({
    x: rnd(60, 620), y: rnd(800, 960), phase: rnd(6.28), tint: i % 2 ? '#fff6d8' : '#ffffff',
  }))
  const fireflies: Firefly[] = Array.from({ length: FIREFLY_COUNT }, () => ({
    x: rnd(W), y: rnd(610, 1000), phase: rnd(6.28), speed: rnd(0.5, 1.4), vx: rnd(-8, 8), vy: rnd(-5, 5),
  }))
  const newFaller = (first: boolean): Faller => ({
    x: rnd(1130, 1500), y: first ? rnd(250, H) : rnd(230, 520),
    vx: rnd(-14, 6), vy: rnd(22, 48), rotation: rnd(6.28), spin: rnd(-2.5, 2.5), scale: rnd(0.7, 1.3), phase: rnd(6.28),
  })
  const fallers = Array.from({ length: FALLER_COUNT }, () => newFaller(true))

  const bird = (context: CanvasRenderingContext2D, x: number, y: number, size: number, flap: number): void => {
    context.beginPath()
    context.moveTo(x - size, y - size * flap)
    context.quadraticCurveTo(x - size * 0.45, y - size * 0.25 * flap - size * 0.2, x, y)
    context.quadraticCurveTo(x + size * 0.45, y - size * 0.25 * flap - size * 0.2, x + size, y - size * flap)
    context.stroke()
  }

  return {
    draw(context, input, deltaSeconds) {
      const { channels, time } = input
      if (channels.swallows > 0.03) {
        context.strokeStyle = `rgba(32,38,52,${0.85 * channels.swallows})`
        context.lineWidth = 2
        context.lineCap = 'round'
        for (let i = 0; i < swallows.length; i++) {
          const swallow = swallows[i]
          if (!swallow) continue
          if (swallow.wait > 0) {
            swallow.wait -= deltaSeconds
            continue
          }
          swallow.x += swallow.direction * swallow.speed * deltaSeconds
          const y = swallow.y + Math.sin(swallow.x * 0.008 + swallow.phase) * swallow.amplitude
          bird(context, swallow.x, y, 9, Math.sin(time * 14 + swallow.phase) * 0.9)
          if (swallow.x < -60 || swallow.x > W + 60) swallows[i] = newSwallow(false)
        }
      }
      if (channels.geese > 0.03 || geese.x < W + 150) {
        if (geese.wait > 0) geese.wait -= deltaSeconds
        else {
          geese.x -= 34 * deltaSeconds
          context.strokeStyle = `rgba(40,44,58,${0.8 * Math.max(channels.geese, 0.3)})`
          context.lineWidth = 1.8
          for (let i = 0; i < 9; i++) {
            const row = Math.ceil(i / 2)
            const side = i % 2 ? 1 : -1
            bird(context, geese.x + row * 26, geese.y + side * row * 13 - row * 3, 7.5, Math.sin(time * 5 + i * 0.8) * 0.7)
          }
          if (geese.x < -320) {
            geese.x = W + 200
            geese.y = rnd(90, 210)
            geese.wait = channels.geese > 0.03 ? rnd(8, 22) : 1e9
          }
        }
        if (geese.wait > 1e8 && channels.geese > 0.03) geese.wait = rnd(2, 8)
      }
      if (channels.butterflies > 0.03) {
        for (const butterfly of butterflies) {
          const x = butterfly.x + Math.sin(time * 0.31 + butterfly.phase) * 120 + Math.sin(time * 1.3 + butterfly.phase * 2) * 22
          const y = butterfly.y + Math.sin(time * 0.47 + butterfly.phase * 3) * 46 + Math.sin(time * 2.1 + butterfly.phase) * 12
          const flap = Math.abs(Math.sin(time * 11 + butterfly.phase))
          context.globalAlpha = channels.butterflies * 0.95
          context.fillStyle = butterfly.tint
          for (const side of [-1, 1]) {
            context.beginPath()
            context.ellipse(x + side * 4.5 * flap, y - 1, 4.8 * flap + 0.6, 6, side * 0.5, 0, 6.283)
            context.fill()
          }
        }
        context.globalAlpha = 1
      }
      const fall = Math.max(channels.petals, channels.leaves)
      if (fall > 0.03) {
        const petal = channels.petals >= channels.leaves
        const count = Math.round(fallers.length * fall * (input.reducedMotion ? 0.4 : 1))
        for (let i = 0; i < count; i++) {
          const faller = fallers[i]
          if (!faller) continue
          const gust = gustAt(faller.x, time) * input.wind
          faller.x += (faller.vx + 38 * gust + Math.sin(time * 1.2 + faller.phase) * 22) * deltaSeconds
          faller.y += faller.vy * (1 - 0.3 * gust) * deltaSeconds
          faller.rotation += faller.spin * (1 + gust) * deltaSeconds
          if (faller.y > H + 20 || faller.x > W + 30) {
            fallers[i] = newFaller(false)
            continue
          }
          context.save()
          context.translate(faller.x, faller.y)
          context.rotate(faller.rotation)
          context.scale(1, 0.45 + 0.55 * Math.abs(Math.sin(time * 1.6 + faller.phase)))
          context.globalAlpha = 0.9 * fall
          context.fillStyle = petal
            ? (i % 3 ? '#ffd9e4' : '#fff1f4')
            : (['#e08a2c', '#c9612a', '#e6b040'][i % 3] ?? '#e08a2c')
          context.beginPath()
          context.ellipse(0, 0, (petal ? 4.2 : 6.5) * faller.scale, (petal ? 2.8 : 3.6) * faller.scale, 0, 0, 6.283)
          context.fill()
          context.restore()
        }
      }
      if (channels.fireflies > 0.03) {
        context.save()
        context.globalCompositeOperation = 'lighter'
        const count = Math.round(fireflies.length * (input.reducedMotion ? 0.5 : 1))
        for (let i = 0; i < count; i++) {
          const firefly = fireflies[i]
          if (!firefly) continue
          firefly.vx += rnd(-14, 14) * deltaSeconds
          firefly.vy += rnd(-10, 10) * deltaSeconds
          firefly.vx *= 0.99
          firefly.vy *= 0.99
          firefly.x += firefly.vx * deltaSeconds
          firefly.y += firefly.vy * deltaSeconds
          if (firefly.x < -20) firefly.x = W + 20
          if (firefly.x > W + 20) firefly.x = -20
          if (firefly.y < 600) firefly.vy += 14 * deltaSeconds
          if (firefly.y > 1005) firefly.vy -= 14 * deltaSeconds
          const alpha = channels.fireflies * Math.pow(Math.max(0, Math.sin(time * firefly.speed + firefly.phase)), 2)
          if (alpha < 0.02) continue
          const gradient = context.createRadialGradient(firefly.x, firefly.y, 0, firefly.x, firefly.y, 13)
          gradient.addColorStop(0, `rgba(226,255,140,${0.85 * alpha})`)
          gradient.addColorStop(0.25, `rgba(190,240,90,${0.3 * alpha})`)
          gradient.addColorStop(1, 'rgba(190,240,90,0)')
          context.fillStyle = gradient
          context.fillRect(firefly.x - 13, firefly.y - 13, 26, 26)
        }
        context.restore()
      }
    },
  }
}
