import { create } from 'zustand'
import type { Character, Group } from '@shared/types'
import { newId } from '@shared/id'
import { yt } from '../lib/api'
import { useLibrary } from './library'

/**
 * 群聊：几位角色和你在同一卷对话里。
 * 群本身只记成员、顺序与规则；角色仍是书斋里原来的那几位。
 */
interface GroupsState {
  groups: Group[]
  loaded: boolean
  load(): Promise<void>
  get(id: string): Group | undefined
  save(g: Group): Promise<void>
  create(name: string, memberIds: string[], extra?: Partial<Group>): Promise<Group>
  remove(id: string): Promise<void>
  touch(id: string): void
}

const path = (id: string) => `groups/${id}.json`

export function blankGroup(name: string, memberIds: string[]): Group {
  const now = Date.now()
  return { id: newId('g'), name, memberIds, mutedIds: [], strategy: 'natural', allowSelfReply: false, scenario: '', talk: {}, description: '', createdAt: now, updatedAt: now }
}

export const useGroups = create<GroupsState>((set, get) => ({
  groups: [],
  loaded: false,
  async load() {
    const out: Group[] = []
    for (const f of await yt.fs.list('groups')) {
      if (f.dir || !f.name.endsWith('.json')) continue
      const g = await yt.fs.readJSON<Group>(`groups/${f.name}`)
      if (g?.id) out.push({ ...blankGroup(g.name, g.memberIds ?? []), ...g })
    }
    out.sort((a, b) => (b.lastChatAt ?? b.updatedAt) - (a.lastChatAt ?? a.updatedAt))
    set({ groups: out, loaded: true })
  },
  get(id) {
    return get().groups.find((g) => g.id === id)
  },
  async save(g) {
    const next = { ...g, updatedAt: Date.now() }
    await yt.fs.writeJSON(path(g.id), next)
    set({ groups: [next, ...get().groups.filter((x) => x.id !== g.id)] })
  },
  async create(name, memberIds, extra) {
    const g = { ...blankGroup(name, memberIds), ...(extra ?? {}) }
    await get().save(g)
    return get().get(g.id)!
  },
  async remove(id) {
    await yt.fs.remove(path(id))
    await yt.fs.remove(`chats/${id}`)
    set({ groups: get().groups.filter((g) => g.id !== id) })
  },
  touch(id) {
    const g = get().get(id)
    if (!g) return
    const next = { ...g, lastChatAt: Date.now() }
    yt.fs.writeJSON(path(id), next).catch(() => undefined)
    set({ groups: [next, ...get().groups.filter((x) => x.id !== id)] })
  }
}))

/** 群里还在书斋中的成员（按群里的顺序） */
export function membersOf(g: Group, chars: Character[] = useLibrary.getState().chars): Character[] {
  return g.memberIds.map((id) => chars.find((c) => c.id === id)).filter((c): c is Character => !!c)
}

export { talkOf } from '@shared/group'

export const isGroupId = (id: string) => useGroups.getState().groups.some((g) => g.id === id)
