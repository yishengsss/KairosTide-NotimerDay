/**
 * One wind model for everything that moves with it: tree, grass, paddy, smoke, fallers, rain, snow,
 * clouds and the wind sound. The shader repeats the same formulas.
 */
export const windLull = (t: number): number => 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.11) * Math.sin(t * 0.047 + 1.3))

export const gustAt = (x: number, t: number): number =>
  (0.5 + 0.5 * (0.6 * Math.sin(x * 0.0045 - t * 1.1) + 0.4 * Math.sin(x * 0.011 - t * 1.7 + 1.3))) * windLull(t)

export type WindSeason = { windFromSeason: number; reducedMotion: boolean; wet: number }

export function windStrength(season: number, wet: number, reducedMotion: boolean): number {
  return season * (1 + wet * 0.6) * (reducedMotion ? 0.5 : 1)
}
