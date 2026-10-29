/**
 * 全局特效层：点击时的墨点涟漪、金色火花等。
 * 画布铺满窗口、不接收鼠标；没有特效时停止渲染。
 */
type RGB = [number, number, number]

interface Ripple {
  kind: 'ink' | 'gold'
  x: number
  y: number
  t0: number
  dur: number
  scale: number
  color: RGB
  specks: { a: number; d: number; r: number; delay: number }[]
  wobble: number[]
}

let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let items: Ripple[] = []
let raf = 0
let dpr = 1
let reduced = false

export function setReducedMotion(r: boolean) {
  reduced = r
}

function ensure() {
  if (canvas) return
  canvas = document.createElement('canvas')
  canvas.className = 'fx-layer'
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '9000' })
  document.body.appendChild(canvas)
  ctx = canvas.getContext('2d')
  const resize = () => {
    dpr = window.devicePixelRatio || 1
    canvas!.width = Math.round(window.innerWidth * dpr)
    canvas!.height = Math.round(window.innerHeight * dpr)
  }
  resize()
  window.addEventListener('resize', resize)
}

export function ripple(x: number, y: number, opts: { kind?: 'ink' | 'gold'; scale?: number; color?: RGB } = {}) {
  if (reduced) return
  ensure()
  const kind = opts.kind ?? 'ink'
  const n = 5 + Math.floor(Math.random() * 3)
  const specks = Array.from({ length: n }, () => ({ a: Math.random() * Math.PI * 2, d: 10 + Math.random() * 16, r: 0.6 + Math.random() * 1.6, delay: Math.random() * 0.12 }))
  const wobble = Array.from({ length: 9 }, () => Math.random() * 2 - 1)
  items.push({
    kind,
    x,
    y,
    t0: performance.now(),
    dur: kind === 'gold' ? 620 : 560,
    scale: opts.scale ?? 1,
    color: opts.color ?? (kind === 'gold' ? [217, 172, 76] : [43, 33, 24]),
    specks,
    wobble
  })
  if (!raf) raf = requestAnimationFrame(frame)
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

function frame(now: number) {
  raf = 0
  if (!ctx || !canvas) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  items = items.filter((r) => now - r.t0 < r.dur)
  for (const r of items) {
    const p = (now - r.t0) / r.dur
    const e = easeOut(p)
    const [cr, cg, cb] = r.color
    const s = r.scale
    ctx.save()
    if (r.kind === 'gold') ctx.globalCompositeOperation = 'lighter'
    // 墨晕：带轻微不规则边缘的圆
    const rad = (5 + 20 * e) * s
    const alpha = (1 - p) * (r.kind === 'gold' ? 0.5 : 0.28)
    ctx.beginPath()
    for (let i = 0; i <= 36; i++) {
      const a = (i / 36) * Math.PI * 2
      const w = r.wobble[i % r.wobble.length] * 0.08 + r.wobble[(i * 3) % r.wobble.length] * 0.05
      const rr = rad * (1 + w * (0.4 + e))
      const px = r.x + Math.cos(a) * rr
      const py = r.y + Math.sin(a) * rr
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.lineWidth = Math.max(0.4, 2.2 * (1 - e)) * s
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`
    ctx.stroke()
    // 中心墨点（迅速变淡）
    const core = Math.max(0, 1 - p * 2.2)
    if (core > 0) {
      const g = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, 9 * s)
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${0.32 * core})`)
      g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(r.x, r.y, 9 * s, 0, Math.PI * 2)
      ctx.fill()
    }
    // 溅出的小墨珠
    for (const k of r.specks) {
      const q = Math.max(0, Math.min(1, (p - k.delay) / (1 - k.delay)))
      if (q <= 0) continue
      const d = k.d * easeOut(q) * s
      const a = (1 - q) * (r.kind === 'gold' ? 0.9 : 0.5)
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`
      ctx.beginPath()
      ctx.arc(r.x + Math.cos(k.a) * d, r.y + Math.sin(k.a) * d, k.r * (1 - q * 0.5) * s, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
  if (items.length) raf = requestAnimationFrame(frame)
  else {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }
}
