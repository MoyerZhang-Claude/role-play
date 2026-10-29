/**
 * 主法阵四周的内容：星盘弧、四个卫星法阵（本草 / 月与星 / 晶石 / 火焰）、虚线连线、星图。
 * 卫星法阵里的东西就是「药材」，药汤熬煮时它们会化作光点飞进阵心。
 */
import { mk, arc, type Stroke } from './circle'

export interface Layout {
  /** 卫星法阵相对主阵中心的横、纵距离（R 单位） */
  sx: number
  sy: number
}

const TOP = -Math.PI / 2
const TAU = Math.PI * 2
export const SAT_R = 0.26

export function addPeriphery(S: Stroke[], layout: Layout, r: () => number): [number, number][] {
  // 星盘弧：只在上下两侧，避开四角的卫星
  const spans: [number, number][] = [
    [-Math.PI * 0.75, -Math.PI * 0.25],
    [Math.PI * 0.25, Math.PI * 0.75]
  ]
  spans.forEach(([a0, a1], k) => {
    const t0 = 1.28 + k * 0.08
    S.push(mk(arc(1.17, a0, a1, 120), t0, t0 + 0.4, 1.1, 0, 0.85))
    S.push(mk(arc(1.235, a1, a0, 120), t0 + 0.06, t0 + 0.46, 0.7, 0, 0.6))
    const n = 30
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n
      const long = i % 5 === 0
      const tt = t0 + 0.1 + (i / n) * 0.36
      const r1 = long ? 1.215 : 1.195
      S.push(mk([[Math.cos(a) * 1.17, Math.sin(a) * 1.17], [Math.cos(a) * r1, Math.sin(a) * r1]], tt, tt + 0.04, long ? 1.0 : 0.6, 0, 0.7))
      if (long) S.push(mk(arc(0.007, 0, TAU, 8).map(([x, y]) => [x + Math.cos(a) * 1.28, y + Math.sin(a) * 1.28]), tt + 0.03, tt + 0.07, 1.3, 0, 0.8))
    }
  })

  const sats: [number, number][] = [
    [-layout.sx, -layout.sy],
    [layout.sx, -layout.sy],
    [-layout.sx, layout.sy],
    [layout.sx, layout.sy]
  ]
  const pictures = [herb, moonStars, crystals, flame]
  sats.forEach(([cx, cy], si) => {
    // 与主阵一样顺时针依次画出：右上 → 右下 → 左下 → 左上
    const rank = [3, 0, 2, 1][si]
    const base = 1.58 + rank * 0.16
    const dist = Math.hypot(cx, cy)
    const ux = cx / dist
    const uy = cy / dist
    // 虚线连线：从主阵边缘到卫星
    const from = 1.02
    const to = dist - SAT_R * 1.12
    if (to > from + 0.05) {
      const seg = 0.055
      const gap = 0.035
      let d = from
      while (d < to) {
        const e = Math.min(to, d + seg)
        const tt = base + ((d - from) / (to - from)) * 0.3
        S.push(mk([[ux * d, uy * d], [ux * e, uy * e]], tt, tt + 0.03, 0.9, 3, 0.75))
        d = e + gap
      }
      const mid = (from + to) / 2
      const dm = 0.022
      const pm = (a: number, b: number) => [ux * (mid + a) - uy * b, uy * (mid + a) + ux * b]
      S.push(mk([pm(0, dm), pm(dm, 0), pm(0, -dm), pm(-dm, 0), pm(0, dm)], base + 0.18, base + 0.26, 1.0, 3))
    }
    // 卫星外环（自转）
    const spin = (si % 2 ? -1 : 1) * 0.16
    const piv: [number, number] = [cx, cy]
    const ring = (rr: number, w: number, t0: number, alpha = 1) => S.push(mk(arc(SAT_R * rr, TOP, TOP + TAU, 90).map(([x, y]) => [x + cx, y + cy]), t0, t0 + 0.32, w, 3, alpha, piv, spin))
    ring(1, 1.4, base + 0.24)
    ring(0.88, 0.7, base + 0.3, 0.8)
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU
      const long = i % 6 === 0
      const r0 = SAT_R * 0.885
      const r1 = SAT_R * (long ? 0.99 : 0.95)
      const tt = base + 0.34 + (i / 24) * 0.22
      S.push(mk([[cx + Math.cos(a) * r0, cy + Math.sin(a) * r0], [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1]], tt, tt + 0.04, long ? 1.0 : 0.6, 3, 0.8, piv, spin))
    }
    // 卫星中的小图
    const t0 = base + 0.42
    pictures[si](SAT_R * 0.62).forEach((pts, j) => S.push(mk(pts.map(([x, y]) => [x + cx, y + cy]), t0 + j * 0.022, t0 + j * 0.022 + 0.14, 1.15, 3)))
  })

  // 星图：左右两侧中部，若隐若现
  for (const side of [-1, 1]) {
    const cx = side * Math.max(1.45, layout.sx * 0.95)
    const stars: [number, number][] = []
    for (let i = 0; i < 6; i++) stars.push([cx + (r() - 0.5) * 0.4, (r() - 0.5) * 0.72])
    stars.sort((a, b) => a[1] - b[1])
    stars.forEach(([x, y], i) => {
      const tt = 2.2 + i * 0.05 + (side > 0 ? 0.08 : 0)
      const rad = 0.006 + r() * 0.008
      S.push(mk(arc(rad, 0, TAU, 10).map(([a, b]) => [a + x, b + y]), tt, tt + 0.05, 1.6, 3, 0.75))
      if (i > 0) {
        const [px, py] = stars[i - 1]
        S.push(mk([[px, py], [x, y]], tt - 0.04, tt + 0.08, 0.55, 3, 0.45))
      }
    })
  }
  return sats
}

