/**
 * 提示词组装（参照 SillyTavern 对话补全）。
 * 默认顺序：主提示词 → 世界书(前) → 用户人设 → 角色描述 → 性格 → 场景 → 世界书(后) → 示例对话 → 聊天记录（含深度插入）→ 历史后指令
 * 导入 SillyTavern 预设后，按预设里的顺序、开关和自定义提示词组装。
 */
import type { ApiProfile, Character, Chat, ChatMessage, LLMMessage, MsgRole, PromptPreset, RegexScript, Settings, Worldbook } from './types'
import { substituteMacros, type MacroContext } from './macros'
import { applyRegexScripts } from './regex'
import { presetScriptsFor, stripEjs, triggerMatches, type GenType } from './presetRuntime'
import { estimateTokens } from './tokens'
import { scanWorldInfo, placeWorldInfo, type WIActivated, type WIEntryRef } from './wiEngine'

export const DEFAULT_MAIN_PROMPT = '你将在一场虚构的角色扮演中扮演{{char}}，与{{user}}对话。请以{{char}}的身份续写下一条回复：保持角色设定与故事连贯，描写生动具体，推动情节发展；不要替{{user}}说话或行动。'
export const DEFAULT_POST_HISTORY = ''
export const DEFAULT_CONTINUE_NUDGE = '[接着你的上一条回复写下去：从中断的地方直接续写，不要重复已经写过的内容，也不要另起开头。]'
/** 群聊里提醒 AI 只写当前发言者（对应酒馆预设的 group_nudge_prompt） */
export const DEFAULT_GROUP_NUDGE = '[接下来轮到{{char}}发言：只写{{char}}的言行与对白，不要替其他角色或{{user}}说话、行动；回复开头不要写名字。]'

export const DEFAULT_IMPERSONATE = '[请以{{user}}的身份，写出{{user}}接下来要说的话或要做的事。参考聊天记录里{{user}}的写法；只写{{user}}的部分，不要替{{char}}说话或描写{{char}}的反应；不加任何解释。]'
const DEFAULT_ENHANCE = "If you have more knowledge of {{char}}, add to the character's lore and personality to enhance them but keep the Character Sheet's definitions absolute."

/** SillyTavern 的固定标记（内容由药汤填充） */
export const MARKERS = ['worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'worldInfoAfter', 'dialogueExamples', 'chatHistory'] as const

export const BLOCK_LABEL: Record<string, string> = {
  main: '主提示词',
  nsfw: '辅助提示词',
  jailbreak: '历史后指令',
  enhanceDefinitions: '增强定义',
  worldInfoBefore: '世界书（角色定义前）',
  worldInfoAfter: '世界书（角色定义后）',
  personaDescription: '用户人设',
  charDescription: '角色描述',
  charPersonality: '角色性格',
  scenario: '场景',
  dialogueExamples: '示例对话',
  chatHistory: '聊天记录'
}

const DEFAULT_ORDER = ['main', 'worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'enhanceDefinitions', 'nsfw', 'worldInfoAfter', 'dialogueExamples', 'chatHistory', 'jailbreak'].map((identifier) => ({
  identifier,
  enabled: identifier !== 'enhanceDefinitions' && identifier !== 'nsfw'
}))

export interface PromptBlockInfo {
  label: string
  role: MsgRole
  content: string
  tokens: number
}

export interface BuildInput {
  character: Character
  chat: Chat
  /** 作为上下文的聊天记录（重新生成时已去掉目标消息） */
  history: ChatMessage[]
  chatSettings: Settings['chat']
  profile: ApiProfile
  extraBooks?: Worldbook[]
  globalRegex?: RegexScript[]
  globalVars?: Record<string, string>
  /** 导入的 SillyTavern 预设；不传则用内置顺序 */
  preset?: PromptPreset | null
  /** 生成方式（预设里有的提示词只在特定方式下发送） */
  genType?: GenType
  /**
   * 群聊：character 是这次发言的成员；members 是全体成员（含发言者）。
   * 聊天记录会带上说话人的名字，并介绍其他成员，最后提醒只以发言者的身份写。
   */
  group?: { name: string; members: Character[]; scenario?: string; muted?: string[] }
  now?: Date
}

