export const clamp = (x: number, a = 0, b = 1): number => Math.min(b, Math.max(a, x))

export const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export const rnd = (a = 1, b?: number): number => (b === undefined ? Math.random() * a : a + Math.random() * (b - a))

export const hash = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

export const bump = (h: number, a: number, b: number): number => {
  const x = (h - a) / (b - a)
  return x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x)
}

/** Solar-term predicate over the term index ring (0 = 春分), wrapping past 23. */
export const inTerms = (t: number, a: number, b: number): boolean => (a <= b ? t >= a && t <= b : t >= a || t <= b)
