import { useEffect, useRef, useState } from 'react'

/**
 * 匀速书写：接口返回是一阵一阵的，这里按稳定的节奏把字「写」出来，
 * 落后太多时自动加速，保证不会拖沓（最多落后约 0.6 秒）。
 */
export function useSmoothText(target: string, active: boolean, enabled: boolean): string {
  const [shown, setShown] = useState(active && enabled ? '' : target)
  const st = useRef({ n: active && enabled ? 0 : target.length, target, active, raf: 0, last: 0, emit: 0 })
  st.current.target = target
  st.current.active = active

  useEffect(() => {
    const s = st.current
    if (!enabled) {
      s.n = target.length
      return
    }
    if (target.length < s.n) s.n = target.length
    if (!active && !s.raf && s.n >= target.length) {
      setShown(target)
      return
    }
    if (s.raf) return
    s.last = 0
    const tick = (now: number) => {
      const total = s.target.length
      if (!s.last) s.last = now
      const dt = Math.min(0.1, (now - s.last) / 1000)
      s.last = now
      const behind = total - s.n
      if (behind > 0) {
        // 基础约 38 字/秒，落后时按比例追赶
        const speed = Math.max(38, behind / (s.active ? 0.6 : 0.25))
        s.n = Math.min(total, s.n + speed * dt)
      }
      const done = !s.active && s.n >= total
      if (now - s.emit > 24 || done) {
        s.emit = now
        const str = done ? s.target : s.target.slice(0, Math.floor(s.n))
        setShown((p) => (p === str ? p : str))
      }
      s.raf = done ? 0 : requestAnimationFrame(tick)
    }
    s.raf = requestAnimationFrame(tick)
  }, [target, active, enabled])

  useEffect(() => () => cancelAnimationFrame(st.current.raf), [])

  return enabled ? shown : target
}

/** 记录可见文字长度随时间的变化，给新出现的字套上「墨渗」动画 */
export class InkTrail {
  private marks: { len: number; t: number }[] = []
  private life = 560

  reset() {
    this.marks = []
  }

  /** 渲染完成后调用：container 已经是最新的 DOM */
  apply(container: HTMLElement, streaming: boolean) {
    const now = performance.now()
    const total = textLength(container)
    const prev = this.marks[this.marks.length - 1]
    if (!prev || total !== prev.len) this.marks.push({ len: total, t: now })
    this.marks = this.marks.filter((m, i) => i === this.marks.length - 1 || now - this.marks[i + 1].t < this.life)
    if (!streaming && this.marks.length <= 1) return
    // 相邻两次记录之间新增的字 = 一段，按出现时间设置负的动画延迟，重渲染时动画连续不跳
    for (let i = this.marks.length - 1; i > 0; i--) {
      const a = this.marks[i - 1]
      const b = this.marks[i]
      const age = now - b.t
      if (age >= this.life) break
      if (b.len > a.len) wrapRange(container, a.len, Math.min(b.len, total), -age)
    }
  }
}

function textLength(el: Node): number {
  let n = 0
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  while (w.nextNode()) n += (w.currentNode as Text).data.length
  return n
}

function wrapRange(root: HTMLElement, start: number, end: number, delay: number) {
  if (end <= start) return
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let pos = 0
  const jobs: { node: Text; s: number; e: number }[] = []
  while (w.nextNode()) {
    const node = w.currentNode as Text
    const len = node.data.length
    const ns = pos
    const ne = pos + len
    pos = ne
    if (ne <= start) continue
    if (ns >= end) break
    jobs.push({ node, s: Math.max(0, start - ns), e: Math.min(len, end - ns) })
  }
  for (const j of jobs) {
    let node = j.node
    if (j.e < node.data.length) node.splitText(j.e)
    if (j.s > 0) node = node.splitText(j.s)
    if (!node.data.trim()) continue
    const span = document.createElement('span')
    span.className = 'ink-new'
    span.style.animationDelay = `${delay.toFixed(0)}ms`
    node.parentNode!.insertBefore(span, node)
    span.appendChild(node)
  }
}
