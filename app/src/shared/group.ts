/**
 * 群聊里「谁来接话」的规则（纯函数，方便测试）。
 */
import type { Character, Group } from './types'

/** 活跃度：群里单独设置的优先，其次是角色卡里的 talkativeness，默认 0.5 */
export function talkOf(g: Group, ch: Character): number {
  const own = g.talk?.[ch.id]
  if (typeof own === 'number') return own
  const raw = Number((ch.raw as { data?: { extensions?: { talkativeness?: unknown } } } | undefined)?.data?.extensions?.talkativeness)
  return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.5
}

/** 姓后面常跟的称呼：「柳先生」「沈掌柜」「老柳」 */
const TITLES = '先生|掌柜|老板|老爷|大人|大哥|大姐|姑娘|小姐|公子|少爷|夫人|娘子|师傅|师父|兄|哥|姐|叔|伯|婶|姨|爷|奶奶|大夫|捕头|道长|将军'
const isCjk = (c: string) => /[㐀-鿿]/.test(c)

/**
 * 名字在一句话里出现的位置。
 * 除了全名，也认：三个字以上的名字去掉姓（「柳三弦」→「三弦」），以及中文名的「姓 + 称呼」（「柳先生」「沈掌柜」「老柳」）。
 */
export function mentionAt(text: string, name: string): number {
  const found: number[] = []
  const add = (i: number) => i >= 0 && found.push(i)
  add(text.indexOf(name))
  const chars = Array.from(name)
  if (chars.length >= 3) add(text.indexOf(chars.slice(1).join('')))
  if (chars.length >= 2 && chars.length <= 4 && chars.every(isCjk) && !'阿小老'.includes(chars[0])) {
    const s = chars[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = new RegExp(`${s}(?:${TITLES})|[老小]${s}`).exec(text)
    if (m) add(m.index)
  }
  return found.length ? Math.min(...found) : -1
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * AI 常会顺手把别人的台词也写了（「柳三弦：……」「**阿豆**：……」「旅人：……」）。
 * 从第一处换了说话人的行开始截掉，只留发言者自己的部分。
 * allowStart：续写时前面已有内容，开头就换人也要截。
 */
export function cutAtOthers(text: string, names: string[], allowStart = false): { text: string; cut: boolean } {
  const ns = [...new Set(names.filter((n) => n && n.trim()))].map(esc).sort((a, b) => b.length - a.length)
  if (!ns.length) return { text, cut: false }
  const re = new RegExp(`(^|\\n)[ \\t>*_【\\[（(]*(?:${ns.join('|')})[ \\t*_】\\]）)]*[:：]`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const at = m.index + m[1].length
    if (allowStart || text.slice(0, at).trim()) return { text: text.slice(0, at).replace(/\s+$/, ''), cut: true }
  }
  return { text, cut: false }
}

/**
 * 谁来接话。
 * - 自然：话里点到名的先说（按出现顺序）；没人被点名，就看各自的活跃度；谁都没开口，就按活跃度挑一位。
 * - 轮流：每位成员按顺序各说一段。
 * - 点名：你说话之后谁也不自动接，等你点名。
 * - 「接着聊」（trigger = auto）：不等你开口，接一两段；轮流模式下是顺序里的下一位。
 * 一轮最多三位，免得一次等太久。
 */
export function pickSpeakers(g: Group, members: Character[], o: { text?: string; lastSpeakerId?: string; trigger: 'user' | 'auto' }, rnd: () => number = Math.random): string[] {
  const live = members.filter((m) => !g.mutedIds.includes(m.id))
  if (!live.length) return []
  if (o.trigger === 'user' && g.strategy === 'manual') return []
  if (o.trigger === 'user' && g.strategy === 'list') return live.map((m) => m.id)
  if (o.trigger === 'auto' && g.strategy === 'list') {
    const i = live.findIndex((m) => m.id === o.lastSpeakerId)
    return [live[(i + 1) % live.length].id]
  }
  const notSelf = (m: Character) => g.allowSelfReply || m.id !== o.lastSpeakerId
  const out: string[] = []
  if (o.text) {
    live
      .map((m) => ({ m, at: mentionAt(o.text!, m.name) }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => a.at - b.at)
      .forEach((x) => out.push(x.m.id))
  }
  if (!out.length) for (const m of live) if (notSelf(m) && rnd() < talkOf(g, m)) out.push(m.id)
  if (!out.length) {
    const pool = live.filter(notSelf)
    const list = pool.length ? pool : live
    const w = (m: Character) => Math.max(0.05, talkOf(g, m))
    let r = rnd() * list.reduce((n, m) => n + w(m), 0)
    for (const m of list) {
      r -= w(m)
      if (r <= 0) {
        out.push(m.id)
        break
      }
    }
    if (!out.length) out.push(list[list.length - 1].id)
  }
  return out.slice(0, o.trigger === 'auto' ? 2 : 3)
}
