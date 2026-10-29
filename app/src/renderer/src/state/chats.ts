import { create } from 'zustand'
import type { Character, Chat, ChatMessage, ChatSummary, LLMEvent, Swipe, PromptPreset } from '@shared/types'
import { newId } from '@shared/id'
import { buildPrompt, swipeText, makeMacroContext, DEFAULT_CONTINUE_NUDGE, DEFAULT_IMPERSONATE, type BuildResult } from '@shared/prompt'
import { applyRegexScripts } from '@shared/regex'
import { effectiveScripts } from '@shared/presetRuntime'
import { usePresets } from './presets'
import { substituteMacros } from '@shared/macros'
import { yt, debounce } from '../lib/api'
import { useLibrary, loadLinkedBooks } from './library'
import { useSettings } from './settings'
import { toast } from './ui'
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
  lastBuild: (BuildResult & { at: number }) | null
  loadIndex(): Promise<void>
  forCharacter(charId: string): ChatSummary[]
  recent(n: number): ChatSummary[]
  createChat(ch: Character): Promise<Chat>
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
  return { id: c.id, characterId: c.characterId, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, count: c.messages.length, preview }
}

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

  /** 生成一条回复：kind=new 追加新消息；kind=swipe 给已有消息加一个新版本；kind=continue 接着已有消息往下写 */
  const generate = async (target: { kind: 'new' } | { kind: 'swipe'; messageId: string } | { kind: 'continue'; messageId: string }) => {
    const chat = get().active
    if (!chat || get().gen) return
    const ch = useLibrary.getState().get(chat.characterId)
    const st = useSettings.getState()
    const profile = st.activeProfile()
    if (!ch) return
    if (!profile || !profile.baseUrl || !profile.model) {
      toast('warn', '还没有配置 AI 接口', '请先到「设置 → 接口」填写地址、模型和密钥')
      return
    }

    let history: ChatMessage[]
    let messageId: string
    let prefix = ''
    const blank: Swipe = { text: '', createdAt: Date.now(), partial: true }
    if (target.kind === 'continue') {
      const i = chat.messages.findIndex((m) => m.id === target.messageId)
      if (i < 0) return
      history = chat.messages.slice(0, i + 1)
      messageId = target.messageId
      prefix = swipeText(chat.messages[i])
    } else if (target.kind === 'new') {
      history = chat.messages
      messageId = newId('m')
      mutate((c) => c.messages.push({ id: messageId, role: 'assistant', swipes: [blank], swipeIndex: 0, createdAt: Date.now() }), { save: 'none' })
    } else {
      const i = chat.messages.findIndex((m) => m.id === target.messageId)
      if (i < 0) return
      history = chat.messages.slice(0, i)
      messageId = target.messageId
      mutate((c) => replaceMsg(c, messageId, (m) => ({ ...m, swipes: [...m.swipes, blank], swipeIndex: m.swipes.length })), { save: 'none' })
    }

    let build: BuildResult
    try {
      const extraBooks = await loadLinkedBooks(ch)
      build = buildPrompt({ character: ch, chat: get().active!, history, chatSettings: st.s.chat, profile, extraBooks, globalVars: st.s.globalVars, preset: await activePreset(), genType: target.kind === 'new' ? 'normal' : target.kind })
      if (target.kind === 'continue') build.messages.push({ role: 'system', content: macroFn(ch, get().active!)(build.continueNudge || DEFAULT_CONTINUE_NUDGE) })
    } catch (e) {
      toast('error', '组装提示词失败', String(e))
      return
    }
    set({ lastBuild: { ...build, at: Date.now() } })
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
    let flushTimer = 0
    let lastSave = Date.now()
    const flush = () => {
      flushTimer = 0
      mutate(
        (c) =>
          replaceMsg(c, messageId, (m) => {
            const sw = [...m.swipes]
            sw[m.swipeIndex] = { ...sw[m.swipeIndex], text: prefix + content, reasoning: reasoning || sw[m.swipeIndex].reasoning || undefined }
            return { ...m, swipes: sw }
          }),
        { save: 'none' }
      )
      if (Date.now() - lastSave > 1000) {
        lastSave = Date.now()
        writeChat.flush(get().active!)
      }
    }

    const off = yt.llm.onEvent((ev: LLMEvent) => {
      if (ev.requestId !== requestId) return
      if (ev.type === 'delta') {
        if (ev.content) content += ev.content
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
      const ch2 = useLibrary.getState().get(chat.characterId) ?? ch
      const cur = get().active
      const macros = cur ? macroFn(ch2, cur) : (s: string) => s
      if (ev.type === 'done') {
        const aborted = ev.finish === 'aborted'
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
          mutate(
            (c) =>
              replaceMsg(c, messageId, (m) => {
                const sw = [...m.swipes]
                sw[m.swipeIndex] = { ...sw[m.swipeIndex], text: finalText, reasoning: finalReason, partial: aborted || undefined, finish: ev.finish, usage: ev.usage, model: ev.model ?? profile.model }
                return { ...m, swipes: sw }
              }),
            { save: 'now' }
          )
          if (!aborted) audio.receive()
          if (ev.finish === 'length') toast('info', '回复达到了长度上限', '可以在「设置 → 接口」调大「单次回复上限」')
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
      useLibrary.getState().touch(chat.characterId)
    })

    try {
      await yt.llm.start(requestId, profile, build.messages)
    } catch (e) {
      off()
      set({ gen: null })
      toast('error', '无法发起请求', String(e))
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
      const ch = useLibrary.getState().get(chat.characterId)
      const st = useSettings.getState()
      const profile = st.activeProfile()
      if (!ch || !profile?.baseUrl || !profile.model) {
        toast('warn', '还没有配置 AI 接口')
        return
      }
      const build = buildPrompt({ character: ch, chat, history: chat.messages, chatSettings: st.s.chat, profile, extraBooks: await loadLinkedBooks(ch), globalVars: st.s.globalVars, preset: await activePreset(), genType: 'impersonate' })
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
      const ch = useLibrary.getState().get(chat.characterId)
      if (!ch) return
      const t = text.replace(/\s+$/, '')
      if (t.trim()) {
        const stored = applyRegexScripts(t, scriptsOf(ch), { placement: 1, macros: macroFn(ch, chat) })
        audio.send()
        mutate((c) => c.messages.push({ id: newId('m'), role: 'user', swipes: [{ text: stored, createdAt: Date.now() }], swipeIndex: 0, createdAt: Date.now() }), { save: 'now' })
      }
      await generate({ kind: 'new' })
    },

    async regenerate() {
      const chat = get().active
      if (!chat || get().gen) return
      const last = chat.messages[chat.messages.length - 1]
      if (last && last.role === 'assistant' && !last.isGreeting) await generate({ kind: 'swipe', messageId: last.id })
      else await generate({ kind: 'new' })
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
      const ch = useLibrary.getState().get(chat.characterId)
      const m = chat.messages.find((x) => x.id === messageId)
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
      const ch = useLibrary.getState().get(chat.characterId)
      const st = useSettings.getState()
      const profile = st.activeProfile()
      if (!ch || !profile) return null
      const extraBooks = await loadLinkedBooks(ch)
      return buildPrompt({ character: ch, chat, history: chat.messages, chatSettings: st.s.chat, profile, extraBooks, globalVars: st.s.globalVars, preset: await activePreset() })
    }
  }
})

window.addEventListener('beforeunload', () => {
  const c = useChats.getState().active
  if (c) writeChat.flush(c)
})
