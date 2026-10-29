/**
 * 药汤核心数据结构。
 * 这里的类型不依赖 Electron / DOM，未来其它平台可以直接复用。
 */

export type ID = string

/* ───────────── 世界书 ───────────── */

/** 次要关键词逻辑：0 含任一 · 1 非全部 · 2 全不含 · 3 含全部（与 SillyTavern 一致） */
export type SelectiveLogic = 0 | 1 | 2 | 3

/**
 * 插入位置（与 SillyTavern 数值一致）
 * 0 角色定义前 · 1 角色定义后 · 2 作者备注前 · 3 作者备注后 · 4 按深度插入
 * 5 示例对话前 · 6 示例对话后 · 7 出口（{{outlet::名字}}）
 */
export type WIPosition = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

/** 0 system · 1 user · 2 assistant */
export type WIRole = 0 | 1 | 2

export interface WorldEntry {
  uid: number
  keys: string[]
  secondaryKeys: string[]
  selective: boolean
  selectiveLogic: SelectiveLogic
  constant: boolean
  enabled: boolean
  comment: string
  content: string
  order: number
  position: WIPosition
  depth: number
  role: WIRole
  probability: number
  useProbability: boolean
  group: string
  groupOverride: boolean
  groupWeight: number
  useGroupScoring: boolean | null
  scanDepth: number | null
  caseSensitive: boolean | null
  matchWholeWords: boolean | null
  excludeRecursion: boolean
  preventRecursion: boolean
  delayUntilRecursion: boolean | number
  sticky: number
  cooldown: number
  delay: number
  vectorized: boolean
  outletName: string
  matchPersonaDescription: boolean
  matchCharacterDescription: boolean
  matchCharacterPersonality: boolean
  matchCharacterDepthPrompt: boolean
  matchScenario: boolean
  matchCreatorNotes: boolean
  /** 没有用到但需要原样保留的字段 */
  extra?: Record<string, unknown>
}

export interface Worldbook {
  id: ID
  name: string
  description?: string
  entries: WorldEntry[]
  /** 来自角色卡 character_book 的书级设置（可选） */
  scanDepth?: number
  tokenBudget?: number
  recursiveScanning?: boolean
  source?: {
    kind: 'card-embedded' | 'st-world' | 'v2-book' | 'custom'
    fileName?: string
    importedAt: number
  }
}

/* ───────────── 正则 ───────────── */

/** 作用范围：1 用户输入 · 2 AI 输出 · 3 快捷命令 · 5 世界书 · 6 思考内容 */
export type RegexPlacement = 1 | 2 | 3 | 5 | 6

export interface RegexScript {
  id: string
  scriptName: string
  findRegex: string
  replaceString: string
  trimStrings: string[]
  placement: number[]
  disabled: boolean
  markdownOnly: boolean
  promptOnly: boolean
  runOnEdit: boolean
  /** 0 不替换宏 · 1 原样替换 · 2 转义后替换 */
  substituteRegex: number
  minDepth: number | null
  maxDepth: number | null
  /** 药汤判定：beautify = 主要用于界面美化（输出带样式的整段 HTML） */
  ytKind?: 'normal' | 'beautify'
  /** 药汤给这条正则写的说明（导入时自动生成） */
  ytNote?: string
  /** 药汤为了显示效果自动关掉的（导出卡片时按原卡的开启状态写回） */
  ytAutoDisabled?: boolean
}

/* ───────────── 角色 ───────────── */

export type MsgRole = 'system' | 'user' | 'assistant'

export interface DepthPrompt {
  prompt: string
  depth: number
  role: MsgRole
}

export type ReportLevel = 'ok' | 'info' | 'warn' | 'skip'

export interface ReportItem {
  level: ReportLevel
  title: string
  detail?: string
}

export interface ImportReport {
  kind: 'character' | 'worldbook' | 'regex' | 'preset'
  name: string
  format: string
  items: ReportItem[]
  /** 致命问题：无法导入 */
  fatal?: string
}

