/**
 * 世界书激活引擎（行为参照 SillyTavern world-info.js 的 checkWorldInfo）。
 */
import type { WorldEntry, WIRole } from './types'
import { estimateTokens } from './tokens'

export interface WIEntryRef extends WorldEntry {
  bookId: string
  bookName: string
}

export interface WIScanInput {
  entries: WIEntryRef[]
  /** 已格式化的聊天消息，最早在前、最新在后 */
  chat: string[]
  scanDepth: number
  budgetTokens: number
  recursive: boolean
  maxRecursion: number
  caseSensitive?: boolean
  matchWholeWords?: boolean
  sources: {
    personaDescription: string
    characterDescription: string
    characterPersonality: string
    characterDepthPrompt: string
    scenario: string
    creatorNotes: string
  }
  /** 对话当前消息数（用于 delay / sticky / cooldown） */
  messageCount: number
  timed?: Record<string, { stickyEnd?: number; cooldownEnd?: number }>
  /** 关键词宏替换 */
  macros?: (s: string) => string
  random?: () => number
}

export type ActivationReason = 'constant' | 'key' | 'recursion' | 'sticky'

export interface WIActivated {
  entry: WIEntryRef
  reason: ActivationReason
  matchedKey?: string
  tokens: number
}

export interface WIScanResult {
  activated: WIActivated[]
  budgetOverflow: boolean
  timed: Record<string, { stickyEnd?: number; cooldownEnd?: number }>
}

const keyOf = (e: WIEntryRef) => `${e.bookId}:${e.uid}`

