/** 兼容性细节：宏、世界书装饰器、换行、前端代码块 */
import { describe, it, expect } from 'vitest'
import { substituteMacros } from '@shared/macros'
import { scanWorldInfo } from '@shared/wiEngine'
import { blankEntry } from '@shared/worldbook'
import { applyRegexScripts, normalizeRegexScript } from '@shared/regex'
import { fixGluedFences, unwrapHtmlFences } from '../src/renderer/src/render/frontend'

const ctx = (over = {}) => ({ user: '旅人', char: '薇拉', vars: { a: '1' }, globalVars: {}, now: new Date(2026, 9, 29, 14, 5, 9), firstMes: '开场白', maxPrompt: 64000, ...over })

describe('宏', () => {
  it('变量是否存在、首条消息、上下文、群聊宏', () => {
    expect(substituteMacros('{{hasvar::a}}/{{hasvar::b}}', ctx())).toBe('true/false')
    expect(substituteMacros('{{charFirstMessage}}|{{maxPrompt}}|{{group}}|{{lastGenerationType}}', ctx())).toBe('开场白|64000|薇拉|normal')
  })
  it('日期格式与时区', () => {
    expect(substituteMacros('{{datetimeformat YYYY-MM-DD HH:mm:ss}}', ctx())).toBe('2026-10-29 14:05:09')
    expect(substituteMacros('{{datetimeformat [第]D[天] dddd}}', ctx())).toBe('第29天 星期四')
    expect(substituteMacros('{{time_UTC+8}}', ctx())).toMatch(/^\d{2}:\d{2}$/)
  })
})

describe('世界书装饰器', () => {
  it('@@activate 总是触发，@@dont_activate 不触发，装饰器行不发送', () => {
    const a = { ...blankEntry(1), keys: ['不会出现的词'], content: '@@activate\n总在', bookId: 'b' }
    const b = { ...blankEntry(2), keys: ['苹果'], content: '@@dont_activate\n不该出现', bookId: 'b' }
    const r = scanWorldInfo({
      entries: [a, b] as any,
      chat: ['我想吃苹果'],
      scanDepth: 4,
      budgetTokens: 10000,
      recursive: false,
      maxRecursion: 0,
      messageCount: 1,
      sources: { personaDescription: '', characterDescription: '', characterPersonality: '', characterDepthPrompt: '', scenario: '', creatorNotes: '' }
    } as any)
    const contents = r.activated.map((x) => x.entry.content)
    expect(contents).toEqual(['总在'])
  })
})

describe('换行与前端代码块', () => {
  it('CRLF 文本也能被按 \\n 写的正则匹配', () => {
    const rx = normalizeRegexScript({ scriptName: 't', findRegex: '/甲：(.*?)\\n乙：(.*)/', replaceString: '[$1|$2]', placement: [2], markdownOnly: true })
    expect(applyRegexScripts('甲：一\r\n乙：二', [rx], { placement: 2, isMarkdown: true, depth: 0, macros: (s) => s })).toBe('[一|二]')
  })
  it('结束围栏后紧跟正文时拆成两行', () => {
    const s = '```html\n<div>a</div>\n```<tag>b</tag>'
    expect(fixGluedFences(s)).toBe('```html\n<div>a</div>\n```\n<tag>b</tag>')
  })
  it('```html 整页拆开显示，普通代码块保留', () => {
    const page = '前文\n```html\n<!DOCTYPE html>\n<html><body><div style="color:red">正文</div></body></html>\n```\n后文'
    expect(unwrapHtmlFences(page)).not.toContain('```')
    expect(unwrapHtmlFences(page)).toContain('<div style="color:red">正文</div>')
    const code = '```js\nconst a = "<div>"\n```'
    expect(unwrapHtmlFences(code)).toBe(code)
    const md = '```markdown\n【状态】\n体力: 85\n```'
    expect(unwrapHtmlFences(md)).toBe(md)
  })
})

import { buildPrompt } from '@shared/prompt'
import { defaultSettings, defaultProfile } from '@shared/defaults'
describe('前情提要', () => {
  const ch: any = { id: 'c', name: '薇拉', avatar: null, description: 'DESC', personality: '', scenario: '', firstMes: '', alternateGreetings: [], mesExample: '', systemPrompt: '', postHistoryInstructions: '', creatorNotes: '', tags: [], creator: '', characterVersion: '', depthPrompt: null, book: null, regexScripts: [], linkedBookIds: [], source: { format: 'custom' }, display: { styleMode: 'yaotang' }, createdAt: 0, updatedAt: 0 }
  const msgs = Array.from({ length: 40 }, (_, i) => ({ id: String(i), role: i % 2 ? 'user' : 'assistant', swipes: [{ text: `第${i}条：` + '很长的剧情描写。'.repeat(60), createdAt: 0 }], swipeIndex: 0, createdAt: 0 })) as any[]
  const chat: any = { id: 'x', characterId: 'c', title: '', createdAt: 0, updatedAt: 0, vars: {}, messages: msgs, summary: { text: 'RECAP-MARK：薇拉与旅人在药铺相识。', covered: 30, updatedAt: 0 } }
  it('较早的对话放不下时带上前情提要，放在聊天记录前面', () => {
    const r = buildPrompt({ character: ch, chat, history: msgs, chatSettings: defaultSettings().chat, profile: { ...defaultProfile(), contextSize: 8000, maxTokens: 1000 } })
    expect(r.trimmedHistory).toBeGreaterThan(0)
    expect(r.recapUsed).toBe(true)
    const iRecap = r.messages.findIndex((m) => m.content.includes('RECAP-MARK'))
    const iHist = r.messages.findIndex((m) => m.content.startsWith('第'))
    expect(iRecap).toBeGreaterThanOrEqual(0)
    expect(iRecap).toBeLessThan(iHist)
  })
  it('全部放得下时不发送前情提要', () => {
    const r = buildPrompt({ character: ch, chat, history: msgs, chatSettings: defaultSettings().chat, profile: { ...defaultProfile(), contextSize: 200000 } })
    expect(r.trimmedHistory).toBe(0)
    expect(r.recapUsed).toBe(false)
    expect(r.messages.some((m) => m.content.includes('RECAP-MARK'))).toBe(false)
  })
})
