import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { DataStore } from '../src/main/storage'
import { buildArchive, inspectArchive, applyArchive } from '../src/main/archive'

function tmp(name: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `yt-${name}-`))
  return new DataStore(d)
}

async function seed(store: DataStore, id: string, name: string) {
  await store.writeJSON(`characters/${id}/character.json`, { id, name, linkedBookIds: ['wb1'] })
  await store.writeBytes(`characters/${id}/avatar.png`, new Uint8Array([137, 80, 78, 71, 1, 2, 3]))
  await store.writeJSON(`chats/${id}/c-${id}.json`, { id: `c-${id}`, characterId: id, messages: [] })
  await store.writeJSON(`worldbooks/wb1.json`, { id: 'wb1', name: 'book', entries: [] })
  await store.writeJSON('settings.json', { version: 1, window: { maximized: true }, appearance: { fontSize: 20 } })
  await store.writeJSON('secrets.json', { version: 1, items: { x: { enc: 'SECRET' } } })
}

describe('存档', () => {
  let src: DataStore
  beforeEach(async () => {
    src = tmp('src')
    await seed(src, 'chA', '甲')
    await seed(src, 'chB', '乙')
  })

  it('打包：角色、对话、世界书、设置；不含密钥和窗口位置', async () => {
    const { bytes, counts } = await buildArchive(src, { characterIds: null, includeSettings: true, app: 'test' })
    expect(counts).toEqual({ characters: 2, chats: 2, worldbooks: 1 })
    const dst = tmp('dst')
    const sum = await inspectArchive(dst, bytes)
    expect(sum.characters.map((c) => c.name).sort()).toEqual(['乙', '甲'])
    expect(sum.hasSettings).toBe(true)
    const r = await applyArchive(dst, sum.token, { mode: 'merge', conflict: 'overwrite', applySettings: true }, 'test')
    expect(r.characters).toBe(2)
    expect(await dst.exists('characters/chA/avatar.png')).toBe(true)
    expect(await dst.exists('secrets.json')).toBe(false)
    const s = await dst.readJSON<any>('settings.json')
    expect(s.appearance.fontSize).toBe(20)
    expect(s.window).toBeUndefined()
    expect(fs.readdirSync(path.join(dst.root, 'backups')).length).toBe(1)
  })

  it('只导出部分角色', async () => {
    const { counts } = await buildArchive(src, { characterIds: ['chA'], includeSettings: false, app: 'test' })
    expect(counts.characters).toBe(1)
    expect(counts.chats).toBe(1)
  })

  it('合并时跳过已有的角色；完全还原会清掉现有角色', async () => {
    const { bytes } = await buildArchive(src, { characterIds: null, includeSettings: false, app: 'test' })
    const dst = tmp('dst2')
    await seed(dst, 'chA', '本地甲')
    await seed(dst, 'chZ', '本地丙')
    let sum = await inspectArchive(dst, bytes)
    expect(sum.characters.find((c) => c.id === 'chA')!.exists).toBe(true)
    await applyArchive(dst, sum.token, { mode: 'merge', conflict: 'skip', applySettings: false }, 'test')
    expect((await dst.readJSON<any>('characters/chA/character.json')).name).toBe('本地甲')
    expect(await dst.exists('characters/chB/character.json')).toBe(true)
    sum = await inspectArchive(dst, bytes)
    await applyArchive(dst, sum.token, { mode: 'replace', conflict: 'overwrite', applySettings: false }, 'test')
    expect(await dst.exists('characters/chZ/character.json')).toBe(false)
    expect((await dst.readJSON<any>('characters/chA/character.json')).name).toBe('甲')
  })

  it('拒绝越界路径与非存档文件', async () => {
    const evil = zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'yaotang-archive', version: 1, counts: {} })), '../evil.txt': strToU8('x'), 'characters/a/../../x.json': strToU8('x') })
    const dst = tmp('dst3')
    const sum = await inspectArchive(dst, evil)
    await applyArchive(dst, sum.token, { mode: 'merge', conflict: 'overwrite', applySettings: false }, 'test')
    expect(fs.existsSync(path.join(dst.root, '..', 'evil.txt'))).toBe(false)
    await expect(inspectArchive(dst, new Uint8Array([1, 2, 3]))).rejects.toThrow()
  })
})
