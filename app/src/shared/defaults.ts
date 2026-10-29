import type { ApiProfile, Settings } from './types'
import { DEFAULT_MAIN_PROMPT, DEFAULT_POST_HISTORY } from './prompt'

export function defaultProfile(): ApiProfile {
  return {
    id: 'deepseek',
    name: 'DeepSeek',
    provider: 'openai',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    temperature: 1.0,
    topP: 1,
    maxTokens: 4096,
    contextSize: 64000,
    presencePenalty: 0,
    frequencyPenalty: 0,
    thinking: 'off',
    extraBody: ''
  }
}

export function defaultSettings(): Settings {
  return {
    version: 1,
    appearance: {
      themeId: 'parchment',
      fontSize: 17,
      lineHeight: 1.9,
      chatWidth: 780,
      bodyFont: 'wenkai',
      paragraphIndent: false,
      quoteHighlight: true,
      reduceMotion: false,
      ambient: true
    },
    sound: { sfxEnabled: true, sfxVolume: 0.7, musicEnabled: true, musicVolume: 0.5 },
    opening: { enabled: true },
    api: { activeProfileId: 'deepseek', profiles: [defaultProfile()] },
    chat: {
      persona: { name: '', description: '' },
      mainPrompt: DEFAULT_MAIN_PROMPT,
      postHistoryPrompt: DEFAULT_POST_HISTORY,
      useCardSystemPrompt: true,
      useCardPostHistory: true,
      wiScanDepth: 2,
      wiBudgetPercent: 25,
      autoSummary: true,
      recapLength: 1500,
      wiRecursive: true,
      wiMaxRecursion: 3,
      wiIncludeNames: true,
      showReasoning: true,
      smoothReveal: true,
      activePresetId: null,
      globalBookIds: []
    },
    home: { recentOrder: [], recentOrderAt: 0, recentHidden: {} },
    globalVars: {}
  }
}

/** 读取到的旧设置与默认值合并（新增字段自动补齐） */
export function mergeSettings(raw: unknown): Settings {
  const d = defaultSettings()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Partial<Settings>
  return {
    ...d,
    ...r,
    version: 1,
    appearance: { ...d.appearance, ...(r.appearance ?? {}) },
    sound: { ...d.sound, ...(r.sound ?? {}) },
    opening: { ...d.opening, ...(r.opening ?? {}) },
    api: {
      activeProfileId: r.api?.activeProfileId ?? d.api.activeProfileId,
      profiles: Array.isArray(r.api?.profiles) && r.api!.profiles.length ? r.api!.profiles.map((p) => ({ ...defaultProfile(), ...p })) : d.api.profiles
    },
    chat: { ...d.chat, ...(r.chat ?? {}), persona: { ...d.chat.persona, ...(r.chat?.persona ?? {}) } },
    home: { recentOrder: Array.isArray(r.home?.recentOrder) ? r.home!.recentOrder : [], recentOrderAt: Number(r.home?.recentOrderAt) || 0, recentHidden: { ...(r.home?.recentHidden ?? {}) } },
    globalVars: { ...(r.globalVars ?? {}) }
  }
}
