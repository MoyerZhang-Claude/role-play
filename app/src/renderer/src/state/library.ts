import { create } from 'zustand'
import type { Character, Worldbook } from '@shared/types'
import { newId } from '@shared/id'
import { yt, dataUrl } from '../lib/api'
import { makeSigilAvatar } from '../lib/avatar'
import { originalDisabled } from '@shared/regex'
import { useSettings } from './settings'

interface LibraryState {
  chars: Character[]
  loaded: boolean
  load(): Promise<void>
  get(id: string): Character | undefined
  save(ch: Character): Promise<void>
  touch(id: string): void
  remove(id: string): Promise<void>
  add(ch: Character, image?: Uint8Array): Promise<Character>
  setAvatar(id: string, bytes: Uint8Array): Promise<void>
}

const charDir = (id: string) => `characters/${id}`

export function avatarSrc(ch: Character | undefined | null): string | null {
  if (!ch || !ch.avatar) return null
  return dataUrl(`${charDir(ch.id)}/${ch.avatar}`, ch.updatedAt)
}

export function blankCharacter(): Character {
  const now = Date.now()
  return {
    id: newId('ch'),
    name: '',
    avatar: null,
    description: '',
    personality: '',
    scenario: '',
    firstMes: '',
    alternateGreetings: [],
    mesExample: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    creatorNotes: '',
    tags: [],
    creator: '',
    characterVersion: '',
    depthPrompt: null,
    book: null,
    regexScripts: [],
    linkedBookIds: [],
    source: { format: 'custom' },
    display: { styleMode: 'yaotang' },
    createdAt: now,
    updatedAt: now
  }
}

const sortChars = (a: Character, b: Character) => (b.lastChatAt ?? b.updatedAt) - (a.lastChatAt ?? a.updatedAt)

export const useLibrary = create<LibraryState>((set, get) => ({
  chars: [],
  loaded: false,
  async load() {
    const dirs = await yt.fs.list('characters')
    const out: Character[] = []
    for (const d of dirs) {
      if (!d.dir) continue
      const ch = await yt.fs.readJSON<Character>(`characters/${d.name}/character.json`)
      if (!ch || !ch.id) continue
      const fixed = repairCharacter(ch)
      if (fixed !== ch) await yt.fs.writeJSON(`characters/${d.name}/character.json`, fixed).catch(() => undefined)
      out.push(fixed)
    }
    out.sort(sortChars)
    set({ chars: out, loaded: true })
  },
  get(id) {
    return get().chars.find((c) => c.id === id)
  },
  async save(ch) {
    const next = { ...ch, updatedAt: Date.now() }
    await yt.fs.writeJSON(`${charDir(ch.id)}/character.json`, next)
    const list = get().chars.filter((c) => c.id !== ch.id)
    list.push(next)
    list.sort(sortChars)
    set({ chars: list })
  },
  touch(id) {
    const ch = get().get(id)
    if (!ch) return
    const next = { ...ch, lastChatAt: Date.now() }
    yt.fs.writeJSON(`${charDir(id)}/character.json`, next).catch(() => undefined)
    set({ chars: [...get().chars.filter((c) => c.id !== id), next].sort(sortChars) })
  },
  async remove(id) {
    await yt.fs.remove(charDir(id))
    await yt.fs.remove(`chats/${id}`)
    set({ chars: get().chars.filter((c) => c.id !== id) })
  },
  async add(ch, image) {
    const c = { ...ch }
    if (image) {
      await yt.fs.writeBytes(`${charDir(c.id)}/avatar.png`, image)
      c.avatar = 'avatar.png'
    } else if (!c.avatar) {
      const bytes = await makeSigilAvatar(c.name)
      await yt.fs.writeBytes(`${charDir(c.id)}/avatar.png`, bytes)
      c.avatar = 'avatar.png'
    }
    await get().save(c)
    return get().get(c.id)!
  },
  async setAvatar(id, bytes) {
    const ch = get().get(id)
    if (!ch) return
    await yt.fs.writeBytes(`${charDir(id)}/avatar.png`, bytes)
    await get().save({ ...ch, avatar: 'avatar.png' })
  }
}))

/**
 * 修复旧版本存下的数据：
 * - v0.3.0 切到「卡片原样式」时，会把作者本来关着的备选样式正则也打开，这里关回去；
 * - 卡片文本里的 Windows 换行统一成 \n。
 */
function repairCharacter(ch: Character): Character {
  let changed = false
  let scripts = ch.regexScripts
  let auto = ch.display?.autoEnabled
  if (auto?.length) {
    const wrong = new Set(scripts.filter((r) => auto!.includes(r.id) && originalDisabled(r, ch.raw) === true).map((r) => r.id))
    if (wrong.size) {
      scripts = scripts.map((r) => (wrong.has(r.id) ? { ...r, disabled: true } : r))
      auto = auto.filter((id) => !wrong.has(id))
      changed = true
    }
  }
  const nl = (s: string) => (s.includes('\r') ? s.replace(/\r\n?/g, '\n') : s)
  const fields = ['description', 'personality', 'scenario', 'firstMes', 'mesExample', 'systemPrompt', 'postHistoryInstructions', 'creatorNotes'] as const
  const patchText: Partial<Character> = {}
  for (const f of fields) {
    const v = ch[f]
    if (typeof v === 'string' && v.includes('\r')) {
      ;(patchText as Record<string, string>)[f] = nl(v)
      changed = true
    }
  }
  const alts = ch.alternateGreetings.some((g) => g.includes('\r')) ? ch.alternateGreetings.map(nl) : ch.alternateGreetings
  if (alts !== ch.alternateGreetings) changed = true
  if (!changed) return ch
  return { ...ch, ...patchText, alternateGreetings: alts, regexScripts: scripts, display: { ...ch.display, autoEnabled: auto } }
}

/** 读取角色绑定的独立世界书，以及对所有角色生效的全局世界书 */
export async function loadLinkedBooks(ch: Character): Promise<Worldbook[]> {
  const out: Worldbook[] = []
  const ids = [...new Set([...(ch.linkedBookIds ?? []), ...useSettings.getState().s.chat.globalBookIds])]
  for (const id of ids) {
    const b = await yt.fs.readJSON<Worldbook>(`worldbooks/${id}.json`)
    if (b) out.push(b)
  }
  return out
}
