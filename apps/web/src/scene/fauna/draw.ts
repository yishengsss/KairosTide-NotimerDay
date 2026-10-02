/**
 * The drawing of one resident, in art pixels. Each species is a small function of the local origin:
 * body, head, and the one gesture only that animal makes.
 *
 * Two things make an animal sit *on* the water instead of floating above it: a soft contact shadow,
 * and a squashed, darkened copy of the same shape mirrored below it. Both are applied by `onWater`,
 * so no species has to think about the surface. Colours are picked from the illustration's own
 * palette, and each has a night value so the animal is never lit from nowhere after dark.
 */

import type { SpeciesKey } from './species.ts'

export type DrawContext = {
  context: CanvasRenderingContext2D
  /** Seconds since the engine started; drives every gesture. */
  time: number
  /** Per-mark 0–1 job, so two ducks never bob in step. */
  phase: number
  /** 0–1, for the cross-fade when the species changes with the light. */
  alpha: number
  /** Scene daylight, 0–1. Chooses between the day and night colours. */
  day: number
}

type Body = (context: CanvasRenderingContext2D, input: DrawContext) => void

/** Day and night colour for one part of one animal. */
const tint = (input: DrawContext, day: string, night: string): string => (input.day > 0.5 ? day : night)

/**
 * Draw a species on the water: reflection first, then contact shadow, then the animal itself.
 * The reflection is the same shape, flipped, halved in height and faded — cheap, and exactly what
 * makes the silhouette read as a reflection at this scale.
 */
function onWater(draw: Body, shadowWidth: number, reflection = 0.55): Body {
  return (context, input) => {
    if (input.alpha <= 0.01) return
    context.save()
    context.globalAlpha = input.alpha * reflection * 0.4
    context.translate(0, 7)
    context.scale(1, -0.5)
    draw(context, input)
    context.restore()

    context.save()
    context.globalAlpha = input.alpha
    context.fillStyle = 'rgba(22,34,42,0.2)'
    context.beginPath()
    context.ellipse(0, 5, shadowWidth, 4, 0, 0, 6.283)
    context.fill()
    context.restore()

    context.save()
    context.globalAlpha = input.alpha
    draw(context, input)
    context.restore()
  }
}

const duck = onWater((context, input) => {
  context.fillStyle = tint(input, '#6b6255', '#4f4a41')
  context.beginPath()
  context.ellipse(0, 0, 21, 11.5, 0, 0, 6.283)
  context.fill()
  context.fillStyle = tint(input, '#4d4638', '#3a352d')
  context.beginPath()
  context.ellipse(-6, -2.5, 12, 7.5, -0.18, 0, 6.283)
  context.fill()
  context.fillStyle = tint(input, '#7a6f5e', '#5a5348')
  context.beginPath()
  context.ellipse(15, -12, 8, 7, 0, 0, 6.283)
  context.fill()
  context.fillStyle = '#c98a3a'
  context.beginPath()
  context.moveTo(22, -12)
  context.lineTo(31, -9.5)
  context.lineTo(22, -7.5)
  context.closePath()
  context.fill()
  context.fillStyle = '#241f19'
  context.beginPath()
  context.arc(17, -14.5, 1.5, 0, 6.283)
  context.fill()
}, 22)

/**
 * Four lobes meeting the body at a waist, plus clubbed antennae. Both matter: ellipses wide enough
 * to touch across the middle would union into a single orange disc, and at this size the antennae
 * are the one cue that separates "butterfly" from "petal".
 */
const butterfly = onWater((context, input) => {
  const ink = '#3a3229'
  const upper = tint(input, '#ffd9a8', '#b98f66')
  const lower = tint(input, '#f0a961', '#9a7145')
  for (const side of [-1, 1]) {
    context.fillStyle = upper
    context.beginPath()
    context.moveTo(side * 1.7, -2.2)
    context.quadraticCurveTo(side * 9.6, -4.8, side * 13.6, -12.6)
    context.quadraticCurveTo(side * 10, -15.8, side * 4.4, -11)
    context.quadraticCurveTo(side * 2, -8.4, side * 1.7, -2.2)
    context.closePath()
    context.fill()
    context.fillStyle = lower
    context.beginPath()
    context.moveTo(side * 1.7, -0.8)
    context.quadraticCurveTo(side * 8.4, 2.6, side * 10, 10.2)
    context.quadraticCurveTo(side * 5.4, 13.2, side * 2.4, 6.8)
    context.quadraticCurveTo(side * 1.8, 2.6, side * 1.7, -0.8)
    context.closePath()
    context.fill()
  }
  context.fillStyle = ink
  context.beginPath()
  context.ellipse(0, 0, 1.9, 8.2, 0, 0, 6.283)
  context.fill()
  context.beginPath()
  context.arc(0, -8.8, 2.3, 0, 6.283)
  context.fill()
  context.strokeStyle = ink
  context.lineWidth = 1.1
  context.lineCap = 'round'
  for (const side of [-1, 1]) {
    context.beginPath()
    context.moveTo(side * 1, -9.8)
    context.quadraticCurveTo(side * 3.4, -13, side * 5.2, -15)
    context.stroke()
    context.beginPath()
    context.arc(side * 5.2, -15, 1.15, 0, 6.283)
    context.fill()
  }
}, 9, 0.35)

