import type { Worldbook, WorldEntry, WIPosition, WIRole, SelectiveLogic } from './types'
import { newId } from './id'

type AnyObj = Record<string, any>

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d)
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : v == null ? d : Boolean(v))
const nbool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)
const nnum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x ?? '')).filter((s) => s.trim() !== '') : typeof v === 'string' && v.trim() ? v.split(',').map((s) => s.trim()).filter(Boolean) : []

export function blankEntry(uid: number): WorldEntry {
  return {
    uid,
    keys: [],
    secondaryKeys: [],
    selective: true,
    selectiveLogic: 0,
    constant: false,
    enabled: true,
    comment: '',
    content: '',
    order: 100,
    position: 0,
    depth: 4,
    role: 0,
    probability: 100,
    useProbability: true,
    group: '',
    groupOverride: false,
    groupWeight: 100,
    useGroupScoring: null,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: false,
    sticky: 0,
    cooldown: 0,
    delay: 0,
    vectorized: false,
    outletName: '',
    matchPersonaDescription: false,
    matchCharacterDescription: false,
    matchCharacterPersonality: false,
    matchCharacterDepthPrompt: false,
    matchScenario: false,
    matchCreatorNotes: false
  }
}

const clampPos = (p: number): WIPosition => (p >= 0 && p <= 7 ? (Math.round(p) as WIPosition) : 0)
const clampRole = (r: unknown): WIRole => {
  const n = num(r, 0)
  return n === 1 || n === 2 ? n : 0
}
const clampLogic = (l: unknown): SelectiveLogic => {
  const n = num(l, 0)
  return n === 1 || n === 2 || n === 3 ? n : 0
}

/** 角色卡 V2/V3 规范中的 character_book 条目 */
export function entryFromCardBook(e: AnyObj, idx: number): WorldEntry {
  const ex: AnyObj = e.extensions && typeof e.extensions === 'object' ? e.extensions : {}
  const base = blankEntry(num(e.id, idx))
  let position: WIPosition
  if (typeof ex.position === 'number') position = clampPos(ex.position)
  else position = e.position === 'after_char' ? 1 : 0
  return {
    ...base,
    keys: strArr(e.keys),
    secondaryKeys: strArr(e.secondary_keys),
    selective: bool(e.selective, true),
    selectiveLogic: clampLogic(ex.selectiveLogic),
    constant: bool(e.constant, false),
    enabled: bool(e.enabled, true),
    comment: String(e.comment ?? e.name ?? ''),
    content: String(e.content ?? ''),
    order: num(e.insertion_order, 100),
    position,
    depth: num(ex.depth, 4),
    role: clampRole(ex.role),
    probability: num(ex.probability, 100),
    useProbability: bool(ex.useProbability, true),
    group: String(ex.group ?? ''),
    groupOverride: bool(ex.group_override, false),
    groupWeight: num(ex.group_weight, 100),
    useGroupScoring: nbool(ex.use_group_scoring),
    scanDepth: nnum(ex.scan_depth),
    caseSensitive: nbool(ex.case_sensitive ?? e.case_sensitive),
    matchWholeWords: nbool(ex.match_whole_words),
    excludeRecursion: bool(ex.exclude_recursion, false),
    preventRecursion: bool(ex.prevent_recursion, false),
    delayUntilRecursion: typeof ex.delay_until_recursion === 'number' ? ex.delay_until_recursion : bool(ex.delay_until_recursion, false),
    sticky: num(ex.sticky, 0),
    cooldown: num(ex.cooldown, 0),
    delay: num(ex.delay, 0),
    vectorized: bool(ex.vectorized, false),
    outletName: String(ex.outlet_name ?? ''),
    matchPersonaDescription: bool(ex.match_persona_description, false),
    matchCharacterDescription: bool(ex.match_character_description, false),
    matchCharacterPersonality: bool(ex.match_character_personality, false),
    matchCharacterDepthPrompt: bool(ex.match_character_depth_prompt, false),
    matchScenario: bool(ex.match_scenario, false),
    matchCreatorNotes: bool(ex.match_creator_notes, false),
    extra: pickExtra(ex, ['automation_id', 'triggers', 'ignore_budget', 'display_index'])
  }
}

