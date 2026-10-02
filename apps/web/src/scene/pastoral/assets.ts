/**
 * Lazy asset store. Base layers, the cloud layer and the clean sky plate are separate images so the
 * shader can move the clouds and keep the pure illustration underneath.
 *
 * The images live next to this module (copied from the 田园四时 demo; see docs/design/PASTORAL_ASSETS.md).
 */

import type { Phase, SeasonKey } from './model.ts'
import { KEYS } from './model.ts'

const files = import.meta.glob('./assets/*.{webp,png}', { query: '?url', import: 'default', eager: true }) as Record<
  string,
  string
>

const url = (name: string): string => {
  const found = files[`./assets/${name}`]
  if (!found) throw new Error(`missing pastoral asset: ${name}`)
  return found
}

export type ImageId = string

/** True once an element has decoded to something drawable. */
export const isReady = (image: HTMLImageElement | undefined): boolean =>
  !!image && image.complete && image.naturalWidth > 0

export const baseId = (key: SeasonKey, phase: Phase): ImageId => `${key}-${phase}`
export const cloudId = (key: SeasonKey, phase: Phase): ImageId => `${key}-${phase}-cloud`
export const plateId = (key: SeasonKey, phase: Phase): ImageId => `${key}-${phase}-plate`

export const ASSET_URLS: Record<ImageId, string> = (() => {
  const table: Record<ImageId, string> = { moon: url('moon.png'), mask: url('mask.png') }
  for (const key of KEYS) {
    for (const phase of ['day', 'dawn', 'dusk', 'night'] as const) {
      table[baseId(key, phase)] = url(`${key}-${phase}.webp`)
      table[cloudId(key, phase)] = url(`${key}-${phase}-cloud.webp`)
      table[plateId(key, phase)] = url(`${key}-${phase}-plate.png`)
    }
  }
  return table
})()

export const assetPath = (id: ImageId): string => {
  const found = ASSET_URLS[id]
  if (!found) throw new Error(`unknown pastoral asset: ${id}`)
  return found
}

/** The image ids needed for one season key at one phase. */
export function layersFor(key: SeasonKey, phase: Phase): ImageId[] {
  return [baseId(key, phase), cloudId(key, phase), plateId(key, phase)]
}

export class ImageStore {
  private readonly images = new Map<ImageId, HTMLImageElement>()

  get(id: ImageId): HTMLImageElement | undefined {
    return this.images.get(id)
  }

  ready(id: ImageId): boolean {
    const image = this.images.get(id)
    return !!image && image.complete && image.naturalWidth > 0
  }

  /** Load an id or return the existing element. The same id never loads twice. */
  load(id: ImageId): HTMLImageElement {
    const existing = this.images.get(id)
    if (existing) return existing
    const image = new Image()
    image.decoding = 'async'
    image.src = assetPath(id)
    this.images.set(id, image)
    return image
  }

  /** Drop everything outside the kept season keys so decoded bitmaps stay near the demo's budget. */
  retain(keys: readonly SeasonKey[]): void {
    const keep = new Set<SeasonKey>(keys)
    for (const id of [...this.images.keys()]) {
      if (id === 'moon' || id === 'mask') continue
      if (keep.has(id.split('-')[0] as SeasonKey)) continue
      this.images.delete(id)
    }
  }

  /** Resolve once both the current and the next season key have their layers at every phase. */
  async preload(keys: readonly SeasonKey[], onProgress?: (done: number, total: number) => void): Promise<void> {
    const ids = keys.flatMap((key) => (['day', 'dawn', 'dusk', 'night'] as const).flatMap((p) => layersFor(key, p)))
    ids.push('moon', 'mask')
    let done = 0
    await Promise.all(
      ids.map(
        (id) =>
          new Promise<void>((resolve) => {
            const image = this.load(id)
            const finish = (): void => {
              done += 1
              onProgress?.(done, ids.length)
              resolve()
            }
            if (image.complete) finish()
            else {
              image.addEventListener('load', finish, { once: true })
              image.addEventListener('error', finish, { once: true })
            }
          }),
      ),
    )
  }
}
