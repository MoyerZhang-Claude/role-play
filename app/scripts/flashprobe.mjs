// 抓取开场结束前后每一帧的亮度，找出「白闪」帧。
// node scripts/flashprobe.mjs <输出目录> [replay]
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = process.argv[2] || path.join(appDir, 'shots-flash')
const replay = process.argv[3] === 'replay'
fs.mkdirSync(out, { recursive: true })
const dataDir = process.env.SHOT_DATA || path.join(out, 'data')
fs.mkdirSync(dataDir, { recursive: true })

// SHOT_EXE：测试安装好的正式版（使用它自己目录下的 data）
const exe = process.env.SHOT_EXE
const app = exe
  ? await electron.launch({ executablePath: exe, args: [], cwd: path.dirname(exe), env: { ...process.env, YAOTANG_OPENING: '1' } })
  : await electron.launch({ executablePath: electronPath, args: [appDir], cwd: appDir, env: { ...process.env, YAOTANG_OPENING: '1', YAOTANG_DATA_DIR: dataDir } })
const win = await app.firstWindow()
win.on('console', (m) => {
  if (m.text().startsWith('[probe]')) console.log(m.text())
})

const startProbe = () =>
  app.evaluate(({ BrowserWindow }, outDir) => {
    const w = BrowserWindow.getAllWindows()[0]
    const fs = process.mainModule.require('node:fs')
    const path = process.mainModule.require('node:path')
    const t0 = Date.now()
    const rows = []
    let saved = 0
    let prev = null
    globalThis.__probeRows = rows
    w.webContents.beginFrameSubscription(false, (image) => {
      const t = Date.now() - t0
      const { width, height } = image.getSize()
      const buf = image.toBitmap()
      let sum = 0
      let n = 0
      let bright = 0
      for (let y = 4; y < height; y += 23) {
        for (let x = 4; x < width; x += 23) {
          const i = (y * width + x) * 4
          const l = 0.0722 * buf[i] + 0.7152 * buf[i + 1] + 0.2126 * buf[i + 2]
          sum += l
          n++
          if (l > 245) bright++
        }
      }
      const mean = sum / n
      const row = { t, mean: Math.round(mean * 10) / 10, bright: Math.round((bright / n) * 1000) / 10 }
      rows.push(row)
      // 亮度突变的帧存图
      if (prev && Math.abs(mean - prev.mean) > 25 && saved < 12) {
        fs.writeFileSync(path.join(outDir, `jump-${t}-${Math.round(mean)}.png`), image.toPNG())
        saved++
      }
      prev = row
    })
    return true
  }, out)

const stopProbe = () =>
  app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.endFrameSubscription()
    return globalThis.__probeRows
  })

await startProbe()
await win.waitForTimeout(9000)
let rows = await stopProbe()
fs.writeFileSync(path.join(out, 'frames-boot.json'), JSON.stringify(rows))
console.log('boot frames', rows.length)

if (replay) {
  await win.evaluate(() => window.dispatchEvent(new Event('yt:replay-opening')))
  await startProbe()
  await win.waitForTimeout(1500)
  await win.screenshot({ path: path.join(out, 'replay-1.5s.png') })
  await win.waitForTimeout(700)
  await win.screenshot({ path: path.join(out, 'replay-2.2s.png') })
  await win.waitForTimeout(5800)
  rows = await stopProbe()
  fs.writeFileSync(path.join(out, 'frames-replay.json'), JSON.stringify(rows))
  console.log('replay frames', rows.length)
}
await app.close()
