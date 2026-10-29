// 声音诊断：在应用内几个位置（音效总线、音乐总线、混音、最终输出）录音，统计每次悬停起音处的突变；可配合系统回放录音对照。
// 例：SEQ=lp1 A_MS=15000 B_MS=35000 node scripts/loopprobe2.mjs <数据目录> <结果.json> 25（复现「电音」的场景，修复前 3–12 次尖峰，修复后 0）
// node scripts/loopprobe2.mjs <数据目录> <结果 json> [秒数]
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [dataDir, outFile, secsArg] = process.argv.slice(2)
const secs = Number(secsArg || 20)
// 录音模块写在页面旁边（file:// 页面不能从 blob / data 加载音频模块），跑完删掉
const recFile = path.join(appDir, 'out', 'renderer', 'yt-rec-probe.js')
fs.writeFileSync(recFile, "class R extends AudioWorkletProcessor{constructor(){super();this.on=false;this.port.onmessage=(e)=>{this.on=e.data}}process(i){if(!this.on)return true;const c=i[0];const m=new Float32Array(128);if(c&&c.length){const L=c[0],Rr=c[1]||c[0];for(let k=0;k<L.length;k++)m[k]=(L[k]+Rr[k])/2}this.port.postMessage({t:currentTime,m},[m.buffer]);return true}}registerProcessor('yt-rec',R)")
const app = await electron.launch({ executablePath: require('electron'), args: [appDir], cwd: appDir, env: { ...process.env, YAOTANG_OPENING: '0', YAOTANG_DATA_DIR: dataDir } })
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(3500)

