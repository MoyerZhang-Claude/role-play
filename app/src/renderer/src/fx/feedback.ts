/**
 * 统一的按压反馈：在 pointerdown（而不是 click）时立刻出墨点和声音，零等待。
 * 元素上可用 data-sfx（click / soft / confirm / back / toggle / page / none）
 * 和 data-fx（ink / gold / none）微调。
 */
import { ripple } from './inkLayer'
import { audio } from '../audio/engine'

const INTERACTIVE = 'button, a[href], [role="button"], [data-fx], summary, label.toggle, .clickable'

export function installFeedback() {
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return
      const el = (e.target as Element | null)?.closest?.(INTERACTIVE) as HTMLElement | null
      if (!el || el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return
      const fx = el.dataset.fx ?? (el.closest('.spine, .on-dark') ? 'gold' : 'ink')
      if (fx !== 'none') ripple(e.clientX, e.clientY, { kind: fx === 'gold' ? 'gold' : 'ink', scale: el.dataset.fxScale ? Number(el.dataset.fxScale) : 1 })
      const sfx = el.dataset.sfx ?? 'click'
      switch (sfx) {
        case 'none':
          break
        case 'soft':
          audio.softClick()
          break
        case 'confirm':
          audio.confirm()
          break
        case 'back':
          audio.back()
          break
        case 'page':
          audio.page()
          break
        case 'send':
          audio.send()
          break
        default:
          audio.click()
      }
    },
    { capture: true, passive: true }
  )

  // 悬停音：只给带 data-hover-sfx 的元素（导航、卡片），而且很轻
  let lastEl: Element | null = null
  window.addEventListener(
    'pointerover',
    (e) => {
      const el = (e.target as Element | null)?.closest?.('[data-hover-sfx]') ?? null
      if (el && el !== lastEl) audio.hover()
      lastEl = el
    },
    { passive: true }
  )
}
