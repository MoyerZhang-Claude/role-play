import { describe, it, expect } from 'vitest'
import { parsePreset, looksLikePreset } from '@shared/preset'
import { buildPrompt } from '@shared/prompt'
import { defaultSettings, defaultProfile } from '@shared/defaults'
import type { Character, Chat } from '@shared/types'
import { blankEntry } from '@shared/worldbook'

const ST_PRESET = {
  temperature: 0.8,
  top_p: 0.95,
  openai_max_context: 32000,
  openai_max_tokens: 1500,
  wi_format: '<lore>\n{0}\n</lore>',
  scenario_format: '[场景：{{scenario}}]',
  personality_format: '[{{char}}的性格：{{personality}}]',
  impersonation_prompt: '[IMP {{user}}]',
  continue_nudge_prompt: '[CONT]',
  new_chat_prompt: '[Start a new Chat]',
  assistant_prefill: 'abc',
  prompts: [
    { identifier: 'main', name: 'Main Prompt', system_prompt: true, role: 'system', content: 'MAIN for {{char}}' },
    { identifier: 'nsfw', name: 'Auxiliary Prompt', system_prompt: true, role: 'system', content: 'AUX' },
    { identifier: 'jailbreak', name: 'Post-History Instructions', system_prompt: true, role: 'system', content: 'PHI' },
    { identifier: 'chatHistory', name: 'Chat History', system_prompt: true, marker: true },
    { identifier: 'worldInfoBefore', name: 'World Info (before)', system_prompt: true, marker: true },
    { identifier: 'charDescription', name: 'Char Description', system_prompt: true, marker: true },
    { identifier: 'scenario', name: 'Scenario', system_prompt: true, marker: true },
    { identifier: 'abc-1', name: '文风', role: 'system', content: 'STYLE RULES', injection_position: 0 },
    { identifier: 'abc-2', name: '深度提醒', role: 'user', content: 'DEPTH NOTE', injection_position: 1, injection_depth: 1 },
    { identifier: 'abc-3', name: '关掉的', role: 'system', content: 'DISABLED' }
  ],
  prompt_order: [
    { character_id: 100000, order: [{ identifier: 'main', enabled: false }] },
    {
      character_id: 100001,
      order: [
        { identifier: 'main', enabled: true },
        { identifier: 'abc-1', enabled: true },
        { identifier: 'worldInfoBefore', enabled: true },
        { identifier: 'charDescription', enabled: true },
        { identifier: 'scenario', enabled: true },
        { identifier: 'nsfw', enabled: false },
        { identifier: 'chatHistory', enabled: true },
        { identifier: 'abc-2', enabled: true },
        { identifier: 'abc-3', enabled: false },
        { identifier: 'jailbreak', enabled: true }
      ]
    }
  ]
}

function ch(): Character {
  const e = { ...blankEntry(0), constant: true, content: 'LORE-A', position: 0 as const }
  return {
    id: 'c', name: '薇拉', avatar: null, description: 'DESC', personality: '', scenario: '药铺', firstMes: '', alternateGreetings: [], mesExample: '',
    systemPrompt: '', postHistoryInstructions: '', creatorNotes: '', tags: [], creator: '', characterVersion: '', depthPrompt: null,
    book: { id: 'b', name: 'b', entries: [e] }, regexScripts: [], linkedBookIds: [], source: { format: 'custom' }, display: { styleMode: 'yaotang' }, createdAt: 0, updatedAt: 0
  }
}
const chat = (): Chat => ({
  id: 'x', characterId: 'c', title: '', createdAt: 0, updatedAt: 0, vars: {},
  messages: [
    { id: '1', role: 'assistant', swipes: [{ text: '欢迎', createdAt: 0 }], swipeIndex: 0, createdAt: 0 },
    { id: '2', role: 'user', swipes: [{ text: '你好', createdAt: 0 }], swipeIndex: 0, createdAt: 0 }
  ]
})

describe('SillyTavern 预设', () => {
  it('识别与解析', () => {
    expect(looksLikePreset(ST_PRESET)).toBe(true)
    expect(looksLikePreset({ name: 'x', first_mes: 'hi' })).toBe(false)
    const { preset, report } = parsePreset(ST_PRESET, 'p.json')
    expect(preset.order[0]).toEqual({ identifier: 'main', enabled: true })
    expect(preset.prompts.find((p) => p.identifier === 'abc-2')!.injection).toBe('depth')
    expect(preset.params!.temperature).toBe(0.8)
    expect(report.items.some((i) => i.level === 'skip')).toBe(true)
  })
  it('按预设组装', () => {
    const { preset } = parsePreset(ST_PRESET, 'p.json')
    const s = defaultSettings()
    s.chat.persona.name = '阿明'
    const c = chat()
    const r = buildPrompt({ character: ch(), chat: c, history: c.messages, chatSettings: s.chat, profile: defaultProfile(), preset })
    const all = r.messages.map((m) => `${m.role}:${m.content}`).join('\n---\n')
    // 顺序：主提示词 → 文风 → 世界书 → 描述 → 场景
    const iMain = all.indexOf('MAIN for 薇拉')
    const iStyle = all.indexOf('STYLE RULES')
    const iLore = all.indexOf('<lore>\nLORE-A\n</lore>')
    const iDesc = all.indexOf('DESC')
    const iScen = all.indexOf('[场景：药铺]')
    expect(iMain).toBeGreaterThanOrEqual(0)
    expect(iMain < iStyle && iStyle < iLore && iLore < iDesc && iDesc < iScen).toBe(true)
    expect(all).not.toContain('AUX')
    expect(all).not.toContain('DISABLED')
    expect(all).toContain('[Start a new Chat]')
    // 深度 1 的用户提示插在最后一条消息之前；历史后指令在最后
    const users = r.messages.filter((m) => m.role === 'user').map((m) => m.content)
    expect(users).toEqual(['DEPTH NOTE', '你好'])
    expect(r.messages[r.messages.length - 1].content).toBe('PHI')
    expect(r.impersonatePrompt).toBe('[IMP {{user}}]')
    expect(r.continueNudge).toBe('[CONT]')
  })
})
