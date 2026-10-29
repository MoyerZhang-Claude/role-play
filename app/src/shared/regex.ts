import type { RegexScript } from './types'
import { newId } from './id'

type AnyObj = Record<string, any>

/** 与 SillyTavern 的 regexFromString 行为一致：/pattern/flags 或直接当作正则 */
export function regexFromString(input: string): RegExp | null {
  try {
    const m = input.match(/^\/([\s\S]+)\/([a-z]*)$/i)
    if (m) {
      const flags = m[2]
      if (flags && !/^(?!.*?(.).*?\1)[gimsuyd]+$/.test(flags)) return new RegExp(input)
      return new RegExp(m[1], flags)
    }
    return new RegExp(input)
  } catch {
    return null
  }
}

export function normalizeRegexScript(r: AnyObj): RegexScript {
  const placement = Array.isArray(r.placement) ? r.placement.map((x: unknown) => Number(x)).filter((n: number) => Number.isFinite(n)) : []
  const sub = r.substituteRegex === true ? 1 : r.substituteRegex === false || r.substituteRegex == null ? 0 : Number(r.substituteRegex) || 0
  const toN = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
  const s: RegexScript = {
    id: String(r.id || newId('rx')),
    scriptName: String(r.scriptName ?? r.name ?? '未命名正则'),
    findRegex: String(r.findRegex ?? ''),
    replaceString: String(r.replaceString ?? ''),
    trimStrings: Array.isArray(r.trimStrings) ? r.trimStrings.map(String) : [],
    placement,
    disabled: !!r.disabled,
    markdownOnly: !!r.markdownOnly,
    promptOnly: !!r.promptOnly,
    runOnEdit: r.runOnEdit !== false,
    substituteRegex: sub,
    minDepth: toN(r.minDepth),
    maxDepth: toN(r.maxDepth)
  }
  s.ytKind = isBeautify(s) ? 'beautify' : 'normal'
  s.ytNote = describeRegex(s)
  return s
}

/** 主要用于界面美化：输出整段带样式/脚本的 HTML */
export function isBeautify(s: RegexScript): boolean {
  const r = s.replaceString
  if (/<\s*(style|script|html|body|head|link|iframe)\b/i.test(r)) return true
  if (/\bstyle\s*=\s*["'][^"']*(position|display\s*:\s*(flex|grid)|background|width|height|border)/i.test(r) && r.length > 300) return true
  return false
}

const PLACEMENT_LABEL: Record<number, string> = { 1: '用户输入', 2: 'AI 回复', 3: '快捷命令', 5: '世界书', 6: '思考内容' }

export function describeRegex(s: RegexScript): string {
  if (!s.placement.length) return '没有指定作用范围：平时不会生效，只供快速回复等脚本用 /regex 命令调用（药汤不运行脚本）。'
  const where = s.placement.map((p) => PLACEMENT_LABEL[p] ?? `未知(${p})`).join('、')
  const scope = s.markdownOnly && s.promptOnly ? '同时作用于显示与发送' : s.markdownOnly ? '只改变显示效果，不改动原文' : s.promptOnly ? '只改变发给 AI 的内容，不影响显示' : '直接改写消息原文'
  let depth = ''
  if (s.minDepth != null && s.minDepth > 0) depth += `，只对倒数第 ${s.minDepth + 1} 条及更早的消息生效`
  if (s.maxDepth != null && s.maxDepth >= 0) depth += `，只对最近 ${s.maxDepth + 1} 条消息生效`
  return `作用于${where}；${scope}${depth}。`
}

export interface RegexContext {
  placement: number
  isMarkdown?: boolean
  isPrompt?: boolean
  isEdit?: boolean
  depth?: number
  /** 宏替换函数（{{user}}、{{char}} 等） */
  macros?: (s: string) => string
}

export function applyRegexScripts(text: string, scripts: RegexScript[], ctx: RegexContext): string {
  if (!text || !scripts.length) return text
  // 卡片里常有 Windows 换行（CRLF），作者的正则按 LF 写；与 SillyTavern 一样先统一成 LF
  let out = text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text
  for (const s of scripts) {
    if (s.disabled) continue
    const ok = (s.markdownOnly && ctx.isMarkdown) || (s.promptOnly && ctx.isPrompt) || (!s.markdownOnly && !s.promptOnly && !ctx.isMarkdown && !ctx.isPrompt)
    if (!ok) continue
    if (ctx.isEdit && !s.runOnEdit) continue
    if (typeof ctx.depth === 'number') {
      if (s.minDepth != null && s.minDepth >= -1 && ctx.depth < s.minDepth) continue
      if (s.maxDepth != null && s.maxDepth >= 0 && ctx.depth > s.maxDepth) continue
    }
    if (!s.placement.includes(ctx.placement)) continue
    out = runRegexScript(s, out, ctx.macros)
  }
  return out
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

export function runRegexScript(s: RegexScript, input: string, macros?: (s: string) => string): string {
  if (!s.findRegex || !input) return input
  const m = macros ?? ((x: string) => x)
  let find = s.findRegex
  if (s.substituteRegex === 1) find = m(find)
  else if (s.substituteRegex === 2) find = find.replace(/\{\{[^}]+\}\}/g, (mac) => escapeRegex(m(mac)))
  const re = regexFromString(find)
  if (!re) return input
  const trims = s.trimStrings.map((t) => m(t))
  const filter = (v: string) => {
    let r = v
    for (const t of trims) if (t) r = r.split(t).join('')
    return r
  }
  return input.replace(re, (...args: any[]) => {
    const hasGroups = typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null
    const groups = hasGroups ? (args[args.length - 1] as Record<string, string>) : undefined
    const replace = s.replaceString.replace(/\{\{match\}\}/gi, '$0')
    const withGroups = replace.replace(/\$(\d+)|\$<([^>]+)>/g, (_all: string, n?: string, name?: string) => {
      let v: unknown
      if (n !== undefined) v = args[Number(n)]
      else if (name) v = groups?.[name]
      if (typeof v !== 'string' || !v) return ''
      return filter(v)
    })
    return m(withGroups)
  })
}

/** 原卡（导入时保存的原始数据）里这条正则的开关状态；找不到返回 null */
export function originalDisabled(r: RegexScript, raw: unknown): boolean | null {
  const list = (raw as AnyObj | undefined)?.data?.extensions?.regex_scripts
  if (!Array.isArray(list)) return null
  const orig = list.find((x: AnyObj) => x?.id === r.id) ?? list.find((x: AnyObj) => x?.scriptName === r.scriptName && x?.findRegex === r.findRegex)
  return orig ? !!orig.disabled : null
}

/**
 * 这条正则是不是药汤为了显示效果自动关掉的（而不是卡片作者本来就关着的）。
 * 作者常把几种可选样式一起放进卡里，只开其中一种；那些本来关着的不能替作者打开。
 */
export function isAutoDisabled(r: RegexScript, raw: unknown): boolean {
  if (!r.disabled) return false
  if (r.ytAutoDisabled != null) return r.ytAutoDisabled
  if (!(r.ytKind === 'beautify' && r.markdownOnly)) return false
  return originalDisabled(r, raw) === false
}

/** 判断一个 JSON 是否为正则脚本（单个或数组） */
export function parseRegexJson(j: unknown): RegexScript[] | null {
  const looks = (o: any) => o && typeof o === 'object' && typeof o.findRegex === 'string' && ('replaceString' in o || 'scriptName' in o)
  if (Array.isArray(j) && j.length && j.every(looks)) return j.map(normalizeRegexScript)
  if (looks(j)) return [normalizeRegexScript(j as AnyObj)]
  return null
}
