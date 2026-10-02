/**
 * Stars, the moon with its real phase, the sun's disk and glow, and the warm light of sunrise and
 * sunset.
 *
 * The disk and the moon sprite are the only parts that have to hide behind the hills and the big
 * tree, and where they end up depends on the renderer:
 *
 * - **With WebGL** they are painted into a sky-height canvas the shader samples. The shader reads
 *   it only where the illustration mask marks sky, so the hills and the tree occlude them for free,
 *   and drifting clouds pass in front of them. That canvas is repainted only when the bodies moved.
 * - **Without WebGL** they are painted onto the display through the mask's blue channel (or the
 *   ridge outline when the mask cannot be read), every frame.
 *
 * Stars, halos, the sun's glow and the twilight wash are always painted straight onto the display,
 * because nothing ever covers them.
 */

import { isReady } from '../assets.ts'
import { SKY_H, W, skyXY } from '../geometry.ts'
import { lerp, rnd, smooth } from '../math.ts'
import { canvasContext } from './canvas.ts'

export const MOON_RADIUS = 30
export const SUN_DISC_RADIUS = 26
const MOON_SOURCE = 192
const MOON_DRAW_RADIUS = MOON_SOURCE / 2 - 2
const MOON_HALO = MOON_RADIUS * 7

const STAR_COUNT = 70
const STAR_EXCLUSION = { right: 1120, bottom: 190 }
/** Repaint the celestial layer only when the visible result moved this much. */
const REDRAW_STEP = 1 / 30

export type Star = { x: number; y: number; radius: number; phase: number; speed: number }

export function makeStars(): Star[] {
  const stars: Star[] = []
  while (stars.length < STAR_COUNT) {
    const x = rnd(W)
    const y = rnd(300)
    if (x > STAR_EXCLUSION.right && y > STAR_EXCLUSION.bottom) continue
    stars.push({ x, y, radius: rnd(0.6, 1.6), phase: rnd(6.28), speed: rnd(0.6, 2.2) })
  }
  return stars
}

export type SkyInput = {
  sun: { alt: number; az: number }
  moon: { alt: number; az: number; lit: number }
  /** 0 at night, 1 in daylight. */
  day: number
  night: number
  twilight: number
  dawn: boolean
  gold: number
  rain: number
  snow: number
  /** Seconds since start; drives the twinkle. */
  time: number
}

export type SkyTarget = {
  /** True when the shader will composite the celestial layer, so the discs must not be drawn directly. */
  live: boolean
  celestial: HTMLCanvasElement
  celestialContext: CanvasRenderingContext2D
  /** Draw through the sky mask onto the display, clipped to the given box. */
  occluded(x: number, y: number, width: number, height: number,
    paint: (context: CanvasRenderingContext2D) => void): void
}

export type SkyRenderer = {
  /** Version of the celestial layer; the shader re-uploads when it changes. */
  readonly key: string
  draw(display: CanvasRenderingContext2D, input: SkyInput, target: SkyTarget): void
  dispose(): void
}

