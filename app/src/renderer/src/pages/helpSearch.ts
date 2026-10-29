/**
 * 帮助手札的搜索：只按「名字」找——章节名、词条名、问题、要点标题，以及为它们准备的别名。
 * 正文不参与主搜索，免得搜一个常见词就冒出一大片；只有名字一个都对不上时，
 * 才在少量正文里找，最多给 3 条，并标明「在正文中」。
 */

export type HelpKind = '章节' | '词条' | '问答' | '要点' | '边界' | '正文'

export interface HelpEntry {
  /** 对应页面上元素的标识（ch:xxx / term:xxx / q:xxx ……） */
  sid: string
  kind: Exclude<HelpKind, '正文'>
  title: string
  /** 所在章节的名字（显示用） */
  chapter: string
  /** 一行摘要 */
  snippet: string
  /** 别名与同义词（含英文、酒馆里的叫法、口语说法） */
  keywords: string[]
  /** 正文（只在后备搜索里用） */
  body?: string
}

export interface HelpHit {
  entry: HelpEntry
  kind: HelpKind
  score: number
  /** 后备搜索里命中的那一小段正文 */
  excerpt?: string
}

const KIND_WEIGHT: Record<HelpEntry['kind'], number> = { 词条: 6, 问答: 4, 章节: 3, 要点: 2, 边界: 1 }

/** 统一大小写，去掉空白和常见标点 */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s「」『』“”"'‘’（）()【】[\]{}<>《》：:，,。.？?！!、·…—\-_/]+/g, '')
}

const isCjk = (s: string) => /[㐀-鿿]/.test(s)

function bigrams(s: string): string[] {
  const a = Array.from(s)
  const out: string[] = []
  for (let i = 0; i < a.length - 1; i++) out.push(a[i] + a[i + 1])
  return out
}

function scoreOne(e: HelpEntry, q: string): number {
  const t = norm(e.title)
  const kws = e.keywords.map(norm).filter(Boolean)
  // 只有一个字：只认完全相同的名字或别名，免得「书」把一半内容都带出来
  const short = q.length < 2 || (!isCjk(q) && q.length < 3)
  let s = 0
  if (t === q) s = 100
  else if (!short && t.startsWith(q)) s = 86
  else if (!short && t.includes(q)) s = 72
  for (const k of kws) {
    if (k === q) s = Math.max(s, 80)
    else if (!short && k.startsWith(q)) s = Math.max(s, 58)
    else if (!short && k.includes(q)) s = Math.max(s, 48)
    // 问句里带着别名：比如「世界书没有生效怎么办」
    else if (k.length >= 2 && q.length > k.length && q.includes(k)) s = Math.max(s, 42 + Math.min(12, k.length * 3))
  }
  // 长句里含着一个短标题：标题占句子的比例越小，越不像是在找它
  if (!short && t.length >= 2 && q.length > t.length && q.includes(t)) s = Math.max(s, 40 + Math.round((20 * t.length) / q.length))
  // 一整句问话：按相邻两个字的重合程度找相近的标题（「世界书没有生效怎么办」→「世界书条目没有生效？」）
  if (q.length >= 4 && t.length >= 4) {
    const tb = bigrams(t)
    const qb = new Set(bigrams(q))
    const hit = tb.filter((b) => qb.has(b)).length
    const ratio = hit / tb.length
    if (hit >= 3 && ratio >= 0.4) s = Math.max(s, 30 + hit * 6 + ratio * 20)
  }
  return s ? s + KIND_WEIGHT[e.kind] : 0
}

export interface HelpSearchResult {
  hits: HelpHit[]
  /** 一共匹配到多少处（可能比显示的多） */
  total: number
  /** 是否来自正文后备搜索 */
  fallback: boolean
  /** 输入太短 */
  tooShort: boolean
}

export const MAX_HITS = 6
const MAX_FALLBACK = 3

export function searchHelp(index: HelpEntry[], raw: string): HelpSearchResult {
  const parts = raw.split(/\s+/).map(norm).filter(Boolean)
  if (!parts.length) return { hits: [], total: 0, fallback: false, tooShort: false }
  const scored: HelpHit[] = []
  for (const e of index) {
    let sum = 0
    let ok = true
    for (const p of parts) {
      const s = scoreOne(e, p)
      if (!s) {
        ok = false
        break
      }
      sum += s
    }
    if (ok) scored.push({ entry: e, kind: e.kind, score: sum / parts.length })
  }
  scored.sort((a, b) => b.score - a.score || a.entry.title.length - b.entry.title.length)
  // 同一个位置只留一条
  const seen = new Set<string>()
  const uniq = scored.filter((h) => (seen.has(h.entry.sid) ? false : (seen.add(h.entry.sid), true)))
  const one = parts.join('')
  const tooShort = one.length < 2 && isCjk(one)
  if (uniq.length || tooShort) return { hits: uniq.slice(0, MAX_HITS), total: uniq.length, fallback: false, tooShort }

  // 后备：名字一个都没对上，才去少量正文里找
  const fb: HelpHit[] = []
  for (const e of index) {
    if (!e.body) continue
    const b = e.body
    const nb = b.toLowerCase()
    const at = nb.indexOf(raw.trim().toLowerCase())
    if (at < 0) continue
    const from = Math.max(0, at - 14)
    fb.push({ entry: e, kind: '正文', score: 1, excerpt: (from > 0 ? '…' : '') + b.slice(from, at + raw.trim().length + 22) + '…' })
  }
  return { hits: fb.slice(0, MAX_FALLBACK), total: fb.length, fallback: true, tooShort: false }
}