await win.evaluate(async () => {
  const a = window.__yt.audio
  const ctx = a.ctx
  await ctx.audioWorklet.addModule('./yt-rec-probe.js')
  const node = new AudioWorkletNode(ctx, 'yt-rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' })
  const mute = ctx.createGain()
  mute.gain.value = 0
  a.out.connect(node).connect(mute).connect(ctx.destination)
  window.__rec = { node, blocks: [], t0: null }
  node.port.onmessage = (e) => {
    if (window.__rec.t0 == null) window.__rec.t0 = e.data.t
    window.__rec.blocks.push(e.data.m)
  }
  // 额外的录音点：音效总线、音乐总线、压缩之前的总混音
  window.__taps = {}
  for (const [name, src] of [['sfx', a.sfx], ['music', a.music], ['master', a.master], ['verb', a.verbOut]]) {
    const n = new AudioWorkletNode(ctx, 'yt-rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' })
    const z = ctx.createGain()
    z.gain.value = 0
    src.connect(n).connect(z).connect(ctx.destination)
    const tap = (window.__taps[name] = { node: n, blocks: [], t0: null })
    n.port.onmessage = (e) => {
      if (tap.t0 == null) tap.t0 = e.data.t
      tap.blocks.push(e.data.m)
    }
  }
  const orig = a.hover.bind(a)
  window.__hov = []
  a.hover = () => {
    const before = a.lastHover
    orig()
    if (a.lastHover !== before) window.__hov.push({ t: Date.now(), ctxT: ctx.currentTime })
  }
})
const boxes = await win.$$eval('.char-card:not(.char-card-new)', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] }).filter(([, y]) => y > 0 && y < innerHeight))
// PRE_SILENCE=秒：先关掉音乐静默一段时间，再开音乐（复现「安静一会儿后再划卡片」）
const pre = Number(process.env.PRE_SILENCE || 0)
if (pre) {
  await win.evaluate(() => { window.__yt.settings.getState().update((d) => { d.sound.musicEnabled = false }); window.__yt.music.stop(0.3) })
  await win.waitForTimeout(pre * 1000)
  await win.evaluate(() => { window.__yt.settings.getState().update((d) => { d.sound.musicEnabled = true }); window.__yt.music.start(0.5) })
  await win.waitForTimeout(1500)
}
const playing = await win.evaluate(() => window.__yt.music.playing)
await win.evaluate(() => { window.__rec.node.port.postMessage(true); for (const t of Object.values(window.__taps)) t.node.port.postMessage(true) })
const tStart = Date.now()
const phases = []
let i = 0
const sweep = async (ms) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (process.env.HOVER === 'api') {
      await win.evaluate(() => window.__yt.audio.hover())
      await win.waitForTimeout(700)
      continue
    }
    const [x, y] = boxes[i++ % boxes.length]
    await win.mouse.move(x, y, { steps: 14 })
    await win.waitForTimeout(450)
  }
  await win.mouse.move(5, 400, { steps: 4 })
}
if (process.env.KEEPALIVE) {
  // 让输出永远「不是完全静音」：一个远低于可听范围的直流（约 -140 dB）
  await win.evaluate(() => {
    const ctx = window.__yt.audio.ctx
    const c = ctx.createConstantSource()
    c.offset.value = 1e-7
    c.connect(ctx.destination)
    c.start()
  })
}
if (process.env.SEQ === 'lp1') {
  // 与第一次测试相同：关音乐划卡片 → 静默 35 秒 → 几次单独悬停 → 开音乐划卡片
  phases.push({ name: 'A', t: Date.now() })
  await win.evaluate(() => { window.__yt.settings.getState().update((d) => { d.sound.musicEnabled = false }); window.__yt.music.stop(0.3) })
  await win.waitForTimeout(2000)
  await sweep(Number(process.env.A_MS || 15000))
  phases.push({ name: 'B', t: Date.now() })
  await win.waitForTimeout(Number(process.env.B_MS || 35000))
  for (let k = 0; k < 5; k++) {
    const [x, y] = boxes[k % boxes.length]
    await win.mouse.move(x, y, { steps: 6 })
    await win.waitForTimeout(1200)
    await win.mouse.move(5, 400, { steps: 3 })
    await win.waitForTimeout(300)
  }
  phases.push({ name: 'C', t: Date.now() })
  await win.evaluate(() => { window.__yt.settings.getState().update((d) => { d.sound.musicEnabled = true }); window.__yt.music.start(0.5) })
  await win.waitForTimeout(2500)
  await sweep(secs * 1000)
} else await sweep(secs * 1000)
await win.evaluate(() => window.__rec.node.port.postMessage(false))
// 在应用里分析自己的输出：每次悬停起音附近的最大二阶差分
const res = await win.evaluate(() => {
  const r = window.__rec
  const n = r.blocks.reduce((s, b) => s + b.length, 0)
  const x = new Float32Array(n)
  let o = 0
  for (const b of r.blocks) {
    x.set(b, o)
    o += b.length
  }
  const sr = window.__yt.audio.ctx.sampleRate
  let peak = 0
  for (let k = 0; k < n; k++) peak = Math.max(peak, Math.abs(x[k]))
  const per = window.__hov.map((h) => {
    const a = Math.floor((h.ctxT - r.t0) * sr)
    let m = 0
    for (let k = Math.max(2, a); k < Math.min(n, a + Math.floor(0.12 * sr)); k++) m = Math.max(m, Math.abs(x[k] - 2 * x[k - 1] + x[k - 2]))
    return { t: h.t, d2: m }
  })
  let rms = 0
  for (let k = 0; k < n; k++) rms += x[k] * x[k]
  const perSec = []
  for (let s0 = 0; s0 + sr <= n; s0 += sr) {
    let q = 0
    for (let k = s0; k < s0 + sr; k++) q += x[k] * x[k]
    perSec.push(Math.sqrt(q / sr))
  }
  return { per, peak, rms: Math.sqrt(rms / n), secs: n / sr, perSec }
})
const tapRes = await win.evaluate(() => {
  const sr = window.__yt.audio.ctx.sampleRate
  const out = {}
  for (const [name, r] of Object.entries(window.__taps)) {
    const n = r.blocks.reduce((s, b) => s + b.length, 0)
    const x = new Float32Array(n)
    let o = 0
    for (const b of r.blocks) { x.set(b, o); o += b.length }
    out[name] = window.__hov.map((h) => {
      const a = Math.floor((h.ctxT - r.t0) * sr)
      let m = 0
      for (let k = Math.max(2, a); k < Math.min(n, a + Math.floor(0.12 * sr)); k++) m = Math.max(m, Math.abs(x[k] - 2 * x[k - 1] + x[k - 2]))
      return +m.toFixed(4)
    })
  }
  return out
})
const outD2 = res.per.map((p) => +p.d2.toFixed(4))
const spikes = outD2.map((v, k) => (v > 0.3 ? k : -1)).filter((k) => k >= 0)
console.log('hovers with a spike in final output:', spikes.length)
for (const k of spikes) console.log(`  hover #${k}: out ${outD2[k]}  master ${tapRes.master[k]}  verb ${tapRes.verb[k]}  sfx ${tapRes.sfx[k]}  music ${tapRes.music[k]}`)
console.log('max per tap: out', Math.max(...outD2), 'master', Math.max(...tapRes.master), 'verb', Math.max(...tapRes.verb), 'sfx', Math.max(...tapRes.sfx), 'music', Math.max(...tapRes.music))
const lat = await win.evaluate(() => ({ out: window.__yt.audio.ctx.outputLatency, u: window.__yt.audio.ctx.playbackStats?.underrunEvents }))
fs.writeFileSync(outFile, JSON.stringify({ playing, tStart, phases, ...res, lat }))
const d = res.per.map((p) => p.d2).sort((a, b) => a - b)
console.log(`music ${playing}; app output ${res.secs.toFixed(1)}s peak ${res.peak.toFixed(3)} rms ${res.rms.toFixed(4)}; hovers ${d.length}; app-side d2 median ${d[d.length >> 1]?.toFixed(4)} max ${d[d.length - 1]?.toFixed(4)}; underruns ${lat.u}`)
await app.close()
fs.rmSync(recFile, { force: true })
process.exit(0)