export function createSkyRenderer(moonImage: HTMLImageElement | undefined): SkyRenderer {
  const stars = makeStars()
  const [moonCanvas, moonContext] = canvasContext(MOON_SOURCE, MOON_SOURCE)
  let moonKey = ''
  let celestialKey = ''

  const buildMoon = (lit: number, angle: number): void => {
    const next = `${lit.toFixed(3)}|${angle.toFixed(2)}|${isReady(moonImage)}`
    if (next === moonKey) return
    moonKey = next
    const centre = MOON_SOURCE / 2
    moonContext.clearRect(0, 0, MOON_SOURCE, MOON_SOURCE)
    moonContext.globalCompositeOperation = 'source-over'
    if (moonImage && isReady(moonImage)) {
      moonContext.drawImage(moonImage, centre - MOON_DRAW_RADIUS, centre - MOON_DRAW_RADIUS,
        MOON_DRAW_RADIUS * 2, MOON_DRAW_RADIUS * 2)
    } else {
      moonContext.fillStyle = '#f6efd8'
      moonContext.beginPath()
      moonContext.arc(centre, centre, MOON_DRAW_RADIUS, 0, 6.283)
      moonContext.fill()
    }
    // The unlit side is erased: left semicircle plus the terminator ellipse, bright side to the right.
    const rx = Math.max(0.01, MOON_DRAW_RADIUS * Math.abs(1 - 2 * lit))
    moonContext.save()
    moonContext.translate(centre, centre)
    moonContext.rotate(angle)
    moonContext.globalCompositeOperation = 'destination-out'
    moonContext.filter = 'blur(4px)'
    moonContext.fillStyle = 'rgba(0,0,0,.965)'   // a sliver stays as earthshine
    moonContext.beginPath()
    // The arc is wider than the disk so the blur only softens the terminator, not the limb.
    moonContext.arc(0, 0, MOON_DRAW_RADIUS + 14, -Math.PI / 2, Math.PI / 2, true)
    if (lit < 0.5) moonContext.ellipse(0, 0, rx, MOON_DRAW_RADIUS, 0, Math.PI / 2, -Math.PI / 2, true)
    else moonContext.ellipse(0, 0, rx, MOON_DRAW_RADIUS, 0, Math.PI / 2, Math.PI * 1.5, false)
    moonContext.fill()
    moonContext.restore()
    moonContext.filter = 'none'
    moonContext.globalCompositeOperation = 'source-over'
  }

  const round = (value: number): number => Math.round(value / REDRAW_STEP)

  /** Everything that changes what the discs look like; time is deliberately not part of it. */
  const bodyKey = (input: SkyInput): string => [
    round(input.sun.alt), round(input.sun.az), round(input.moon.alt), round(input.moon.az),
    round(input.moon.lit), round(input.day), round(input.rain), round(input.snow),
  ].join()

  const moonAlpha = (input: SkyInput): number =>
    (1 - Math.max(input.rain, input.snow) * 0.85) * smooth(-4, 2, input.moon.alt)

  const sunAlpha = (input: SkyInput): number =>
    (1 - Math.max(input.rain, input.snow) * 0.8) * smooth(-6, -1, input.sun.alt)

  const paintMoonSprite = (context: CanvasRenderingContext2D, input: SkyInput,
    point: { x: number; y: number }): void => {
    const sunPoint = skyXY(input.sun.alt, input.sun.az)
    buildMoon(input.moon.lit, Math.atan2(sunPoint.y - point.y, sunPoint.x - point.x))
    const alpha = moonAlpha(input)
    // By day the moon is a washed-out smear; after dark it is solid.
    const size = (MOON_RADIUS * MOON_SOURCE) / MOON_DRAW_RADIUS
    context.globalAlpha = alpha * (1 - input.day)
    context.drawImage(moonCanvas, point.x - size / 2, point.y - size / 2, size, size)
    context.globalCompositeOperation = 'lighter'
    context.globalAlpha = alpha * input.day * 0.55
    context.drawImage(moonCanvas, point.x - size / 2, point.y - size / 2, size, size)
    context.globalCompositeOperation = 'source-over'
    context.globalAlpha = 1
  }

  const paintSunDisc = (context: CanvasRenderingContext2D, input: SkyInput,
    point: { x: number; y: number }): void => {
    const alpha = sunAlpha(input)
    const low = smooth(28, 0, input.sun.alt)
    const tint = `${255},${Math.round(lerp(248, 176, low))},${Math.round(lerp(225, 104, low))}`
    const disc = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, SUN_DISC_RADIUS)
    disc.addColorStop(0, `rgba(255,253,242,${alpha})`)
    disc.addColorStop(0.6, `rgba(255,250,232,${alpha})`)
    disc.addColorStop(0.85, `rgba(${tint},${0.9 * alpha})`)
    disc.addColorStop(1, `rgba(${tint},0)`)
    context.fillStyle = disc
    context.beginPath()
    context.arc(point.x, point.y, SUN_DISC_RADIUS, 0, 6.283)
    context.fill()
  }

  const drawStars = (context: CanvasRenderingContext2D, input: SkyInput,
    moonPoint: { x: number; y: number } | null): void => {
    const wet = Math.max(input.rain, input.snow)
    const alpha = Math.max(input.night, input.twilight * (input.dawn ? 0.1 : 0.3))
    if (alpha <= 0.03) return
    context.fillStyle = '#fff'
    for (const star of stars) {
      if (moonPoint && Math.hypot(star.x - moonPoint.x, star.y - moonPoint.y) < MOON_RADIUS + 3) continue
      const twinkle = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(input.time * star.speed + star.phase))
      const horizon = input.night > 0.5 ? 1 : smooth(260, 0, star.y)
      context.globalAlpha = alpha * (1 - wet * 0.9) * twinkle * horizon
      context.beginPath()
      context.arc(star.x, star.y, star.radius, 0, 6.283)
      context.fill()
    }
    context.globalAlpha = 1
  }

  const drawMoonHalo = (context: CanvasRenderingContext2D, input: SkyInput,
    point: { x: number; y: number }): void => {
    const halo = moonAlpha(input) * Math.pow(input.moon.lit, 1.5) * smooth(0.3, 1, input.night)
    if (halo <= 0.01) return
    context.save()
    context.globalCompositeOperation = 'screen'
    const glow = context.createRadialGradient(point.x, point.y, MOON_RADIUS * 0.8, point.x, point.y, MOON_HALO)
    glow.addColorStop(0, `rgba(255,244,214,${0.3 * halo})`)
    glow.addColorStop(0.25, `rgba(220,226,250,${0.12 * halo})`)
    glow.addColorStop(1, 'rgba(200,215,255,0)')
    context.fillStyle = glow
    context.fillRect(point.x - MOON_HALO, point.y - MOON_HALO, MOON_HALO * 2, MOON_HALO * 2)
    context.restore()
  }

  const drawSunGlow = (context: CanvasRenderingContext2D, input: SkyInput,
    point: { x: number; y: number }): void => {
    const alpha = sunAlpha(input)
    if (alpha <= 0.01) return
    const low = smooth(28, 0, input.sun.alt)
    const tint = `${255},${Math.round(lerp(248, 176, low))},${Math.round(lerp(225, 104, low))}`
    context.save()
    context.globalCompositeOperation = 'screen'
    const radius = lerp(300, 460, low)
    const glow = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius)
    glow.addColorStop(0, `rgba(${tint},${0.62 * alpha})`)
    glow.addColorStop(0.25, `rgba(${tint},${0.24 * alpha})`)
    glow.addColorStop(1, `rgba(${tint},0)`)
    context.fillStyle = glow
    context.fillRect(point.x - radius, point.y - radius, radius * 2, radius * 2)
    context.restore()
  }

  const drawGoldLight = (context: CanvasRenderingContext2D, input: SkyInput): void => {
    const strength = input.gold * (1 - Math.max(input.rain, input.snow) * 0.7)
    if (strength <= 0.01) return
    context.save()
    context.globalCompositeOperation = 'screen'
    const gradient = context.createLinearGradient(0, 0, 0, 560)
    gradient.addColorStop(0, 'rgba(255,120,120,0)')
    gradient.addColorStop(0.5, `rgba(255,128,112,${0.1 * strength})`)
    gradient.addColorStop(0.75, `rgba(255,160,90,${0.22 * strength})`)
    gradient.addColorStop(1, 'rgba(255,170,90,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, W, 560)
    // Kept out of the ground: this light is meant for the sky, and the ridge is below 560.
    context.globalCompositeOperation = 'soft-light'
    context.fillStyle = `rgba(255,150,80,${0.3 * strength})`
    context.fillRect(0, 0, W, 560)
    context.restore()
  }

  return {
    get key() {
      return celestialKey
    },
    draw(display, input, target) {
      const moonPoint = input.moon.alt > -4 ? skyXY(input.moon.alt, input.moon.az) : null
      const sunPoint = skyXY(input.sun.alt, input.sun.az)
      const moonVisible = !!moonPoint && input.moon.lit > 0.015 && moonAlpha(input) > 0.01
      const sunVisible = input.sun.alt > -6 && sunAlpha(input) > 0.01

      // Halos and glows sit behind everything; the moon blocks the stars behind it.
      if (moonVisible && moonPoint) drawMoonHalo(display, input, moonPoint)
      drawStars(display, input, moonPoint)
      if (sunVisible) drawSunGlow(display, input, sunPoint)
      drawGoldLight(display, input)

      if (target.live) {
        const next = bodyKey(input)
        if (next === celestialKey) return
        celestialKey = next
        const celestial = target.celestialContext
        celestial.setTransform(1, 0, 0, 1, 0, 0)
        celestial.clearRect(0, 0, W, SKY_H)
        celestial.save()
        if (moonVisible && moonPoint) paintMoonSprite(celestial, input, moonPoint)
        if (sunVisible) paintSunDisc(celestial, input, sunPoint)
        celestial.restore()
        return
      }

      if (moonVisible && moonPoint) {
        const size = (MOON_RADIUS * MOON_SOURCE) / MOON_DRAW_RADIUS
        target.occluded(moonPoint.x - size / 2, moonPoint.y - size / 2, size, size,
          (context) => paintMoonSprite(context, input, moonPoint))
      }
      if (sunVisible) {
        const box = SUN_DISC_RADIUS + 2
        target.occluded(sunPoint.x - box, sunPoint.y - box, box * 2, box * 2,
          (context) => paintSunDisc(context, input, sunPoint))
      }
    },
    dispose() {
      celestialKey = ''
      moonKey = ''
    },
  }
}
