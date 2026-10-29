import fsp from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import { safeJoin } from './paths'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 同一文件的写入排队，避免并发覆盖 */
const queues = new Map<string, Promise<unknown>>()
function enqueue<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(job)
  queues.set(
    key,
    next.finally(() => {
      if (queues.get(key) === next) queues.delete(key)
    })
  )
  return next
}

/** 原子写入：写临时文件 → 刷盘 → 替换。异常退出时旧文件保持完整。 */
export async function atomicWrite(file: string, data: string | Uint8Array): Promise<void> {
  return enqueue(file, async () => {
    await fsp.mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
    const fh = await fsp.open(tmp, 'w')
    try {
      await fh.writeFile(data)
      await fh.sync()
    } finally {
      await fh.close()
    }
    for (let i = 0; i < 6; i++) {
      try {
        await fsp.rename(tmp, file)
        return
      } catch (e: any) {
        if (['EPERM', 'EBUSY', 'EACCES'].includes(e?.code)) await sleep(25 * (i + 1))
        else {
          await fsp.unlink(tmp).catch(() => undefined)
          throw e
        }
      }
    }
    // 实在替换不了（被其它程序占用），退而求其次直接覆盖
    await fsp.copyFile(tmp, file)
    await fsp.unlink(tmp).catch(() => undefined)
  })
}

export class DataStore {
  constructor(public readonly root: string) {}

  p(rel: string) {
    return safeJoin(this.root, rel)
  }

  async readJSON<T = unknown>(rel: string): Promise<T | null> {
    const f = this.p(rel)
    try {
      const txt = await fsp.readFile(f, 'utf8')
      return JSON.parse(txt) as T
    } catch (e: any) {
      if (e?.code === 'ENOENT') return null
      // 文件损坏：尝试备份
      try {
        const bak = await fsp.readFile(f + '.bak', 'utf8')
        return JSON.parse(bak) as T
      } catch {
        if (e instanceof SyntaxError) {
          await fsp.copyFile(f, `${f}.broken-${Date.now()}`).catch(() => undefined)
          return null
        }
        throw e
      }
    }
  }

  async writeJSON(rel: string, data: unknown, opts?: { backup?: boolean }): Promise<void> {
    const f = this.p(rel)
    if (opts?.backup) await fsp.copyFile(f, f + '.bak').catch(() => undefined)
    await atomicWrite(f, JSON.stringify(data))
  }

  async readBytes(rel: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await fsp.readFile(this.p(rel)))
    } catch (e: any) {
      if (e?.code === 'ENOENT') return null
      throw e
    }
  }

  async writeBytes(rel: string, data: Uint8Array): Promise<void> {
    await atomicWrite(this.p(rel), data)
  }

  async list(rel: string): Promise<{ name: string; dir: boolean; mtime: number; size: number }[]> {
    const d = this.p(rel)
    try {
      const ents = await fsp.readdir(d, { withFileTypes: true })
      const out: { name: string; dir: boolean; mtime: number; size: number }[] = []
      for (const e of ents) {
        if (e.name.endsWith('.tmp')) continue
        let mtime = 0
        let size = 0
        try {
          const st = await fsp.stat(path.join(d, e.name))
          mtime = st.mtimeMs
          size = st.size
        } catch {
          /* 忽略 */
        }
        out.push({ name: e.name, dir: e.isDirectory(), mtime, size })
      }
      return out
    } catch (e: any) {
      if (e?.code === 'ENOENT') return []
      throw e
    }
  }

  async remove(rel: string): Promise<void> {
    const f = this.p(rel)
    if (path.resolve(f) === path.resolve(this.root)) throw new Error('不能删除数据根目录')
    await fsp.rm(f, { recursive: true, force: true })
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await fsp.access(this.p(rel))
      return true
    } catch {
      return false
    }
  }

  /** 启动时清理残留的临时文件 */
  cleanupTemp(): void {
    const walk = (dir: string, depth: number) => {
      if (depth > 3) return
      let ents: fs.Dirent[]
      try {
        ents = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of ents) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name !== 'runtime') walk(full, depth + 1)
        } else if (e.name.endsWith('.tmp')) {
          try {
            fs.unlinkSync(full)
          } catch {
            /* 忽略 */
          }
        }
      }
    }
    walk(this.root, 0)
  }
}
