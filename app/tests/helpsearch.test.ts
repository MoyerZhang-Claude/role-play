import { describe, it, expect } from 'vitest'
import { searchHelp, type HelpEntry } from '../src/renderer/src/pages/helpSearch'

const E = (sid: string, kind: HelpEntry['kind'], title: string, keywords: string[] = [], body?: string): HelpEntry => ({ sid, kind, title, chapter: 'x', snippet: '', keywords, body })
const idx: HelpEntry[] = [
  E('ch:lore', '章节', '世界书', ['lorebook']),
  E('term:世界书', '词条', '世界书', ['lorebook', '设定集']),
  E('q:1', '问答', '世界书条目没有生效？', ['不生效']),
  E('term:书斋', '词条', '书斋'),
  E('term:历史后指令', '词条', '历史后指令', ['破限', 'jailbreak'], '放在聊天记录之后的要求'),
  E('mini:常驻', '要点', '常驻条目', [], '每次都发送'),
  ...Array.from({ length: 12 }, (_, i) => E(`p:${i}`, '要点', `世界书要点${i}`))
]

describe('帮助搜索', () => {
  it('名字完全相同的词条排第一，结果最多 6 条', () => {
    const r = searchHelp(idx, '世界书')
    expect(r.hits[0].entry.sid).toBe('term:世界书')
    expect(r.hits.length).toBe(6)
    expect(r.total).toBeGreaterThan(6)
  })
  it('别名也能找到', () => {
    expect(searchHelp(idx, '破限').hits[0].entry.sid).toBe('term:历史后指令')
    expect(searchHelp(idx, 'Lorebook').hits[0].entry.sid).toBe('term:世界书')
  })
  it('一个字只认完全相同的名字', () => {
    const r = searchHelp(idx, '书')
    expect(r.hits.length).toBe(0)
    expect(r.tooShort).toBe(true)
  })
  it('名字对不上时才去正文里找，最多 3 条', () => {
    const r = searchHelp(idx, '每次都发送')
    expect(r.fallback).toBe(true)
    expect(r.hits[0].entry.sid).toBe('mini:常驻')
    expect(r.hits.length).toBeLessThanOrEqual(3)
  })
  it('问句里带着关键词也能找到', () => {
    expect(searchHelp(idx, '世界书没有生效怎么办').hits[0].entry.sid).toBe('q:1')
  })
})
