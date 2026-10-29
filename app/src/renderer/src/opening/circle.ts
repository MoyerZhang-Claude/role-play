/**
 * 法阵的几何：每一笔都有自己的起止时间，画面按时间把笔画「写」出来。
 * 坐标以法阵半径 R 为单位，圆心为原点，y 轴向下。
 */
import { addPeriphery, type Layout } from './periphery'

export type Group = 0 | 1 | 2 | 3 // 外环 / 中环 / 内环（各自旋转）/ 四周（不随主阵旋转）

export interface Stroke {
  pts: Float32Array
  len: Float32Array // 累计长度
  total: number
  t0: number
  t1: number
  width: number
  group: Group
  alpha: number
  /** 绕自身中心缓慢旋转（卫星法阵的外环） */
  pivot?: [number, number]
  spin?: number
}

export function mk(points: number[][], t0: number, t1: number, width: number, group: Group, alpha = 1, pivot?: [number, number], spin?: number): Stroke {
  const pts = new Float32Array(points.length * 2)
  const len = new Float32Array(points.length)
  let total = 0
  points.forEach((p, i) => {
    pts[i * 2] = p[0]
    pts[i * 2 + 1] = p[1]
    if (i > 0) total += Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1])
    len[i] = total
  })
  return { pts, len, total, t0, t1, width, group, alpha, pivot, spin }
}

export function arc(r: number, a0: number, a1: number, n = 220): number[][] {
  const out: number[][] = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    out.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  return out
}

/** 可复现的伪随机 */
export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** 原创符文：一根竖干 + 若干枝杈 / 圆点（局部坐标，宽高约 1） */
function rune(r: () => number): number[][][] {
  const strokes: number[][][] = []
  const kind = Math.floor(r() * 6)
  const stemX = kind === 5 ? -0.25 : 0
  strokes.push([
    [stemX, -0.5],
    [stemX, 0.5]
  ])
  const branches = 1 + Math.floor(r() * 3)
  for (let b = 0; b < branches; b++) {
    const y0 = -0.45 + r() * 0.6
    const side = r() < 0.5 ? -1 : 1
    const t = Math.floor(r() * 4)
    if (t === 0) strokes.push([[stemX, y0], [stemX + side * 0.38, y0 + 0.28]])
    else if (t === 1) strokes.push([[stemX, y0 + 0.28], [stemX + side * 0.38, y0]])
    else if (t === 2)
      strokes.push([
        [stemX, y0],
        [stemX + side * 0.36, y0 + 0.18],
        [stemX, y0 + 0.36]
      ])
    else strokes.push([[stemX - 0.3, y0 + 0.1], [stemX + 0.3, y0 + 0.1]])
  }
  if (r() < 0.28) {
    const cy = -0.2 + r() * 0.4
    const cx = stemX + (r() < 0.5 ? -0.28 : 0.28)
    strokes.push(arc(0.09, 0, Math.PI * 2, 14).map(([x, y]) => [x + cx, y + cy]))
  }
  return strokes
}

export interface CircleSpec {
  strokes: Stroke[]
  vertices: [number, number][]
  /** 四个卫星法阵的圆心（R 单位，y 向下）：左上 本草 / 右上 月与星 / 左下 晶石 / 右下 火焰 */
  satellites: [number, number][]
}

