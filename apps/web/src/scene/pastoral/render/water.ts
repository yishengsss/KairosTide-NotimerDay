/**
 * Hand-drawn water detail on top of the shader's reflection: the sparkle lines, the column of
 * broken light under the sun and moon, and the expanding rings where rain lands.
 *
 * With WebGL active the shader already paints the reflection and the glitter, so this layer keeps
 * the lines dimmer and the rings are the only strong addition.
 */

import { PADDY, POND, skyXY, type Point } from '../geometry.ts'
import { clamp, hash, lerp, rnd, smooth } from '../math.ts'
import { canvasContext } from './canvas.ts'

const GLINT_COUNT = 64
const POND_GLINTS = 46
const RIPPLE_LIMIT = 40

type Glint = { x: number; y: number; width: number; phase: number; speed: number; pond: boolean }
type Ripple = { x: number; y: number; life: number }

const polygonPath = (points: readonly Point[]): Path2D => {
  const path = new Path2D()
  points.forEach(([x, y], index) => (index ? path.lineTo(x, y) : path.moveTo(x, y)))
  path.closePath()
  return path
}

const glowSprite = (rgb: string): HTMLCanvasElement => {
  const [canvas, context] = canvasContext(64, 64)
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, `rgba(${rgb},1)`)
  gradient.addColorStop(0.35, `rgba(${rgb},.55)`)
  gradient.addColorStop(1, `rgba(${rgb},0)`)
  context.fillStyle = gradient
  context.fillRect(0, 0, 64, 64)
  return canvas
}

export type WaterInput = {
  time: number
  rain: number
  snow: number
  day: number
  /** 1 when the pond is liquid, 0.25 when frozen. */
  frozen: number
  /** Sun and moon reflection scale; halved while the weather is unknown. */
  reflection: number
  sun: { alt: number; az: number }
  moon: { alt: number; az: number; lit: number }
  /** True when WebGL is painting the reflection, so the lines here stay subtle. */
  live: boolean
}

export type WaterLayer = {
  draw(context: CanvasRenderingContext2D, input: WaterInput, deltaSeconds: number): void
  /** Rough position of a real ripple on the pond, for gesture feedback. */
  rippleAt(x: number, y: number): void
}

export function createWaterLayer(): WaterLayer {
  const [sunSprite, moonSprite] = [glowSprite('255,238,200'), glowSprite('222,232,255')]
  const pondPath = polygonPath(POND)
  const paddyPath = polygonPath(PADDY)
  const ripples: Ripple[] = []
  const glints: Glint[] = Array.from({ length: GLINT_COUNT }, (_, index) => index < POND_GLINTS
    ? { x: rnd(400, 1536), y: rnd(775, 1024), width: rnd(18, 60), phase: rnd(6.28), speed: rnd(0.5, 1.6), pond: true }
    : { x: rnd(100, 1190), y: rnd(655, 730), width: rnd(12, 34), phase: rnd(6.28), speed: rnd(0.5, 1.4), pond: false })
  const layer: WaterLayer = {
    draw(context, input, deltaSeconds) {
      const wet = Math.max(input.rain, input.snow)
      context.save()
      context.lineCap = 'round'
      for (const pond of [true, false]) {
        context.save()
        context.clip(pond ? pondPath : paddyPath)
        context.lineWidth = pond ? 1.6 : 1.1
        for (const glint of glints) {
          if (glint.pond !== pond) continue
          const alpha = Math.max(0, Math.sin(input.time * glint.speed + glint.phase)) *
            (pond ? 0.3 : 0.22) * input.frozen * lerp(0.5, 1, input.day) * (input.live ? 0.45 : 1)
          if (alpha < 0.01) continue
          const drift = Math.sin(input.time * 0.4 + glint.phase) * 6
          context.strokeStyle = `rgba(${input.day > 0.4 ? '255,255,255' : '190,210,255'},${alpha})`
          context.beginPath()
          context.moveTo(glint.x + drift, glint.y)
          context.lineTo(glint.x + drift + glint.width, glint.y)
          context.stroke()
        }
        if (pond && !input.live) {
          // Without WebGL the sun and moon light on the water has to be painted here.
          spot(context, sunSprite, input.sun, 0.9 * input.day * (1 - wet) * input.frozen * input.reflection,
            input.time)
          spot(context, moonSprite, input.moon, 0.8 * (1 - input.day) * input.moon.lit * (1 - wet) * input.frozen *
            input.reflection,
            input.time)
        }
        if (pond) {
          if (input.rain > 0.05 && Math.random() < input.rain * deltaSeconds * 40 && ripples.length < RIPPLE_LIMIT) {
            ripples.push({ x: rnd(400, 1536), y: rnd(775, 1024), life: 0 })
          }
          context.lineWidth = 1
          for (let i = ripples.length - 1; i >= 0; i--) {
            const ripple = ripples[i]
            if (!ripple) continue
            ripple.life += deltaSeconds * 1.3
            if (ripple.life > 1) {
              ripples.splice(i, 1)
              continue
            }
            context.strokeStyle = `rgba(235,242,250,${0.4 * (1 - ripple.life)})`
            context.beginPath()
            context.ellipse(ripple.x, ripple.y, 4 + ripple.life * 20, 1.5 + ripple.life * 6, 0, 0, 6.283)
            context.stroke()
          }
        }
        context.restore()
      }
      context.restore()
    },
    rippleAt(x, y) {
      if (ripples.length >= RIPPLE_LIMIT) return
      ripples.push({ x, y, life: 0 })
    },
  }
  return layer
}

/** A column of soft light broken into shifting patches, wider and looser nearer the viewer. */
function spot(context: CanvasRenderingContext2D, sprite: HTMLCanvasElement, body: { alt: number; az: number },
  strength: number, time: number): void {
  const point = skyXY(body.alt, body.az)
  const falloff = smooth(1, 6, body.alt) * smooth(75, 40, body.alt)   // too low is behind the hill, too high misses the water
  const amount = clamp(strength * falloff)
  if (point.x < 430 || point.x > 1480 || amount < 0.02) return
  context.save()
  context.globalCompositeOperation = 'screen'
  context.globalAlpha = amount * 0.22
  context.drawImage(sprite, point.x - 90, 770, 180, 250)
  for (let i = 0; i < 26; i++) {
    const k = i / 25
    const y = 786 + k * 225 + Math.sin(i * 7.3) * 4
    const spread = 8 + k * 46
    const x = point.x + Math.sin(i * 12.9898 + time * (0.5 + hash(i) * 0.6)) * spread
    const width = (9 + k * 26) * (0.55 + 0.45 * Math.sin(time * 1.3 + i * 2.4))
    const alpha = amount * Math.pow(0.5 + 0.5 * Math.sin(time * (1.6 + hash(i + 40) * 1.8) + i * 1.9), 2) * (0.9 - 0.35 * k)
    if (alpha < 0.02) continue
    context.globalAlpha = alpha
    context.drawImage(sprite, x - width, y - 2.2 - k * 1.6, width * 2, 4.4 + k * 3.2)
  }
  context.restore()
}
