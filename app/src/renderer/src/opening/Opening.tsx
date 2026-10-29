import { useEffect, useRef } from 'react'
import { OpeningScene } from './scene'
import { OpeningScore } from './score'
import { getTheme } from '../theme/apply'

/**
 * 开场用的画布与 WebGL 场景整个程序只建一次，重播时复用。
 * （销毁 WebGL 上下文会让屏幕白闪一帧，见 scene.sleep 的说明）
 */
let kept: { canvas: HTMLCanvasElement; scene: OpeningScene; theme: string } | null = null

function acquire(): { canvas: HTMLCanvasElement; scene: OpeningScene } {
  const theme = getTheme()
  if (kept && kept.theme === theme.id) {
    kept.scene.wake()
    return kept
  }
  const canvas = document.createElement('canvas')
  canvas.className = 'opening-canvas'
  const scene = new OpeningScene(canvas, theme.paper, { ink: theme.fx.ink, gold: theme.fx.gold, glow: theme.fx.glow, rubric: theme.fx.rubric })
  kept = { canvas, scene, theme: theme.id }
  return kept
}

/**
 * 开场动画容器：双击或 Esc 跳过（画面上不显示任何提示）。
 * 测试时可以用 ?t=秒 冻结在某一帧（仅用于截图检查）。
 */
export function Opening({ onReveal, onDone }: { onReveal: () => void; onDone: () => void }) {
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let canvas: HTMLCanvasElement
    let scene: OpeningScene
    try {
      ;({ canvas, scene } = acquire())
    } catch (e) {
      console.error('开场动画初始化失败', e)
      onReveal()
      onDone()
      return
    }
    wrap.current!.appendChild(canvas)
    const params = new URLSearchParams(location.search)
    let freeze = params.get('t') ? Number(params.get('t')) : null
    ;(window as any).__openingSetT = (t: number) => (freeze = t)
    // 预热：先把各阶段画一遍（让显卡把着色器真正编译好），最后停在全黑的第一帧，再开始计时
    if (freeze == null) for (const wt of [3.5, 2.0, 4.6, 0]) scene.render(wt)
    const score = new OpeningScore()
    if (freeze == null) score.start(0.04)
    const t0 = performance.now() + 40
    let raf = 0
    let revealed = false
    let finished = false
    const now = () => (freeze != null ? freeze : Math.max(0, (performance.now() - t0) / 1000))

    const stats = { frames: 0, worst: 0, last: 0, start: performance.now(), log: [] as number[] }
    ;(window as any).__openingStats = stats
    const tick = () => {
      const t = now()
      const pn = performance.now()
      if (stats.last) {
        stats.worst = Math.max(stats.worst, pn - stats.last)
        if (stats.log.length < 4000) stats.log.push(t, pn - stats.last)
      }
      stats.last = pn
      stats.frames++
      scene.render(t)
      if (!revealed && t >= scene.exitStart) {
        revealed = true
        onReveal()
      }
      if (scene.done(t) && freeze == null) {
        if (!finished) {
          finished = true
          onDone()
        }
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const skip = () => {
      const t = now()
      if (t >= scene.exitStart) return
      scene.skip(t)
      score.stop(0.35)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') skip()
    }
    const onResize = () => scene.resize()
    const el = wrap.current!
    el.addEventListener('dblclick', skip)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('dblclick', skip)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
      canvas.remove()
      scene.sleep()
    }
  }, [])

  return (
    <div ref={wrap} className="opening" aria-hidden />
  )
}
