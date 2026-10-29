import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Character, ChatSummary } from '@shared/types'
import { avatarSrc } from '../../state/library'
import { useSettings } from '../../state/settings'
import { go } from '../../state/router'
import { toast } from '../../state/ui'
import { Medallion, MagicCircle } from '../../components/ui'
import { Icon } from '../../icons/Icon'
import { relTime } from '../../lib/api'
import { audio } from '../../audio/engine'
import { ripple } from '../../fx/inkLayer'

const LIMIT = 6
const HOLD_MS = 280
const MOVE_START = 8

/** 续读区要显示的对话：去掉已移出的（之后有新内容会重新出现），按手动顺序，新对话排在最前 */
export function useRecentList(index: Record<string, ChatSummary>, chars: Character[]): ChatSummary[] {
  const home = useSettings((s) => s.s.home)
  return useMemo(() => {
    const alive = Object.values(index).filter((s) => chars.some((c) => c.id === s.characterId) && !(home.recentHidden[s.id] && s.updatedAt <= home.recentHidden[s.id]))
    alive.sort((a, b) => b.updatedAt - a.updatedAt)
    const pos = new Map(home.recentOrder.map((id, i) => [id, i]))
    // 手动排序之后有新动静的对话排最前；其余没排过序的旧对话接在后面
    const fresh = alive.filter((s) => !pos.has(s.id) && s.updatedAt > home.recentOrderAt)
    const ordered = alive.filter((s) => pos.has(s.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!)
    const rest = alive.filter((s) => !pos.has(s.id) && s.updatedAt <= home.recentOrderAt)
    return [...fresh, ...ordered, ...rest].slice(0, LIMIT)
  }, [index, chars, home])
}

function CardBody({ s, ch }: { s: ChatSummary; ch: Character }) {
  return (
    <>
      <Medallion src={avatarSrc(ch)} name={ch.name} size={46} />
      <span className="recent-body">
        <span className="recent-name">{ch.name}</span>
        <span className="recent-title">{s.title.split(' · ').slice(1, 2).join('')}</span>
        <span className="recent-preview">{s.preview || '（尚未落笔）'}</span>
      </span>
      <span className="recent-time t-pixel">{relTime(s.updatedAt)}</span>
    </>
  )
}

interface Drag {
  id: string
  ox: number
  oy: number
  w: number
  h: number
  x: number
  y: number
  tilt: number
  from: number
  to: number
  slots: DOMRect[]
  over: boolean
  phase: 'drag' | 'burn' | 'return'
}

function move<T>(arr: T[], from: number, to: number): T[] {
  const a = arr.slice()
  const [it] = a.splice(from, 1)
  a.splice(to, 0, it)
  return a
}

export function RecentShelf({ items, chars }: { items: ChatSummary[]; chars: Character[] }) {
  const update = useSettings((s) => s.update)
  const [drag, setDragState] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const setDrag = (d: Drag | null) => {
    dragRef.current = d
    setDragState(d)
  }
  const refs = useRef(new Map<string, HTMLElement>())
  const ghostRef = useRef<HTMLDivElement>(null)
  const trashRef = useRef<HTMLDivElement>(null)
  const suppressClick = useRef(false)
  const lastRects = useRef(new Map<string, DOMRect>())

  const ids = items.map((s) => s.id)
  const order = drag ? move(ids, drag.from, drag.to) : ids

  // FLIP：位置变化时平滑滑过去
  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>()
    for (const [id, el] of refs.current) {
      if (!el.isConnected) continue
      const r = el.getBoundingClientRect()
      next.set(id, r)
      const prev = lastRects.current.get(id)
      if (prev && (Math.abs(prev.left - r.left) > 1 || Math.abs(prev.top - r.top) > 1)) {
        el.animate([{ transform: `translate(${prev.left - r.left}px, ${prev.top - r.top}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' })
      }
    }
    lastRects.current = next
  })

  const startDrag = (id: string, cx: number, cy: number, rect: DOMRect) => {
    const slots = ids.map((x) => refs.current.get(x)!.getBoundingClientRect())
    const from = ids.indexOf(id)
    audio.lift()
    suppressClick.current = true
    setDrag({ id, ox: cx - rect.left, oy: cy - rect.top, w: rect.width, h: rect.height, x: cx, y: cy, tilt: 0, from, to: from, slots, over: false, phase: 'drag' })
  }

  const onPointerDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0 || dragRef.current) return
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    const x0 = e.clientX
    const y0 = e.clientY
    let started = false
    let lastX = x0
    const timer = window.setTimeout(() => {
      started = true
      startDrag(id, lastX, y0, rect)
    }, HOLD_MS)
    const onMove = (ev: PointerEvent) => {
      lastX = ev.clientX
      if (!started) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > MOVE_START) {
          window.clearTimeout(timer)
          started = true
          startDrag(id, x0, y0, rect)
        } else return
      }
      const d = dragRef.current
      if (!d || d.phase !== 'drag') return
      // 目标位置：离指针最近的格子
      let best = d.to
      let bd = Infinity
      d.slots.forEach((r, i) => {
        const dd = Math.hypot(r.left + r.width / 2 - ev.clientX, r.top + r.height / 2 - ev.clientY)
        if (dd < bd) {
          bd = dd
          best = i
        }
      })
      const tr = trashRef.current?.getBoundingClientRect()
      const over = !!tr && ev.clientX > tr.left - 40 && ev.clientX < tr.right + 40 && ev.clientY > tr.top - 30 && ev.clientY < tr.bottom + 40
      if (over && !d.over) audio.hover()
      if (best !== d.to && !over) audio.softClick()
      const vx = ev.clientX - d.x
      setDrag({ ...d, x: ev.clientX, y: ev.clientY, tilt: Math.max(-7, Math.min(7, d.tilt * 0.7 + vx * 0.35)), to: over ? d.to : best, over })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.clearTimeout(timer)
      const d = dragRef.current
      if (!started || !d) return
      if (d.over) burn(d)
      else settle(d)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  /** 放回：飞到目标格子，再写入新顺序 */
  const settle = (d: Drag) => {
    setDrag({ ...d, phase: 'return' })
    const g = ghostRef.current
    const target = d.slots[d.to]
    audio.place()
    const finish = () => {
      if (d.to !== d.from)
        update((s) => {
          s.home.recentOrder = move(ids, d.from, d.to)
          s.home.recentOrderAt = Date.now()
        })
      setDrag(null)
      window.setTimeout(() => (suppressClick.current = false), 50)
    }
    if (!g || !target) return finish()
    const dx = target.left - (d.x - d.ox)
    const dy = target.top - (d.y - d.oy)
    g.animate([{ transform: `translate(0,0) rotate(${d.tilt}deg) scale(1.04)` }, { transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(1)` }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }).onfinish = finish
  }

  /** 焚去：卡片被吸进焚化阵，化成灰烬 */
  const burn = (d: Drag) => {
    setDrag({ ...d, phase: 'burn' })
    const g = ghostRef.current
    const tr = trashRef.current?.getBoundingClientRect()
    audio.burn()
    const s = items.find((x) => x.id === d.id)
    const finish = () => {
      if (s) {
        update((st) => {
          st.home.recentHidden[s.id] = s.updatedAt
          st.home.recentOrder = st.home.recentOrder.filter((x) => x !== s.id)
        })
        const ch = chars.find((c) => c.id === s.characterId)
        toast('ok', '已从续读中移出', `「${ch?.name ?? ''}」的这一卷仍保存在角色页的卷册里`, {
          label: '撤销',
          run: () =>
            update((st) => {
              delete st.home.recentHidden[s.id]
            })
        })
      }
      setDrag(null)
      window.setTimeout(() => (suppressClick.current = false), 50)
    }
    if (!g || !tr) return finish()
    const cx = tr.left + tr.width / 2
    const cy = tr.top + tr.height / 2
    const gx = d.x - d.ox + d.w / 2
    const gy = d.y - d.oy + d.h / 2
    for (let i = 0; i < 3; i++) window.setTimeout(() => ripple(cx + (Math.random() - 0.5) * 30, cy + (Math.random() - 0.5) * 30, { kind: 'gold', scale: 2.2 - i * 0.4 }), i * 90)
    g.animate(
      [
        { transform: `translate(0,0) rotate(${d.tilt}deg) scale(0.72)`, filter: 'none', opacity: 1 },
        { transform: `translate(${(cx - gx) * 0.6}px, ${(cy - gy) * 0.6}px) rotate(10deg) scale(0.45)`, filter: 'sepia(1) saturate(2.5) brightness(1.3)', opacity: 0.95, offset: 0.5 },
        { transform: `translate(${cx - gx}px, ${cy - gy}px) rotate(24deg) scale(0.06)`, filter: 'sepia(1) saturate(3) brightness(2.2) blur(3px)', opacity: 0 }
      ],
      { duration: 520, easing: 'cubic-bezier(.55,0,.8,.3)', fill: 'forwards' }
    ).onfinish = finish
  }

  useEffect(() => {
    if (!drag) return
    document.body.classList.add('is-dragging-card')
    return () => document.body.classList.remove('is-dragging-card')
  }, [!!drag])

  const dragged = drag ? items.find((x) => x.id === drag.id) : null
  const draggedCh = dragged ? chars.find((c) => c.id === dragged.characterId) : null

  return (
    <>
      <div className="recent-row">
        {order.map((id, i) => {
          const s = items.find((x) => x.id === id)!
          const ch = chars.find((c) => c.id === s.characterId)!
          const isGhostSlot = drag?.id === id
          return (
            <button
              key={id}
              ref={(el) => {
                if (el) refs.current.set(id, el)
                else refs.current.delete(id)
              }}
              className={`recent-card sheet ${isGhostSlot ? 'is-slot' : ''}`}
              style={{ animationDelay: `${i * 50}ms` }}
              data-hover-sfx
              data-sfx="page"
              onPointerDown={(e) => onPointerDown(e, id)}
              onClick={() => {
                if (suppressClick.current) return
                go({ name: 'chat', characterId: s.characterId, chatId: s.id })
              }}
            >
              <CardBody s={s} ch={ch} />
            </button>
          )
        })}
      </div>
      {createPortal(
        <>
          {drag && dragged && draggedCh && (
            <div
              ref={ghostRef}
              className={`recent-ghost sheet ${drag.over ? 'over' : ''} ${drag.phase}`}
              style={{ left: drag.x - drag.ox, top: drag.y - drag.oy, width: drag.w, height: drag.h, ['--tilt' as any]: `${drag.tilt}deg` }}
            >
              <div className="recent-ghost-inner">
                <CardBody s={dragged} ch={draggedCh} />
              </div>
            </div>
          )}
          <div ref={trashRef} className={`pyre ${drag && drag.phase !== 'return' ? 'show' : ''} ${drag?.over ? 'armed' : ''} ${drag?.phase === 'burn' ? 'burning' : ''}`} aria-hidden={!drag}>
            <MagicCircle size={92} strokeWidth={1.4} runes={16} className="pyre-circle" />
            <span className="pyre-flame">
              <Icon name="flame" scale={1.6} />
            </span>
            <span className="pyre-label">{drag?.over ? '松手焚去' : '拖到这里焚去'}</span>
          </div>
        </>,
        document.body
      )}
    </>
  )
}
