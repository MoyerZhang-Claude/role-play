/**
 * 预设在生成 / 显示时用到的小工具（与解析分开，避免模块循环引用）。
 */
import type { Character, PromptPreset, RegexScript } from './types'

export type GenType = 'normal' | 'swipe' | 'continue' | 'impersonate'

/**
 * 预设自带的正则在这位角色身上是否生效：
 * 界面美化类（只改显示、输出带样式的 HTML）只在「卡片原样式」的角色里生效，
 * 其余（隐藏思维链、不发送旧状态栏等）总是生效。
 */
export function presetScriptsFor(preset: PromptPreset | null | undefined, ch: Character | null | undefined): RegexScript[] {
  const list = preset?.regexScripts
  if (!list?.length) return []
  const iso = ch?.display?.styleMode === 'isolated'
  return list.filter((r) => iso || !(r.ytKind === 'beautify' && r.markdownOnly))
}

/**
 * 依赖脚本的「前端界面」正则：替换内容里带 <script>（通常是 ```html 包着的整页 HTML，
 * 在 SillyTavern 里要靠酒馆助手扩展运行）。药汤不运行脚本，显示时跳过它们，
 * 被它替换的原文照常显示。
 */
export function needsScript(r: RegexScript): boolean {
  return r.markdownOnly && /<script\b/i.test(r.replaceString)
}

/** 显示用：去掉依赖脚本的正则 */
export function displayScripts(list: RegexScript[]): RegexScript[] {
  return list.some(needsScript) ? list.filter((r) => !needsScript(r)) : list
}

/** 顺序与 SillyTavern 一致：预设正则在前，角色正则在后 */
export function effectiveScripts(ch: Character, preset: PromptPreset | null | undefined): RegexScript[] {
  const p = presetScriptsFor(preset, ch)
  return p.length ? [...p, ...ch.regexScripts] : ch.regexScripts
}

/** 提示词是否在这种生成方式下发送（ST 的 injection_trigger；空 = 总是发送） */
export function triggerMatches(triggers: string[] | undefined, gen: GenType | undefined): boolean {
  if (!triggers?.length) return true
  const g = gen ?? 'normal'
  if (g === 'swipe') return triggers.includes('swipe') || triggers.includes('regenerate')
  return triggers.includes(g)
}

const EJS_RE = /<%[\s\S]*?%>/g

/** 预设里的 EJS 模板（需要 ST-Prompt-Template 扩展）不执行：去掉模板代码，只留下普通文字 */
export function stripEjs(s: string): string {
  if (!s.includes('<%')) return s
  return s.replace(EJS_RE, '').replace(/\n{3,}/g, '\n\n')
}

export const hasEjs = (s: string | undefined) => !!s && /<%[\s\S]*?%>/.test(s)
