/**
 * Draws content that must be hidden behind the hills and the big tree.
 *
 * The illustration mask's blue channel marks sky, so using it as alpha hides everything the
 * painting puts in front. When the mask cannot be read — a cross-origin image, or a browser that
 * refuses getImageData — the ridge outline is clipped instead, which is close but lets the tree
 * through.
 */

import { RIDGE, SKY_H, W, type Point } from '../geometry.ts'
import { isReady } from '../assets.ts'
import { canvasContext } from './canvas.ts'

export type MaskState = 'ready' | 'unreadable' | 'pending'

export type Occluder = {
  readonly state: MaskState
  /** Composite `paint` onto the display so it stays inside the sky. */
  draw(display: CanvasRenderingContext2D, x: number, y: number, width: number, height: number,
    paint: (context: CanvasRenderingContext2D) => void): void
}

const polygonPath = (points: readonly Point[]): Path2D => {
  const path = new Path2D()
  points.forEach(([x, y], index) => (index ? path.lineTo(x, y) : path.moveTo(x, y)))
  path.closePath()
  return path
}

/** The sky silhouette: the top edge of the illustration, closed along the ridge. */
const skyPath = (): Path2D => polygonPath([[0, 0], [W, 0], ...[...RIDGE].reverse()])

export function createOccluder(mask: HTMLImageElement | undefined): Occluder {
  const [maskCanvas, maskContext] = canvasContext(W, SKY_H + 256)
  const [layer, layerContext] = canvasContext(W, SKY_H + 256)
  const ridge = skyPath()
  let state: MaskState = 'pending'

  const ensure = (): void => {
    if (state !== 'pending' || !isReady(mask)) return
    const source = mask as HTMLImageElement
    if (source.naturalWidth < W || source.naturalHeight < SKY_H) {
      state = 'unreadable'
      return
    }
    try {
      maskContext.drawImage(source, 0, 0, W, SKY_H)
      const image = maskContext.getImageData(0, 0, W, SKY_H)
      const pixels = image.data
      // Blue becomes alpha. The colour channels are never sampled, so they are left white.
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i + 3] = pixels[i + 2] ?? 0
        pixels[i] = 255
        pixels[i + 1] = 255
        pixels[i + 2] = 255
      }
      maskContext.putImageData(image, 0, 0)
      state = 'ready'
    } catch {
      state = 'unreadable'
    }
  }

  return {
    get state() {
      ensure()
      return state
    },
    draw(display, x, y, width, height, paint) {
      ensure()
      if (state === 'unreadable') {
        display.save()
        display.clip(ridge)
        paint(display)
        display.restore()
        return
      }
      if (state === 'pending') return
      const left = Math.floor(x) - 2
      const top = Math.floor(y) - 2
      const w = Math.ceil(width) + 4
      const h = Math.ceil(height) + 4
      layerContext.save()
      layerContext.clearRect(left, top, w, h)
      layerContext.beginPath()
      layerContext.rect(left, top, w, h)
      layerContext.clip()
      paint(layerContext)
      layerContext.globalAlpha = 1
      layerContext.globalCompositeOperation = 'destination-in'
      layerContext.drawImage(maskCanvas, left, top, w, h, left, top, w, h)
      layerContext.restore()
      display.drawImage(layer, left, top, w, h, left, top, w, h)
    },
  }
}
