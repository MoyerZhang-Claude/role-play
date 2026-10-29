/** 群聊：谁来接话、提示词里的群聊部分 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { pickSpeakers, mentionAt } from '@shared/group'
import { buildPrompt } from '@shared/prompt'
import { defaultSettings, defaultProfile } from '@shared/defaults'
import type { Character, Chat, Group } from '@shared/types'

const mk = (id: string, name: string, talk?: number): Character =>
  ({
    id, name, avatar: null, description: `${name}的描述`, personality: `${name}的性格`, scenario: `${name}自己的场景`, firstMes: '', alternateGreetings: [], mesExample: '',
    systemPrompt: '', postHistoryInstructions: '', creatorNotes: '', tags: [], creator: '', characterVersion: '', depthPrompt: null, book: null, regexScripts: [], linkedBookIds: [],
    source: { format: 'custom' }, display: { styleMode: 'yaotang' }, createdAt: 0, updatedAt: 0,
    raw: talk == null ? undefined : { data: { extensions: { talkativeness: talk } } }
  }) as Character
const A = mk('a', '沈墨', 0.2)
const B = mk('b', '柳三弦', 0.9)
const C = mk('c', '阿豆', 0.6)
const G = (over: Partial<Group> = {}): Group => ({ id: 'g', name: '听雨楼', memberIds: ['a', 'b', 'c'], mutedIds: [], strategy: 'natural', allowSelfReply: false, scenario: '', talk: {}, createdAt: 0, updatedAt: 0, ...over })

describe('谁来接话', () => {
  it('点到名的先说，按出现顺序；去掉姓也认', () => {
    expect(pickSpeakers(G(), [A, B, C], { text: '阿豆，去给三弦先生添茶', trigger: 'user' })).toEqual(['c', 'b'])
    expect(mentionAt('三弦先生', '柳三弦')).toBe(0)
  })
  it('没人被点名时看活跃度；谁都没开口就挑一位', () => {
    expect(pickSpeakers(G(), [A, B, C], { text: '今晚雨真大', trigger: 'user' }, () => 0.5)).toEqual(['b', 'c'])
    const one = pickSpeakers(G(), [A, B, C], { text: '嗯', trigger: 'user' }, () => 0.99)
    expect(one.length).toBe(1)
  })
  it('轮流：每人一段；点名模式：不自动接', () => {
    expect(pickSpeakers(G({ strategy: 'list' }), [A, B, C], { text: '大家好', trigger: 'user' })).toEqual(['a', 'b', 'c'])
    expect(pickSpeakers(G({ strategy: 'manual' }), [A, B, C], { text: '阿豆', trigger: 'user' })).toEqual([])
    expect(pickSpeakers(G({ strategy: 'list' }), [A, B, C], { lastSpeakerId: 'b', trigger: 'auto' })).toEqual(['c'])
  })
  it('静默的成员不说话；默认不连着说两段', () => {
    expect(pickSpeakers(G({ mutedIds: ['c'] }), [A, B, C], { text: '阿豆在吗', trigger: 'user' }, () => 0.99)).not.toContain('c')
    for (let i = 0; i < 20; i++) expect(pickSpeakers(G(), [A, B, C], { lastSpeakerId: 'b', trigger: 'auto' })).not.toContain('b')
  })
})

describe('群聊的提示词', () => {
  const chat: Chat = {
    id: 'x', characterId: 'g', groupId: 'g', title: '', createdAt: 0, updatedAt: 0, vars: {},
    messages: [
      { id: '1', role: 'assistant', speakerId: 'a', swipes: [{ text: '客官里面请。', createdAt: 0 }], swipeIndex: 0, createdAt: 0 },
      { id: '2', role: 'user', swipes: [{ text: '有热茶吗？', createdAt: 0 }], swipeIndex: 0, createdAt: 0 },
      { id: '3', role: 'assistant', speakerId: 'b', swipes: [{ text: '热茶管够！', createdAt: 0 }], swipeIndex: 0, createdAt: 0 }
    ]
  }
  const build = (scenario = '') =>
    buildPrompt({ character: C, chat, history: chat.messages, chatSettings: defaultSettings().chat, profile: defaultProfile(), group: { name: '听雨楼', members: [A, B, C], scenario } })
  it('聊天记录带说话人的名字，介绍其他成员，最后提醒只以发言者说话', () => {
    const r = build()
    const all = r.messages.map((m) => m.content).join('\n')
    expect(all).toContain('沈墨：客官里面请。')
    expect(all).toContain('旅人：有热茶吗？')
    expect(all).toContain('柳三弦：热茶管够！')
    expect(all).toContain('其他成员')
    expect(all).toContain('柳三弦的性格')
    expect(r.messages[r.messages.length - 1].content).toContain('轮到阿豆发言')
  })
  it('群聊场景代替角色自己的场景', () => {
    const all = build('雨夜的茶馆').messages.map((m) => m.content).join('\n')
    expect(all).toContain('雨夜的茶馆')
    expect(all).not.toContain('阿豆自己的场景')
  })
})

// 示例群聊卡放在素材库里，不随源码分发；没有这个文件时跳过
const SAMPLE = path.resolve(__dirname, '../../素材库/群聊示例/听雨楼（群聊卡）.json')

describe('群聊卡示例', () => {
  it.skipIf(!fs.existsSync(SAMPLE))('素材库里的「听雨楼」能解析出三位成员和世界书', async () => {
    const { cardFromJson } = await import('@shared/card')
    const j = JSON.parse(fs.readFileSync(SAMPLE, 'utf-8'))
    expect(j.spec).toBe('yaotang_group_v1')
    const cs = j.members.map((m: { card: unknown }) => cardFromJson(m.card as never, 'x')!.character)
    expect(cs.map((c: Character) => c.name)).toEqual(['沈墨', '柳三弦', '阿豆'])
    expect(cs[0].book?.entries.length).toBe(5)
    expect(talkOfRaw(cs[1])).toBe(0.8)
  })
})

function talkOfRaw(c: Character) {
  return (c.raw as { data?: { extensions?: { talkativeness?: number } } } | undefined)?.data?.extensions?.talkativeness
}

describe('截掉替别人写的台词', () => {
  it('从换人的那一行截住；开头的名字不截（除非是续写）', async () => {
    const { cutAtOthers } = await import('@shared/group')
    const t = '*他添了热水。*\n\n「龙井。」\n\n柳三弦：*折扇一合。*「我来说！」\n\n阿豆：「我也要！」'
    expect(cutAtOthers(t, ['柳三弦', '阿豆', '旅人'])).toEqual({ text: '*他添了热水。*\n\n「龙井。」', cut: true })
    expect(cutAtOthers('「好。」\n**阿豆**：「来了！」', ['阿豆']).text).toBe('「好。」')
    expect(cutAtOthers('「好。」\n旅人: 那就这样。', ['阿豆', '旅人']).text).toBe('「好。」')
    expect(cutAtOthers('阿豆：「来了！」', ['阿豆']).cut).toBe(false)
    expect(cutAtOthers('阿豆：「来了！」', ['阿豆'], true)).toEqual({ text: '', cut: true })
    expect(cutAtOthers('他看着阿豆：这孩子。', ['阿豆']).cut).toBe(false)
  })
})

describe('姓 + 称呼也算点名', () => {
  it('柳先生、沈掌柜、老柳都认；阿姨不算点到阿豆', () => {
    expect(mentionAt('柳先生，码头的事你听说过吗', '柳三弦')).toBe(0)
    expect(mentionAt('那就麻烦沈掌柜了', '沈墨')).toBe(4)
    expect(mentionAt('老柳又喝多了', '柳三弦')).toBe(0)
    expect(mentionAt('隔壁阿姨来过', '阿豆')).toBe(-1)
    expect(mentionAt('今晚雨真大', '沈墨')).toBe(-1)
    expect(pickSpeakers(G(), [A, B, C], { text: '阿豆，去后厨看看。柳先生，码头那伙人你听说过吗？', trigger: 'user' })).toEqual(['c', 'b'])
  })
})
