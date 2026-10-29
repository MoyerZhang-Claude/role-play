import { createElement } from 'react'
import { cardFromJson } from '@shared/card'
import type { Character, Group, GroupStrategy, Worldbook } from '@shared/types'
import { useLibrary } from '../state/library'
import { useGroups, membersOf, talkOf } from '../state/groups'
import { yt } from './api'
import { confirmDialog, toast } from '../state/ui'
import { go } from '../state/router'
import { audio } from '../audio/engine'

/**
 * 群聊卡（药汤自己的格式，SillyTavern 没有可移植的群聊文件）：
 * {
 *   "spec": "yaotang_group_v1",
 *   "name": "群名", "description": "", "scenario": "群聊场景",
 *   "strategy": "natural" | "list" | "manual", "allow_self_reply": false,
 *   "members": [ { "card": <SillyTavern V2/V3 角色卡 JSON>, "avatar"?: "data:image/png;base64,…", "muted"?: true } ]
 * }
 * 成员的活跃度写在各自卡里的 extensions.talkativeness（与 SillyTavern 一致）。
 */
export interface GroupBundle {
  spec: 'yaotang_group_v1'
  name?: string
  description?: string
  scenario?: string
  strategy?: GroupStrategy
  allow_self_reply?: boolean
  members?: { card?: unknown; avatar?: string; muted?: boolean }[]
}

export const isGroupBundle = (j: unknown): j is GroupBundle => !!j && typeof j === 'object' && (j as { spec?: unknown }).spec === 'yaotang_group_v1'

function dataUrlBytes(url?: string): Uint8Array | undefined {
  const m = url?.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i)
  if (!m) return undefined
  try {
    const bin = atob(m[2])
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return undefined
  }
}

const sameChar = (a: Character, b: Character) => a.name === b.name && a.description.trim() === b.description.trim() && a.firstMes.trim() === b.firstMes.trim()

export async function importGroupBundle(j: GroupBundle, fileName: string): Promise<void> {
  const parsed = (j.members ?? []).map((m, i) => ({ p: cardFromJson(m?.card as never, `${fileName}#${i + 1}`), avatar: dataUrlBytes(m?.avatar), muted: !!m?.muted })).filter((x) => x.p)
  if (parsed.length < 2) {
    toast('error', `「${fileName}」里的成员不足两位`, '群聊卡至少要带两张能识别的角色卡')
    return
  }
  const name = (j.name || '').trim() || parsed.map((x) => x.p!.character.name).join('、')
  const chars = useLibrary.getState().chars
  const reuse = parsed.map((x) => chars.find((c) => sameChar(c, x.p!.character)))
  const fresh = reuse.filter((r) => !r).length
  const ok = await confirmDialog({
    title: `导入群聊「${name}」？`,
    body: createElement(
      'div',
      { className: 'group-import-body' },
      createElement('p', null, `成员：${parsed.map((x) => x.p!.character.name).join('、')}`),
      createElement(
        'p',
        { className: 't-small t-faint' },
        fresh === parsed.length ? `会新建 ${fresh} 位角色收进书斋，再把他们组成一个群聊。` : `其中 ${parsed.length - fresh} 位书斋里已经有了，直接沿用；另外新建 ${fresh} 位。`
      )
    ),
    okText: '导入'
  })
  if (!ok) return
  const ids: string[] = []
  for (let i = 0; i < parsed.length; i++) {
    const have = reuse[i]
    if (have) {
      ids.push(have.id)
      continue
    }
    const saved = await useLibrary.getState().add(parsed[i].p!.character, parsed[i].avatar ?? parsed[i].p!.image)
    ids.push(saved.id)
  }
  const strategy: GroupStrategy = j.strategy === 'list' || j.strategy === 'manual' ? j.strategy : 'natural'
  const mutedIds = ids.filter((_, i) => parsed[i].muted)
  // 活跃度：沿用已有角色时，以群聊卡里写的为准
  const talk: Record<string, number> = {}
  parsed.forEach((x, i) => {
    const v = Number((x.p!.character.raw as { data?: { extensions?: { talkativeness?: unknown } } } | undefined)?.data?.extensions?.talkativeness)
    if (reuse[i] && Number.isFinite(v)) talk[ids[i]] = Math.max(0, Math.min(1, v))
  })
  const g = await useGroups.getState().create(name, ids, { scenario: j.scenario ?? '', description: j.description ?? '', strategy, allowSelfReply: !!j.allow_self_reply, mutedIds, talk })
  audio.stamp()
  toast('ok', `群聊「${g.name}」已收进书斋`, `${ids.length} 位成员 · 在群聊页点「开始新的一卷」就能开聊`)
  go({ name: 'group', id: g.id })
}

/* ───────── 导出群聊卡 ───────── */

/** 头像缩到长边不超过 768 像素、重新编码成 PNG（顺便去掉 PNG 里夹带的旧卡片数据），免得群聊卡太大 */
async function avatarDataUrl(ch: Character): Promise<string> {
  const { avatarPng } = await import('../pages/CardExport')
  const bytes = await avatarPng(ch)
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart]))
  const k = Math.min(1, 768 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(bmp.width * k))
  c.height = Math.max(1, Math.round(bmp.height * k))
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return c.toDataURL('image/png')
}

/** 把群聊连同成员角色卡（含绑定的世界书、头像、活跃度、静默）打包成一个 JSON 文件 */
export async function exportGroupBundle(g: Group): Promise<void> {
  const { mergeBooks } = await import('../pages/CardExport')
  const { characterToCards } = await import('@shared/cardExport')
  const members = membersOf(g)
  if (members.length < 2) {
    toast('warn', '群里至少要有两位成员才能导出')
    return
  }
  const out: GroupBundle & Record<string, unknown> = {
    spec: 'yaotang_group_v1',
    name: g.name,
    description: g.description ?? '',
    scenario: g.scenario,
    strategy: g.strategy,
    allow_self_reply: g.allowSelfReply,
    exported_at: new Date().toISOString(),
    members: []
  }
  for (const m of members) {
    const books: Worldbook[] = []
    for (const id of m.linkedBookIds ?? []) {
      const b = await yt.fs.readJSON<Worldbook>(`worldbooks/${id}.json`)
      if (b) books.push(b)
    }
    const card = characterToCards(mergeBooks(m, books)).v2 as { data: { extensions?: Record<string, unknown> } }
    card.data.extensions = { ...(card.data.extensions ?? {}), talkativeness: talkOf(g, m) }
    out.members!.push({ card, avatar: await avatarDataUrl(m), ...(g.mutedIds.includes(m.id) ? { muted: true } : {}) })
  }
  const bytes = new TextEncoder().encode(JSON.stringify(out, null, 1))
  const safe = g.name.replace(/[\\/:*?"<>|\r\n]+/g, '_').trim() || '群聊'
  const p = await yt.dialog.saveFile(`${safe}（群聊卡）.json`, bytes, [{ name: '药汤群聊卡', extensions: ['json'] }])
  if (p) {
    audio.stamp()
    toast('ok', '群聊卡已导出', `${members.length} 位成员的角色卡与头像都在里面 · ${(bytes.length / 1048576).toFixed(1)} MB\n${p}`)
  }
}
