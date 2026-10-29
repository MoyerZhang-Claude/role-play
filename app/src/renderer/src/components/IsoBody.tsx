import { useLayoutEffect, useRef } from 'react'
import { ISO_BASE_CSS } from '../render/isolated'
import { useSharedCss } from '../state/isoCss'

/**
 * 把卡片原样式的内容放进独立的 Shadow DOM 底板。
 * 外层套上 SillyTavern 消息的 class（mes / mes_block / mes_text），作者按酒馆界面写的选择器也能对上。
 */
export function IsoBody({ html, className = '' }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const shared = useSharedCss()
  useLayoutEffect(() => {
    const host = ref.current
    if (!host) return
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>${ISO_BASE_CSS}</style><style>${shared}</style><div class="yt-iso mes"><div class="mes_block"><div class="mes_text">${html}</div></div></div>`
  }, [html, shared])
  return <div ref={ref} className={`iso-plate selectable ${className}`} />
}
