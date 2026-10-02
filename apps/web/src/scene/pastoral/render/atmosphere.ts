/**
 * Weather wash over the finished frame: desaturation and grey for wet weather, frost sheen, fog.
 * Draws into the main context in art space.
 */

import { H, W } from '../geometry.ts'

export type AtmosphereInput = {
  rain: number
  snow: number
  fog: number
  frost: number
  day: number
}

export function drawAtmosphere(context: CanvasRenderingContext2D, input: AtmosphereInput): void {
  const wet = Math.max(input.rain, input.snow * 0.8)
  if (wet > 0.01) {
    context.save()
    context.globalCompositeOperation = 'saturation'
    context.fillStyle = `rgba(128,128,128,${0.55 * wet})`
    context.fillRect(0, 0, W, H)
    context.globalCompositeOperation = 'multiply'
    context.fillStyle = `rgba(170,178,190,${0.6 * wet})`
    context.fillRect(0, 0, W, H)
    context.restore()
    context.fillStyle = `rgba(150,158,170,${0.22 * wet * input.day})`
    context.fillRect(0, 0, W, 420)
  }
  if (input.frost > 0.01) {
    context.save()
    context.globalCompositeOperation = 'screen'
    const sheen = context.createLinearGradient(0, 430, 0, H)
    sheen.addColorStop(0, 'rgba(225,238,250,0)')
    sheen.addColorStop(0.3, `rgba(225,238,250,${0.3 * input.frost})`)
    sheen.addColorStop(1, `rgba(235,244,252,${0.38 * input.frost})`)
    context.fillStyle = sheen
    context.fillRect(0, 430, W, H - 430)
    context.restore()
  }
  if (input.fog > 0.01) {
    const tint = input.day > 0.5 ? '246,246,240' : '170,184,205'
    const veil = context.createLinearGradient(0, 300, 0, 900)
    veil.addColorStop(0, `rgba(${tint},0)`)
    veil.addColorStop(0.3, `rgba(${tint},${0.5 * input.fog})`)
    veil.addColorStop(0.62, `rgba(${tint},${0.36 * input.fog})`)
    veil.addColorStop(1, `rgba(${tint},0)`)
    context.fillStyle = veil
    context.fillRect(0, 300, W, 600)
  }
}