export interface BuildResult {
  messages: LLMMessage[]
  blocks: PromptBlockInfo[]
  activated: WIActivated[]
  budgetOverflow: boolean
  tokens: number
  includedHistory: number
  trimmedHistory: number
  wiTimed: Chat['wiTimed']
  vars: Record<string, string>
  globalVars: Record<string, string>
  /**
   * 上下文用量（token，已按校准系数估算）。
   * over = 预设、角色、世界书等固定内容本身就超过了「上下文 − 回复预留」，与 SillyTavern 一样不发送。
   */
  budget: { context: number; reserve: number; fixed: number; history: number; over: boolean; calibrated: boolean }
  /** 这次发送是否带上了前情提要 */
  recapUsed: boolean
  /** 预设里自带的续写 / 代写提示（没有则为空） */
  continueNudge?: string
  impersonatePrompt?: string
}

export function swipeText(m: ChatMessage): string {
  return m.swipes[m.swipeIndex]?.text ?? ''
}

export function personaName(s: Settings['chat']): string {
  return s.persona.name.trim() || '旅人'
}

export function makeMacroContext(ch: Character, chat: Chat, s: Settings['chat'], profile: ApiProfile | null, history: ChatMessage[], globalVars: Record<string, string>, now?: Date): MacroContext {
  const lastUser = [...history].reverse().find((m) => m.role === 'user')
  const lastChar = [...history].reverse().find((m) => m.role === 'assistant')
  const last = history[history.length - 1]
  return {
    user: personaName(s),
    char: ch.name,
    persona: s.persona.description,
    description: ch.description,
    personality: ch.personality,
    scenario: ch.scenario,
    mesExamples: ch.mesExample,
    charPrompt: ch.systemPrompt,
    charJailbreak: ch.postHistoryInstructions,
    charVersion: ch.characterVersion,
    creatorNotes: ch.creatorNotes,
    model: profile?.model,
    lastMessage: last ? swipeText(last) : '',
    lastUserMessage: lastUser ? swipeText(lastUser) : '',
    lastCharMessage: lastChar ? swipeText(lastChar) : '',
    lastMessageId: history.length - 1,
    firstMes: ch.firstMes,
    depthPrompt: ch.depthPrompt?.prompt,
    maxPrompt: profile?.contextSize,
    vars: chat.vars,
    globalVars,
    seed: chat.id,
    now
  }
}

