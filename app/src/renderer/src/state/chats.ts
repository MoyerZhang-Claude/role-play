import { create } from 'zustand'
import type { ApiProfile, Character, Chat, ChatMessage, ChatSummary, Group, LLMEvent, LLMMessage, Swipe, PromptPreset, Worldbook } from '@shared/types'
import { newId } from '@shared/id'
import { buildPrompt, swipeText, makeMacroContext, personaName, DEFAULT_CONTINUE_NUDGE, DEFAULT_IMPERSONATE, type BuildResult } from '@shared/prompt'
import { applyRegexScripts } from '@shared/regex'
import { effectiveScripts, presetScriptsFor } from '@shared/presetRuntime'
import { useGroups, membersOf } from './groups'
import { pickSpeakers, cutAtOthers } from '@shared/group'
import { usePresets } from './presets'
import { substituteMacros } from '@shared/macros'
import { estimateTokens } from '@shared/tokens'
import { yt, debounce } from '../lib/api'
import { useLibrary, loadLinkedBooks } from './library'
import { useSettings } from './settings'
import { toast } from './ui'
import { go } from './router'
import { audio } from '../audio/engine'

export type GenPhase = 'waiting' | 'thinking' | 'writing'

export interface GenState {
  requestId: string
  chatId: string
  messageId: string
  phase: GenPhase
  startedAt: number
  firstTokenAt?: number
}

interface ChatsState {
  index: Record<string, ChatSummary>
  indexLoaded: boolean
  active: Chat | null
  gen: GenState | null
  lastBuild: (BuildResult & { at: number; chatId?: string }) | null
  loadIndex(): Promise<void>
  forCharacter(charId: string): ChatSummary[]
  recent(n: number): ChatSummary[]
  createChat(ch: Character): Promise<Chat>
  /** 新建一卷群聊：每位成员的开场白依次排好 */
  createGroupChat(g: Group): Promise<Chat>
  /** 群聊：点名让某位成员接着说 */
  speakAs(memberId: string): Promise<void>
  /** 群聊：不等你开口，让他们自己接着聊一轮 */
  continueGroup(): Promise<void>
  openChat(charId: string, chatId: string): Promise<Chat | null>
  closeChat(): void
  renameChat(chatId: string, title: string): Promise<void>
  deleteChat(charId: string, chatId: string): Promise<void>
  send(text: string): Promise<void>
  regenerate(): Promise<void>
  swipe(messageId: string, dir: -1 | 1): Promise<void>
  editMessage(messageId: string, text: string): void
  deleteMessage(messageId: string): void
  stop(): void
  /** 续写最后一条回复 */
  continueLast(): Promise<void>
  /** 代写：AI 替你写下一句，写进输入框 */
  imp: { chatId: string; requestId: string; text: string; busy: boolean } | null
  impersonate(): Promise<void>
  stopImpersonate(): void
  clearImp(): void
  /** 从某条消息分出一卷新对话 */
  branchFrom(messageId: string): Promise<Chat | null>
  setAuthorNote(text: string, depth: number): void
  preview(): Promise<BuildResult | null>
  /** 正在整理前情提要的对话 */
  recapping: string | null
  /** 手动重新整理当前对话的前情提要 */
  rebuildRecap(): Promise<void>
  setRecap(text: string): void
  clearRecap(): void
}

const chatPath = (c: { characterId: string; id: string }) => `chats/${c.characterId}/${c.id}.json`

