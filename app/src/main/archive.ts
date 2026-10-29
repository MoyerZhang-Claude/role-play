/**
 * 存档（.yaotang）：一个 zip 文件。
 * 包含：角色（设定、头像、内嵌世界书与正则、原始卡片数据）、对话、独立世界书、设置（可选）。
 * 不包含：API 密钥、窗口位置、运行缓存。
 */
import { zipSync, unzipSync, strToU8, strFromU8, type Zippable } from 'fflate'
import path from 'node:path'
import type { DataStore } from './storage'
import type { ArchiveManifest, ArchiveSummary, ApplyOptions } from '@shared/types'

export type { ArchiveManifest, ArchiveSummary, ApplyOptions }

const ID = /^[A-Za-z0-9_-]{1,80}$/
const ALLOWED = [/^manifest\.json$/, /^settings\.json$/, /^characters\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+)$/, /^chats\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\.json$/, /^worldbooks\/([A-Za-z0-9_-]+)\.json$/, /^groups\/([A-Za-z0-9_-]+)\.json$/]

const pending = new Map<string, Record<string, Uint8Array>>()

/** 打包。characterIds 为 null 表示全部 */
export async function buildArchive(store: DataStore, opts: { characterIds: string[] | null; includeSettings: boolean; app: string }): Promise<{ bytes: Uint8Array; counts: ArchiveManifest['counts'] }> {
  const files: Zippable = {}
  const counts = { characters: 0, chats: 0, worldbooks: 0 }
  const wanted = opts.characterIds ? new Set(opts.characterIds) : null
  const bookIds = new Set<string>()
  for (const d of await store.list('characters')) {
    if (!d.dir || !ID.test(d.name)) continue
    if (wanted && !wanted.has(d.name)) continue
    const ch = await store.readJSON<any>(`characters/${d.name}/character.json`)
    if (!ch) continue
    counts.characters++
    for (const f of await store.list(`characters/${d.name}`)) {
      if (f.dir || f.name.endsWith('.tmp') || f.name.endsWith('.bak')) continue
      const b = await store.readBytes(`characters/${d.name}/${f.name}`)
      if (b) files[`characters/${d.name}/${f.name}`] = [b, { level: /\.(png|jpe?g|webp)$/i.test(f.name) ? 0 : 6 }]
    }
    for (const id of ch.linkedBookIds ?? []) bookIds.add(id)
    for (const f of await store.list(`chats/${d.name}`)) {
      if (f.dir || !f.name.endsWith('.json')) continue
      const b = await store.readBytes(`chats/${d.name}/${f.name}`)
      if (b) {
        files[`chats/${d.name}/${f.name}`] = b
        counts.chats++
      }
    }
  }
  // 群聊：全部打包时都带上；只打包部分角色时，带上至少有两位成员被选中的群
  for (const f of await store.list('groups')) {
    if (f.dir || !f.name.endsWith('.json')) continue
    const g = await store.readJSON<any>(`groups/${f.name}`)
    if (!g?.id || !ID.test(g.id)) continue
    if (wanted && (g.memberIds ?? []).filter((id: string) => wanted.has(id)).length < 2) continue
    const b = await store.readBytes(`groups/${f.name}`)
    if (b) files[`groups/${f.name}`] = b
    for (const c of await store.list(`chats/${g.id}`)) {
      if (c.dir || !c.name.endsWith('.json')) continue
      const cb = await store.readBytes(`chats/${g.id}/${c.name}`)
      if (cb) {
        files[`chats/${g.id}/${c.name}`] = cb
        counts.chats++
      }
    }
  }
  for (const f of await store.list('worldbooks')) {
    if (f.dir || !f.name.endsWith('.json')) continue
    const id = f.name.replace(/\.json$/, '')
    if (wanted && !bookIds.has(id)) continue
    const b = await store.readBytes(`worldbooks/${f.name}`)
    if (b) {
      files[`worldbooks/${f.name}`] = b
      counts.worldbooks++
    }
  }
  if (opts.includeSettings) {
    const s = await store.readJSON<any>('settings.json')
    if (s) {
      delete s.window
      files['settings.json'] = strToU8(JSON.stringify(s))
    }
  }
  const manifest: ArchiveManifest = { format: 'yaotang-archive', version: 1, app: opts.app, createdAt: Date.now(), counts, includesSettings: !!files['settings.json'], includesSecrets: false }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  return { bytes: zipSync(files, { level: 6 }), counts }
}