export interface Character {
  id: ID
  name: string
  /** 头像文件名（相对角色目录），没有则为 null */
  avatar: string | null
  description: string
  personality: string
  scenario: string
  firstMes: string
  alternateGreetings: string[]
  mesExample: string
  systemPrompt: string
  postHistoryInstructions: string
  creatorNotes: string
  tags: string[]
  creator: string
  characterVersion: string
  depthPrompt: DepthPrompt | null
  /** 角色自带的世界书 */
  book: Worldbook | null
  /** 角色自带的正则 */
  regexScripts: RegexScript[]
  /** 额外绑定的独立世界书（第二阶段） */
  linkedBookIds: ID[]
  source: {
    format: 'custom' | 'v1' | 'v2' | 'v3'
    fileName?: string
    importedAt?: number
    report?: ImportReport
  }
  /** 原始卡片 JSON（导出时原样带回，避免丢字段） */
  raw?: unknown
  display: {
    /** yaotang = 药汤风格显示（默认）；isolated = 卡片自带样式隔离显示（第二阶段） */
    styleMode: 'yaotang' | 'isolated'
    /** 切到原样式时自动打开的美化正则，切回时再关上 */
    autoEnabled?: ID[]
  }
  favorite?: boolean
  createdAt: number
  updatedAt: number
  lastChatAt?: number
}

/* ───────────── 对话 ───────────── */

export interface TokenUsage {
  prompt?: number
  completion?: number
  reasoning?: number
  cached?: number
}

export interface Swipe {
  text: string
  reasoning?: string
  model?: string
  createdAt: number
  finish?: string
  usage?: TokenUsage
  error?: string
  /** 生成未完成（中途退出或停止） */
  partial?: boolean
}

export interface ChatMessage {
  id: ID
  role: MsgRole
  swipes: Swipe[]
  swipeIndex: number
  createdAt: number
  /** 开场白（可在备选开场白之间切换） */
  isGreeting?: boolean
  /** 群聊里写这一条的角色 */
  speakerId?: ID
}

export interface AuthorNote {
  text: string
  depth: number
  role: MsgRole
}

export interface Chat {
  id: ID
  characterId: ID
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
  authorNote?: AuthorNote
  /** {{setvar}} 等宏的局部变量 */
  vars: Record<string, string>
  /** 世界书时效状态（sticky / cooldown），键为 `${bookId}:${uid}` */
  wiTimed?: Record<string, { stickyEnd?: number; cooldownEnd?: number }>
  /**
   * 前情提要：较早的对话因上下文放不下而不再发送时，用它代替，免得 AI 忘掉前面的剧情。
   * covered = 概括了最前面多少条消息。
   */
  summary?: { text: string; covered: number; updatedAt: number; edited?: boolean }
  /** 群聊：所属的群（此时 characterId 也等于群 ID） */
  groupId?: ID
}

/* ───────────── 群聊 ───────────── */

/** 谁来接话：自然 = 被点名的先说，其余看活跃度；轮流 = 每人按顺序说一次；点名 = 只在你点名时说 */
export type GroupStrategy = 'natural' | 'list' | 'manual'

export interface Group {
  id: ID
  name: string
  /** 成员（角色 ID），顺序就是「轮流」的顺序 */
  memberIds: ID[]
  /** 暂时不让说话的成员 */
  mutedIds: ID[]
  strategy: GroupStrategy
  /** 允许同一位角色连着说两段 */
  allowSelfReply: boolean
  /** 群聊场景：不为空时代替每位角色自己的场景 */
  scenario: string
  /** 每位成员的活跃度（0–1）；不填用角色卡里的 talkativeness，默认 0.5 */
  talk: Record<ID, number>
  description?: string
  createdAt: number
  updatedAt: number
  lastChatAt?: number
}

export interface ChatSummary {
  id: ID
  /** 单人对话是角色 ID；群聊是群 ID */
  characterId: ID
  groupId?: ID
  title: string
  createdAt: number
  updatedAt: number
  count: number
  preview: string
}

/* ───────────── 接口配置 ───────────── */

export type ProviderKind = 'openai' | 'anthropic' | 'gemini'

export type ThinkingMode = 'default' | 'off' | 'low' | 'high' | 'max'

export interface ApiProfile {
  id: ID
  name: string
  provider: ProviderKind
  baseUrl: string
  model: string
  temperature: number
  topP: number
  maxTokens: number
  /** 上下文预算（token），超出会从最早的聊天记录开始裁剪 */
  contextSize: number
  presencePenalty: number
  frequencyPenalty: number
  thinking: ThinkingMode
  /** 附加请求参数（JSON 文本，合并进请求体） */
  extraBody: string
  /**
   * token 估算的校准系数：接口实际报告的提示 token ÷ 药汤的估算。
   * 不同模型的分词差别很大（同样的中文，DeepSeek 比 Gemini 省得多），按实际用量自动校准。
   */
  tokenRatio?: number
}

/* ───────────── 提示词预设（SillyTavern 对话补全预设） ───────────── */

