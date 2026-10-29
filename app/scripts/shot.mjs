// 自动化截图 / 交互脚本：node scripts/shot.mjs <输出目录> [步骤 JSON 文件]
// 使用独立的数据目录，不会碰到正式数据。
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = process.argv[2] || path.join(appDir, 'shots')
const stepsFile = process.argv[3]
const dataDir = process.env.SHOT_DATA || path.join(out, 'data')
fs.mkdirSync(out, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })

const steps = stepsFile ? JSON.parse(fs.readFileSync(stepsFile, 'utf8')) : [{ wait: 1500 }, { shot: 'home' }]

const exe = process.env.SHOT_EXE
const env = { ...process.env, YAOTANG_OPENING: process.env.SHOT_OPENING ?? '0' }
if (!exe) env.YAOTANG_DATA_DIR = dataDir
const app = await electron.launch({
  executablePath: exe || electronPath,
  args: exe ? [] : [appDir],
  cwd: exe ? path.dirname(exe) : appDir,
  env
})
const win = await app.firstWindow()
win.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}]`, m.text())
})
win.on('pageerror', (e) => console.log('[pageerror]', e.message))
await win.waitForLoadState('domcontentloaded')
if (process.env.SHOT_SIZE) {
  const [w, h] = process.env.SHOT_SIZE.split('x').map(Number)
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [w, h])
}

for (const s of steps) {
  try {
    if (s.wait) await win.waitForTimeout(s.wait)
    if (s.setKeyFromFile) {
      // 从文件里取出密钥交给应用加密保存（不打印）
      // 字符串：取 DeepSeek 的 sk- 密钥；对象 { file, line }：取包含 line 的那一行冒号后面的部分
      const spec = typeof s.setKeyFromFile === 'string' ? { file: s.setKeyFromFile } : s.setKeyFromFile
      const buf = fs.readFileSync(spec.file)
      let text
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
      } catch {
        text = new TextDecoder('gb18030').decode(buf)
      }
      const key = spec.line
        ? (text.split(/\r?\n/).find((l) => l.toLowerCase().includes(spec.line.toLowerCase())) ?? '').split(/[：:]/).slice(1).join(':').trim()
        : text.match(/sk-[A-Za-z0-9]+/)?.[0]
      const ok = await win.evaluate(async (k) => {
        const id = window.__yt.settings.getState().s.api.activeProfileId
        await window.yt.secrets.set(id, k)
        return !!id
      }, key)
      console.log('key set:', ok && !!key)
    }
    if (s.mockSave) {
      // 让「另存为」对话框直接返回指定路径（测试用）
      await app.evaluate(({ dialog }, p) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: p })
      }, s.mockSave)
    }
    if (s.click) await win.click(s.click, { timeout: 8000 })
    if (s.dblclick) await win.dblclick(s.dblclick)
    if (s.hover) await win.hover(s.hover)
    if (s.fill) await win.fill(s.fill[0], s.fill[1])
    if (s.type) await win.keyboard.type(s.type, { delay: 10 })
    if (s.press) await win.keyboard.press(s.press)
    if (s.files) {
      // 模拟导入：直接调用页面内的导入函数
      const payload = s.files.map((f) => ({ name: path.basename(f), b64: fs.readFileSync(f).toString('base64') }))
      await win.evaluate(async (files) => {
        const list = files.map((f) => ({ name: f.name, bytes: Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0)) }))
        window.__importFiles(list)
      }, payload)
    }
    if (s.drag) {
      // 长按 → 拖动 → （可选截图）→ 松开
      const center = async (sel) => {
        if (Array.isArray(sel)) return { x: sel[0], y: sel[1] }
        const b = await win.locator(sel).first().boundingBox()
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
      }
      const a = await center(s.drag.from)
      const b = await center(s.drag.to)
      await win.mouse.move(a.x, a.y)
      await win.mouse.down()
      await win.waitForTimeout(s.drag.hold ?? 400)
      const steps = s.drag.steps ?? 20
      for (let i = 1; i <= steps; i++) {
        await win.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps)
        await win.waitForTimeout(16)
      }
      await win.waitForTimeout(250)
      if (s.drag.shot) await win.screenshot({ path: path.join(out, `${s.drag.shot}.png`) })
      await win.mouse.up()
    }
    if (s.eval) console.log('eval:', JSON.stringify(await win.evaluate(s.eval)))
    if (s.waitFor) await win.waitForSelector(s.waitFor, { timeout: s.timeout ?? 15000 })
    if (s.shot) {
      await win.screenshot({ path: path.join(out, `${s.shot}.png`) })
      console.log('shot', s.shot)
    }
  } catch (e) {
    console.log('step failed', JSON.stringify(s), String(e).slice(0, 300))
    if (s.required) break
  }
}
if (!process.env.SHOT_KEEP) await app.close()
