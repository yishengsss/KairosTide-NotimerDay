/**
 * Chimney smoke and the window lights coming on after dark.
 * Smoke drifts with the same wind model the shader uses, so the plume leans with the grass.
 */

import { CHIMNEY, WINDOWS } from '../geometry.ts'
import { rnd } from '../math.ts'
import { gustAt } from '../wind.ts'

type Puff = { x: number; y: number; radius: number; life: number; max: number; vx: number; vy: number; phase: number }

const MAX_PUFFS = 90

export type HouseInput = {
  smoke: number
  day: number
  wind: number
  time: number
}

export type HouseLayer = {
  draw(context: CanvasRenderingContext2D, input: HouseInput, deltaSeconds: number): void
  /** Fill the plume with particles already in a natural state, so the first frame looks settled. */
  prime(count: number): void
}

export function createHouseLayer(): HouseLayer {
  const puffs: Puff[] = []
  const spawn = (offset = 0): Puff => ({
    x: CHIMNEY.x + rnd(-4, 4) + offset * 0.5,
    y: CHIMNEY.y - offset * 0.9,
    radius: 5 + rnd(3) + offset * 0.18,
    life: offset / 30,
    max: rnd(5, 8),
    vx: rnd(5, 13),
    vy: rnd(-22, -15),
    phase: rnd(6.28),
  })
  return {
    prime(count) {
      for (let i = 0; i < count; i++) if (i % 3 === 0) puffs.push(spawn(i))
    },
    draw(context, input, deltaSeconds) {
      if (input.smoke > 0.05 && Math.random() < deltaSeconds * 7 * input.smoke && puffs.length < MAX_PUFFS) {
        puffs.push(spawn())
      }
      const tint = input.day > 0.5 ? '246,243,236' : '150,162,190'
      for (let i = puffs.length - 1; i >= 0; i--) {
        const puff = puffs[i]
        if (!puff) continue
        puff.life += deltaSeconds
        if (puff.life > puff.max) {
          puffs.splice(i, 1)
          continue
        }
        const k = puff.life / puff.max
        puff.x += (puff.vx * 0.5 + 22 * input.wind * gustAt(puff.x, input.time) +
          Math.sin(input.time * 0.7 + puff.phase) * 4) * deltaSeconds * (0.4 + k)
        puff.y += puff.vy * deltaSeconds * (1 - k * 0.4)
        puff.radius += deltaSeconds * 6.5
        const alpha = 0.3 * Math.sin(Math.PI * Math.min(1, k * 1.15)) * (1 - k * 0.4)
        const gradient = context.createRadialGradient(puff.x, puff.y, 0, puff.x, puff.y, puff.radius)
        gradient.addColorStop(0, `rgba(${tint},${alpha})`)
        gradient.addColorStop(1, `rgba(${tint},0)`)
        context.fillStyle = gradient
        context.fillRect(puff.x - puff.radius, puff.y - puff.radius, puff.radius * 2, puff.radius * 2)
      }
      const night = 1 - input.day
      if (night <= 0.05) return
      context.save()
      context.globalCompositeOperation = 'screen'
      for (const window of WINDOWS) {
        const flicker = 0.85 + 0.15 * Math.sin(input.time * 2.1 + window.x) * Math.sin(input.time * 3.7 + window.y)
        const gradient = context.createRadialGradient(window.x, window.y, 0, window.x, window.y, 70)
        gradient.addColorStop(0, `rgba(255,190,110,${0.4 * night * flicker})`)
        gradient.addColorStop(1, 'rgba(255,170,90,0)')
        context.fillStyle = gradient
        context.fillRect(window.x - 70, window.y - 70, 140, 140)
      }
      context.restore()
    },
  }
}
