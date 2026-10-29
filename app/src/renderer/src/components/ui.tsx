import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type TextareaHTMLAttributes, type InputHTMLAttributes } from 'react'
import { Icon } from '../icons/Icon'
import type { IconName } from '../icons/pixel'
import { audio } from '../audio/engine'

/* ───────── 按钮 ───────── */

type BtnVariant = 'default' | 'primary' | 'rubric' | 'ghost' | 'danger'

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant
  size?: 'sm' | 'md' | 'lg'
  icon?: IconName
  sfx?: string
  tip?: string
}

/** 悬停时墨色从光标处晕开 */
function trackInk(e: React.PointerEvent<HTMLElement>) {
  const el = e.currentTarget
  const r = el.getBoundingClientRect()
  el.style.setProperty('--mx', `${e.clientX - r.left}px`)
  el.style.setProperty('--my', `${e.clientY - r.top}px`)
}

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'default', size = 'md', icon, sfx, tip, className, children, ...rest }, ref) {
  return (
    <button ref={ref} className={`btn btn-${variant} btn-${size} ${className ?? ''}`} data-sfx={sfx} data-tip={tip} onPointerEnter={trackInk} onPointerMove={trackInk} {...rest}>
      <span className="btn-ink" aria-hidden />
      {icon && <Icon name={icon} />}
      {children != null && <span className="btn-label">{children}</span>}
    </button>
  )
})

interface IconBtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName
  tip?: string
  active?: boolean
  sfx?: string
  scale?: number
  tone?: 'ink' | 'rubric' | 'light'
}

export const IconButton = forwardRef<HTMLButtonElement, IconBtnProps>(function IconButton({ icon, tip, active, sfx, scale, tone = 'ink', className, ...rest }, ref) {
  return (
    <button ref={ref} className={`icon-btn tone-${tone} ${active ? 'is-active' : ''} ${className ?? ''}`} data-tip={tip} aria-label={tip} data-sfx={sfx ?? 'soft'} {...rest}>
      <Icon name={icon} scale={scale} />
    </button>
  )
})

/* ───────── 开关 ───────── */

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={`toggle ${checked ? 'on' : ''} ${disabled ? 'disabled' : ''}`} data-sfx="none">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          audio.toggle(e.target.checked)
          onChange(e.target.checked)
        }}
      />
      <span className="toggle-track" aria-hidden>
        <span className="toggle-knob" />
      </span>
      {(label || hint) && (
        <span className="toggle-text">
          {label && <span className="toggle-label">{label}</span>}
          {hint && <span className="toggle-hint">{hint}</span>}
        </span>
      )}
    </label>
  )
}

/* ───────── 滑块 ───────── */

export function Slider({ value, min, max, step = 1, onChange, format, width }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string; width?: number }) {
  const pct = ((value - min) / (max - min)) * 100
  const last = useRef(value)
  return (
    <div className="slider" style={{ width }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--pct' as any]: `${pct}%` }}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Math.abs(v - last.current) >= step * 0.999) audio.softClick()
          last.current = v
          onChange(v)
        }}
      />
      <span className="slider-val t-pixel">{format ? format(value) : value}</span>
    </div>
  )
}

