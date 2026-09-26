import type { LinearRGB, OKLab } from '../types'

const finite = (n: number, fallback = 0) => Number.isFinite(n) ? n : fallback
export const clamp01 = (v: number) => Math.min(1, Math.max(0, finite(v)))
export function srgbToLinear(v: number): number {
  const c = clamp01(v)
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
export function linearToSrgb(v: number): number {
  const c = Math.max(0, finite(v))
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
}
export function encodedRgbToLinear(r: number, g: number, b: number): LinearRGB {
  return { r: srgbToLinear(r), g: srgbToLinear(g), b: srgbToLinear(b) }
}
export function linearToEncodedRgb(c: LinearRGB): [number, number, number] {
  return [clamp01(linearToSrgb(c.r)), clamp01(linearToSrgb(c.g)), clamp01(linearToSrgb(c.b))]
}
export function linearToOKLab(c: LinearRGB): OKLab {
  const l = Math.cbrt(finite(0.4122214708*c.r + 0.5363325363*c.g + 0.0514459929*c.b))
  const m = Math.cbrt(finite(0.2119034982*c.r + 0.6806995451*c.g + 0.1073969566*c.b))
  const s = Math.cbrt(finite(0.0883024619*c.r + 0.2817188376*c.g + 0.6299787005*c.b))
  return {
    L: finite(0.2104542553*l + 0.793617785*m - 0.0040720468*s),
    a: finite(1.9779984951*l - 2.428592205*m + 0.4505937099*s),
    b: finite(0.0259040371*l + 0.7827717662*m - 0.808675766*s),
  }
}
export function oklabToLinear(lab: OKLab): LinearRGB {
  const l_ = lab.L + 0.3963377774*lab.a + 0.2158037573*lab.b
  const m_ = lab.L - 0.1055613458*lab.a - 0.0638541728*lab.b
  const s_ = lab.L - 0.0894841775*lab.a - 1.291485548*lab.b
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3
  return {
    r: finite(4.0767416621*l - 3.3077115913*m + 0.2309699292*s),
    g: finite(-1.2684380046*l + 2.6097574011*m - 0.3413193965*s),
    b: finite(-0.0041960863*l - 0.7034186147*m + 1.707614701*s),
  }
}
export function linearToOKLCH(c: LinearRGB) {
  const lab = linearToOKLab(c)
  return { L: lab.L, C: Math.hypot(lab.a, lab.b), h: Math.atan2(lab.b, lab.a) }
}
export function deltaEOK(a: LinearRGB, b: LinearRGB): number {
  const x = linearToOKLab(a), y = linearToOKLab(b)
  return Math.hypot(x.L-y.L, x.a-y.a, x.b-y.b)
}

export interface GamutMapper { map(color: LinearRGB, gamut?: 'srgb'): LinearRGB }
const inGamut = (c: LinearRGB) => [c.r,c.g,c.b].every(v => Number.isFinite(v) && v >= -1e-7 && v <= 1 + 1e-7)
export const hardClipGamut: GamutMapper = { map: c => ({ r: clamp01(c.r), g: clamp01(c.g), b: clamp01(c.b) }) }
export const oklchChromaCompression: GamutMapper = {
  map(color) {
    if (inGamut(color)) return { r: clamp01(color.r), g: clamp01(color.g), b: clamp01(color.b) }
    const lch = linearToOKLCH(color)
    const L = Math.min(1, Math.max(0, lch.L)), h = Number.isFinite(lch.h) ? lch.h : 0
    let lo = 0, hi = Math.min(0.5, Math.max(0, Number.isFinite(lch.C) ? lch.C : 0))
    for (let i=0; i<22; i++) {
      const mid = (lo + hi) / 2
      const candidate = oklabToLinear({ L, a: mid*Math.cos(h), b: mid*Math.sin(h) })
      if (inGamut(candidate)) lo = mid
      else hi = mid
    }
    const mapped = oklabToLinear({ L, a: lo*Math.cos(h), b: lo*Math.sin(h) })
    return { r: clamp01(mapped.r), g: clamp01(mapped.g), b: clamp01(mapped.b) }
  },
}
