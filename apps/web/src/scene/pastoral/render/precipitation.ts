/**
 * Rain streaks, snowflakes and the distant lightning flash. Rain and snow appear only when a real
 * observation says so; the flash follows the same real thunderstorm flag the audio uses.
 */

import { H, W } from '../geometry.ts'
import { rnd } from '../math.ts'
import { gustAt } from '../wind.ts'

const DROP_COUNT = 340
const FLAKE_COUNT = 300

type Drop = { x: number; y: number; length: number; speed: number }
type Flake = { x: number; y: number; radius: number; speed: number; phase: number }

export type PrecipitationInput = {
  rain: number
  snow: number
  thunder: boolean
  wind: number
  time: number
  reducedMotion: boolean
}

export type PrecipitationLayer = {
  draw(context: CanvasRenderingContext2D, input: PrecipitationInput, deltaSeconds: number): void
  /** Called when a real thunderstorm is overhead; the flash decays on its own. */
  flash(): void
}

export function createPrecipitationLayer(): PrecipitationLayer {
  const drops: Drop[] = Array.from({ length: DROP_COUNT }, () => ({
    x: rnd(-100, W + 200), y: rnd(H), length: rnd(14, 30), speed: rnd(780, 1150),
  }))
  const flakes: Flake[] = Array.from({ length: FLAKE_COUNT }, () => ({
    x: rnd(W), y: rnd(H), radius: rnd(1.1, 3.4), speed: rnd(26, 70), phase: rnd(6.28),
  }))
  let intensity = 0
  const layer: PrecipitationLayer = {
    flash() {
      intensity = 1
    },
    draw(context, input, deltaSeconds) {
      const density = input.reducedMotion ? 0.4 : 1
      if (input.rain > 0.02) {
        const count = Math.round(drops.length * input.rain * density)
        context.strokeStyle = `rgba(226,234,246,${0.2 + 0.22 * input.rain})`
        context.lineWidth = 1.2
        context.lineCap = 'round'
        const slant = 0.06 + 0.14 * input.wind * gustAt(W / 2, input.time)
        context.beginPath()
        for (let i = 0; i < count; i++) {
          const drop = drops[i]
          if (!drop) continue
          drop.y += drop.speed * deltaSeconds
          drop.x += drop.speed * slant * deltaSeconds
          if (drop.y > H + 30) {
            drop.y = -30
            drop.x = rnd(-220, W + 60)
          }
          context.moveTo(drop.x, drop.y)
          context.lineTo(drop.x - drop.length * slant, drop.y - drop.length)
        }
        context.stroke()
      }
      if (input.snow > 0.02) {
        const count = Math.round(flakes.length * input.snow * density)
        context.fillStyle = 'rgba(255,255,255,.86)'
        context.beginPath()
        for (let i = 0; i < count; i++) {
          const flake = flakes[i]
          if (!flake) continue
          flake.y += flake.speed * deltaSeconds
          flake.x += (Math.sin(input.time * 0.8 + flake.phase) * 16 +
            30 * input.wind * gustAt(flake.x, input.time)) * deltaSeconds
          if (flake.y > H + 10) {
            flake.y = -10
            flake.x = rnd(-60, W)
          }
          if (flake.x > W + 10) flake.x = -10
          context.moveTo(flake.x + flake.radius, flake.y)
          context.arc(flake.x, flake.y, flake.radius, 0, 6.283)
        }
        context.fill()
      }
      if (intensity <= 0.01) return
      intensity *= Math.exp(-deltaSeconds * 3.2)
      context.save()
      context.globalCompositeOperation = 'screen'
      const glow = context.createRadialGradient(900, 260, 0, 900, 260, 900)
      glow.addColorStop(0, `rgba(226,232,255,${0.3 * intensity})`)
      glow.addColorStop(1, 'rgba(226,232,255,0)')
      context.fillStyle = glow
      context.fillRect(0, 0, W, H)
      context.restore()
    },
  }
  return layer
}