/* ───────── 输入 ───────── */

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; hint?: ReactNode }>(function TextField({ label, hint, className, ...rest }, ref) {
  return (
    <label className={`field ${className ?? ''}`}>
      {label && <span className="field-label">{label}</span>}
      <input ref={ref} className="field-input" spellCheck={false} {...rest} />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
})

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; hint?: ReactNode; autoGrow?: boolean; minRows?: number }>(function TextArea(
  { label, hint, className, autoGrow = true, minRows = 3, ...rest },
  ref
) {
  const inner = useRef<HTMLTextAreaElement | null>(null)
  useLayoutEffect(() => {
    const el = inner.current
    if (!el || !autoGrow) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, 560)}px`
  }, [rest.value, autoGrow])
  return (
    <label className={`field ${className ?? ''}`}>
      {label && <span className="field-label">{label}</span>}
      <textarea
        ref={(el) => {
          inner.current = el
          if (typeof ref === 'function') ref(el)
          else if (ref) ref.current = el
        }}
        className="field-area"
        rows={minRows}
        spellCheck={false}
        {...rest}
      />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
})

/* ───────── 下拉选择（自绘，避免系统白色弹窗） ───────── */

export interface Option<T extends string> {
  value: T
  label: ReactNode
  hint?: ReactNode
}

export function Select<T extends string>({ value, options, onChange, width, placeholder }: { value: T; options: Option<T>[]; onChange: (v: T) => void; width?: number | string; placeholder?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  const cur = options.find((o) => o.value === value)
  return (
    <div className={`select ${open ? 'open' : ''}`} ref={ref} style={{ width }}>
      <button type="button" className="select-btn" data-sfx="soft" onClick={() => setOpen(!open)}>
        <span className="select-cur">{cur?.label ?? placeholder ?? '请选择'}</span>
        <Icon name="chevD" />
      </button>
      {open && (
        <div className="select-pop">
          {options.map((o) => (
            <button
              type="button"
              key={o.value}
              className={`select-opt ${o.value === value ? 'sel' : ''}`}
              data-sfx="soft"
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
            >
              <span>{o.label}</span>
              {o.hint && <span className="select-hint">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ───────── 出现 / 消失（保留退场动画） ───────── */

export function usePresence(show: boolean, exitMs = 220) {
  const [mounted, setMounted] = useState(show)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (show) {
      setMounted(true)
      setLeaving(false)
      return
    }
    if (!mounted) return
    setLeaving(true)
    const t = window.setTimeout(() => {
      setMounted(false)
      setLeaving(false)
    }, exitMs)
    return () => window.clearTimeout(t)
  }, [show])
  return { mounted, leaving }
}

/* ───────── 装饰 ───────── */

export function Divider({ className, glyph = 'fleuron' }: { className?: string; glyph?: 'fleuron' | 'diamond' | 'star' }) {
  return (
    <div className={`divider ${className ?? ''}`} aria-hidden>
      <span className="divider-line" />
      <svg className="divider-glyph" viewBox="0 0 40 16" width="40" height="16">
        {glyph === 'fleuron' && (
          <g fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
            <path d="M20 3 C 17 6, 17 10, 20 13 C 23 10, 23 6, 20 3 Z" fill="currentColor" fillOpacity="0.85" />
            <path d="M16 8 C 12 4, 7 5, 4 8 M24 8 C 28 4, 33 5, 36 8" />
            <path d="M16 8 C 12 12, 8 11, 6 9 M24 8 C 28 12, 32 11, 34 9" opacity="0.6" />
          </g>
        )}
        {glyph === 'diamond' && <path d="M20 3 L25 8 L20 13 L15 8 Z" fill="currentColor" />}
        {glyph === 'star' && <path d="M20 2 L21.6 6.4 L26 8 L21.6 9.6 L20 14 L18.4 9.6 L14 8 L18.4 6.4 Z" fill="currentColor" />}
      </svg>
      <span className="divider-line" />
    </div>
  )
}

/** 手稿风格的角花，放在框的四角 */
export function Corners({ size = 22 }: { size?: number }) {
  const path = 'M2 20 L2 6 Q2 2 6 2 L20 2 M2 12 Q7 12 8 8 Q9 4 13 4 M6 6 Q9 9 6 13'
  return (
    <>
      {(['tl', 'tr', 'bl', 'br'] as const).map((p) => (
        <svg key={p} className={`corner corner-${p}`} width={size} height={size} viewBox="0 0 22 22" aria-hidden>
          <path d={path} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="13.5" cy="4" r="1.1" fill="currentColor" />
        </svg>
      ))}
    </>
  )
}

/** 魔法阵（SVG，缓慢旋转），用于加载、空状态、背景水印 */
export function MagicCircle({ size = 120, spin = true, className, strokeWidth = 1, runes = 24 }: { size?: number; spin?: boolean; className?: string; strokeWidth?: number; runes?: number }) {
  const r1 = 47
  const r2 = 41
  const r3 = 28
  const star = (n: number, k: number, r: number) => {
    let d = ''
    for (let i = 0; i <= n; i++) {
      const a = (i * k * 2 * Math.PI) / n - Math.PI / 2
      d += `${i ? 'L' : 'M'}${50 + Math.cos(a) * r} ${50 + Math.sin(a) * r}`
    }
    return d
  }
  const glyphs = []
  for (let i = 0; i < runes; i++) {
    const a = (i / runes) * 360
    const t = i % 4
    glyphs.push(
      <g key={i} transform={`rotate(${a} 50 50) translate(50 ${50 - 44})`}>
        {t === 0 && <path d="M-1.6 -1.6 L1.6 1.6 M1.6 -1.6 L-1.6 1.6" />}
        {t === 1 && <circle r="1.5" />}
        {t === 2 && <path d="M0 -2 L0 2 M-1.5 0 L1.5 0" />}
        {t === 3 && <path d="M-1.6 1.6 L0 -1.8 L1.6 1.6" />}
      </g>
    )
  }
  return (
    <svg className={`magic-circle ${spin ? 'spin' : ''} ${className ?? ''}`} width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round">
        <g className="mc-outer">
          <circle cx="50" cy="50" r={r1} />
          <circle cx="50" cy="50" r={r2} />
          <g strokeWidth={strokeWidth * 0.8}>{glyphs}</g>
        </g>
        <g className="mc-inner">
          <path d={star(7, 3, r2)} strokeWidth={strokeWidth * 0.8} />
          <circle cx="50" cy="50" r={r3} />
          <path d={star(5, 2, r3)} strokeWidth={strokeWidth * 0.8} opacity="0.8" />
          <circle cx="50" cy="50" r="5" />
        </g>
      </g>
    </svg>
  )
}

/** 圆形头像（墨线圆框） */
export function Medallion({ src, name, size = 44, ring = true }: { src: string | null; name: string; size?: number; ring?: boolean }) {
  return (
    <span className={`medallion ${ring ? 'ring' : ''}`} style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" draggable={false} /> : <span className="medallion-fallback t-display">{Array.from(name || '？')[0]}</span>}
    </span>
  )
}

export function Spinner({ size = 22 }: { size?: number }) {
  return <MagicCircle size={size} className="spinner" strokeWidth={2.4} runes={8} />
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}