/** SillyTavern 原生世界书 JSON 的条目 */
export function entryFromST(e: AnyObj, idx: number): WorldEntry {
  const base = blankEntry(num(e.uid, idx))
  return {
    ...base,
    keys: strArr(e.key ?? e.keys),
    secondaryKeys: strArr(e.keysecondary ?? e.secondary_keys),
    selective: bool(e.selective, true),
    selectiveLogic: clampLogic(e.selectiveLogic),
    constant: bool(e.constant, false),
    enabled: !bool(e.disable, false),
    comment: String(e.comment ?? ''),
    content: String(e.content ?? ''),
    order: num(e.order, 100),
    position: clampPos(num(e.position, 0)),
    depth: num(e.depth, 4),
    role: clampRole(e.role),
    probability: num(e.probability, 100),
    useProbability: bool(e.useProbability, true),
    group: String(e.group ?? ''),
    groupOverride: bool(e.groupOverride, false),
    groupWeight: num(e.groupWeight, 100),
    useGroupScoring: nbool(e.useGroupScoring),
    scanDepth: nnum(e.scanDepth),
    caseSensitive: nbool(e.caseSensitive),
    matchWholeWords: nbool(e.matchWholeWords),
    excludeRecursion: bool(e.excludeRecursion, false),
    preventRecursion: bool(e.preventRecursion, false),
    delayUntilRecursion: typeof e.delayUntilRecursion === 'number' ? e.delayUntilRecursion : bool(e.delayUntilRecursion, false),
    sticky: num(e.sticky, 0),
    cooldown: num(e.cooldown, 0),
    delay: num(e.delay, 0),
    vectorized: bool(e.vectorized, false),
    outletName: String(e.outletName ?? ''),
    matchPersonaDescription: bool(e.matchPersonaDescription, false),
    matchCharacterDescription: bool(e.matchCharacterDescription, false),
    matchCharacterPersonality: bool(e.matchCharacterPersonality, false),
    matchCharacterDepthPrompt: bool(e.matchCharacterDepthPrompt, false),
    matchScenario: bool(e.matchScenario, false),
    matchCreatorNotes: bool(e.matchCreatorNotes, false),
    extra: pickExtra(e, ['automationId', 'triggers', 'ignoreBudget', 'displayIndex', 'addMemo', 'characterFilter'])
  }
}

function pickExtra(o: AnyObj, keys: string[]): Record<string, unknown> | undefined {
  const r: Record<string, unknown> = {}
  let any = false
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null && o[k] !== '' && !(Array.isArray(o[k]) && o[k].length === 0)) {
      r[k] = o[k]
      any = true
    }
  }
  return any ? r : undefined
}

/** 角色卡内嵌 character_book → Worldbook */
export function bookFromCard(cb: AnyObj, fallbackName: string): Worldbook {
  const entries = Array.isArray(cb.entries) ? cb.entries.map((e: AnyObj, i: number) => entryFromCardBook(e, i)) : []
  return {
    id: newId('wb'),
    name: String(cb.name || fallbackName),
    description: cb.description ? String(cb.description) : undefined,
    entries,
    scanDepth: nnum(cb.scan_depth) ?? undefined,
    tokenBudget: nnum(cb.token_budget) ?? undefined,
    recursiveScanning: typeof cb.recursive_scanning === 'boolean' ? cb.recursive_scanning : undefined,
    source: { kind: 'card-embedded', importedAt: Date.now() }
  }
}

/** 判断一个 JSON 是否为世界书，并转换 */
export function parseWorldbookJson(j: AnyObj, fileName: string): Worldbook | null {
  if (!j || typeof j !== 'object') return null
  const name = String(j.name || fileName.replace(/\.json$/i, ''))
  // SillyTavern 原生：entries 是以 uid 为键的对象
  if (j.entries && !Array.isArray(j.entries) && typeof j.entries === 'object') {
    const list = Object.values(j.entries as AnyObj).map((e, i) => entryFromST(e as AnyObj, i))
    list.sort((a, b) => a.uid - b.uid)
    return { id: newId('wb'), name, entries: list, source: { kind: 'st-world', fileName, importedAt: Date.now() } }
  }
  // V2 规范 character_book 独立导出：entries 是数组
  if (Array.isArray(j.entries)) {
    const b = bookFromCard(j, name)
    b.source = { kind: 'v2-book', fileName, importedAt: Date.now() }
    return b
  }
  return null
}

/**
 * 纯文本设定（.txt）→ 只有一条常驻条目的世界书。
 * 没有关键词可用，所以默认常驻；想按关键词触发可以之后在世界书库里改。
 */
export function bookFromText(text: string, fileName: string): Worldbook {
  const name = fileName.replace(/\.(txt|md)$/i, '') || '文本设定'
  const e = blankEntry(0)
  e.comment = name
  e.content = text.replace(/\r\n?/g, '\n').trim()
  e.constant = true
  return { id: newId('wb'), name, entries: [e], source: { kind: 'custom', fileName, importedAt: Date.now() } }
}

/** 文本文件解码：先按 UTF-8，不合法再按 GB18030（老的中文记事本文件） */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('gb18030').decode(bytes)
  }
}

