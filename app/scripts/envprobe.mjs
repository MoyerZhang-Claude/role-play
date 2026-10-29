// 离线复现：噪声起点与音量包络起点因取整差一个采样时，默认增益 1 会漏出一个满幅度的噪声采样。
// node scripts/envprobe.mjs
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const app = await electron.launch({ executablePath: require('electron'), args: [appDir], cwd: appDir, env: { ...process.env, YAOTANG_OPENING: '0', YAOTANG_DATA_DIR: process.argv[2] } })
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
const run = (fixed) =>
  win.evaluate(async (fixed) => {
    const sr = 48000
    const secs = 140
    const ctx = new OfflineAudioContext(1, sr * secs, sr)
    const noise = ctx.createBuffer(1, sr * 2, sr)
    const d = noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    const times = []
    // 与药汤的悬停音相同：t = 某个渲染块的起点 + 16ms，每 0.37 秒一次
    for (let q = 0; q * 0.37 < secs - 1; q++) {
      const now = Math.round((q * 0.37 * sr) / 128) * 128 / sr
      const t = now + 0.016
      const src = ctx.createBufferSource()
      src.buffer = noise
      const f = ctx.createBiquadFilter()
      f.type = 'highpass'
      f.frequency.setValueAtTime(3800, t)
      f.Q.value = 0.7
      const g = ctx.createGain()
      if (fixed) g.gain.value = 0
      g.gain.setValueAtTime(0.0001, t)
      g.gain.linearRampToValueAtTime(0.012, t + 0.004)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.039)
      src.connect(f).connect(g).connect(ctx.destination)
      src.start(t, Math.random() * 1.5)
      src.stop(t + 0.09)
      times.push(t)
    }
    const out = (await ctx.startRendering()).getChannelData(0)
    // 每次起音附近的最大样本值：正常应在 0.012 左右以内
    const res = times.map((t) => {
      const a = Math.floor(t * sr) - 4
      let m = 0
      for (let k = a; k < a + 64; k++) m = Math.max(m, Math.abs(out[k]))
      return { t, m }
    })
    const bad = res.filter((r) => r.m > 0.05)
    return { events: res.length, bad: bad.length, firstBadAt: bad[0]?.t ?? null, maxOnset: Math.max(...res.map((r) => r.m)), badBefore64: bad.filter((r) => r.t < 64).length }
  }, fixed)
console.log('current code :', JSON.stringify(await run(false)))
console.log('with gain = 0:', JSON.stringify(await run(true)))
await app.close()
process.exit(0)
