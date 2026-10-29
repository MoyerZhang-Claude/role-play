/**
 * SillyTavern「对话补全预设」（Chat Completion preset）的导入。
 * 取用：提示词内容与顺序、开关、按深度插入、格式模板、续写 / 代写提示、采样参数。
 */
import type { ImportReport, MsgRole, PresetPrompt, PromptPreset, ReportItem } from './types'
import { normalizeRegexScript } from './regex'
import { hasEjs, needsScript } from './presetRuntime'
import { estimateTokens } from './tokens'
import { newId } from './id'
import { BLOCK_LABEL, MARKERS } from './prompt'

type AnyObj = Record<string, any>

export function looksLikePreset(j: unknown): boolean {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return false
  const o = j as AnyObj
  return Array.isArray(o.prompts) || Array.isArray(o.prompt_order) || ('openai_max_context' in o && 'temperature' in o)
}

const role = (r: unknown): MsgRole => (r === 'user' || r === 'assistant' ? r : 'system')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** ST 内置但药汤用不上的设置 → 报告里说明 */
const IGNORED: Record<string, string> = {
  assistant_prefill: '助手预填（只对 Claude 生效）',
  assistant_impersonation: '代写时的助手预填',
  squash_system_messages: '合并系统消息（药汤总是合并相邻的系统消息）',
  names_behavior: '名字前缀行为',
  bias_preset_selected: 'Logit 偏置',
  function_calling: '函数调用',
  image_inlining: '图片内联',
  inline_image_quality: '图片质量',
  continue_prefill: '续写预填',
  continue_postfix: '续写后缀',
  seed: '随机种子',
  n: '一次生成多条',
  send_if_empty: '空消息时发送的内容',
  wrap_in_quotes: '自动加引号',
  show_external_models: '显示外部模型',
  reasoning_effort: '思考强度（DeepSeek 的思考开关在「设置 → 接口」里）',
  show_thoughts: '显示思考过程（药汤总是把思考内容折叠显示）',
  enable_web_search: '联网搜索',
  request_images: '生成图片',
  media_inlining: '媒体内联',
  claude_fast_mode: 'Claude 快速模式',
  verbosity: '输出详细度',
  tool_reasoning_mode: '工具调用',
  strip_old_tool_calls: '工具调用'
}

/** 只有不是默认值时才值得提一句的采样参数（OpenAI 兼容接口不支持） */
const EXTRA_SAMPLERS: Record<string, [string, number]> = {
  top_k: ['Top K', 0],
  top_a: ['Top A', 0],
  min_p: ['Min P', 0],
  repetition_penalty: ['重复惩罚', 1]
}

