// 测量鼠标在卡片间移动时的绘制负载跳变（笔记本「电流声」常由负载突变引起）。
// 采样：药汤 GPU 进程在显卡 3D 引擎上的占用（Windows 性能计数器）+ 各进程 CPU。
// node scripts/gpuprobe.mjs <数据目录> [每段秒数]
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = process.argv[2]
const secs = Number(process.argv[3] || 10)
const app = await electron.launch({ executablePath: require('electron'), args: [appDir], cwd: appDir, env: { ...process.env, YAOTANG_OPENING: '0', YAOTANG_DATA_DIR: dataDir } })
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(3000)

const metrics = () => app.evaluate(({ app }) => app.getAppMetrics().map((m) => ({ type: m.type, pid: m.pid, cpu: m.cpu.percentCPUUsage })))
const m0 = await metrics()
const gpuPid = m0.find((m) => m.type === 'GPU')?.pid
console.log('gpu pid', gpuPid)

let phase = 'warm'
const gpu = []
const ps = spawn('powershell.exe', ['-NoProfile', '-Command', `while($true){ $s=(Get-Counter '\\GPU Engine(pid_${gpuPid}_*engtype_3D)\\Utilization Percentage' -ErrorAction SilentlyContinue).CounterSamples | Measure-Object CookedValue -Sum; Write-Output ([math]::Round($s.Sum,2)) }`])
ps.stdout.on('data', (b) => {
  for (const line of String(b).split(/\r?\n/)) if (line.trim() && Number.isFinite(Number(line))) gpu.push({ phase, v: Number(line) })
})
await win.waitForTimeout(2500)

const report = {}
const run = async (name, fn) => {
  phase = name
  await metrics()
  const cpus = []
  const t = setInterval(async () => {
    try {
      const m = await metrics()
      cpus.push(m.filter((x) => x.type === 'GPU' || x.type === 'Tab').reduce((n, x) => n + x.cpu, 0))
    } catch {}
  }, 1000)
  await fn()
  clearInterval(t)
  const g = gpu.filter((x) => x.phase === name).map((x) => x.v)
  report[name] = {
    gpu3dAvg: +(g.reduce((a, b) => a + b, 0) / Math.max(1, g.length)).toFixed(1),
    gpu3dMax: +Math.max(0, ...g).toFixed(1),
    cpuAvg: +(cpus.reduce((a, b) => a + b, 0) / Math.max(1, cpus.length)).toFixed(1),
    cpuMax: +Math.max(0, ...cpus).toFixed(1),
    n: g.length
  }
}
await run('idle1', () => win.waitForTimeout(secs * 1000))
const boxes = await win.$$eval('.char-card:not(.char-card-new), .recent-card', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] }).filter(([, y]) => y > 0 && y < innerHeight))
await run('hover', async () => {
  const t0 = Date.now()
  let i = 0
  while (Date.now() - t0 < secs * 1000) {
    const [x, y] = boxes[i++ % boxes.length]
    await win.mouse.move(x, y, { steps: 18 })
    for (let k = 0; k < 6; k++) await win.mouse.move(x + Math.sin(k) * 30, y + Math.cos(k) * 40, { steps: 3 })
  }
})
await win.mouse.move(5, 300)
await run('idle2', () => win.waitForTimeout(secs * 1000))
ps.kill()
console.log(JSON.stringify(report))
await app.close()
process.exit(0)
