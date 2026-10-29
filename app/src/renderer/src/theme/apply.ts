import type { ThemeDefinition } from './types'
import { THEMES, parchment } from './parchment'
import { paintPaper, watchPaper, makeGrain } from './paper'
import type { Settings } from '@shared/types'

let watching = false
let activeTheme: ThemeDefinition = parchment

export function getTheme(): ThemeDefinition {
  return activeTheme
}

const BODY_FONTS: Record<Settings['appearance']['bodyFont'], string | null> = {
  wenkai: null,
  notoserif: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', serif",
  system: "'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif"
}

export function applyTheme(themeId: string) {
  const t = THEMES[themeId] ?? parchment
  activeTheme = t
  const root = document.documentElement
  for (const [k, v] of Object.entries(t.colors)) root.style.setProperty(`--c-${k}`, v)
  root.style.setProperty('--f-body', t.fonts.body)
  root.style.setProperty('--f-ui', t.fonts.ui)
  root.style.setProperty('--f-display', t.fonts.display)
  root.style.setProperty('--f-deco', t.fonts.deco)
  root.style.setProperty('--f-pixel', t.fonts.pixel)
  root.style.setProperty('--f-mono', t.fonts.mono)
  const fx = t.fx
  root.style.setProperty('--rgb-ink', fx.ink.join(','))
  root.style.setProperty('--rgb-gold', fx.gold.join(','))
  root.style.setProperty('--rgb-glow', fx.glow.join(','))
  root.style.setProperty('--rgb-rubric', fx.rubric.join(','))
  root.style.setProperty('--tex-grain', `url(${makeGrain(192, 30, 7)})`)
  root.style.setProperty('--tex-grain-fine', `url(${makeGrain(128, 18, 13)})`)
  root.dataset.theme = t.id
  const canvas = document.getElementById('paper-bg') as HTMLCanvasElement | null
  if (canvas) {
    paintPaper(canvas, t.paper)
    if (!watching) {
      watchPaper(canvas)
      watching = true
    }
  }
}

/** 外观设置（字号、行距、宽度、字体）→ CSS 变量 */
export function applyAppearance(a: Settings['appearance']) {
  const root = document.documentElement
  root.style.setProperty('--chat-fs', `${a.fontSize}px`)
  root.style.setProperty('--chat-lh', String(a.lineHeight))
  root.style.setProperty('--chat-w', `${a.chatWidth}px`)
  const bf = BODY_FONTS[a.bodyFont]
  root.style.setProperty('--f-chat', bf ?? activeTheme.fonts.body)
  root.dataset.indent = a.paragraphIndent ? '1' : '0'
  root.dataset.quotes = a.quoteHighlight ? '1' : '0'
  root.dataset.motion = a.reduceMotion ? 'reduced' : 'full'
  root.dataset.ambient = a.ambient ? '1' : '0'
}

/** 像素图标的「像素」大小：让每个像素正好落在整数个物理像素上 */
export function applyPixelScale() {
  const dpr = window.devicePixelRatio || 1
  const dev = Math.max(1, Math.round(1.4 * dpr))
  document.documentElement.style.setProperty('--px', `${dev / dpr}px`)
}