/* ───── 卫星法阵里的小图（局部坐标，s 为尺寸） ───── */

/** 本草：一枝带叶的草药 */
function herb(s: number): number[][][] {
  const out: number[][][] = []
  const P = (u: number) => [(-0.5 + u * 0.95) * s + Math.sin(u * Math.PI) * 0.16 * s, (0.62 - u * 1.24) * s]
  const stem: number[][] = []
  for (let i = 0; i <= 24; i++) stem.push(P(i / 24))
  out.push(stem)
  ;[0.22, 0.36, 0.5, 0.64, 0.78, 0.92].forEach((u, k) => {
    const [bx, by] = P(u)
    const [nx, ny] = P(Math.min(1, u + 0.02))
    const ang = Math.atan2(ny - by, nx - bx) + (k % 2 ? 1 : -1) * 0.9
    const dx = Math.cos(ang)
    const dy = Math.sin(ang)
    const len = s * (0.42 - u * 0.18)
    const w = len * 0.32
    const leaf: number[][] = []
    for (let i = 0; i <= 10; i++) {
      const v = i / 10
      const o = Math.sin(v * Math.PI) * w
      leaf.push([bx + dx * len * v - dy * o, by + dy * len * v + dx * o])
    }
    for (let i = 10; i >= 0; i--) {
      const v = i / 10
      const o = Math.sin(v * Math.PI) * w * 0.85
      leaf.push([bx + dx * len * v + dy * o, by + dy * len * v - dx * o])
    }
    out.push(leaf)
    out.push([
      [bx, by],
      [bx + dx * len * 0.85, by + dy * len * 0.85]
    ])
  })
  return out
}

/** 新月与三颗星 */
function moonStars(s: number): number[][][] {
  const out: number[][][] = []
  const cres: number[][] = []
  for (let i = 0; i <= 30; i++) {
    const a = Math.PI * 0.35 + (i / 30) * Math.PI * 1.3
    cres.push([Math.cos(a) * 0.55 * s - 0.12 * s, Math.sin(a) * 0.55 * s])
  }
  for (let i = 30; i >= 0; i--) {
    const a = Math.PI * 0.42 + (i / 30) * Math.PI * 1.16
    cres.push([Math.cos(a) * 0.42 * s + 0.02 * s, Math.sin(a) * 0.46 * s])
  }
  cres.push(cres[0])
  out.push(cres)
  const star = (x: number, y: number, k: number) => {
    out.push([
      [x - k, y],
      [x + k, y]
    ])
    out.push([
      [x, y - k * 1.3],
      [x, y + k * 1.3]
    ])
  }
  star(0.38 * s, -0.42 * s, 0.1 * s)
  star(0.56 * s, 0.05 * s, 0.07 * s)
  star(0.28 * s, 0.42 * s, 0.06 * s)
  return out
}

/** 晶石簇 */
function crystals(s: number): number[][][] {
  const out: number[][][] = []
  const prism = (bx: number, by: number, ang: number, len: number, w: number) => {
    const dx = Math.sin(ang)
    const dy = -Math.cos(ang)
    const nx = -dy
    const ny = dx
    const p = (a: number, b: number) => [bx + dx * a + nx * b, by + dy * a + ny * b]
    out.push([p(0, -w), p(len * 0.78, -w), p(len, 0), p(len * 0.78, w), p(0, w), p(0, -w)])
    out.push([p(len * 0.78, -w), p(len * 0.86, 0), p(len * 0.78, w)])
    out.push([p(0.05 * len, 0), p(len * 0.86, 0)])
  }
  prism(-0.02 * s, 0.55 * s, -0.08, 1.05 * s, 0.17 * s)
  prism(-0.25 * s, 0.6 * s, -0.55, 0.72 * s, 0.13 * s)
  prism(0.2 * s, 0.6 * s, 0.45, 0.62 * s, 0.12 * s)
  out.push([
    [-0.62 * s, 0.6 * s],
    [0.62 * s, 0.6 * s]
  ])
  return out
}

/** 火焰 */
function flame(s: number): number[][][] {
  const shape = (k: number, oy: number) => {
    const pts: number[][] = []
    for (let i = 0; i <= 40; i++) {
      const v = i / 40
      const side = v < 0.5 ? -1 : 1
      const u = v < 0.5 ? v * 2 : (1 - v) * 2
      const y = (0.6 - u * 1.25) * s * k + oy
      const wv = Math.sin(Math.min(1, u * 1.15) * Math.PI) * (0.42 - u * 0.2) * s * k
      const wob = Math.sin(u * 9 + side) * 0.03 * s * k * u
      pts.push([side * wv + wob, y])
    }
    return pts
  }
  return [
    shape(1, 0),
    shape(0.55, 0.22 * s),
    [
      [-0.5 * s, 0.68 * s],
      [0.5 * s, 0.68 * s]
    ]
  ]
}
