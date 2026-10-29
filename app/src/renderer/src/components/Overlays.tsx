import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useUI } from '../state/ui'
import { Button, IconButton, usePresence, Corners } from './ui'
import { Icon } from '../icons/Icon'
import type { IconName } from '../icons/pixel'
import { audio } from '../audio/engine'

/* ───────── 模态框 ───────── */

export function Modal({ open, onClose, title, deco, children, footer, width = 560, className }: { open: boolean; onClose: () => void; title?: ReactNode; deco?: string; children: ReactNode; footer?: ReactNode; width?: number; className?: string }) {
  const { mounted, leaving } = usePresence(open, 200)
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        audio.back()
        onClose()
      }
    }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [open, onClose])
  useEffect(() => {
    if (open) audio.page()
  }, [open])
  if (!mounted) return null
  return (
    <div className={`modal-backdrop ${leaving ? 'leaving' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal sheet ${className ?? ''}`} style={{ width }} role="dialog" aria-modal="true">
        <Corners />
        {(title || deco) && (
          <header className="modal-head">
            {deco && <div className="t-deco">{deco}</div>}
            {title && <h2 className="modal-title">{title}</h2>}
            <IconButton icon="close" tip="关闭" className="modal-x" sfx="back" onClick={onClose} />
          </header>
        )}
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  )
}

export function ConfirmHost() {
  const req = useUI((s) => s.confirmReq)
  const close = useUI((s) => s.closeConfirm)
  const [last, setLast] = useState(req)
  useEffect(() => {
    if (req) setLast(req)
  }, [req])
  const r = req ?? last
  return (
    <Modal open={!!req} onClose={() => close(false)} title={r?.title} width={440} className="confirm">
      {r?.body && <div className="confirm-body">{r.body}</div>}
      <div className="confirm-actions">
        <Button sfx="back" onClick={() => close(false)}>
          {r?.cancelText ?? '取消'}
        </Button>
        <Button variant={r?.danger ? 'danger' : 'primary'} sfx="confirm" autoFocus onClick={() => close(true)}>
          {r?.okText ?? '确定'}
        </Button>
      </div>
    </Modal>
  )
}

export function ModalHost() {
  const modal = useUI((s) => s.modal)
  return <>{modal?.node}</>
}

/* ───────── 提示条 ───────── */

const TOAST_ICON: Record<string, IconName> = { info: 'info', ok: 'check', warn: 'warn', error: 'warn' }

export function Toasts() {
  const toasts = useUI((s) => s.toasts)
  const dismiss = useUI((s) => s.dismiss)
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind} ${t.leaving ? 'leaving' : ''}`} onClick={() => dismiss(t.id)} data-sfx="soft">
          <Icon name={TOAST_ICON[t.kind]} />
          <div className="toast-text">
            <div className="toast-title">{t.text}</div>
            {t.detail && <div className="toast-detail selectable">{t.detail}</div>}
          </div>
          {t.action && (
            <button
              className="toast-action"
              data-sfx="confirm"
              onClick={(e) => {
                e.stopPropagation()
                t.action!.run()
                dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/* ───────── 悬浮提示（替代系统 title 提示） ───────── */

export function TooltipHost() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null)
  const timer = useRef(0)
  const cur = useRef<Element | null>(null)
  useEffect(() => {
    const over = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]') ?? null
      if (el === cur.current) return
      cur.current = el
      window.clearTimeout(timer.current)
      setTip(null)
      if (!el) return
      const text = el.getAttribute('data-tip')
      if (!text) return
      timer.current = window.setTimeout(() => {
        const r = el.getBoundingClientRect()
        const below = r.top < 64
        setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below })
      }, 420)
    }
    const hide = () => {
      window.clearTimeout(timer.current)
      cur.current = null
      setTip(null)
    }
    window.addEventListener('pointerover', over)
    window.addEventListener('pointerdown', hide, true)
    window.addEventListener('wheel', hide, { passive: true })
    return () => {
      window.removeEventListener('pointerover', over)
      window.removeEventListener('pointerdown', hide, true)
      window.removeEventListener('wheel', hide)
    }
  }, [])
  if (!tip) return null
  const left = Math.max(80, Math.min(window.innerWidth - 80, tip.x))
  return (
    <div className={`tooltip ${tip.below ? 'below' : ''}`} style={{ left, top: tip.y }}>
      {tip.text}
    </div>
  )
}
