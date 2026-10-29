import { safeStorage } from 'electron'
import type { DataStore } from './storage'

/**
 * API 密钥：用 Windows DPAPI（Electron safeStorage）加密后存进 data/secrets.json。
 * 只能在本机、本 Windows 用户下解密；不进入页面进程，不随存档导出。
 */
type SecretFile = { version: 1; items: Record<string, { enc: string; hint: string }> }

export class Secrets {
  private cache: SecretFile | null = null
  constructor(private store: DataStore) {}

  private async load(): Promise<SecretFile> {
    if (this.cache) return this.cache
    const f = await this.store.readJSON<SecretFile>('secrets.json')
    this.cache = f && f.items ? f : { version: 1, items: {} }
    return this.cache
  }

  private async save() {
    if (this.cache) await this.store.writeJSON('secrets.json', this.cache)
  }

  available(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  async set(id: string, key: string): Promise<void> {
    const f = await this.load()
    const k = key.trim()
    if (!k) {
      delete f.items[id]
    } else {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法安全保存密钥')
      const enc = safeStorage.encryptString(k).toString('base64')
      f.items[id] = { enc, hint: maskKey(k) }
    }
    await this.save()
  }

  async get(id: string): Promise<string | null> {
    const f = await this.load()
    const it = f.items[id]
    if (!it) return null
    try {
      return safeStorage.decryptString(Buffer.from(it.enc, 'base64'))
    } catch {
      return null
    }
  }

  async hint(id: string): Promise<string | null> {
    const f = await this.load()
    return f.items[id]?.hint ?? null
  }

  async remove(id: string): Promise<void> {
    const f = await this.load()
    delete f.items[id]
    await this.save()
  }
}

export function maskKey(k: string): string {
  if (k.length <= 8) return '••••'
  return `${k.slice(0, 5)}…${k.slice(-4)}`
}