export function parsePreset(j: AnyObj, fileName: string): { preset: PromptPreset; report: ImportReport } {
  const items: ReportItem[] = []
  const prompts: PresetPrompt[] = (Array.isArray(j.prompts) ? j.prompts : [])
    .filter((p: AnyObj) => p && typeof p.identifier === 'string')
    .map((p: AnyObj) => ({
      identifier: String(p.identifier),
      name: String(p.name ?? BLOCK_LABEL[p.identifier] ?? p.identifier),
      role: role(p.role),
      content: typeof p.content === 'string' ? p.content : '',
      marker: !!p.marker || (MARKERS as readonly string[]).includes(p.identifier),
      injection: Number(p.injection_position) === 1 ? 'depth' : 'relative',
      depth: Number.isFinite(Number(p.injection_depth)) ? Number(p.injection_depth) : 4,
      ...(Array.isArray(p.injection_trigger) && p.injection_trigger.length ? { triggers: p.injection_trigger.map(String) } : {}),
      ...(p.forbid_overrides ? { forbidOverrides: true } : {})
    })) as PresetPrompt[]
  // 顺序：优先取全局（ST 用 100001 / 100000 表示）
  let order: { identifier: string; enabled: boolean }[] = []
  if (Array.isArray(j.prompt_order) && j.prompt_order.length) {
    const pick = j.prompt_order.find((o: AnyObj) => o.character_id === 100001) ?? j.prompt_order.find((o: AnyObj) => o.character_id === 100000) ?? j.prompt_order[0]
    if (Array.isArray(pick?.order)) order = pick.order.filter((x: AnyObj) => x && typeof x.identifier === 'string').map((x: AnyObj) => ({ identifier: String(x.identifier), enabled: x.enabled !== false }))
  }
  if (!order.length) order = prompts.map((p) => ({ identifier: p.identifier, enabled: true }))
  for (const p of prompts) if (!order.some((o) => o.identifier === p.identifier)) order.push({ identifier: p.identifier, enabled: false })

  const name = String(j.name ?? fileName.replace(/\.json$/i, ''))
  const preset: PromptPreset = {
    id: newId('ps'),
    name,
    prompts,
    order,
    formats: {
      wi: typeof j.wi_format === 'string' ? j.wi_format : undefined,
      scenario: typeof j.scenario_format === 'string' ? j.scenario_format : undefined,
      personality: typeof j.personality_format === 'string' ? j.personality_format : undefined
    },
    continueNudge: typeof j.continue_nudge_prompt === 'string' ? j.continue_nudge_prompt : undefined,
    impersonate: typeof j.impersonation_prompt === 'string' ? j.impersonation_prompt : undefined,
    groupNudge: typeof j.group_nudge_prompt === 'string' && j.group_nudge_prompt.trim() ? j.group_nudge_prompt : undefined,
    newChat: typeof j.new_chat_prompt === 'string' ? j.new_chat_prompt : undefined,
    newExampleChat: typeof j.new_example_chat_prompt === 'string' ? j.new_example_chat_prompt : undefined,
    params: {
      temperature: num(j.temperature),
      topP: num(j.top_p),
      maxTokens: num(j.openai_max_tokens),
      contextSize: num(j.openai_max_context),
      presencePenalty: num(j.presence_penalty),
      frequencyPenalty: num(j.frequency_penalty)
    },
    source: { fileName, importedAt: Date.now(), ignored: [] }
  }
  const ext: AnyObj = j.extensions && typeof j.extensions === 'object' ? j.extensions : {}
  const rx = Array.isArray(ext.regex_scripts) ? ext.regex_scripts.filter((r: AnyObj) => r && typeof r.findRegex === 'string').map((r: AnyObj) => normalizeRegexScript(r)) : []
  if (rx.length) preset.regexScripts = rx

  const enabled = order.filter((o) => o.enabled)
  const custom = prompts.filter((p) => !p.marker && !['main', 'nsfw', 'jailbreak', 'enhanceDefinitions'].includes(p.identifier))
  items.push({ level: 'ok', title: '提示词顺序', detail: `共 ${order.length} 段，启用 ${enabled.length} 段（${enabled.map((o) => BLOCK_LABEL[o.identifier] ?? prompts.find((p) => p.identifier === o.identifier)?.name ?? o.identifier).join(' → ')}）` })
  if (custom.length) {
    const depth = custom.filter((p) => p.injection === 'depth').length
    items.push({ level: 'ok', title: '自定义提示词', detail: `${custom.length} 段${depth ? `，其中 ${depth} 段按深度插入聊天记录` : ''}` })
  }
  const fm = [preset.formats?.wi && '世界书', preset.formats?.scenario && '场景', preset.formats?.personality && '性格'].filter(Boolean)
  if (fm.length) items.push({ level: 'ok', title: '格式模板', detail: fm.join('、') })
  const extras = [preset.continueNudge && '续写提示', preset.impersonate && '代写提示', preset.newChat && '新对话提示', preset.newExampleChat && '示例对话提示'].filter(Boolean)
  if (extras.length) items.push({ level: 'ok', title: '其它提示', detail: extras.join('、') })
  const enabledIds = new Set(enabled.map((o) => o.identifier))
  const trig = prompts.filter((p) => p.triggers?.length && enabledIds.has(p.identifier))
  if (trig.length) items.push({ level: 'ok', title: '按生成方式发送', detail: `${trig.length} 段只在特定生成方式下发送（如只在正常回复、重写时），药汤会照做。` })
  const forbid = prompts.filter((p) => p.forbidOverrides && ['main', 'jailbreak'].includes(p.identifier))
  if (forbid.length) items.push({ level: 'ok', title: '禁止被角色卡覆盖', detail: `${forbid.map((p) => BLOCK_LABEL[p.identifier] ?? p.name).join('、')}不会被角色卡自带的系统提示词 / 历史后指令替换。` })
  if (rx.length) {
    const script = rx.filter(needsScript)
    const beauty = rx.filter((r) => r.ytKind === 'beautify' && r.markdownOnly && !script.includes(r))
    const both = rx.filter((r) => r.promptOnly && r.markdownOnly && !beauty.includes(r))
    const promptOnly = rx.filter((r) => r.promptOnly && !r.markdownOnly)
    const showOnly = rx.filter((r) => r.markdownOnly && !r.promptOnly && !beauty.includes(r) && !script.includes(r))
    const rewrite = rx.filter((r) => !r.promptOnly && !r.markdownOnly)
    const off = rx.filter((r) => r.disabled)
    const parts = [
      beauty.length && `界面美化 ${beauty.length} 条（只在显示方式为「卡片原样式」的角色里生效）`,
      script.length && `依赖脚本的前端界面 ${script.length} 条（药汤不运行脚本，这几条不使用，被它们替换的内容按原文显示）`,
      showOnly.length && `只改显示 ${showOnly.length} 条`,
      promptOnly.length && `只改发给 AI 的内容 ${promptOnly.length} 条（如不发送旧的状态栏、思维链）`,
      both.length && `显示和发送时都隐藏某些内容 ${both.length} 条`,
      rewrite.length && `直接改写回复原文 ${rewrite.length} 条`,
      off.length && `其中 ${off.length} 条在预设里原本就是关闭的`
    ].filter(Boolean)
    items.push({ level: 'ok', title: `预设自带正则 ${rx.length} 条`, detail: `启用这个预设时，对所有角色生效：${parts.join('；')}。可在预设面板里逐条开关。` })
  }
  const bulk = enabled.reduce((n, o) => {
    const p = prompts.find((x) => x.identifier === o.identifier)
    return n + (p && !p.marker ? estimateTokens(p.content) : 0)
  }, 0)
  if (bulk > 16000)
    items.push({
      level: 'warn',
      title: `启用的提示词很长（约 ${Math.round(bulk / 1000)}K tokens）`,
      detail: '每次回复都会先发送这些内容，再加上角色、世界书和聊天记录。如果超出模型的上下文上限，接口会报错；可以在预设面板里关掉用不到的段落，或在「设置 → 接口」里调大上下文。药汤会优先舍去较早的聊天记录来腾出位置。'
    })
  const ejs = prompts.filter((p) => hasEjs(p.content))
  if (ejs.length) {
    const on = ejs.filter((p) => enabledIds.has(p.identifier))
    items.push({
      level: 'warn',
      title: `${ejs.length} 段使用了 EJS 模板`,
      detail: `「${ejs.map((p) => p.name).slice(0, 8).join('」「')}」${ejs.length > 8 ? '等' : ''}含有 <% … %> 模板代码，需要 SillyTavern 的提示词模板扩展才能执行。药汤不运行这些代码，发送前会把它们去掉、只保留其中的普通文字；条件分支不会判断，各个分支的文字都会发出。${on.length ? `其中 ${on.length} 段处于开启状态，如效果不对可在预设面板里关掉。` : ''}`
    })
  }
  const th = ext.tavern_helper
  const scripts: AnyObj[] = Array.isArray(th?.scripts) ? th.scripts : []
  if (scripts.length) items.push({ level: 'skip', title: `酒馆助手脚本 ${scripts.length} 个`, detail: `「${scripts.map((x) => String(x.name ?? '未命名')).join('」「')}」是 JS 脚本（酒馆助手 / JS-Slash-Runner），药汤不运行脚本。依赖它们的功能（自动总结、按钮界面等）不会出现。` })
  const otherExt = Object.keys(ext).filter((k) => !['regex_scripts', 'tavern_helper'].includes(k))
  if (otherExt.length) items.push({ level: 'skip', title: '其它扩展的数据', detail: `${otherExt.join('、')}：属于 SillyTavern 扩展，药汤不使用。${otherExt.includes('SPreset') ? 'SPreset 里绑定的正则与预设自带正则相同，已经导入。' : ''}` })
  const params = Object.entries(preset.params ?? {}).filter(([, v]) => v !== undefined)
  if (params.length) items.push({ level: 'info', title: '采样参数', detail: '温度、Top P、回复上限、上下文等。可以选择是否同时应用到当前接口。' })
  items.push({ level: 'info', title: '角色卡的系统提示词与历史后指令', detail: '如果角色卡自带，仍会按「设置 → 对话与人设」里的开关替换预设的主提示词 / 历史后指令（与 ST 的「优先角色卡」一致）。' })
  const isSet = (v: unknown) => v !== undefined && v !== null && v !== '' && v !== false && v !== 'auto' && v !== 'Default (none)' && !(Array.isArray(v) && !v.length)
  const ignoredLabels = [...new Set(Object.keys(IGNORED).filter((k) => isSet(j[k]) && !(k === 'seed' && j[k] === -1) && !(k === 'n' && j[k] === 1)).map((k) => IGNORED[k]))]
  for (const [k, [label, def]] of Object.entries(EXTRA_SAMPLERS)) if (typeof j[k] === 'number' && j[k] !== def) ignoredLabels.push(`${label}（OpenAI 兼容接口不支持）`)
  if (ignoredLabels.length) {
    preset.source!.ignored = ignoredLabels
    items.push({ level: 'skip', title: '未使用的设置', detail: ignoredLabels.join('、') })
  }
  const report: ImportReport = { kind: 'preset', name, format: 'SillyTavern 对话补全预设', items }
  return { preset, report }
}
