/**
 * Residents for flexible tasks: they stand on the bank or hang in the air, never sit on the water,
 * so they get a ground shadow and no reflection. Same rules as the pond set: small, palette colours,
 * a night tint, one gentle gesture each, no flashing.
 */

import type { DrawContext } from './draw.ts'
import type { TaskSpeciesKey } from './species.ts'

type Body = (context: CanvasRenderingContext2D, input: DrawContext) => void

const tint = (input: DrawContext, day: string, night: string): string => (input.day > 0.5 ? day : night)

const blob = (context: CanvasRenderingContext2D, fill: string, x: number, y: number, rx: number, ry: number,
  rotation = 0): void => {
  context.fillStyle = fill
  context.beginPath()
  context.ellipse(x, y, rx, ry, rotation, 0, 6.283)
  context.fill()
}

const eye = (context: CanvasRenderingContext2D, x: number, y: number, r = 1.3): void =>
  blob(context, '#241f19', x, y, r, r)

/** Ground shadow, then the animal, both at the resident's fade. */
function onGround(draw: Body, shadowWidth: number, lift = 0): Body {
  return (context, input) => {
    if (input.alpha <= 0.01) return
    context.save()
    context.globalAlpha = input.alpha * (lift ? 0.5 : 1)
    blob(context, 'rgba(30,26,20,0.22)', 0, 3, shadowWidth, 3)
    context.globalAlpha = input.alpha
    context.translate(0, -lift)
    draw(context, input)
    context.restore()
  }
}

const sparrow = onGround((context, input) => {
  blob(context, tint(input, '#8a6a4a', '#5d4b3a'), 0, -8, 11, 7)
  blob(context, tint(input, '#d9c7a8', '#8f8370'), 2, -5, 7, 4)
  blob(context, tint(input, '#6e5038', '#4a3a2c'), 9, -15, 6, 5.5)
  context.fillStyle = '#3a3229'
  context.fillRect(-15, -11, 7, 3)
  context.fillStyle = '#c98a3a'
  context.beginPath()
  context.moveTo(14.5, -15)
  context.lineTo(19, -14)
  context.lineTo(14.5, -12.5)
  context.fill()
  eye(context, 11, -16.5)
}, 11)

const cicada = onGround((context, input) => {
  blob(context, tint(input, '#4a4234', '#33302a'), 0, -10, 4, 10)
  context.globalAlpha *= 0.55
  blob(context, tint(input, '#e8efe6', '#9aa29c'), -4, -8, 3.5, 11, 0.18)
  blob(context, tint(input, '#e8efe6', '#9aa29c'), 4, -8, 3.5, 11, -0.18)
  context.globalAlpha /= 0.55
  eye(context, -2.5, -19, 1.1)
  eye(context, 2.5, -19, 1.1)
}, 6, 18)

const squirrel = onGround((context, input) => {
  const fur = tint(input, '#a8643a', '#6c4a33')
  blob(context, fur, -12, -18, 7, 14, -0.4)
  blob(context, fur, 0, -9, 9, 8)
  blob(context, fur, 7, -18, 6, 5.5)
  blob(context, fur, 6, -24, 1.8, 3)
  blob(context, tint(input, '#e3c49c', '#9a8268'), 3, -7, 4, 5)
  eye(context, 9, -19)
}, 12)

const tit = onGround((context, input) => {
  blob(context, tint(input, '#6f7f8a', '#4c5660'), -1, -8, 10, 7)
  blob(context, tint(input, '#e9e2cf', '#9c978a'), 2, -6, 6, 4.5)
  blob(context, '#2a2622', 7, -14, 6, 5.5)
  blob(context, '#f3efe6', 8.5, -13, 3, 2.4)
  context.fillStyle = '#2a2622'
  context.fillRect(-14, -9, 6, 2.5)
  eye(context, 9, -15, 1)
}, 10)

const cricket = onGround((context, input) => {
  blob(context, tint(input, '#5a4a30', '#3b3226'), 0, -4, 9, 3.5)
  blob(context, tint(input, '#4a3d28', '#2f281f'), 8, -5, 3.5, 3)
  context.strokeStyle = tint(input, '#4a3d28', '#2f281f')
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(-4, -3)
  context.lineTo(-9, -10)
  context.lineTo(-12, 0)
  context.moveTo(10, -7)
  context.quadraticCurveTo(16, -16, 22, -14)
  context.stroke()
}, 9)

const owl = onGround((context, input) => {
  context.fillStyle = tint(input, '#5c4c3a', '#3b3329')
  context.fillRect(-16, -1, 32, 3)
  blob(context, tint(input, '#8a7356', '#5a4c3c'), 0, -14, 9, 13)
  blob(context, tint(input, '#c9b590', '#827459'), 0, -10, 5.5, 7)
  blob(context, '#e8d8a8', -3.5, -19, 2.6, 2.6)
  blob(context, '#e8d8a8', 3.5, -19, 2.6, 2.6)
  eye(context, -3.5, -19, 1.2)
  eye(context, 3.5, -19, 1.2)
}, 10)

const snail = onGround((context, input) => {
  blob(context, tint(input, '#b5a58a', '#76705f'), 2, -2.5, 13, 3)
  blob(context, tint(input, '#9a6a42', '#64492f'), -1, -10, 8, 8)
  blob(context, tint(input, '#c48a58', '#7f5c3e'), -1, -10, 4.5, 4.5)
  context.strokeStyle = tint(input, '#b5a58a', '#76705f')
  context.lineWidth = 1.3
  context.beginPath()
  context.moveTo(12, -4)
  context.lineTo(15, -12)
  context.moveTo(13, -4)
  context.lineTo(18, -10)
  context.stroke()
}, 13)

const BODIES: Record<TaskSpeciesKey, Body> = { sparrow, cicada, squirrel, tit, cricket, owl, snail }

/** One shore resident with the origin at its feet; the gesture is a slow sway or hop, never a pulse. */
export function drawShore(key: TaskSpeciesKey, input: DrawContext): void {
  const { context, time, phase } = input
  const drift = phase * 6.283
  context.save()
  if (key === 'cicada' || key === 'owl') context.rotate(Math.sin(time * 0.4 + drift) * 0.04)
  else if (key === 'snail') context.translate(Math.sin(time * 0.15 + drift) * 2, 0)
  else context.translate(0, -Math.max(0, Math.sin(time * 0.9 + drift)) * 1.5)
  BODIES[key](context, input)
  context.restore()
}

export const SHORE_SIZE: Record<TaskSpeciesKey, number> = {
  sparrow: 40, cicada: 24, squirrel: 44, tit: 36, cricket: 40, owl: 36, snail: 34,
}