const dragonfly = onWater((context, input) => {
  // Filled pairs, not hairline strokes: a 1.2 px translucent outline disappears over sunlit water.
  const glass = tint(input, 'rgba(242,250,255,0.78)', 'rgba(170,198,222,0.6)')
  const rim = tint(input, 'rgba(118,150,178,0.55)', 'rgba(92,124,150,0.5)')
  context.fillStyle = glass
  context.strokeStyle = rim
  context.lineWidth = 0.8
  for (const side of [-1, 1]) {
    for (const [cx, cy, rx, ry, tilt] of [[6.6, -5, 9.6, 2.7, 0.2], [6.2, -1, 8.4, 2.4, 0.08]] as const) {
      context.beginPath()
      context.ellipse(side * cx, cy, rx, ry, side * tilt, 0, 6.283)
      context.fill()
      context.stroke()
    }
  }
  context.fillStyle = tint(input, '#4d7fa0', '#2f536b')
  context.beginPath()
  context.ellipse(0, 0, 3.1, 13, 0, 0, 6.283)
  context.fill()
  context.beginPath()
  context.arc(0, -13, 3.5, 0, 6.283)
  context.fill()
  context.fillStyle = '#101d26'
  context.beginPath()
  context.arc(-1.5, -14.3, 1.2, 0, 6.283)
  context.arc(1.5, -14.3, 1.2, 0, 6.283)
  context.fill()
}, 11, 0.4)

const egret = onWater((context, input) => {
  const feather = tint(input, '#f4f2ea', '#b9bcc2')
  context.strokeStyle = tint(input, '#3b3a35', '#2b2b28')
  context.lineWidth = 1.7
  context.beginPath()
  context.moveTo(-3, 8)
  context.lineTo(-4, 26)
  context.moveTo(4, 8)
  context.lineTo(5, 26)
  context.stroke()
  context.fillStyle = feather
  context.beginPath()
  context.ellipse(-4, -4, 17, 12, -0.12, 0, 6.283)
  context.fill()
  context.strokeStyle = feather
  context.lineWidth = 5.5
  context.lineCap = 'round'
  context.beginPath()
  context.moveTo(6, -8)
  context.quadraticCurveTo(16, -14, 17, -25)
  context.stroke()
  context.beginPath()
  context.ellipse(18, -28, 6, 4.6, 0.2, 0, 6.283)
  context.fillStyle = feather
  context.fill()
  context.fillStyle = '#d8a63c'
  context.beginPath()
  context.moveTo(23, -29)
  context.lineTo(34, -26)
  context.lineTo(23, -24)
  context.closePath()
  context.fill()
  context.fillStyle = '#2c2a24'
  context.beginPath()
  context.arc(20, -30, 1.2, 0, 6.283)
  context.fill()
}, 17)

const frog = onWater((context, input) => {
  context.fillStyle = tint(input, '#5c7a44', '#3f5731')
  context.beginPath()
  context.ellipse(0, 0, 15, 11, 0, 0, 6.283)
  context.fill()
  context.fillStyle = tint(input, '#6d8c4e', '#4b6640')
  context.beginPath()
  context.ellipse(0, -4, 11, 6.5, 0, 0, 6.283)
  context.fill()
  for (const side of [-1, 1]) {
    context.beginPath()
    context.arc(side * 6.5, -9, 4.6, 0, 6.283)
    context.fill()
    context.fillStyle = '#f3efdd'
    context.beginPath()
    context.arc(side * 6.5, -10.5, 2.6, 0, 6.283)
    context.fill()
    context.fillStyle = '#1d1a14'
    context.beginPath()
    context.arc(side * 6.5, -10.8, 1.2, 0, 6.283)
    context.fill()
    context.fillStyle = tint(input, '#6d8c4e', '#4b6640')
  }
  context.strokeStyle = tint(input, '#4c6638', '#35492a')
  context.lineWidth = 2.4
  context.lineCap = 'round'
  context.beginPath()
  context.moveTo(-12, 2)
  context.lineTo(-19, 8)
  context.moveTo(12, 2)
  context.lineTo(19, 8)
  context.stroke()
}, 15)