/** 导出为 SillyTavern 原生世界书 JSON */
export function toSTWorld(book: Worldbook): AnyObj {
  const entries: AnyObj = {}
  book.entries.forEach((e, i) => {
    entries[String(e.uid)] = {
      uid: e.uid,
      key: e.keys,
      keysecondary: e.secondaryKeys,
      comment: e.comment,
      content: e.content,
      constant: e.constant,
      vectorized: e.vectorized,
      selective: e.selective,
      selectiveLogic: e.selectiveLogic,
      addMemo: true,
      order: e.order,
      position: e.position,
      disable: !e.enabled,
      excludeRecursion: e.excludeRecursion,
      preventRecursion: e.preventRecursion,
      delayUntilRecursion: e.delayUntilRecursion,
      probability: e.probability,
      useProbability: e.useProbability,
      depth: e.depth,
      group: e.group,
      groupOverride: e.groupOverride,
      groupWeight: e.groupWeight,
      scanDepth: e.scanDepth,
      caseSensitive: e.caseSensitive,
      matchWholeWords: e.matchWholeWords,
      useGroupScoring: e.useGroupScoring,
      role: e.role,
      sticky: e.sticky,
      cooldown: e.cooldown,
      delay: e.delay,
      displayIndex: i,
      outletName: e.outletName,
      matchPersonaDescription: e.matchPersonaDescription,
      matchCharacterDescription: e.matchCharacterDescription,
      matchCharacterPersonality: e.matchCharacterPersonality,
      matchCharacterDepthPrompt: e.matchCharacterDepthPrompt,
      matchScenario: e.matchScenario,
      matchCreatorNotes: e.matchCreatorNotes,
      ...(e.extra ?? {})
    }
  })
  return { name: book.name, entries }
}

export const POSITION_LABEL: Record<number, string> = {
  0: '角色定义前',
  1: '角色定义后',
  2: '作者备注前',
  3: '作者备注后',
  4: '按深度插入',
  5: '示例对话前',
  6: '示例对话后',
  7: '出口'
}

/** 统计世界书用到了哪些药汤暂不支持 / 行为不同的特性 */
export function auditWorldbook(book: Worldbook): { unsupported: string[]; notes: string[] } {
  const unsupported: string[] = []
  const notes: string[] = []
  const active = book.entries.filter((e) => e.enabled)
  const count = (f: (e: WorldEntry) => boolean) => active.filter(f).length
  const vec = count((e) => e.vectorized)
  if (vec) unsupported.push(`${vec} 条使用「向量化匹配」，药汤不支持，改按关键词匹配`)
  const trig = count((e) => Array.isArray(e.extra?.triggers) && (e.extra!.triggers as unknown[]).length > 0)
  if (trig) notes.push(`${trig} 条限定了生成类型触发（如仅续写时），药汤忽略此限制`)
  const auto = count((e) => !!(e.extra?.automationId || e.extra?.automation_id))
  if (auto) unsupported.push(`${auto} 条带有「自动化 ID」（用于 ST 脚本），药汤不执行脚本`)
  const vars = count((e) => /\{\{(setvar|getvar|addvar|incvar|decvar|setglobalvar|getglobalvar)::/i.test(e.content))
  if (vars) notes.push(`${vars} 条使用变量宏（setvar/getvar 等），已支持基本用法`)
  const ejs = count((e) => /<%[\s\S]*?%>/.test(e.content))
  if (ejs) unsupported.push(`${ejs} 条包含 EJS 模板脚本（<% %>），药汤不执行：发送前去掉模板代码，只留普通文字`)
  const dead = count((e) => !e.constant && !e.keys.length)
  if (dead) notes.push(`${dead} 条既没有关键词也不是常驻，不会被触发（与 SillyTavern 相同）；需要的话可以给它们加上关键词`)
  const filtered = count((e) => {
    const f = e.extra?.characterFilter as { names?: unknown[]; tags?: unknown[] } | undefined
    return !!f && ((Array.isArray(f.names) && f.names.length > 0) || (Array.isArray(f.tags) && f.tags.length > 0))
  })
  if (filtered) unsupported.push(`${filtered} 条限定了只对某些角色生效，药汤暂不区分，对绑定的所有角色都生效`)
  const constChars = active.filter((e) => e.constant).reduce((n, e) => n + e.content.length, 0)
  if (constChars > 20000) notes.push(`常驻条目合计约 ${Math.round(constChars / 1000)}K 字，可能超过世界书预算（设置 → 世界书），超出的部分不会发送`)
  const stc = count((e) => /\{\{(?!\/\/)[^}]*?(\/|getmes|trigger|gen|inject)[^}]*?\}\}/i.test(e.content) && /\{\{\/[a-z]/i.test(e.content))
  if (stc) unsupported.push(`${stc} 条疑似包含 ST 斜杠命令，药汤不执行`)
  return { unsupported, notes }
}