function summarize(c: Chat): ChatSummary {
  const last = [...c.messages].reverse().find((m) => swipeText(m).trim())
  const preview = last
    ? swipeText(last)
        .replace(/<[^>]+>/g, '')
        .replace(/[*_`#>]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 90)
    : ''
  return { id: c.id, characterId: c.characterId, groupId: c.groupId, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, count: c.messages.length, preview }
}

const fmtK = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}K` : n.toLocaleString())

/**
 * 固定内容（预设、角色、世界书、作者备注等）本身就超过了上下文：与 SillyTavern 一样不发送，
 * 并告诉用户是哪几段最大、可以怎么做。
 */
function overBudget(b: BuildResult) {
  const top = b.blocks
    .filter((x) => !x.label.startsWith('聊天记录'))
    .sort((a, z) => z.tokens - a.tokens)
    .slice(0, 3)
    .map((x) => `「${x.label}」约 ${fmtK(x.tokens)}`)
    .join('、')
  toast(
    'error',
    '提示词超出了上下文',
    `预设、角色、世界书等固定内容约 ${fmtK(b.budget.fixed)} tokens，超过了可用的 ${fmtK(b.budget.context - b.budget.reserve)}（上下文 ${fmtK(b.budget.context)} − 回复预留 ${fmtK(b.budget.reserve)}），所以没有发送。最大的几段：${top}。可以在预设面板关掉用不到的段落、调低世界书预算，或在「设置 → 接口」调大上下文。`,
    { label: '查看提示词', run: () => window.dispatchEvent(new Event('yt:open-inspector')) }
  )
}

/** 用接口报告的实际提示 token 数校准估算（不同模型的分词差别很大） */
function calibrate(profileId: string, msgs: { content: string }[], actual: number) {
  const raw = msgs.reduce((n, m) => n + estimateTokens(m.content) + 4, 0)
  if (raw < 400 || !(actual > 0)) return
  const r = Math.min(4, Math.max(0.25, actual / raw))
  useSettings.getState().update((d) => {
    const p = d.api.profiles.find((x) => x.id === profileId)
    if (!p) return
    const next = p.tokenRatio ? p.tokenRatio * 0.6 + r * 0.4 : r
    p.tokenRatio = Math.round(next * 1000) / 1000
  })
}

/** Gemini、Claude 一定要密钥；OpenAI 兼容的本地服务可以不填 */
async function keyReady(p: { id: string; provider: string; name: string }): Promise<boolean> {
  if (p.provider === 'openai') return true
  if (await yt.secrets.hint(p.id)) return true
  toast('warn', `接口「${p.name}」还没有保存密钥`, '到「设置 → 接口」填写密钥，点「保存」（或离开输入框）即可', { label: '去设置', run: () => go({ name: 'settings', tab: 'api' }) })
  return false
}

/** 发一个不显示在聊天里的请求，等它写完返回全文 */
function completeOnce(profile: ApiProfile, messages: LLMMessage[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const requestId = newId('rq')
    let text = ''
    const off = yt.llm.onEvent((ev: LLMEvent) => {
      if (ev.requestId !== requestId) return
      if (ev.type === 'delta') {
        if (ev.content) text += ev.content
        return
      }
      off()
      if (ev.type === 'done') resolve(text)
      else reject(new Error(ev.message))
    })
    yt.llm.start(requestId, profile, messages).catch((e) => {
      off()
      reject(e)
    })
  })
}

const recapSystem = (limit: number) => `你是这场角色扮演的书记官，负责把较早的剧情整理成「前情提要」，供之后继续写作时参考。
要求：
- 只根据给出的内容整理，不编造，不续写，不评价；
- 保留：主要人物、彼此的关系与称呼；已经发生的关键事件（按时间顺序）；做过的承诺与约定；埋下的伏笔与悬念；人物当前的处境、情绪、伤势与随身物品；地点与时间的变化；
- 省略：环境描写的细节、重复的对白、状态栏之类的格式内容；
- 用第三人称、简洁的中文条目书写，总长度不超过 ${limit} 字；篇幅宽裕时多保留细节（原话里的关键约定、名字、数字、物品）；
- 只输出前情提要正文，不要标题、不要解释。`

/** 把消息整理成书记官看得懂的纯文字 */
function transcript(msgs: ChatMessage[], userName: string, nameOf: (m: ChatMessage) => string): string {
  return msgs
    .map((m) => {
      const t = swipeText(m)
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      return t ? `【${m.role === 'user' ? userName : nameOf(m)}】${t.slice(0, 4000)}` : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

/* ───────── 群聊 ───────── */

const groupOf = (chat: Chat): Group | null => (chat.groupId ? useGroups.getState().get(chat.groupId) ?? null : null)

/** 这一条（或接下来要写的一条）由谁来说；单人对话就是那位角色 */
function speakerFor(chat: Chat, msg?: ChatMessage | null, wantId?: string): Character | undefined {
  const g = groupOf(chat)
  if (!g) return useLibrary.getState().get(chat.characterId)
  const members = membersOf(g)
  return members.find((m) => m.id === (msg?.speakerId ?? wantId)) ?? members[0]
}

function groupInput(chat: Chat) {
  const g = groupOf(chat)
  return g ? { name: g.name, members: membersOf(g), scenario: g.scenario, muted: g.mutedIds } : undefined
}

/** 群聊的世界书：发言者自己的，加上其他成员卡内的与绑定的（与 SillyTavern 一致） */
async function booksFor(chat: Chat, ch: Character): Promise<Worldbook[]> {
  const base = await loadLinkedBooks(ch)
  const g = groupOf(chat)
  if (!g) return base
  const out = [...base]
  const seen = new Set(out.map((b) => b.id))
  if (ch.book) seen.add(ch.book.id)
  for (const m of membersOf(g)) {
    if (m.id === ch.id) continue
    if (m.book && !seen.has(m.book.id)) {
      out.push(m.book)
      seen.add(m.book.id)
    }
    for (const b of await loadLinkedBooks(m)) {
      if (seen.has(b.id)) continue
      out.push(b)
      seen.add(b.id)
    }
  }
  return out
}

/** 模型有时会照着聊天记录的格式，在开头写上「名字：」，去掉它 */
function stripSpeaker(text: string, name: string): string {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`^\\s*(\\*\\*)?${esc}(\\*\\*)?\\s*[:：]\\s*`), '')
}

const lastSpeakerOf = (chat: Chat) => [...chat.messages].reverse().find((m) => m.role === 'assistant')?.speakerId

/** 群聊里一轮接一轮地说；停止时整轮都取消 */
let roundSeq = 0

/** 前情提要的篇幅上限（字），在「设置 → 对话与人设」里选 */
const recapLimit = () => {
  const v = Number(useSettings.getState().s.chat.recapLength)
  return Number.isFinite(v) && v >= 300 ? Math.min(8000, v) : 1500
}

/** 最近的几条始终原样发送，不并入前情提要 */
const RECAP_KEEP_RECENT = 6
/** 提前多整理几条，免得每一轮都要重新整理 */
const RECAP_AHEAD = 6

/** 当前启用的 SillyTavern 预设（没有则用内置顺序） */
function activePreset(): Promise<PromptPreset | null> {
  return usePresets.getState().load()
}
/** 这位角色此刻生效的正则：当前预设自带的 + 角色自己的 */
const scriptsOf = (ch: Character) => effectiveScripts(ch, usePresets.getState().active)

const writeIndex = debounce((idx: Record<string, ChatSummary>) => {
  yt.fs.writeJSON('chats/index.json', idx).catch(() => undefined)
}, 500)

const writeChat = debounce((c: Chat) => {
  yt.fs.writeJSON(chatPath(c), c).catch((e) => toast('error', '对话保存失败', String(e)))
}, 300)

/** 角色与当前设置下的宏函数 */
function macroFn(ch: Character, chat: Chat) {
  const st = useSettings.getState()
  const ctx = makeMacroContext(ch, chat, st.s.chat, st.activeProfile(), chat.messages, st.s.globalVars)
  return (t: string) => substituteMacros(t, ctx)
}

function newChatTitle(ch: Character, n: number) {
  const d = new Date()
  return `${ch.name} · 第${n}卷 · ${d.getMonth() + 1}月${d.getDate()}日`
}

export const useChats = create<ChatsState>((set, get) => {
  /** 修改当前对话并安排保存 */
  const mutate = (fn: (c: Chat) => void, opts: { save?: 'debounce' | 'now' | 'none' } = {}) => {
    const cur = get().active
    if (!cur) return
    const next: Chat = { ...cur, messages: [...cur.messages] }
    fn(next)
    next.updatedAt = Date.now()
    set({ active: next })
    const mode = opts.save ?? 'debounce'
    if (mode === 'now') writeChat.flush(next)
    else if (mode === 'debounce') writeChat(next)
    const idx = { ...get().index, [next.id]: summarize(next) }
    set({ index: idx })
    if (mode !== 'none') writeIndex(idx)
  }

  const replaceMsg = (c: Chat, id: string, fn: (m: ChatMessage) => ChatMessage) => {
    const i = c.messages.findIndex((m) => m.id === id)
    if (i >= 0) c.messages[i] = fn(c.messages[i])
  }

  /**
   * 前情提要：聊天记录开始被省略（或快要放不下）时，把最早的、还没整理过的消息交给书记官并入提要。
   * 在后台进行，不影响继续聊天；整理好之后，下一次发送就会带上。
   */
  const runRecap = async (chatId: string, upto: number, fresh: boolean) => {
    const st = useSettings.getState()
    const profile = st.activeProfile()
    const chat0 = get().active
    if (!profile || !chat0 || chat0.id !== chatId || get().recapping) return
    const g0 = groupOf(chat0)
    const ch = g0 ? null : useLibrary.getState().get(chat0.characterId)
    if (!g0 && !ch) return
    const members = g0 ? membersOf(g0) : []
    const nameOf = (m: ChatMessage) => (g0 ? members.find((x) => x.id === m.speakerId)?.name ?? g0.name : ch!.name)
    set({ recapping: chatId })
    try {
      let text = fresh ? '' : chat0.summary?.text ?? ''
      let covered = fresh ? 0 : chat0.summary?.covered ?? 0
      const userName = st.s.chat.persona.name.trim() || '旅人'
      // 一次最多交 2.4 万字，太长就分几轮并入
      while (covered < upto) {
        const msgs = get().active?.id === chatId ? get().active!.messages : chat0.messages
        let end = covered
        let size = 0
        while (end < upto && (end === covered || size < 24000)) {
          size += swipeText(msgs[end]).length
          end++
        }
        const body = `${text ? `【已有的前情提要】\n${text}\n\n` : ''}【需要并入的对话（第 ${covered + 1}–${end} 条）】\n${transcript(msgs.slice(covered, end), userName, nameOf)}\n\n请输出${text ? '合并后的完整' : ''}前情提要。`
        const limit = recapLimit()
        const out = await completeOnce({ ...profile, maxTokens: Math.max(2000, Math.round(limit * 1.6)), temperature: 0.3, thinking: 'off' }, [
          { role: 'system', content: recapSystem(limit) },
          { role: 'user', content: body }
        ])
        if (!out.trim()) throw new Error('接口没有返回内容')
        text = out.trim()
        covered = end
      }
      const summary = { text, covered, updatedAt: Date.now() }
      if (get().active?.id === chatId) mutate((c) => (c.summary = summary), { save: 'now' })
      else {
        const s0 = get().index[chatId]
        if (s0) {
          const path = chatPath({ characterId: s0.characterId, id: chatId })
          const c = await yt.fs.readJSON<Chat>(path)
          if (c) await yt.fs.writeJSON(path, { ...c, summary })
        }
      }
    } catch (e) {
      toast('warn', '前情提要没有整理成', String((e as Error)?.message ?? e).slice(0, 160))
    } finally {
      set({ recapping: null })
    }
  }

  const maybeRecap = async (chatId: string, b: BuildResult) => {
    if (useSettings.getState().s.chat.autoSummary === false) return
    const chat = get().active
    if (!chat || chat.id !== chatId) return
    const covered = chat.summary?.covered ?? 0
    const n = chat.messages.length
    const room = b.budget.context - b.budget.reserve
    const nearlyFull = b.budget.fixed + b.budget.history > room * 0.85
    if (!b.trimmedHistory && !nearlyFull) return
    // 已经整理好的部分领先「省略点」足够多，就先不整理
    if (covered - b.trimmedHistory >= RECAP_AHEAD) return
    // 整理到省略点之后再多一段（约三成正在发送的对话），保证消息被省略之前提要里就已经有它；最近几条始终原样发送
    const chunk = Math.max(RECAP_AHEAD, Math.round(b.includedHistory * 0.3))
    const upto = Math.min(n - RECAP_KEEP_RECENT, Math.max(b.trimmedHistory + chunk, covered + 2))
    if (upto - covered < 2) return
    await runRecap(chatId, upto, false)
  }

  /** 生成一条回复：kind=new 追加新消息；kind=swipe 给已有消息加一个新版本；kind=continue 接着已有消息往下写 */
  /** 返回 true 表示这一段正常写完（群聊据此决定要不要接着下一位） */
  const generate = async (target: { kind: 'new' } | { kind: 'swipe'; messageId: string } | { kind: 'continue'; messageId: string }, opts: { speakerId?: string } = {}): Promise<boolean> => {
    const chat = get().active
    if (!chat || get().gen) return false
    const isGroup = !!chat.groupId
    const ch = target.kind === 'new' ? speakerFor(chat, null, opts.speakerId) : speakerFor(chat, chat.messages.find((m) => m.id === target.messageId))
    const st = useSettings.getState()
    const profile = st.activeProfile()
    if (!ch) return false
    if (!profile || (profile.provider === 'openai' && !profile.baseUrl) || !profile.model) {
      toast('warn', '还没有配置 AI 接口', '请先到「设置 → 接口」填写地址、模型和密钥')
      return false
    }
    if (!(await keyReady(profile))) return false

    let history: ChatMessage[]
    let messageId: string
    let prefix = ''
    const blank: Swipe = { text: '', createdAt: Date.now(), partial: true }
    let place: (() => void) | null = null
    if (target.kind === 'continue') {
      const i = chat.messages.findIndex((m) => m.id === target.messageId)
      if (i < 0) return false
      history = chat.messages.slice(0, i + 1)
      messageId = target.messageId
      prefix = swipeText(chat.messages[i])
    } else if (target.kind === 'new') {
      history = chat.messages
      messageId = newId('m')
      place = () => mutate((c) => c.messages.push({ id: messageId, role: 'assistant', speakerId: isGroup ? ch.id : undefined, swipes: [blank], swipeIndex: 0, createdAt: Date.now() }), { save: 'none' })
    } else {
      const i = chat.messages.findIndex((m) => m.id === target.messageId)
      if (i < 0) return false
      history = chat.messages.slice(0, i)
      messageId = target.messageId
      place = () => mutate((c) => replaceMsg(c, messageId, (m) => ({ ...m, swipes: [...m.swipes, blank], swipeIndex: m.swipes.length })), { save: 'none' })
    }

    let build: BuildResult
    try {
      const extraBooks = await booksFor(chat, ch)
      build = buildPrompt({ character: ch, chat: get().active!, history, chatSettings: st.s.chat, profile, extraBooks, globalVars: st.s.globalVars, preset: await activePreset(), genType: target.kind === 'new' ? 'normal' : target.kind, group: groupInput(chat) })
      if (target.kind === 'continue') build.messages.push({ role: 'system', content: macroFn(ch, get().active!)(build.continueNudge || DEFAULT_CONTINUE_NUDGE) })
    } catch (e) {
      toast('error', '组装提示词失败', String(e))
      return false
    }
    set({ lastBuild: { ...build, at: Date.now(), chatId: chat.id } })
    if (build.budget.over) {
      overBudget(build)
      return false
    }
    place?.()
    mutate(
      (c) => {
        c.vars = build.vars
        c.wiTimed = build.wiTimed
      },
      { save: 'none' }
    )
    if (JSON.stringify(build.globalVars) !== JSON.stringify(st.s.globalVars)) st.update((d) => (d.globalVars = build.globalVars))

    const requestId = newId('rq')
    set({ gen: { requestId, chatId: chat.id, messageId, phase: 'waiting', startedAt: Date.now() } })

    let content = ''
    let reasoning = ''
    // 群聊：写到别人的台词就截住并停下（不算出错，这一轮照常往下走）
    const others = isGroup ? [...(groupInput(chat)?.members ?? []).filter((m) => m.id !== ch.id).map((m) => m.name), personaName(st.s.chat)] : []
    let cutOff = false
    let empty = false
    let flushTimer = 0
    let lastSave = Date.now()
    const flush = () => {
      flushTimer = 0
      mutate(
        (c) =>
          replaceMsg(c, messageId, (m) => {
            const sw = [...m.swipes]
            sw[m.swipeIndex] = { ...sw[m.swipeIndex], text: prefix + (isGroup && !prefix ? stripSpeaker(content, ch.name) : content), reasoning: reasoning || sw[m.swipeIndex].reasoning || undefined }
            return { ...m, swipes: sw }
          }),
        { save: 'none' }
      )
      if (Date.now() - lastSave > 1000) {
        lastSave = Date.now()
        writeChat.flush(get().active!)
      }
    }

    let resolveEnd: (ok: boolean) => void = () => undefined
    const ended = new Promise<boolean>((r) => (resolveEnd = r))
    const off = yt.llm.onEvent((ev: LLMEvent) => {
      if (ev.requestId !== requestId) return
      if (ev.type === 'delta') {
        if (cutOff) return
        if (ev.content) content += ev.content
        if (isGroup && ev.content) {
          const r = cutAtOthers(content, others, !!prefix)
          if (r.cut) {
            content = r.text
            cutOff = true
            yt.llm.abort(requestId)
          }
        }
        if (ev.reasoning) reasoning += ev.reasoning
        const g = get().gen
        if (g) {
          const phase: GenPhase = content ? 'writing' : 'thinking'
          if (g.phase !== phase || !g.firstTokenAt) set({ gen: { ...g, phase, firstTokenAt: g.firstTokenAt ?? Date.now() } })
        }
        if (!flushTimer) flushTimer = window.setTimeout(flush, 33)
        return
      }
      off()
      if (flushTimer) window.clearTimeout(flushTimer)
      const ch2 = useLibrary.getState().get(ch.id) ?? ch
      if (isGroup && !prefix) content = stripSpeaker(content, ch.name)
      const cur = get().active
      const macros = cur ? macroFn(ch2, cur) : (s: string) => s
      if (ev.type === 'done') {
        const aborted = ev.finish === 'aborted' && !cutOff
        if (aborted && !content.trim() && target.kind === 'continue') {
          // 续写还没写出字就停了：保持原样
        } else if (aborted && !content.trim()) {
          // 什么都没写出来就停止了：撤回这次生成
          mutate((c) => {
            const i = c.messages.findIndex((m) => m.id === messageId)
            if (i < 0) return
            const m = c.messages[i]
            if (m.swipes.length <= 1) c.messages.splice(i, 1)
            else {
              const sw = m.swipes.filter((_, k) => k !== m.swipeIndex)
              c.messages[i] = { ...m, swipes: sw, swipeIndex: sw.length - 1 }
            }
          }, { save: 'now' })
        } else {
          const finalText = prefix + applyRegexScripts(content, scriptsOf(ch2), { placement: 2, macros })
          const finalReason = reasoning ? applyRegexScripts(reasoning, scriptsOf(ch2), { placement: 6, macros }) : undefined
          // 什么也没写出来（Gemini 偶尔如此，或整段被正则隐藏）：标成出错，免得留下一个空白气泡；群聊这一轮也就此打住
          empty = !aborted && target.kind !== 'continue' && !finalText.trim()
          const blankNote = '回复是空白的：模型这次什么也没写，或者整段被正则隐藏了。可以点「重写」再试一次。'
          mutate(
            (c) =>
              replaceMsg(c, messageId, (m) => {
                const sw = [...m.swipes]
                sw[m.swipeIndex] = { ...sw[m.swipeIndex], text: finalText, reasoning: finalReason, partial: aborted || undefined, finish: cutOff ? 'stop' : ev.finish, usage: ev.usage, model: ev.model ?? profile.model, error: empty ? blankNote : undefined }
                return { ...m, swipes: sw }
              }),
            { save: 'now' }
          )
          if (ev.usage?.prompt) calibrate(profile.id, build.messages, ev.usage.prompt)
          if (empty) toast('warn', '这次回复是空白的', '可以点「重写」再试一次')
          else if (ev.finish === 'length') toast('info', '回复达到了长度上限', '可以在「设置 → 接口」调大「单次回复上限」')
        }
      } else if (ev.type === 'error') {
        mutate(
          (c) =>
            replaceMsg(c, messageId, (m) => {
              const sw = [...m.swipes]
              sw[m.swipeIndex] = { ...sw[m.swipeIndex], text: prefix + content, reasoning: reasoning || undefined, partial: undefined, error: ev.message }
              return { ...m, swipes: sw }
            }),
          { save: 'now' }
        )
        toast('error', '生成失败', ev.message)
      }
      set({ gen: null })
      useLibrary.getState().touch(ch.id)
      if (chat.groupId) useGroups.getState().touch(chat.groupId)
      const ok = ev.type === 'done' && (ev.finish !== 'aborted' || cutOff) && !empty
      if (ok) void maybeRecap(chat.id, build)
      resolveEnd(ok)
    })

    try {
      await yt.llm.start(requestId, profile, build.messages)
    } catch (e) {
      off()
      set({ gen: null })
      toast('error', '无法发起请求', String(e))
      resolveEnd(false)
    }
    return ended
  }

  /** 群聊：按顺序让几位成员各说一段；中途停止或出错就不再继续 */
  const runRound = async (chatId: string, picks: string[]) => {
    const token = ++roundSeq
    for (const id of picks) {
      if (token !== roundSeq) break
      if (get().active?.id !== chatId) break
      const ok = await generate({ kind: 'new' }, { speakerId: id })
      if (!ok) break
    }
  }

  return {
    index: {},
    indexLoaded: false,
    active: null,
    gen: null,
    lastBuild: null,
    imp: null,

    async continueLast() {
      const chat = get().active
      if (!chat || get().gen) return
      const last = chat.messages[chat.messages.length - 1]
      if (!last || last.role !== 'assistant') return
      await generate({ kind: 'continue', messageId: last.id })
    },

    async impersonate() {
      const chat = get().active
      if (!chat || get().gen || get().imp?.busy) return
      const ch = speakerFor(chat, [...chat.messages].reverse().find((m) => m.role === 'assistant'))
      const st = useSettings.getState()
      const profile = st.activeProfile()
      if (!ch || !profile || (profile.provider === 'openai' && !profile.baseUrl) || !profile.model) {
        toast('warn', '还没有配置 AI 接口')
        return
      }
      if (!(await keyReady(profile))) return
      const build = buildPrompt({ character: ch, chat, history: chat.messages, chatSettings: st.s.chat, profile, extraBooks: await booksFor(chat, ch), globalVars: st.s.globalVars, preset: await activePreset(), genType: 'impersonate', group: groupInput(chat) })
      if (build.budget.over) {
        overBudget(build)
        return
      }
      build.messages.push({ role: 'system', content: macroFn(ch, chat)(build.impersonatePrompt || DEFAULT_IMPERSONATE) })
      const requestId = newId('rq')
      let text = ''
      let timer = 0
      set({ imp: { chatId: chat.id, requestId, text: '', busy: true } })
      const off = yt.llm.onEvent((ev: LLMEvent) => {
        if (ev.requestId !== requestId) return
        if (ev.type === 'delta') {
          if (ev.content) text += ev.content
          if (!timer)
            timer = window.setTimeout(() => {
              timer = 0
              const cur = get().imp
              if (cur?.requestId === requestId) set({ imp: { ...cur, text } })
            }, 40)
          return
        }
        off()
        window.clearTimeout(timer)
        const cur = get().imp
        if (cur?.requestId === requestId) set({ imp: { ...cur, text: text.trim(), busy: false } })
        if (ev.type === 'error') toast('error', '代写失败', ev.message)
      })
      try {
        await yt.llm.start(requestId, profile, build.messages)
      } catch (e) {
        off()
        set({ imp: null })
        toast('error', '无法发起请求', String(e))
      }
    },

    stopImpersonate() {
      const i = get().imp
      if (i?.busy) yt.llm.abort(i.requestId)
    },

    clearImp() {
      set({ imp: null })
    },

    recapping: null,
    async rebuildRecap() {
      const chat = get().active
      if (!chat) return
      const upto = Math.max(0, chat.messages.length - RECAP_KEEP_RECENT)
      if (upto < 2) {
        toast('info', '对话还很短', '前情提要会把较早的对话整理成概要；现在全部对话都会原样发送')
        return
      }
      await runRecap(chat.id, upto, true)
      if (get().active?.summary?.covered) toast('ok', '前情提要已整理好', `概括了最早的 ${get().active!.summary!.covered} 条对话`)
    },
    setRecap(text) {
      mutate((c) => {
        if (!text.trim()) delete c.summary
        else c.summary = { text, covered: c.summary?.covered ?? Math.max(0, c.messages.length - RECAP_KEEP_RECENT), updatedAt: Date.now(), edited: true }
      })
    },
    clearRecap() {
      mutate((c) => delete c.summary, { save: 'now' })
    },

    async branchFrom(messageId) {
      const chat = get().active
      if (!chat) return null
      const i = chat.messages.findIndex((m) => m.id === messageId)
      if (i < 0) return null
      writeChat.flush(chat)
      const now = Date.now()
      const nc: Chat = {
        ...structuredClone(chat),
        id: newId('c'),
        title: `${chat.title}（分支）`,
        createdAt: now,
        updatedAt: now,
        messages: structuredClone(chat.messages.slice(0, i + 1))
      }
      // 前情提要只在它概括的范围都还在新卷里时保留
      if (nc.summary && nc.summary.covered > i + 1) delete nc.summary
      await yt.fs.writeJSON(chatPath(nc), nc)
      const idx = { ...get().index, [nc.id]: summarize(nc) }
      set({ index: idx, active: nc })
      writeIndex(idx)
      return nc
    },


    async loadIndex() {
      let idx = await yt.fs.readJSON<Record<string, ChatSummary>>('chats/index.json')
      if (!idx) {
        idx = {}
        for (const d of await yt.fs.list('chats')) {
          if (!d.dir) continue
          for (const f of await yt.fs.list(`chats/${d.name}`)) {
            if (!f.name.endsWith('.json')) continue
            const c = await yt.fs.readJSON<Chat>(`chats/${d.name}/${f.name}`)
            if (c?.id) idx[c.id] = summarize(c)
          }
        }
        writeIndex(idx)
      }
      set({ index: idx, indexLoaded: true })
    },

    forCharacter(charId) {
      return Object.values(get().index)
        .filter((s) => s.characterId === charId)
        .sort((a, b) => b.updatedAt - a.updatedAt)
    },

    recent(n) {
      const lib = useLibrary.getState()
      return Object.values(get().index)
        .filter((s) => lib.get(s.characterId))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, n)
    },

    async createChat(ch) {
      const n = get().forCharacter(ch.id).length + 1
      const now = Date.now()
      const greetings = [ch.firstMes, ...ch.alternateGreetings].filter((g) => g.trim())
      const chat: Chat = {
        id: newId('c'),
        characterId: ch.id,
        title: newChatTitle(ch, n),
        createdAt: now,
        updatedAt: now,
        vars: {},
        messages: greetings.length
          ? [{ id: newId('m'), role: 'assistant', isGreeting: true, createdAt: now, swipeIndex: 0, swipes: greetings.map((g) => ({ text: g, createdAt: now })) }]
          : []
      }
      await yt.fs.writeJSON(chatPath(chat), chat)
      const idx = { ...get().index, [chat.id]: summarize(chat) }
      set({ index: idx, active: chat })
      writeIndex(idx)
      useLibrary.getState().touch(ch.id)
      return chat
    },

    async createGroupChat(g) {
      const n = get().forCharacter(g.id).length + 1
      const now = Date.now()
      const d = new Date()
      const chat: Chat = {
        id: newId('c'),
        characterId: g.id,
        groupId: g.id,
        title: `${g.name} · 第${n}卷 · ${d.getMonth() + 1}月${d.getDate()}日`,
        createdAt: now,
        updatedAt: now,
        vars: {},
        messages: []
      }
      // 每位成员的开场白依次排好（静默的成员不出场）
      for (const m of membersOf(g)) {
        if (g.mutedIds.includes(m.id)) continue
        const greetings = [m.firstMes, ...m.alternateGreetings].filter((x) => x.trim())
        if (!greetings.length) continue
        chat.messages.push({ id: newId('m'), role: 'assistant', speakerId: m.id, isGreeting: true, createdAt: now, swipeIndex: 0, swipes: greetings.map((t) => ({ text: t, createdAt: now })) })
      }
      await yt.fs.writeJSON(chatPath(chat), chat)
      const idx = { ...get().index, [chat.id]: summarize(chat) }
      set({ index: idx, active: chat })
      writeIndex(idx)
      useGroups.getState().touch(g.id)
      return chat
    },

    async speakAs(memberId) {
      const chat = get().active
      if (!chat || !chat.groupId || get().gen) return
      await runRound(chat.id, [memberId])
    },

    async continueGroup() {
      const chat = get().active
      const g = chat ? groupOf(chat) : null
      if (!chat || !g || get().gen) return
      const picks = pickSpeakers(g, membersOf(g), { lastSpeakerId: lastSpeakerOf(chat), trigger: 'auto' })
      if (!picks.length) {
        toast('info', '群里的成员都被设为静默了')
        return
      }
      await runRound(chat.id, picks)
    },

    async openChat(charId, chatId) {
      const cur = get().active
      if (cur?.id === chatId) return cur
      if (cur) writeChat.flush(cur)
      const c = await yt.fs.readJSON<Chat>(`chats/${charId}/${chatId}.json`)
      if (!c) return null
      c.vars ??= {}
      set({ active: c })
      return c
    },

    closeChat() {
      const cur = get().active
      if (cur) writeChat.flush(cur)
    },

    async renameChat(chatId, title) {
      const cur = get().active
      if (cur?.id === chatId) {
        mutate((c) => (c.title = title), { save: 'now' })
        return
      }
      const s = get().index[chatId]
      if (!s) return
      const c = await yt.fs.readJSON<Chat>(`chats/${s.characterId}/${chatId}.json`)
      if (!c) return
      c.title = title
      await yt.fs.writeJSON(chatPath(c), c)
      const idx = { ...get().index, [chatId]: summarize(c) }
      set({ index: idx })
      writeIndex(idx)
    },

    async deleteChat(charId, chatId) {
      if (get().gen?.chatId === chatId) get().stop()
      await yt.fs.remove(`chats/${charId}/${chatId}.json`)
      const idx = { ...get().index }
      delete idx[chatId]
      set({ index: idx, active: get().active?.id === chatId ? null : get().active })
      writeIndex(idx)
    },

    async send(text) {
      const chat = get().active
      if (!chat || get().gen) return
      const g = groupOf(chat)
      const ch = speakerFor(chat)
      if (!ch) return
      const t = text.replace(/\s+$/, '')
      if (t.trim()) {
        // 群聊里你的话不属于某位角色：只用预设自带的正则
        const scripts = g ? presetScriptsFor(usePresets.getState().active, null) : scriptsOf(ch)
        const stored = applyRegexScripts(t, scripts, { placement: 1, macros: macroFn(ch, chat) })
        audio.send()
        mutate((c) => c.messages.push({ id: newId('m'), role: 'user', swipes: [{ text: stored, createdAt: Date.now() }], swipeIndex: 0, createdAt: Date.now() }), { save: 'now' })
      }
      if (g) {
        const picks = pickSpeakers(g, membersOf(g), { text: t, lastSpeakerId: lastSpeakerOf(chat), trigger: 'user' })
        if (picks.length) await runRound(chat.id, picks)
        return
      }
      await generate({ kind: 'new' })
    },

    async regenerate() {
      const chat = get().active
      if (!chat || get().gen) return
      const last = chat.messages[chat.messages.length - 1]
      if (last && last.role === 'assistant' && !last.isGreeting) {
        await generate({ kind: 'swipe', messageId: last.id })
        return
      }
      const g = groupOf(chat)
      if (g) {
        const lastUser = [...chat.messages].reverse().find((m) => m.role === 'user')
        let picks = pickSpeakers(g, membersOf(g), { text: lastUser ? swipeText(lastUser) : '', lastSpeakerId: lastSpeakerOf(chat), trigger: 'user' })
        if (!picks.length) picks = pickSpeakers(g, membersOf(g), { lastSpeakerId: lastSpeakerOf(chat), trigger: 'auto' }).slice(0, 1)
        await runRound(chat.id, picks)
        return
      }
      await generate({ kind: 'new' })
    },

    async swipe(messageId, dir) {
      const chat = get().active
      if (!chat || get().gen) return
      const i = chat.messages.findIndex((m) => m.id === messageId)
      const m = chat.messages[i]
      if (!m) return
      const n = m.swipes.length
      if (dir < 0) {
        mutate((c) => replaceMsg(c, messageId, (x) => ({ ...x, swipeIndex: x.isGreeting ? (x.swipeIndex - 1 + n) % n : Math.max(0, x.swipeIndex - 1) })))
        return
      }
      if (m.isGreeting) {
        mutate((c) => replaceMsg(c, messageId, (x) => ({ ...x, swipeIndex: (x.swipeIndex + 1) % n })))
        return
      }
      if (m.swipeIndex < n - 1) {
        mutate((c) => replaceMsg(c, messageId, (x) => ({ ...x, swipeIndex: x.swipeIndex + 1 })))
        return
      }
      // 已经是最后一个版本：如果是最后一条回复，就生成新版本
      if (i === chat.messages.length - 1 && m.role === 'assistant') await generate({ kind: 'swipe', messageId })
    },

    editMessage(messageId, text) {
      const chat = get().active
      if (!chat) return
      const m = chat.messages.find((x) => x.id === messageId)
      const ch = m ? speakerFor(chat, m.role === 'assistant' ? m : null) : undefined
      if (!m || !ch) return
      const placement = m.role === 'user' ? 1 : 2
      const stored = applyRegexScripts(text, scriptsOf(ch), { placement, isEdit: true, macros: macroFn(ch, chat) })
      mutate((c) =>
        replaceMsg(c, messageId, (x) => {
          const sw = [...x.swipes]
          sw[x.swipeIndex] = { ...sw[x.swipeIndex], text: stored, error: undefined, partial: undefined }
          return { ...x, swipes: sw }
        })
      )
    },

    deleteMessage(messageId) {
      if (get().gen?.messageId === messageId) get().stop()
      mutate((c) => {
        c.messages = c.messages.filter((m) => m.id !== messageId)
      })
    },

    stop() {
      roundSeq++
      const g = get().gen
      if (g) yt.llm.abort(g.requestId)
    },

    setAuthorNote(text, depth) {
      mutate((c) => {
        c.authorNote = text.trim() ? { text, depth, role: 'system' } : undefined
      })
    },

    async preview() {
      const chat = get().active
      if (!chat) return null
      const g = groupOf(chat)
      // 群聊：按下一位最可能开口的成员来预览
      const next = g ? pickSpeakers(g, membersOf(g), { lastSpeakerId: lastSpeakerOf(chat), trigger: 'auto' }, () => 0.5)[0] : undefined
      const ch = speakerFor(chat, null, next)
      const st = useSettings.getState()
      const profile = st.activeProfile()
      if (!ch || !profile) return null
      const extraBooks = await booksFor(chat, ch)
      return buildPrompt({ character: ch, chat, history: chat.messages, chatSettings: st.s.chat, profile, extraBooks, globalVars: st.s.globalVars, preset: await activePreset(), group: groupInput(chat) })
    }
  }
})

window.addEventListener('beforeunload', () => {
  const c = useChats.getState().active
  if (c) writeChat.flush(c)
})
