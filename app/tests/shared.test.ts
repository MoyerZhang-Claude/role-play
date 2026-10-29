import { describe, it, expect } from 'vitest'
import { parseCardFile } from '@shared/card'
import { parseWorldbookJson, blankEntry, bookFromText } from '@shared/worldbook'
import { parseRegexJson, applyRegexScripts, regexFromString } from '@shared/regex'
import { substituteMacros } from '@shared/macros'
import { buildPrompt } from '@shared/prompt'
import { scanWorldInfo, matchKey } from '@shared/wiEngine'
import { defaultSettings, defaultProfile } from '@shared/defaults'
import { embedCardInPng, characterToCards } from '@shared/cardExport'
import { triggerMatches, stripEjs } from '@shared/presetRuntime'
import type { Character, Chat } from '@shared/types'

// All fixtures are constructed for this repository; no private card assets are used.
function character(): Character {
  const bytes = new TextEncoder().encode(JSON.stringify({
    spec: 'chara_card_v2', spec_version: '2.0', data: {
      name: 'Test Guide', description: 'A guide in a fictional library.',
      personality: 'patient', scenario: 'A quiet library', first_mes: 'Hello {{user}}',
      mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '',
      alternate_greetings: [], tags: [], creator: '', character_version: '1',
      character_book: { name: 'Library', entries: [{ id: 0, keys: ['library'], content: 'LIBRARY_LORE', enabled: true, constant: true, insertion_order: 100, position: 'before_char' }] },
      extensions: { regex_scripts: [{ id: 'beauty', scriptName: 'test panel', findRegex: 'PANEL', replaceString: '<style>.panel { color: white; }</style><div class="panel">Test</div>', placement: [2], markdownOnly: true, disabled: false }] }
    }
  }))
  const result = parseCardFile(bytes, 'fixture.json')
  if (!result || 'error' in result) throw new Error('Synthetic card failed to parse')
  return result.character
}
function chat(ch: Character, texts: string[]): Chat {
  return { id: 'test-chat', characterId: ch.id, title: 'Test', createdAt: 0, updatedAt: 0, vars: {},
    messages: texts.map((text, i) => ({ id: `m${i}`, role: i % 2 ? 'user' : 'assistant', swipes: [{text, createdAt: 0}], swipeIndex: 0, createdAt: 0 })) }
}