/** One firefly lamp; the layer places several of these per mark. */
const firefly = (context: CanvasRenderingContext2D, input: DrawContext): void => {
  const glow = context.createRadialGradient(0, 0, 0, 0, 0, 9)
  glow.addColorStop(0, 'rgba(240,255,170,0.95)')
  glow.addColorStop(0.3, 'rgba(216,246,120,0.4)')
  glow.addColorStop(1, 'rgba(200,240,100,0)')
  context.fillStyle = glow
  context.fillRect(-9, -9, 18, 18)
  void input
}

const crane = onWater((context, input) => {
  const feather = tint(input, '#f6f4ee', '#c2c4c9')
  context.strokeStyle = tint(input, '#4a4a44', '#333330')
  context.lineWidth = 1.8
  context.beginPath()
  context.moveTo(-3, 10)
  context.lineTo(-5, 30)
  context.moveTo(4, 10)
  context.lineTo(6, 30)
  context.stroke()
  context.fillStyle = feather
  context.beginPath()
  context.ellipse(-2, -2, 16, 13, -0.1, 0, 6.283)
  context.fill()
  context.fillStyle = tint(input, '#2f2f2c', '#22221f')
  context.beginPath()
  context.ellipse(-14, 2, 8, 5, 0.3, 0, 6.283)
  context.fill()
  context.strokeStyle = feather
  context.lineWidth = 5
  context.lineCap = 'round'
  context.beginPath()
  context.moveTo(6, -6)
  context.quadraticCurveTo(14, -12, 13, -22)
  context.stroke()
  context.fillStyle = feather
  context.beginPath()
  context.ellipse(12, -25, 5, 4, 0, 0, 6.283)
  context.fill()
  context.fillStyle = '#c33b2c'
  context.beginPath()
  context.arc(13, -29.5, 2.6, 0, 6.283)
  context.fill()
  context.fillStyle = '#c9a53e'
  context.beginPath()
  context.moveTo(16, -26)
  context.lineTo(26, -23.5)
  context.lineTo(16, -21.5)
  context.closePath()
  context.fill()
}, 16)

/**
 * Draw one resident with the origin at the waterline under it. The caller has already translated to
 * the mark; each species adds only the motion that belongs to it, and its own fade.
 */
export function drawSpecies(key: SpeciesKey, input: DrawContext): void {
  const { context, time, phase } = input
  const drift = phase * 6.283
  context.save()
  switch (key) {
    case 'duck':
      context.translate(0, Math.sin(time * 1.15 + drift) * 1.8)
      duck(context, input)
      break
    case 'butterfly':
      context.translate(0, Math.sin(time * 0.9 + drift) * 1.2)
      context.scale(0.35 + 0.65 * Math.abs(Math.sin(time * 2.4 + drift)), 1)
      butterfly(context, input)
      break
    case 'dragonfly':
      context.translate(0, Math.sin(time * 1.6 + drift) * 1.1)
      context.rotate(Math.sin(time * 0.7 + drift) * 0.12)
      dragonfly(context, input)
      break
    case 'egret':
      context.translate(0, Math.sin(time * 0.8 + drift) * 1.2)
      context.rotate(Math.sin(time * 0.35 + drift) * 0.06)
      egret(context, input)
      break
    case 'frog':
      context.translate(0, Math.sin(time * 1.05 + drift) * 1.1)
      context.scale(1, 1 + 0.09 * Math.sin(time * 3.4 + drift))
      frog(context, input)
      break
    case 'firefly':
      for (let i = 0; i < 4; i++) {
        const angle = time * (0.3 + i * 0.11) + drift + i * 1.7
        const lift = 16 + Math.sin(time * 0.8 + i * 2.1) * 7
        const spread = 17 + Math.sin(time * 0.55 + i) * 9
        const flicker = Math.pow(0.5 + 0.5 * Math.sin(time * 1.5 + i * 2.4 + drift), 2)
        context.save()
        context.translate(Math.cos(angle) * spread, -lift + Math.sin(angle * 1.3) * 6)
        context.globalAlpha = input.alpha * (0.3 + 0.7 * flicker)
        firefly(context, input)
        context.restore()
      }
      break
    case 'crane':
      context.translate(0, Math.sin(time * 0.75 + drift) * 1.1)
      context.rotate(Math.sin(time * 0.3 + drift) * 0.05)
      crane(context, input)
      break
  }
  context.restore()
}

/** Nominal width of each resident in art pixels: hit targets and spacing between marks. */
export const SPECIES_SIZE: Record<SpeciesKey, number> = {
  duck: 62, butterfly: 30, dragonfly: 34, egret: 68, frog: 44, firefly: 52, crane: 62,
}
