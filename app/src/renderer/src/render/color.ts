/**
 * 外部内容里的文字颜色（如 <font color="yellow">）在羊皮纸上可能看不清。
 * 这里保留色相，自动把亮度压到足以阅读的程度（对比度 ≥ 4.5）。
 */
let probe: CanvasRenderingContext2D | null = null

export function parseColor(input: string): [number, number, number] | null {
  if (!probe) probe = document.createElement('canvas').getContext('2d')
  if (!probe) return null
  const s = input.trim()
  if (!s || /url\(|expression|var\(/i.test(s)) return null
  probe.fillStyle = '#010203'
  probe.fillStyle = s
  const v = String(probe.fillStyle)
  if (v === '#010203' && !/^#?010203$/i.test(s)) return null
  if (v.startsWith('#')) return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)]
  const m = v.match(/rgba?\(([^)]+)\)/)
  if (!m) return null
  const [r, g, b, a] = m[1].split(',').map((x) => parseFloat(x))
  if (a !== undefined && a < 0.05) return null
  return [r, g, b]
}

const lin = (c: number) => {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
const luminance = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const contrast = (a: number[], b: number[]) => {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/* OKLab 转换 */
function toOklab([r, g, b]: number[]) {
  const R = lin(r)
  const G = lin(g)
  const B = lin(b)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
function fromOklab([L, a, b]: number[]): number[] {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3)
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3)
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3)
  const enc = (c: number) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
    return Math.round(Math.max(0, Math.min(1, v)) * 255)
  }
  return [enc(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), enc(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), enc(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)]
}

const cache = new Map<string, string | null>()
const PAPER = [239, 227, 200]

export function adaptColor(input: string, paper: number[] = PAPER): string | null {
  const key = input + '|' + paper.join(',')
  if (cache.has(key)) return cache.get(key)!
  const rgb = parseColor(input)
  let out: string | null = null
  if (rgb) {
    if (contrast(rgb, paper) >= 4.5) out = `rgb(${rgb.join(',')})`
    else {
      const [L, a, b] = toOklab(rgb)
      // 降低亮度，同时略收饱和度，避免发脏
      let lo = 0
      let hi = L
      let best = fromOklab([0.35, a * 0.7, b * 0.7])
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2
        const k = 0.65 + 0.35 * (mid / Math.max(L, 0.001))
        const c = fromOklab([mid, a * k, b * k])
        if (contrast(c, paper) >= 4.6) {
          best = c
          lo = mid
        } else hi = mid
      }
      out = `rgb(${best.join(',')})`
    }
  }
  cache.set(key, out)
  return out
}