export function buildCircle(seed = 7, layout: Layout = { sx: 1.9, sy: 0.82 }): CircleSpec {
  const S: Stroke[] = []
  const TOP = -Math.PI / 2
  const TAU = Math.PI * 2
  const r = rng(seed)

  // 外环
  S.push(mk(arc(1.0, TOP, TOP + TAU, 320), 1.1, 1.55, 2.6, 0))
  S.push(mk(arc(0.982, TOP + 0.2, TOP + 0.2 + TAU, 320), 1.2, 1.62, 0.9, 0, 0.8))
  S.push(mk(arc(0.895, TOP + Math.PI, TOP + Math.PI - TAU, 300), 1.3, 1.74, 1.3, 0))

  // 符文带
  const N = 40
  for (let i = 0; i < N; i++) {
    const a = TOP + (i / N) * TAU
    const g = rune(r)
    const t0 = 1.42 + i * 0.019
    const size = 0.052
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    g.forEach((st, k) => {
      // 让「上」朝外：局部 y 轴沿半径方向
      const pts = st.map(([x, y]) => {
        const rr = 0.94 - y * size
        const tx = x * size
        return [ca * rr - sa * tx, sa * rr + ca * tx]
      })
      S.push(mk(pts, t0 + k * 0.018, t0 + k * 0.018 + 0.07, 1.25, 0))
    })
  }

  // 刻度
  const ticks = 96
  for (let i = 0; i < ticks; i++) {
    const a = TOP + (i / ticks) * TAU
    const long = i % 8 === 0
    const r0 = long ? 0.765 : 0.79
    const t0 = 1.58 + (i / ticks) * 0.42
    S.push(mk([[Math.cos(a) * 0.815, Math.sin(a) * 0.815], [Math.cos(a) * r0, Math.sin(a) * r0]], t0, t0 + 0.05, long ? 1.4 : 0.8, 0, 0.85))
  }

  // 中环 + 七芒星
  S.push(mk(arc(0.755, TOP, TOP - TAU, 300), 1.52, 1.95, 1.5, 1))
  const verts: [number, number][] = []
  for (let k = 0; k < 7; k++) {
    const a = TOP + (k / 7) * TAU
    verts.push([Math.cos(a) * 0.755, Math.sin(a) * 0.755])
  }
  for (let k = 0; k < 7; k++) {
    const a = verts[(k * 3) % 7]
    const b = verts[(k * 3 + 3) % 7]
    const t0 = 1.76 + k * 0.072
    S.push(mk([a, b], t0, t0 + 0.13, 1.25, 1))
  }
  for (let k = 0; k < 7; k++) {
    const [vx, vy] = verts[(k * 3) % 7]
    const t0 = 1.78 + k * 0.072
    S.push(mk(arc(0.034, 0, TAU, 28).map(([x, y]) => [x + vx, y + vy]), t0, t0 + 0.09, 1.2, 1))
  }

  // 四个炼金符号（日、月、汞、盐），位于中环与内环之间
  const syms: number[][][][] = [
    [arc(0.042, 0, TAU, 30), arc(0.008, 0, TAU, 8)],
    [arc(0.042, -1.1, 4.0, 30), arc(0.032, -0.6, 3.6, 26).map(([x, y]) => [x + 0.016, y])],
    [arc(0.03, 0, TAU, 24), [[0, 0.03], [0, 0.07]], [[-0.02, 0.05], [0.02, 0.05]], arc(0.022, Math.PI, TAU, 14).map(([x, y]) => [x, y - 0.035])],
    [arc(0.042, 0, TAU, 30), [[-0.042, 0], [0.042, 0]]]
  ]
  syms.forEach((parts, i) => {
    const a = TOP + Math.PI / 4 + (i * Math.PI) / 2
    const cx = Math.cos(a) * 0.625
    const cy = Math.sin(a) * 0.625
    parts.forEach((p, k) => S.push(mk(p.map(([x, y]) => [x + cx, y + cy]), 2.28 + i * 0.06 + k * 0.03, 2.4 + i * 0.06 + k * 0.03, 1.2, 1)))
  })

  // 内环 + 六芒星
  S.push(mk(arc(0.5, TOP, TOP + TAU, 260), 1.98, 2.32, 1.4, 2))
  S.push(mk(arc(0.478, TOP + Math.PI, TOP + Math.PI + TAU, 260), 2.05, 2.38, 0.8, 2, 0.8))
  const hex = (off: number) => [0, 1, 2, 3].map((k) => {
    const a = TOP + off + (k / 3) * TAU
    return [Math.cos(a) * 0.478, Math.sin(a) * 0.478]
  })
  S.push(mk(hex(0), 2.1, 2.42, 1.1, 2))
  S.push(mk(hex(Math.PI), 2.16, 2.48, 1.1, 2))
  // 药池边缘
  S.push(mk(arc(0.3, TOP, TOP - TAU, 200), 2.24, 2.56, 1.8, 2))

  const satellites = addPeriphery(S, layout, r)
  return { strokes: S, vertices: verts, satellites }
}

/** 把一笔画到 ctx 上（按进度截断），返回笔尖位置 */
export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, p: number, R: number): [number, number] | null {
  if (p <= 0) return null
  const target = s.total * Math.min(1, p)
  const n = s.len.length
  ctx.beginPath()
  ctx.moveTo(s.pts[0] * R, s.pts[1] * R)
  let hx = s.pts[0] * R
  let hy = s.pts[1] * R
  for (let i = 1; i < n; i++) {
    if (s.len[i] <= target) {
      hx = s.pts[i * 2] * R
      hy = s.pts[i * 2 + 1] * R
      ctx.lineTo(hx, hy)
    } else {
      const seg = s.len[i] - s.len[i - 1]
      const f = seg > 0 ? (target - s.len[i - 1]) / seg : 0
      hx = (s.pts[(i - 1) * 2] + (s.pts[i * 2] - s.pts[(i - 1) * 2]) * f) * R
      hy = (s.pts[(i - 1) * 2 + 1] + (s.pts[i * 2 + 1] - s.pts[(i - 1) * 2 + 1]) * f) * R
      ctx.lineTo(hx, hy)
      break
    }
  }
  ctx.stroke()
  return [hx, hy]
}
