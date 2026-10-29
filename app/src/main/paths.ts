import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export interface DataLocation {
  dir: string
  /** 程序目录不可写，退回到 %APPDATA% */
  fallback: boolean
}

function writable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const probe = path.join(dir, `.probe-${process.pid}`)
    fs.writeFileSync(probe, 'ok')
    fs.unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

/**
 * 数据目录：
 * - 开发时：项目下的 data-dev/
 * - 安装后：程序所在目录下的 data/（程序与数据放在一起）
 * - 程序目录不可写（例如装进了 Program Files）：%APPDATA%/药汤/data
 */
export function resolveDataLocation(): DataLocation {
  if (process.env.YAOTANG_DATA_DIR) {
    fs.mkdirSync(process.env.YAOTANG_DATA_DIR, { recursive: true })
    return { dir: process.env.YAOTANG_DATA_DIR, fallback: false }
  }
  if (!app.isPackaged) {
    const dir = path.join(app.getAppPath(), 'data-dev')
    fs.mkdirSync(dir, { recursive: true })
    return { dir, fallback: false }
  }
  const exeDir = path.dirname(app.getPath('exe'))
  const preferred = path.join(exeDir, 'data')
  if (writable(preferred)) return { dir: preferred, fallback: false }
  const alt = path.join(app.getPath('appData'), '药汤', 'data')
  fs.mkdirSync(alt, { recursive: true })
  return { dir: alt, fallback: true }
}

/** 把相对路径解析到数据目录内；越界则抛错 */
export function safeJoin(root: string, rel: string): string {
  const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  const full = path.resolve(root, clean)
  const r = path.resolve(root)
  if (full !== r && !full.startsWith(r + path.sep)) throw new Error('路径越界: ' + rel)
  return full
}
