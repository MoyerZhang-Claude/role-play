/**
 * 导出 PNG 角色卡（SillyTavern 兼容：同时写入 V2 的 chara 与 V3 的 ccv3）。
 * 以原始卡片数据为底，覆盖药汤里修改过的字段，避免丢失其它软件的扩展字段。
 */
import type { Character, RegexScript, Worldbook } from './types'
import { makeChunk, isPng } from './png'

type AnyObj = Record<string, any>

function bookToCard(book: Worldbook): AnyObj {
  return {
    name: book.name,
    ...(book.description ? { description: book.description } : {}),
    ...(book.scanDepth != null ? { scan_depth: book.scanDepth } : {}),
    ...(book.tokenBudget != null ? { token_budget: book.tokenBudget } : {}),
    ...(book.recursiveScanning != null ? { recursive_scanning: book.recursiveScanning } : {}),
    extensions: {},
    entries: book.entries.map((e, i) => ({
      id: e.uid,
      keys: e.keys,
      secondary_keys: e.secondaryKeys,
      comment: e.comment,
      content: e.content,
      constant: e.constant,
      selective: e.selective,
      insertion_order: e.order,
      enabled: e.enabled,
      position: e.position === 1 ? 'after_char' : 'before_char',
      use_regex: true,
      extensions: {
        position: e.position,
        exclude_recursion: e.excludeRecursion,
        display_index: i,
        probability: e.probability,
        useProbability: e.useProbability,
        depth: e.depth,
        selectiveLogic: e.selectiveLogic,
        group: e.group,
        group_override: e.groupOverride,
        group_weight: e.groupWeight,
        prevent_recursion: e.preventRecursion,
        delay_until_recursion: e.delayUntilRecursion,
        scan_depth: e.scanDepth,
        match_whole_words: e.matchWholeWords,
        use_group_scoring: e.useGroupScoring,
        case_sensitive: e.caseSensitive,
        automation_id: (e.extra?.automationId ?? e.extra?.automation_id ?? '') as string,
        role: e.role,
        vectorized: e.vectorized,
        sticky: e.sticky,
        cooldown: e.cooldown,
        delay: e.delay,
        match_persona_description: e.matchPersonaDescription,
        match_character_description: e.matchCharacterDescription,
        match_character_personality: e.matchCharacterPersonality,
        match_character_depth_prompt: e.matchCharacterDepthPrompt,
        match_scenario: e.matchScenario,
        match_creator_notes: e.matchCreatorNotes,
        ...(e.outletName ? { outlet_name: e.outletName } : {})
      }
    }))
  }
}

/** 药汤为显示效果自动关掉的正则，导出时按原卡的状态写回 */
function wasAutoDisabled(r: RegexScript, raw: AnyObj | undefined): boolean {
  if (r.ytAutoDisabled != null) return r.ytAutoDisabled && r.disabled
  if (!(r.ytKind === 'beautify' && r.markdownOnly && r.disabled)) return false
  const orig = (raw?.data?.extensions?.regex_scripts as AnyObj[] | undefined)?.find((x) => x?.id === r.id)
  return !!orig && !orig.disabled
}

function regexToST(r: RegexScript, raw?: AnyObj): AnyObj {
  return {
    id: r.id,
    scriptName: r.scriptName,
    findRegex: r.findRegex,
    replaceString: r.replaceString,
    trimStrings: r.trimStrings,
    placement: r.placement,
    disabled: wasAutoDisabled(r, raw) ? false : r.disabled,
    markdownOnly: r.markdownOnly,
    promptOnly: r.promptOnly,
    runOnEdit: r.runOnEdit,
    substituteRegex: r.substituteRegex,
    minDepth: r.minDepth,
    maxDepth: r.maxDepth
  }
}

/** 角色 → 卡片 data 对象 */
export function characterToCardData(ch: Character): AnyObj {
  const raw = ch.raw as AnyObj | undefined
  const base: AnyObj = raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object' ? structuredClone(raw.data) : {}
  const ext: AnyObj = { ...(base.extensions ?? {}) }
  if (ch.depthPrompt) ext.depth_prompt = { prompt: ch.depthPrompt.prompt, depth: ch.depthPrompt.depth, role: ch.depthPrompt.role }
  else delete ext.depth_prompt
  if (ch.regexScripts.length) ext.regex_scripts = ch.regexScripts.map((r) => regexToST(r, raw))
  else delete ext.regex_scripts
  if (ch.book) ext.world = ch.book.name
  const data: AnyObj = {
    ...base,
    name: ch.name,
    description: ch.description,
    personality: ch.personality,
    scenario: ch.scenario,
    first_mes: ch.firstMes,
    mes_example: ch.mesExample,
    creator_notes: ch.creatorNotes,
    system_prompt: ch.systemPrompt,
    post_history_instructions: ch.postHistoryInstructions,
    alternate_greetings: ch.alternateGreetings,
    tags: ch.tags,
    creator: ch.creator,
    character_version: ch.characterVersion,
    extensions: ext
  }
  if (ch.book) data.character_book = bookToCard(ch.book)
  else delete data.character_book
  return data
}

export function characterToCards(ch: Character): { v2: AnyObj; v3: AnyObj } {
  const data = characterToCardData(ch)
  const top = { name: ch.name, description: ch.description, personality: ch.personality, scenario: ch.scenario, first_mes: ch.firstMes, mes_example: ch.mesExample, creatorcomment: ch.creatorNotes, tags: ch.tags }
  const v2 = { ...top, spec: 'chara_card_v2', spec_version: '2.0', data: { ...data } }
  const v3data = { ...data }
  if (!('group_only_greetings' in v3data)) v3data.group_only_greetings = []
  const v3 = { ...top, spec: 'chara_card_v3', spec_version: '3.0', data: v3data }
  return { v2, v3 }
}

function b64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'latin1').toString('base64')
}

function textChunk(key: string, value: string): Uint8Array {
  const k = new TextEncoder().encode(key)
  const v = new TextEncoder().encode(value) // base64 只含 ASCII
  const body = new Uint8Array(k.length + 1 + v.length)
  body.set(k, 0)
  body[k.length] = 0
  body.set(v, k.length + 1)
  return makeChunk('tEXt', body)
}

/** 把卡片数据写进 PNG（移除旧的 chara / ccv3） */
export function embedCardInPng(png: Uint8Array, ch: Character): Uint8Array {
  if (!isPng(png)) throw new Error('头像不是 PNG')
  const { v2, v3 } = characterToCards(ch)
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const latin1 = new TextDecoder('latin1')
  const parts: Uint8Array[] = [png.subarray(0, 8)]
  let i = 8
  while (i + 8 <= png.length) {
    const len = view.getUint32(i)
    const type = latin1.decode(png.subarray(i + 4, i + 8))
    const whole = png.subarray(i, i + 12 + len)
    if (type === 'IEND') {
      parts.push(textChunk('chara', b64(JSON.stringify(v2))))
      parts.push(textChunk('ccv3', b64(JSON.stringify(v3))))
      parts.push(whole)
      break
    }
    if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
      const body = png.subarray(i + 8, i + 8 + len)
      const z = body.indexOf(0)
      const key = latin1.decode(body.subarray(0, z < 0 ? 0 : z)).toLowerCase()
      if (key === 'chara' || key === 'ccv3') {
        i += 12 + len
        continue
      }
    }
    parts.push(whole)
    i += 12 + len
  }
  const total = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