/** 读取存档、校验，返回摘要（文件暂存在内存里，等用户确认后再写入） */
export async function inspectArchive(store: DataStore, bytes: Uint8Array): Promise<ArchiveSummary> {
  let raw: Record<string, Uint8Array>
  try {
    raw = unzipSync(bytes)
  } catch {
    throw new Error('这不是有效的存档文件（无法解压）')
  }
  const files: Record<string, Uint8Array> = {}
  for (const [name, data] of Object.entries(raw)) {
    const n = name.replace(/\\/g, '/')
    if (n.endsWith('/')) continue
    if (n.split('/').some((p) => p === '..' || p === '')) continue
    if (ALLOWED.some((re) => re.test(n))) files[n] = data
  }
  if (!files['manifest.json']) throw new Error('存档缺少说明文件（manifest.json），可能不是药汤的存档')
  let manifest: ArchiveManifest
  try {
    manifest = JSON.parse(strFromU8(files['manifest.json']))
  } catch {
    throw new Error('存档说明文件已损坏')
  }
  if (manifest.format !== 'yaotang-archive') throw new Error('不是药汤的存档格式')
  const characters: ArchiveSummary['characters'] = []
  for (const n of Object.keys(files)) {
    const m = n.match(/^characters\/([A-Za-z0-9_-]+)\/character\.json$/)
    if (!m) continue
    let name = m[1]
    try {
      name = JSON.parse(strFromU8(files[n])).name || name
    } catch {
      /* 保留 id */
    }
    const chats = Object.keys(files).filter((k) => k.startsWith(`chats/${m[1]}/`)).length
    characters.push({ id: m[1], name, chats, exists: await store.exists(`characters/${m[1]}/character.json`) })
  }
  const token = Math.random().toString(36).slice(2)
  pending.set(token, files)
  return { token, manifest, characters, worldbooks: Object.keys(files).filter((k) => k.startsWith('worldbooks/')).length, hasSettings: !!files['settings.json'] }
}

/** 自动备份：导入前先把当前数据完整打包一份，只保留最近 5 份 */
export async function autoBackup(store: DataStore, app: string): Promise<string> {
  const { bytes } = await buildArchive(store, { characterIds: null, includeSettings: true, app })
  const d = new Date()
  const p2 = (n: number) => String(n).padStart(2, '0')
  const name = `导入前自动备份-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.yaotang`
  await store.writeBytes(`backups/${name}`, bytes)
  const list = (await store.list('backups')).filter((f) => f.name.startsWith('导入前自动备份')).sort((a, b) => b.mtime - a.mtime)
  for (const f of list.slice(5)) await store.remove(`backups/${f.name}`)
  return path.join(store.root, 'backups', name)
}

export async function applyArchive(store: DataStore, token: string, opts: ApplyOptions, app: string): Promise<{ characters: number; chats: number; worldbooks: number; skipped: number; backup: string }> {
  const files = pending.get(token)
  if (!files) throw new Error('存档已过期，请重新选择文件')
  const backup = await autoBackup(store, app)
  if (opts.mode === 'replace') {
    await store.remove('characters')
    await store.remove('chats')
    await store.remove('worldbooks')
    await store.remove('groups')
  }
  const result = { characters: 0, chats: 0, worldbooks: 0, skipped: 0, backup }
  const skipChars = new Set<string>()
  for (const n of Object.keys(files)) {
    const m = n.match(/^characters\/([A-Za-z0-9_-]+)\/character\.json$/)
    if (!m) continue
    if (opts.mode === 'merge' && opts.conflict === 'skip' && (await store.exists(n))) {
      skipChars.add(m[1])
      result.skipped++
    } else result.characters++
  }
  for (const [n, data] of Object.entries(files)) {
    if (n === 'manifest.json' || n === 'settings.json') continue
    const cm = n.match(/^characters\/([A-Za-z0-9_-]+)\//)
    if (cm && skipChars.has(cm[1])) continue
    if (n.startsWith('chats/')) {
      if (opts.mode === 'merge' && opts.conflict === 'skip' && (await store.exists(n))) {
        result.skipped++
        continue
      }
      result.chats++
    }
    if (n.startsWith('worldbooks/')) {
      if (opts.mode === 'merge' && opts.conflict === 'skip' && (await store.exists(n))) continue
      result.worldbooks++
    }
    if (n.startsWith('groups/') && opts.mode === 'merge' && opts.conflict === 'skip' && (await store.exists(n))) continue
    await store.writeBytes(n, data)
  }
  if (opts.applySettings && files['settings.json']) {
    try {
      const incoming = JSON.parse(strFromU8(files['settings.json']))
      const current = (await store.readJSON<any>('settings.json')) ?? {}
      await store.writeJSON('settings.json', { ...incoming, window: current.window })
    } catch {
      /* 设置损坏时忽略 */
    }
  }
  // 对话索引会在页面里重建
  await store.remove('chats/index.json').catch(() => undefined)
  pending.delete(token)
  return result
}

export function discardArchive(token: string) {
  pending.delete(token)
}