function parseKeyRegex(key: string): RegExp | null {
  const m = key.match(/^\/([\s\S]+?)\/([gimsuy]*)$/)
  if (!m) return null
  try {
    return new RegExp(m[1], m[2])
  } catch {
    return null
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function matchKey(haystack: string, needle: string, caseSensitive: boolean, wholeWords: boolean): boolean {
  if (!needle) return false
  const re = parseKeyRegex(needle)
  if (re) {
    re.lastIndex = 0
    return re.test(haystack)
  }
  const h = caseSensitive ? haystack : haystack.toLowerCase()
  const n = caseSensitive ? needle : needle.toLowerCase()
  if (wholeWords) {
    const words = n.split(/\s+/)
    if (words.length > 1) return h.includes(n)
    return new RegExp(`(?:^|\\W)(${escapeRegex(n)})(?:$|\\W)`).test(h)
  }
  return h.includes(n)
}

/**
 * SillyTavern 的条目装饰器：写在内容最前面的 @@activate（总是触发）、@@dont_activate（不按关键词触发）。
 * 装饰器那几行本身不发给 AI。
 */
function applyDecorators<T extends { content: string; constant: boolean }>(e: T): T | null {
  if (!e.content || !/^\s*@@/.test(e.content)) return e
  const lines = e.content.split('\n')
  let i = 0
  let activate = false
  let dont = false
  while (i < lines.length && /^\s*@@[a-z_]+/i.test(lines[i])) {
    const d = lines[i].trim().toLowerCase()
    if (d.startsWith('@@activate')) activate = true
    else if (d.startsWith('@@dont_activate')) dont = true
    i++
  }
  if (dont) return null
  const content = lines.slice(i).join('\n')
  return { ...e, content, constant: e.constant || activate }
}

export function scanWorldInfo(input: WIScanInput): WIScanResult {
  const rnd = input.random ?? Math.random
  const macros = input.macros ?? ((s: string) => s)
  const timedIn = input.timed ?? {}
  const timed: Record<string, { stickyEnd?: number; cooldownEnd?: number }> = JSON.parse(JSON.stringify(timedIn))
  const mc = input.messageCount

  // 按 order 从高到低（高 order 优先占用预算）
  const sorted = input.entries
    .map(applyDecorators)
    .filter((e): e is NonNullable<typeof e> => !!e && e.enabled && (e.content || '').trim() !== '')
    .sort((a, b) => b.order - a.order || a.uid - b.uid)

  const reversed = [...input.chat].reverse() // 最新在前
  const chatText = (depth: number) => reversed.slice(0, Math.max(0, depth)).join('\n\u0001')

  const activated = new Map<string, WIActivated>()
  const failedProb = new Set<string>()
  const recursionBuffer: string[] = []
  let budgetOverflow = false
  let usedTokens = 0
  let loop = 0
  let recursionState = false

  const isSticky = (e: WIEntryRef) => {
    const t = timed[keyOf(e)]
    return !!(t?.stickyEnd && t.stickyEnd > mc)
  }
  const onCooldown = (e: WIEntryRef) => {
    const t = timed[keyOf(e)]
    return !!(t?.cooldownEnd && t.cooldownEnd > mc)
  }

  // 已过期的 sticky 转入 cooldown
  for (const e of sorted) {
    const t = timed[keyOf(e)]
    if (t?.stickyEnd && t.stickyEnd <= mc) {
      if (e.cooldown > 0 && !t.cooldownEnd) t.cooldownEnd = t.stickyEnd + e.cooldown
      delete t.stickyEnd
    }
  }

  while (true) {
    loop++
    const fresh: WIActivated[] = []
    for (const e of sorted) {
      const k = keyOf(e)
      if (activated.has(k) || failedProb.has(k)) continue
      const sticky = isSticky(e)
      if (e.delay > 0 && mc < e.delay && !sticky) continue
      if (onCooldown(e) && !sticky) continue
      if (!recursionState && e.delayUntilRecursion && !sticky) continue
      if (recursionState && typeof e.delayUntilRecursion === 'number' && e.delayUntilRecursion > loop - 1 && !sticky) continue
      if (recursionState && e.excludeRecursion && !sticky) continue

      if (sticky) {
        fresh.push({ entry: e, reason: 'sticky', tokens: 0 })
        continue
      }
      if (e.constant) {
        fresh.push({ entry: e, reason: 'constant', tokens: 0 })
        continue
      }
      if (!e.keys.length) continue

      let text = chatText(e.scanDepth ?? input.scanDepth)
      if (recursionState && recursionBuffer.length) text += '\n\u0001' + recursionBuffer.join('\n\u0001')
      const src = input.sources
      if (e.matchPersonaDescription) text += '\n\u0001' + src.personaDescription
      if (e.matchCharacterDescription) text += '\n\u0001' + src.characterDescription
      if (e.matchCharacterPersonality) text += '\n\u0001' + src.characterPersonality
      if (e.matchCharacterDepthPrompt) text += '\n\u0001' + src.characterDepthPrompt
      if (e.matchScenario) text += '\n\u0001' + src.scenario
      if (e.matchCreatorNotes) text += '\n\u0001' + src.creatorNotes
      if (!text.trim()) continue

      const cs = e.caseSensitive ?? input.caseSensitive ?? false
      const ww = e.matchWholeWords ?? input.matchWholeWords ?? false
      let primary: string | undefined
      for (const raw of e.keys) {
        const key = macros(raw).trim()
        if (key && matchKey(text, key, cs, ww)) {
          primary = key
          break
        }
      }
      if (!primary) continue

      const hasSecondary = e.selective && e.secondaryKeys.length > 0
      if (hasSecondary) {
        let any = false
        let all = true
        let pass = false
        for (const raw of e.secondaryKeys) {
          const key = macros(raw).trim()
          const hit = !!key && matchKey(text, key, cs, ww)
          if (hit) any = true
          else all = false
          if (e.selectiveLogic === 0 && hit) {
            pass = true
            break
          }
          if (e.selectiveLogic === 1 && !hit) {
            pass = true
            break
          }
        }
        if (e.selectiveLogic === 2 && !any) pass = true
        if (e.selectiveLogic === 3 && all) pass = true
        if (!pass) continue
      }
      fresh.push({ entry: e, reason: recursionState ? 'recursion' : 'key', matchedKey: primary, tokens: 0 })
    }

    // 分组：同组只留一条
    const winners = filterGroups(fresh, [...activated.values()], rnd)

    // 概率
    const passed: WIActivated[] = []
    for (const a of winners) {
      const e = a.entry
      if (a.reason !== 'sticky' && e.useProbability && e.probability < 100) {
        if (rnd() * 100 > e.probability) {
          failedProb.add(keyOf(e))
          continue
        }
      }
      passed.push(a)
    }

    // 预算
    const added: WIActivated[] = []
    for (const a of passed) {
      const t = estimateTokens(a.entry.content) + 1
      const ignore = !!(a.entry.extra?.ignoreBudget || a.entry.extra?.ignore_budget)
      if (!ignore && usedTokens + t > input.budgetTokens) {
        budgetOverflow = true
        break
      }
      if (!ignore) usedTokens += t
      a.tokens = t
      activated.set(keyOf(a.entry), a)
      added.push(a)
    }

    if (budgetOverflow) break
    const recursable = added.filter((a) => !a.entry.preventRecursion)
    if (!input.recursive || !recursable.length || loop > input.maxRecursion) break
    for (const a of recursable) recursionBuffer.push(a.entry.content)
    recursionState = true
  }

  // 更新时效状态
  for (const a of activated.values()) {
    const e = a.entry
    const k = keyOf(e)
    if (a.reason !== 'sticky') {
      if (e.sticky > 0) timed[k] = { ...(timed[k] ?? {}), stickyEnd: mc + e.sticky }
      else if (e.cooldown > 0) timed[k] = { ...(timed[k] ?? {}), cooldownEnd: mc + e.cooldown }
    }
  }
  for (const k of Object.keys(timed)) {
    const t = timed[k]
    if (t.cooldownEnd && t.cooldownEnd <= mc) delete t.cooldownEnd
    if (!t.stickyEnd && !t.cooldownEnd) delete timed[k]
  }

  return { activated: [...activated.values()], budgetOverflow, timed }
}

function filterGroups(fresh: WIActivated[], already: WIActivated[], rnd: () => number): WIActivated[] {
  const groupsOf = (e: WIEntryRef) =>
    e.group
      .split(/,\s*/)
      .map((g) => g.trim())
      .filter(Boolean)
  const byGroup = new Map<string, WIActivated[]>()
  for (const a of fresh) {
    if (a.reason === 'sticky') continue
    for (const g of groupsOf(a.entry)) {
      if (!byGroup.has(g)) byGroup.set(g, [])
      byGroup.get(g)!.push(a)
    }
  }
  if (!byGroup.size) return fresh
  const removed = new Set<WIActivated>()
  for (const [g, list] of byGroup) {
    if (already.some((x) => groupsOf(x.entry).includes(g))) {
      list.forEach((x) => removed.add(x))
      continue
    }
    const live = list.filter((x) => !removed.has(x))
    if (live.length <= 1) continue
    const prios = live.filter((x) => x.entry.groupOverride).sort((a, b) => b.entry.order - a.entry.order)
    let winner: WIActivated
    if (prios.length) winner = prios[0]
    else {
      const total = live.reduce((s, x) => s + Math.max(0, x.entry.groupWeight), 0)
      let r = rnd() * total
      winner = live[live.length - 1]
      for (const x of live) {
        r -= Math.max(0, x.entry.groupWeight)
        if (r <= 0) {
          winner = x
          break
        }
      }
    }
    for (const x of live) if (x !== winner) removed.add(x)
  }
  return fresh.filter((x) => !removed.has(x))
}

export interface WIPlaced {
  before: string[]
  after: string[]
  anTop: string[]
  anBottom: string[]
  emTop: string[]
  emBottom: string[]
  depth: { depth: number; role: WIRole; contents: string[] }[]
  outlets: Record<string, string[]>
}

/** 把激活的条目按位置分组；同一位置内 order 小的在前（与 ST 一致） */
export function placeWorldInfo(activated: WIActivated[], transform: (content: string, e: WIEntryRef) => string): WIPlaced {
  const out: WIPlaced = { before: [], after: [], anTop: [], anBottom: [], emTop: [], emBottom: [], depth: [], outlets: {} }
  const list = [...activated].sort((a, b) => b.entry.order - a.entry.order || b.entry.uid - a.entry.uid)
  for (const a of list) {
    const e = a.entry
    const c = transform(e.content, e)
    if (!c.trim()) continue
    switch (e.position) {
      case 0:
        out.before.unshift(c)
        break
      case 1:
        out.after.unshift(c)
        break
      case 2:
        out.anTop.unshift(c)
        break
      case 3:
        out.anBottom.unshift(c)
        break
      case 5:
        out.emTop.unshift(c)
        break
      case 6:
        out.emBottom.unshift(c)
        break
      case 4: {
        const d = out.depth.find((x) => x.depth === e.depth && x.role === e.role)
        if (d) d.contents.unshift(c)
        else out.depth.push({ depth: e.depth, role: e.role, contents: [c] })
        break
      }
      case 7: {
        const name = e.outletName || 'default'
        ;(out.outlets[name] ??= []).unshift(c)
        break
      }
    }
  }
  return out
}
