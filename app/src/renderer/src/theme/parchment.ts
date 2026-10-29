import type { ThemeDefinition } from './types'

/** 默认主题：羊皮纸 · 铁胆墨 · 朱砂 · 金箔 */
export const parchment: ThemeDefinition = {
  id: 'parchment',
  name: '羊皮纸',
  description: '羊皮纸配铁胆墨水，朱砂落印，金箔点光。',
  colors: {
    // 纸
    paper: '#efe3c8',
    'paper-hi': '#f7efdc',
    'paper-lo': '#e3d2ae',
    'paper-edge': '#c9ae84',
    'paper-sheet': 'rgba(250, 243, 226, 0.62)',
    'paper-sheet-solid': '#f4ead3',
    // 墨
    ink: '#2b2118',
    'ink-soft': '#4d3d2d',
    'ink-faint': '#7d6a55',
    'ink-ghost': 'rgba(60, 42, 26, 0.16)',
    'ink-line': 'rgba(60, 42, 26, 0.32)',
    'ink-wash': 'rgba(60, 42, 26, 0.07)',
    // 强调
    rubric: '#a3322a',
    'rubric-soft': '#c0574d',
    'rubric-wash': 'rgba(163, 50, 42, 0.1)',
    gold: '#a97b25',
    'gold-hi': '#d9ac4c',
    glow: '#ffd98a',
    'user-ink': '#26355a',
    'user-ink-soft': '#4a5a80',
    verdigris: '#3c6e64',
    // 书脊皮革
    leather: '#3b2719',
    'leather-hi': '#59402b',
    'leather-lo': '#24170e',
    'leather-ink': '#e8cf98',
    'leather-ink-dim': '#a88e62',
    // 状态
    ok: '#4f6b2f',
    warn: '#9a6312',
    danger: '#a3322a',
    shadow: 'rgba(48, 30, 14, 0.22)',
    'shadow-deep': 'rgba(32, 18, 6, 0.38)',
    backdrop: 'rgba(36, 24, 12, 0.42)',
    // 「卡片原样式」的底板：中性深色，让按深色界面设计的美化正常显示
    'iso-bg': '#1e1b18',
    'iso-fg': '#ddd6c6',
    'iso-em': '#b8ae9c',
    'iso-link': '#e3b56a',
    'iso-edge': '#5a452c'
  },
  fonts: {
    body: "'LXGW WenKai Screen', 'KaiTi', 'STKaiti', serif",
    ui: "'LXGW WenKai Screen', 'Microsoft YaHei UI', sans-serif",
    display: "'Ma Shan Zheng', 'LXGW WenKai Screen', 'KaiTi', serif",
    deco: "'Cinzel', 'IM Fell English', serif",
    pixel: "'Silkscreen', monospace",
    mono: "'Cascadia Mono', 'Consolas', monospace"
  },
  paper: {
    base: [239, 227, 200],
    light: [248, 240, 220],
    dark: [222, 204, 165],
    burn: [176, 136, 84],
    mottle: 0.75,
    fiber: 0.6,
    grain: 0.5,
    edge: 0.65,
    foxing: 7,
    seed: 3.17
  },
  fx: {
    ink: [43, 33, 24],
    inkSoft: [77, 61, 45],
    rubric: [163, 50, 42],
    gold: [217, 172, 76],
    glow: [255, 217, 138],
    userInk: [38, 53, 90]
  },
  ornaments: { divider: 'fleuron', frame: 'manuscript' }
}

export const THEMES: Record<string, ThemeDefinition> = { parchment }
