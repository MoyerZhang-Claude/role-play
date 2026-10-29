import { app, BrowserWindow, ipcMain, protocol, net, shell, dialog, screen } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolveDataLocation, safeJoin } from './paths'
import { DataStore } from './storage'
import { Secrets } from './secrets'
import { startStream, abortStream, listModels, testConnection } from './llm'
import { buildArchive, inspectArchive, applyArchive, discardArchive, type ApplyOptions } from './archive'
import type { ApiProfile, LLMMessage } from '@shared/types'

const here = path.dirname(fileURLToPath(import.meta.url))

/* ───────── 启动前设置 ───────── */

const loc = resolveDataLocation()
// Chromium 的缓存等也放进数据目录，不写 AppData
app.setPath('userData', path.join(loc.dir, 'runtime'))
app.setPath('sessionData', path.join(loc.dir, 'runtime'))
app.setPath('crashDumps', path.join(loc.dir, 'runtime', 'crashes'))
app.setAppUserModelId('com.yaotang.app')

// 性能：独显、GPU 光栅化；保持垂直同步（跟随屏幕 240Hz）
app.commandLine.appendSwitch('force_high_performance_gpu')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')
app.commandLine.appendSwitch('ignore-gpu-blocklist')

protocol.registerSchemesAsPrivileged([{ scheme: 'yt-data', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } }])

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

const store = new DataStore(loc.dir)
const secrets = new Secrets(store)
let win: BrowserWindow | null = null

const isDev = !app.isPackaged
const devUrl = process.env.ELECTRON_RENDERER_URL

/* ───────── 窗口状态 ───────── */

interface WinState {
  bounds?: { x: number; y: number; width: number; height: number }
  maximized?: boolean
}

function loadWinState(): WinState {
  try {
    return JSON.parse(fs.readFileSync(path.join(loc.dir, 'window.json'), 'utf8'))
  } catch {
    return {}
  }
}

function boundsVisible(b: WinState['bounds']): boolean {
  if (!b) return false
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return b.x < a.x + a.width - 100 && b.x + b.width > a.x + 100 && b.y >= a.y - 20 && b.y < a.y + a.height - 100
  })
}

let saveTimer: NodeJS.Timeout | null = null
function saveWinState() {
  if (!win) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return
    const st: WinState = { maximized: win.isMaximized(), bounds: win.isMaximized() || win.isMinimized() ? loadWinState().bounds : win.getBounds() }
    store.writeJSON('window.json', st).catch(() => undefined)
  }, 400)
}

function iconPath(): string | undefined {
  const p = isDev ? path.join(app.getAppPath(), 'build', 'icon.ico') : path.join(process.resourcesPath, 'icon.ico')
  return fs.existsSync(p) ? p : undefined
}