describe('Public synthetic fixtures', () => {
  it('parses a V2 card and its embedded worldbook', () => {
    const ch = character()
    expect(ch.name).toBe('Test Guide')
    expect(ch.book?.entries[0].content).toBe('LIBRARY_LORE')
    expect(ch.source.report).toBeTruthy()
  })
  it('disables style replacements for display, and restores author intent on export', () => {
    const ch = character()
    expect(ch.regexScripts[0].ytKind).toBe('beautify')
    expect(ch.regexScripts[0].disabled).toBe(true)
    expect(characterToCards(ch).v3.data.extensions.regex_scripts[0].disabled).toBe(false)
    ch.regexScripts[0].ytAutoDisabled = false
    expect(characterToCards(ch).v3.data.extensions.regex_scripts[0].disabled).toBe(true)
  })
  it('round trips a synthetic card through PNG metadata', () => {
    const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
    const ch = character()
    ch.name = 'Edited Guide'
    const result = parseCardFile(embedCardInPng(png, ch), 'export.png')
    if (!result || 'error' in result) throw new Error('PNG round trip failed')
    expect(result.character.name).toBe(ch.name)
    expect(result.character.firstMes).toBe(ch.firstMes)
    expect(result.character.book?.entries[0].content).toBe('LIBRARY_LORE')
    expect(result.character.source.format).toBe('v3')
  })
  it('parses independent worldbooks and plain text', () => {
    const wb = parseWorldbookJson({ entries: { '0': { uid: 0, key: ['library'], content: 'Lore', constant: true, order: 100 } } }, 'book.json')!
    expect(wb.entries[0].keys).toEqual(['library'])
    expect(wb.entries[0].constant).toBe(true)
    expect(bookFromText('Sample lore', 'lore.txt').entries[0].content).toBe('Sample lore')
  })
  it('keeps display-only regex out of sent prompts', () => {
    const rx = parseRegexJson([{ id: 'r', scriptName: 'color', findRegex: '/hello/g', replaceString: 'world', placement: [2], markdownOnly: true }])!
    expect(applyRegexScripts('hello', rx, { placement: 2, isMarkdown: true, depth: 0 })).toBe('world')
    expect(applyRegexScripts('hello', rx, { placement: 2, isPrompt: true, depth: 0 })).toBe('hello')
  })
  it('substitutes names and sequential variables', () => {
    const vars: Record<string,string> = {}
    expect(substituteMacros('{{user}} meets {{char}}', { user: 'Reader', char: 'Guide' })).toBe('Reader meets Guide')
    expect(substituteMacros('{{setvar::hp::10}}{{addvar::hp::5}}{{getvar::hp}}', { user: 'Reader', char: 'Guide', vars })).toBe('15')
  })
  it('matches keywords, case and whole words', () => {
    expect(matchKey('Hello World', 'world', false, false)).toBe(true)
    expect(matchKey('Hello World', 'world', true, false)).toBe(false)
    expect(matchKey('a dragonfly', 'dragon', false, true)).toBe(false)
    expect(matchKey('the dragon!', 'dragon', false, true)).toBe(true)
  })
  it('applies secondary keywords and group overrides', () => {
    const base = blankEntry(0)
    const mk = (uid: number, over: Partial<typeof base>) => ({ ...base, uid, keys: ['dragon'], constant: false, group: '', bookId: 'b', bookName: 'b', content: `c${uid}`, ...over })
    const result = scanWorldInfo({ entries: [
      mk(1, { selective: true, secondaryKeys: ['fire'], selectiveLogic: 0 }),
      mk(2, { selective: true, secondaryKeys: ['fire'], selectiveLogic: 2 }),
      mk(3, { group: 'g', order: 10 }), mk(4, { group: 'g', order: 20, groupOverride: true })
    ], chat: ['a dragon breathes fire'], scanDepth: 2, budgetTokens: 10000, recursive: false, maxRecursion: 0,
      sources: { personaDescription: '', characterDescription: '', characterPersonality: '', characterDepthPrompt: '', scenario: '', creatorNotes: '' }, messageCount: 1, random: () => 0 })
    expect(result.activated.map(a => a.entry.uid).sort()).toEqual([1,4])
  })
  it('includes lore and substitutes the user in the prompt', () => {
    const ch = character(), c = chat(ch, [ch.firstMes, 'Hello'])
    const settings = defaultSettings(); settings.chat.persona.name = 'Reader'
    const result = buildPrompt({ character: ch, chat: c, history: c.messages, chatSettings: settings.chat, profile: defaultProfile() })
    const all = result.messages.map(m => m.content).join('\n')
    expect(all).toContain('LIBRARY_LORE')
    expect(all).toContain('Reader')
    expect(all).not.toContain('{{user}}')
  })
  it('trims long history to the context budget', () => {
    const ch = character(), c = chat(ch, Array.from({length: 200}, () => 'Long conversation text. '.repeat(100)))
    const result = buildPrompt({ character: ch, chat: c, history: c.messages, chatSettings: defaultSettings().chat, profile: {...defaultProfile(), contextSize: 8000, maxTokens: 1000} })
    expect(result.trimmedHistory).toBeGreaterThan(0)
    expect(result.tokens).toBeLessThanOrEqual(8000)
  })
  it('handles generation triggers and strips EJS code without executing it', () => {
    expect(triggerMatches(['normal', 'swipe'], 'swipe')).toBe(true)
    expect(triggerMatches(['normal'], 'continue')).toBe(false)
    expect(stripEjs('a<% if (x) { %>B<% } %>c')).toBe('aBc')
  })
  it('rejects invalid regular expressions', () => {
    expect(regexFromString('/a+/g')!.flags).toBe('g')
    expect(regexFromString('/(/')).toBeNull()
  })
})
