import { useLayoutEffect, useRef } from 'react'
import { ISO_BASE_CSS } from '../render/isolated'

/** 把卡片原样式的内容放进独立的 Shadow DOM 底板 */
export function IsoBody({ html, className = '' }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const host = ref.current
    if (!host) return
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>${ISO_BASE_CSS}</style><div class="yt-iso">${html}</div>`
  }, [html])
  return <div ref={ref} className={`iso-plate selectable ${className}`} />
}