export interface PresetPrompt {
  identifier: string
  name: string
  role: MsgRole
  content: string
  /** ST 的固定标记（世界书、角色描述、聊天记录等），内容由药汤填充 */
  marker: boolean
  /** relative = 按顺序放在这里；depth = 插在聊天记录的倒数第 N 条 */
  injection: 'relative' | 'depth'
  depth: number
  /** 只在这些生成方式下发送（normal / swipe / regenerate / continue / impersonate）；空 = 总是 */
  triggers?: string[]
  /** 禁止被角色卡的系统提示词 / 历史后指令覆盖 */
  forbidOverrides?: boolean
}

export interface PromptPreset {
  id: string
  name: string
  prompts: PresetPrompt[]
  order: { identifier: string; enabled: boolean }[]
  formats?: { wi?: string; scenario?: string; personality?: string }
  continueNudge?: string
  impersonate?: string
  /** 群聊里提醒「只以某位角色发言」的提示 */
  groupNudge?: string
  newChat?: string
  newExampleChat?: string
  params?: { temperature?: number; topP?: number; maxTokens?: number; contextSize?: number; presencePenalty?: number; frequencyPenalty?: number }
  /** 预设自带的正则（ST 1.13 起可以把正则绑在预设上） */
  regexScripts?: RegexScript[]
  source?: { fileName?: string; importedAt: number; ignored: string[] }
}

/* ───────────── 设置 ───────────── */

export interface Persona {
  name: string
  description: string
}

export interface Settings {
  version: 1
  appearance: {
    themeId: string
    fontSize: number
    lineHeight: number
    chatWidth: number
    bodyFont: 'wenkai' | 'notoserif' | 'system'
    paragraphIndent: boolean
    quoteHighlight: boolean
    reduceMotion: boolean
    ambient: boolean
  }
  sound: {
    sfxEnabled: boolean
    sfxVolume: number
    musicEnabled: boolean
    musicVolume: number
  }
  opening: {
    enabled: boolean
  }
  api: {
    activeProfileId: ID | null
    profiles: ApiProfile[]
  }
  chat: {
    persona: Persona
    mainPrompt: string
    postHistoryPrompt: string
    useCardSystemPrompt: boolean
    useCardPostHistory: boolean
    wiScanDepth: number
    /** 较早的对话放不下时，自动整理成前情提要 */
    autoSummary: boolean
    /** 前情提要的篇幅上限（字），越长保留的细节越多，也多占一些上下文 */
    recapLength?: number
    wiBudgetPercent: number
    wiRecursive: boolean
    wiMaxRecursion: number
    wiIncludeNames: boolean
    showReasoning: boolean
    smoothReveal: boolean
    /** 启用的 SillyTavern 预设（null = 药汤内置顺序） */
    activePresetId: string | null
    /** 对所有角色生效的全局世界书 */
    globalBookIds: string[]
  }
  window?: {
    bounds?: { x: number; y: number; width: number; height: number }
    maximized?: boolean
  }
  /** 书斋「续读」区：手动排序与已移出的卡片（值为移出时对话的更新时间，之后有新内容会重新出现） */
  home: {
    recentOrder: string[]
    /** 上次手动排序的时间：之后有新动静的对话排在最前 */
    recentOrderAt: number
    recentHidden: Record<string, number>
  }
  globalVars: Record<string, string>
}

/* ───────────── LLM 请求 ───────────── */

export interface LLMMessage {
  role: MsgRole
  content: string
}

export interface LLMRequest {
  requestId: string
  profile: ApiProfile
  messages: LLMMessage[]
}

export type LLMEvent =
  | { type: 'delta'; requestId: string; content?: string; reasoning?: string }
  | { type: 'done'; requestId: string; finish?: string; usage?: TokenUsage; model?: string }
  | { type: 'error'; requestId: string; message: string; status?: number }

/* ───────────── 存档 ───────────── */

export interface ArchiveManifest {
  format: 'yaotang-archive'
  version: 1
  app: string
  createdAt: number
  counts: { characters: number; chats: number; worldbooks: number }
  includesSettings: boolean
  includesSecrets: false
}

export interface ArchiveSummary {
  token: string
  manifest: ArchiveManifest
  characters: { id: string; name: string; chats: number; exists: boolean }[]
  worldbooks: number
  hasSettings: boolean
}

export interface ApplyOptions {
  mode: 'merge' | 'replace'
  /** 合并时遇到同一个角色 / 对话：覆盖或跳过 */
  conflict: 'overwrite' | 'skip'
  applySettings: boolean
}