function createWindow() {
  const st = loadWinState()
  const wa = screen.getPrimaryDisplay().workAreaSize
  const def = { width: Math.min(1480, Math.round(wa.width * 0.86)), height: Math.min(960, Math.round(wa.height * 0.88)) }
  const b = boundsVisible(st.bounds) ? st.bounds! : undefined

  win = new BrowserWindow({
    width: b?.width ?? def.width,
    height: b?.height ?? def.height,
    x: b?.x,
    y: b?.y,
    minWidth: 980,
    minHeight: 640,
    frame: false,
    show: false,
    backgroundColor: '#120c08',
    title: '药汤',
    icon: iconPath(),
    webPreferences: {
      preload: path.join(here, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  if (st.maximized) win.maximize()

  win.once('ready-to-show', () => win?.show())
  // 鼠标侧键（Windows 的 WM_APPCOMMAND）→ 页面里的前进 / 后退
  win.on('app-command', (_e, cmd) => win?.webContents.send('app:command', cmd))
  win.on('maximize', () => win?.webContents.send('win:maximized', true))
  win.on('unmaximize', () => win?.webContents.send('win:maximized', false))
  win.on('resize', saveWinState)
  win.on('move', saveWinState)
  win.on('close', () => {
    if (!win) return
    const s: WinState = { maximized: win.isMaximized(), bounds: win.isMaximized() ? loadWinState().bounds ?? win.getNormalBounds() : win.getBounds() }
    try {
      fs.writeFileSync(path.join(loc.dir, 'window.json'), JSON.stringify(s))
    } catch {
      /* 忽略 */
    }
  })
  win.on('closed', () => (win = null))

  // 外部链接一律用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (devUrl && url.startsWith(devUrl)) return
    e.preventDefault()
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
  })

  if (devUrl) win.loadURL(devUrl)
  else {
    const query: Record<string, string> = {}
    if (process.env.YAOTANG_OPENING === '0') query.opening = '0'
    if (process.env.YAOTANG_OPENING_T) query.t = process.env.YAOTANG_OPENING_T
    win.loadFile(path.join(here, '../renderer/index.html'), Object.keys(query).length ? { query } : undefined)
  }
}

/* ───────── IPC ───────── */

function registerIpc() {
  ipcMain.handle('app:info', () => {
    const d = screen.getPrimaryDisplay()
    return {
      version: app.getVersion(),
      dataDir: loc.dir,
      dataFallback: loc.fallback,
      isDev,
      displayHz: d.displayFrequency,
      scaleFactor: d.scaleFactor,
      encryption: secrets.available(),
      electron: process.versions.electron,
      chrome: process.versions.chrome
    }
  })
  ipcMain.handle('app:openDataDir', (_e, rel?: string) => shell.openPath(rel ? safeJoin(loc.dir, rel) : loc.dir))
  ipcMain.handle('app:openExternal', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
  })
  ipcMain.handle('app:quit', () => app.quit())

  ipcMain.handle('win:minimize', () => win?.minimize())
  ipcMain.handle('win:toggleMaximize', () => {
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle('win:close', () => win?.close())
  ipcMain.handle('win:isMaximized', () => win?.isMaximized() ?? false)

  ipcMain.handle('fs:readJSON', (_e, rel: string) => store.readJSON(rel))
  ipcMain.handle('fs:writeJSON', (_e, rel: string, data: unknown, backup?: boolean) => store.writeJSON(rel, data, { backup }))
  ipcMain.handle('fs:readBytes', (_e, rel: string) => store.readBytes(rel))
  ipcMain.handle('fs:writeBytes', (_e, rel: string, data: Uint8Array) => store.writeBytes(rel, data))
  ipcMain.handle('fs:list', (_e, rel: string) => store.list(rel))
  ipcMain.handle('fs:remove', (_e, rel: string) => store.remove(rel))
  ipcMain.handle('fs:exists', (_e, rel: string) => store.exists(rel))

  ipcMain.handle('secrets:set', (_e, id: string, key: string) => secrets.set(id, key))
  ipcMain.handle('secrets:hint', (_e, id: string) => secrets.hint(id))
  ipcMain.handle('secrets:remove', (_e, id: string) => secrets.remove(id))

  ipcMain.handle('llm:start', async (e, requestId: string, profile: ApiProfile, messages: LLMMessage[]) => {
    const key = await secrets.get(profile.id)
    const sender = e.sender
    // 不等待：事件通过 llm:event 推送
    startStream(profile, key, requestId, messages, (ev) => {
      if (!sender.isDestroyed()) sender.send('llm:event', ev)
    })
    return true
  })
  ipcMain.handle('llm:abort', (_e, requestId: string) => abortStream(requestId))
  ipcMain.handle('llm:models', async (_e, profile: ApiProfile) => listModels(profile, await secrets.get(profile.id)))
  ipcMain.handle('llm:test', async (_e, profile: ApiProfile) => testConnection(profile, await secrets.get(profile.id)))

  ipcMain.handle('dialog:openFiles', async (_e, opts: { title?: string; filters?: { name: string; extensions: string[] }[]; multi?: boolean }) => {
    if (!win) return []
    const r = await dialog.showOpenDialog(win, {
      title: opts?.title ?? '选择文件',
      filters: opts?.filters,
      properties: opts?.multi === false ? ['openFile'] : ['openFile', 'multiSelections']
    })
    if (r.canceled) return []
    return Promise.all(r.filePaths.map(async (p) => ({ name: path.basename(p), bytes: new Uint8Array(await fs.promises.readFile(p)) })))
  })
  ipcMain.handle('dialog:saveFile', async (_e, defaultName: string, bytes: Uint8Array, filters?: { name: string; extensions: string[] }[]) => {
    if (!win) return null
    const r = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters })
    if (r.canceled || !r.filePath) return null
    await fs.promises.writeFile(r.filePath, bytes)
    return r.filePath
  })

  // 存档
  ipcMain.handle('archive:export', async (_e, opts: { characterIds: string[] | null; includeSettings: boolean }) => {
    const { bytes, counts } = await buildArchive(store, { ...opts, app: app.getVersion() })
    const d = new Date()
    const p2 = (n: number) => String(n).padStart(2, '0')
    const name = `药汤存档-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${opts.characterIds ? '-部分' : ''}.yaotang`
    if (!win) return null
    const r = await dialog.showSaveDialog(win, { title: '导出存档', defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: '药汤存档', extensions: ['yaotang'] }] })
    if (r.canceled || !r.filePath) return null
    await fs.promises.writeFile(r.filePath, bytes)
    return { path: r.filePath, size: bytes.length, counts }
  })
  ipcMain.handle('archive:pick', async () => {
    if (!win) return null
    const r = await dialog.showOpenDialog(win, { title: '导入存档', filters: [{ name: '药汤存档', extensions: ['yaotang', 'zip'] }], properties: ['openFile'] })
    if (r.canceled || !r.filePaths[0]) return null
    return inspectArchive(store, new Uint8Array(await fs.promises.readFile(r.filePaths[0])))
  })
  ipcMain.handle('archive:inspect', (_e, bytes: Uint8Array) => inspectArchive(store, bytes))
  ipcMain.handle('archive:apply', (_e, token: string, opts: ApplyOptions) => applyArchive(store, token, opts, app.getVersion()))
  ipcMain.handle('archive:discard', (_e, token: string) => discardArchive(token))

  // 自动化测试用：截取窗口画面（仅开发版）
  ipcMain.handle('dev:capture', async (_e, file: string) => {
    if (!win || !isDev) return null
    const img = await win.webContents.capturePage()
    await fs.promises.writeFile(file, img.toPNG())
    return file
  })
}

/* ───────── 启动 ───────── */

app.whenReady().then(() => {
  store.cleanupTemp()
  protocol.handle('yt-data', (req) => {
    try {
      const u = new URL(req.url)
      const rel = decodeURIComponent(u.pathname)
      const full = safeJoin(loc.dir, rel)
      return net.fetch(pathToFileURL(full).toString())
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
  registerIpc()
  createWindow()
})

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('window-all-closed', () => app.quit())