export function buildPrompt(input: BuildInput): BuildResult {
  const { character: ch, chat, chatSettings: s, profile, preset } = input
  // 按实际用量校准过的估算（没有校准时按 1）
  const scale = profile.tokenRatio && profile.tokenRatio > 0 ? profile.tokenRatio : 1
  const est = (t: string) => Math.ceil(estimateTokens(t) * scale)
  const vars = { ...(chat.vars ?? {}) }
  const globalVars = { ...(input.globalVars ?? {}) }
  const chatForCtx: Chat = { ...chat, vars }
  const ctx = makeMacroContext(ch, chatForCtx, s, profile, input.history, globalVars, input.now)
  const grp = input.group
  if (grp) {
    ctx.group = grp.members.map((m) => m.name).join('、')
    ctx.groupNotMuted = grp.members.filter((m) => !grp.muted?.includes(m.id)).map((m) => m.name).join('、')
  }
  ctx.genType = input.genType === 'swipe' ? 'swipe' : input.genType ?? 'normal'
  const mac = (t: string) => substituteMacros(t, ctx)
  const scripts = [...(input.globalRegex ?? []), ...presetScriptsFor(preset, ch), ...ch.regexScripts]
  const userName = ctx.user

  // —— 聊天记录（应用「仅发送」正则）
  const n = input.history.length
  const hist = input.history.map((m, i) => {
    const depth = n - 1 - i
    const placement = m.role === 'user' ? 1 : 2
    let text = applyRegexScripts(swipeText(m), scripts, { placement, isPrompt: true, depth, macros: mac })
    text = mac(text)
    // 群聊：每条都带上说话人的名字，AI 才分得清谁说了什么
    if (grp) {
      const who = m.role === 'user' ? ctx.user : grp.members.find((x) => x.id === m.speakerId)?.name ?? ch.name
      text = `${who}：${text}`
    }
    return { role: m.role, content: text }
  })

  // —— 世界书
  const books: Worldbook[] = []
  if (ch.book) books.push(ch.book)
  for (const b of input.extraBooks ?? []) if (!books.some((x) => x.id === b.id)) books.push(b)
  const entries: WIEntryRef[] = []
  for (const b of books) for (const e of b.entries) entries.push({ ...e, bookId: b.id, bookName: b.name })
  const scanChat = hist.map((h) => (s.wiIncludeNames ? `${h.role === 'user' ? userName : ch.name}: ${h.content}` : h.content))
  const wi = scanWorldInfo({
    entries,
    chat: scanChat,
    scanDepth: s.wiScanDepth,
    budgetTokens: Math.max(1, Math.round((profile.contextSize * s.wiBudgetPercent) / 100 / scale)),
    recursive: s.wiRecursive,
    maxRecursion: s.wiMaxRecursion,
    sources: {
      personaDescription: s.persona.description,
      characterDescription: ch.description,
      characterPersonality: ch.personality,
      characterDepthPrompt: ch.depthPrompt?.prompt ?? '',
      scenario: ch.scenario,
      creatorNotes: ch.creatorNotes
    },
    messageCount: chat.messages.length,
    timed: chat.wiTimed,
    macros: mac
  })
  const wiFormat = preset?.formats?.wi || '{0}'
  const placed = placeWorldInfo(wi.activated, (c) => mac(applyRegexScripts(stripEjs(c), scripts, { placement: 5, isPrompt: true, macros: mac })))
  ctx.outlets = Object.fromEntries(Object.entries(placed.outlets).map(([k, v]) => [k, v.join('\n')]))
  const wrapWI = (list: string[]) => (list.length ? wiFormat.replace('{0}', list.join('\n')) : '')

  // —— 各段内容
  const pp = (id: string) => preset?.prompts.find((p) => p.identifier === id)
  /** 预设提示词的正文（EJS 模板代码不执行，去掉） */
  const ppText = (id: string) => {
    const c = pp(id)?.content
    return c == null ? undefined : stripEjs(c)
  }
  const baseMain = (ppText('main') ?? s.mainPrompt).trim() || DEFAULT_MAIN_PROMPT
  const main = s.useCardSystemPrompt && !pp('main')?.forbidOverrides && ch.systemPrompt.trim() ? ch.systemPrompt.replace(/\{\{original\}\}/gi, baseMain) : baseMain
  const basePhi = (ppText('jailbreak') ?? s.postHistoryPrompt).trim()
  const phi = s.useCardPostHistory && !pp('jailbreak')?.forbidOverrides && ch.postHistoryInstructions.trim() ? ch.postHistoryInstructions.replace(/\{\{original\}\}/gi, basePhi) : basePhi
  const personalityFmt = preset?.formats?.personality
  const scenarioFmt = preset?.formats?.scenario
  const exampleHeader = preset?.newExampleChat ?? '[示例]'
  const examples = formatExamples(mac(ch.mesExample), exampleHeader, !preset)

  const contentOf = (id: string): string => {
    switch (id) {
      case 'main':
        return mac(main)
      case 'jailbreak':
        return mac(phi)
      case 'nsfw':
        return mac(ppText('nsfw') ?? '')
      case 'enhanceDefinitions':
        return mac(ppText('enhanceDefinitions') ?? DEFAULT_ENHANCE)
      case 'worldInfoBefore':
        return wrapWI(placed.before)
      case 'worldInfoAfter':
        return wrapWI(placed.after)
      case 'personaDescription':
        return mac(s.persona.description)
      case 'charDescription':
        return mac(ch.description)
      case 'charPersonality':
        if (!ch.personality.trim()) return ''
        return mac(personalityFmt ? personalityFmt.replace(/\{\{personality\}\}/gi, ch.personality) : `{{char}}的性格：${ch.personality}`)
      case 'scenario': {
        // 群聊场景优先
        const sc = grp?.scenario?.trim() ? grp.scenario : ch.scenario
        if (!sc.trim()) return ''
        return mac(scenarioFmt ? scenarioFmt.replace(/\{\{scenario\}\}/gi, sc) : `场景：${sc}`)
      }
      case 'dialogueExamples':
        return [placed.emTop.join('\n'), examples, placed.emBottom.join('\n')].filter((x) => x.trim()).join('\n')
      default:
        return mac(ppText(id) ?? '')
    }
  }
  const roleOf = (id: string): MsgRole => pp(id)?.role ?? 'system'
  const labelOf = (id: string) => BLOCK_LABEL[id] ?? pp(id)?.name ?? id

  // —— 深度插入
  type Inj = { depth: number; role: MsgRole; label: string; content: string }
  const inj: Inj[] = []
  const roleName = (r: number): MsgRole => (r === 1 ? 'user' : r === 2 ? 'assistant' : 'system')
  for (const d of placed.depth) inj.push({ depth: d.depth, role: roleName(d.role), label: `世界书（深度 ${d.depth}）`, content: d.contents.join('\n') })
  const an = chat.authorNote
  const anText = [placed.anTop.join('\n'), mac(an?.text ?? ''), placed.anBottom.join('\n')].filter((x) => x.trim()).join('\n')
  if (anText.trim()) inj.push({ depth: an?.depth ?? 4, role: an?.role ?? 'system', label: '作者备注', content: anText })
  if (ch.depthPrompt && ch.depthPrompt.prompt.trim()) inj.push({ depth: ch.depthPrompt.depth, role: ch.depthPrompt.role, label: '角色备注', content: mac(ch.depthPrompt.prompt) })

  // —— 按顺序排出段落：聊天记录之前 / 之后
  const order = preset?.order?.length ? preset.order : DEFAULT_ORDER
  const before: PromptBlockInfo[] = []
  const after: PromptBlockInfo[] = []
  let seenHistory = false
  for (const it of order) {
    if (!it.enabled) continue
    if (it.identifier === 'chatHistory') {
      seenHistory = true
      continue
    }
    const p = pp(it.identifier)
    if (p && !triggerMatches(p.triggers, input.genType)) continue
    // 预设里的「按深度插入」自定义提示词
    if (p && !p.marker && p.injection === 'depth' && !['main', 'jailbreak', 'nsfw', 'enhanceDefinitions'].includes(it.identifier)) {
      const c = contentOf(it.identifier).trim()
      if (c) inj.push({ depth: p.depth, role: p.role, label: labelOf(it.identifier), content: c })
      continue
    }
    const c = contentOf(it.identifier).trim()
    if (!c) continue
    const blk = { label: labelOf(it.identifier), role: roleOf(it.identifier), content: c, tokens: est(c) }
    ;(seenHistory ? after : before).push(blk)
  }
  if (grp) {
    const others = grp.members.filter((m) => m.id !== ch.id)
    const intro = others
      .map((m) => {
        const brief = (m.personality.trim() || m.description.trim()).replace(/\s+/g, ' ')
        const text = brief.length > 360 ? brief.slice(0, 360) + '……' : brief
        return `- ${m.name}${text ? `：${substituteMacros(text, { ...ctx, char: m.name })}` : ''}`
      })
      .join('\n')
    const c = `[群聊「${grp.name}」：这是一场多人对话，参与者有${ctx.user}、${grp.members.map((m) => m.name).join('、')}。你扮演其中的${ch.name}。]${intro ? `\n其他成员：\n${intro}` : ''}`
    before.push({ label: '群聊成员', role: 'system', content: c, tokens: est(c) })
  }

  // 预设里没有聊天记录位置时，聊天记录放在所有段落之后
  const newChat = preset?.newChat ? mac(preset.newChat).trim() : ''

  // —— 上下文预算：从最新的消息往前装
  const fixedTokens = [...before, ...after].reduce((a, b) => a + b.tokens + 4, 0) + inj.reduce((a, b) => a + est(b.content) + 4, 0) + (newChat ? est(newChat) + 4 : 0)
  const reserve = Math.min(profile.maxTokens, Math.floor(profile.contextSize / 2))
  // 前情提要：只有较早的对话放不下时才发送，所以先为它留出位置
  const recapText = chat.summary?.text?.trim()
    ? `[前情提要：以下是这段故事较早部分的概要，那部分对话原文没有发送]\n${chat.summary.text.trim()}`
    : ''
  const recapTokens = recapText ? est(recapText) + 4 : 0
  const available = profile.contextSize - reserve - fixedTokens - recapTokens
  let used = 0
  let start = hist.length
  for (let i = hist.length - 1; i >= 0; i--) {
    const t = est(hist[i].content) + 4
    if (used + t > available && i < hist.length - 1) break
    used += t
    start = i
  }
  const kept = hist.slice(start)
  const recapUsed = !!recapText && start > 0

  // —— 组装
  const messages: LLMMessage[] = []
  for (const b of before) messages.push({ role: b.role, content: b.content })
  if (newChat) messages.push({ role: 'system', content: newChat })
  if (recapUsed) messages.push({ role: 'system', content: recapText })
  const histBlocks: PromptBlockInfo[] = []
  // 深度 d = 插在倒数第 d 条消息之前；超出聊天长度时放在聊天记录最前（与 ST 一致）
  const len = kept.length
  const slot = (d: number) => Math.max(0, len - Math.max(0, d))
  const roleRank: Record<MsgRole, number> = { system: 0, user: 1, assistant: 2 }
  const emit = (at: number) => {
    const here = inj.filter((x) => slot(x.depth) === at).sort((a, b) => roleRank[a.role] - roleRank[b.role])
    for (const x of here) {
      messages.push({ role: x.role, content: x.content })
      histBlocks.push({ label: x.label, role: x.role, content: x.content, tokens: est(x.content) })
    }
  }
  for (let i = 0; i < len; i++) {
    emit(i)
    messages.push({ role: kept[i].role, content: kept[i].content })
  }
  emit(len)
  for (const b of after) messages.push({ role: b.role, content: b.content })
  if (grp && input.genType !== 'impersonate') {
    const nudge = mac(preset?.groupNudge || DEFAULT_GROUP_NUDGE).trim()
    if (nudge) {
      messages.push({ role: 'system', content: nudge })
      after.push({ label: '群聊提醒', role: 'system', content: nudge, tokens: est(nudge) })
    }
  }

  const allBlocks: PromptBlockInfo[] = [
    ...before,
    ...(newChat ? [{ label: '新对话提示', role: 'system' as MsgRole, content: newChat, tokens: est(newChat) }] : []),
    ...(recapUsed ? [{ label: `前情提要（概括了最早的 ${chat.summary!.covered} 条）`, role: 'system' as MsgRole, content: recapText, tokens: recapTokens }] : []),
    { label: `聊天记录（${kept.length} 条${start > 0 ? `，较早的 ${start} 条因上下文预算未发送` : ''}）`, role: 'user', content: kept.map((k) => `【${k.role === 'user' ? userName : ch.name}】${k.content}`).join('\n\n'), tokens: used },
    ...histBlocks,
    ...after
  ]

  return {
    messages: mergeAdjacentSystem(messages),
    blocks: allBlocks,
    activated: wi.activated,
    budgetOverflow: wi.budgetOverflow,
    tokens: fixedTokens + used + (recapUsed ? recapTokens : 0),
    includedHistory: kept.length,
    trimmedHistory: start,
    wiTimed: wi.timed,
    vars,
    globalVars,
    budget: { context: profile.contextSize, reserve, fixed: fixedTokens + (recapUsed ? recapTokens : 0), history: used, over: profile.contextSize - reserve - fixedTokens < 0, calibrated: scale !== 1 },
    recapUsed,
    continueNudge: preset?.continueNudge || undefined,
    impersonatePrompt: preset?.impersonate || undefined
  }
}

/** <START> 分隔的示例对话 */
function formatExamples(raw: string, header: string, withIntro: boolean): string {
  const t = raw.trim()
  if (!t) return ''
  const parts = t
    .split(/<START>/i)
    .map((p) => p.trim())
    .filter(Boolean)
  if (!parts.length) return ''
  return (withIntro ? '[以下是对话风格示例]\n' : '') + parts.map((p) => `${header}\n${p}`).join('\n\n')
}

function mergeAdjacentSystem(msgs: LLMMessage[]): LLMMessage[] {
  const out: LLMMessage[] = []
  for (const m of msgs) {
    const prev = out[out.length - 1]
    if (prev && prev.role === 'system' && m.role === 'system') prev.content += '\n\n' + m.content
    else out.push({ ...m })
  }
  return out
}
