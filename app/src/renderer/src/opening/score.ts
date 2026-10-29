/**
 * 开场配乐（与画面同一条时间轴，单位秒）。
 * 音乐部分走音乐总线，落墨、落印等走音效总线，分别受各自开关控制。
 */
import { audio } from '../audio/engine'
import { MOTE_T0, MOTE_GAP, MOTE_FLY, DROP_UP, DROP_HIT } from './scene'

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

export class OpeningScore {
  private mus: GainNode | null = null
  private sfx: GainNode | null = null
  private nodes: AudioScheduledSourceNode[] = []

  start(delay = 0.05) {
    const ctx = audio.ensure()
    const T = ctx.currentTime + delay
    this.mus = ctx.createGain()
    this.sfx = ctx.createGain()
    this.mus.connect(audio.music)
    this.sfx.connect(audio.sfx)
    const musVerb = ctx.createGain()
    musVerb.gain.value = 0.9
    this.mus.connect(musVerb).connect(audio.musicVerb)
    const sfxVerb = ctx.createGain()
    sfxVerb.gain.value = 0.6
    this.sfx.connect(sfxVerb).connect(audio.sfxVerb)
    const M = this.mus
    const S = this.sfx

    const osc = (type: OscillatorType, f: number, t0: number, t1: number, env: [number, number][], dest: AudioNode, f1?: number, glide?: number, detune = 0) => {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.setValueAtTime(f, T + t0)
      if (f1) o.frequency.exponentialRampToValueAtTime(f1, T + t0 + (glide ?? t1 - t0))
      o.detune.value = detune
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, T + t0)
      for (const [at, v] of env) g.gain.linearRampToValueAtTime(Math.max(0.0001, v), T + at)
      o.connect(g).connect(dest)
      o.start(T + t0)
      o.stop(T + t1 + 0.05)
      this.nodes.push(o)
      return { o, g }
    }
    const noise = (t0: number, dur: number, type: BiquadFilterType, f0: number, f1: number, q: number, peak: number, dest: AudioNode, attack = 0.01) => {
      const src = ctx.createBufferSource()
      src.buffer = audio.noise
      const f = ctx.createBiquadFilter()
      f.type = type
      f.Q.value = q
      f.frequency.setValueAtTime(f0, T + t0)
      f.frequency.exponentialRampToValueAtTime(f1, T + t0 + dur)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, T + t0)
      g.gain.linearRampToValueAtTime(peak, T + t0 + attack)
      g.gain.exponentialRampToValueAtTime(0.0001, T + t0 + dur)
      src.connect(f).connect(g).connect(dest)
      src.start(T + t0, Math.random())
      src.stop(T + t0 + dur + 0.05)
      this.nodes.push(src)
    }

    // 室内底噪与低音长音（D）
    noise(0, 6.2, 'lowpass', 260, 180, 0.5, 0.035, S, 0.9)
    osc('sine', mtof(38), 0, 6.4, [[1.4, 0.07], [4.8, 0.06], [6.3, 0.0001]], M)
    osc('triangle', mtof(45), 0.3, 6.4, [[1.8, 0.03], [4.8, 0.028], [6.3, 0.0001]], M)

    // 墨滴落下
    noise(0.5, 0.45, 'bandpass', 3600, 900, 2, 0.022, S, 0.2)
    // 落纸：一声「滴」+ 低沉的回响
    osc('sine', 1450, 0.97, 1.12, [[0.972, 0.17], [1.1, 0.0001]], S, 330, 0.05)
    osc('sine', 92, 0.97, 2.6, [[0.99, 0.34], [2.5, 0.0001]], S, 38, 0.7)
    noise(0.97, 0.16, 'bandpass', 2200, 1200, 1.4, 0.07, S, 0.003)

    // 符文琴音：沿着法阵转一圈（声像也跟着转）
    const arp = [62, 65, 69, 72, 76, 74, 77, 81, 84, 88]
    arp.forEach((m, i) => {
      const t = 1.12 + i * 0.128
      const pan = ctx.createStereoPanner()
      pan.pan.value = Math.sin((i / arp.length) * Math.PI * 2) * 0.7
      pan.connect(M)
      audio.bell({ f: mtof(m), at: T + t, peak: 0.05 - i * 0.002, decay: 1.8, ratio: 2.0, index: 0.35, dest: pan })
      audio.bell({ f: mtof(m + 12), at: T + t + 0.004, peak: 0.012, decay: 0.9, ratio: 3.0, index: 0.2, dest: pan })
    })
    // 七芒星连线：细小的玻璃音
    for (let i = 0; i < 7; i++) audio.bell({ f: mtof(93 + [0, 3, 7, 10, 12, 7, 3][i]), at: T + 1.86 + i * 0.075, peak: 0.012, decay: 0.6, ratio: 3.5, index: 0.6, dest: M })

    // 点亮：上扬的微光 + 和弦铺开（Dm9）
    noise(2.62, 0.9, 'highpass', 700, 7000, 0.7, 0.045, S, 0.5)
    ;[50, 53, 57, 60, 64].forEach((m, i) => {
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(500, T + 2.65)
      lp.frequency.linearRampToValueAtTime(1800, T + 3.6)
      lp.frequency.linearRampToValueAtTime(900, T + 5.6)
      lp.connect(M)
      for (const d of [-7, 7]) osc('sawtooth', mtof(m), 2.65, 6.2, [[3.3, 0.016], [4.7, 0.014], [6.1, 0.0001]], lp, undefined, undefined, d + i)
    })

    // 四味药材飞入：起飞时一缕上扬的风，落入时一声咕嘟 + 一个音（D F A D）
    const arrive = [74, 77, 81, 86]
    for (let i = 0; i < 4; i++) {
      const t0 = MOTE_T0 + i * MOTE_GAP
      const t1 = t0 + MOTE_FLY
      noise(t0, MOTE_FLY, 'bandpass', 900 + i * 200, 3200 + i * 300, 3, 0.016, S, 0.3)
      const f = 230 + i * 40
      osc('sine', f, t1, t1 + 0.07, [[t1 + 0.006, 0.05], [t1 + 0.07, 0.0001]], S, f * 2.3, 0.06)
      audio.bell({ f: mtof(arrive[i]), at: T + t1 + 0.01, peak: 0.032, decay: 1.6, ratio: 2.0, index: 0.3, dest: M, pan: (i % 2 ? 1 : -1) * 0.35 })
    }
    // 熬成：一阵细碎的微光
    noise(4.05, 0.55, 'highpass', 2500, 9000, 0.7, 0.028, S, 0.3)
    for (let i = 0; i < 6; i++) audio.bell({ f: mtof(93 + [0, 2, 5, 7, 9, 12][i]), at: T + 4.1 + i * 0.04, peak: 0.008, decay: 0.8, ratio: 3.5, index: 0.5, dest: M })

    // 金滴跃起（上扬）与落下（清脆的一滴 + 低沉回响）
    osc('sine', 300, DROP_UP, DROP_UP + 0.28, [[DROP_UP + 0.02, 0.07], [DROP_UP + 0.28, 0.0001]], S, 900, 0.25)
    osc('sine', 1900, DROP_HIT, DROP_HIT + 0.14, [[DROP_HIT + 0.003, 0.12], [DROP_HIT + 0.14, 0.0001]], S, 620, 0.05)
    osc('sine', 110, DROP_HIT, DROP_HIT + 1.2, [[DROP_HIT + 0.01, 0.2], [DROP_HIT + 1.1, 0.0001]], S, 44, 0.6)

    // 终和弦（D 大调，明亮的落定）+ 揭开纸页的风声
    ;[74, 78, 81, 88].forEach((m, i) => audio.bell({ f: mtof(m), at: T + 4.86 + i * 0.035, peak: 0.032, decay: 3.2, ratio: 2.0, index: 0.32, dest: M }))
    noise(4.7, 0.7, 'bandpass', 600, 3200, 0.9, 0.04, S, 0.45)
  }

  /** 跳过：快速淡出 */
  stop(fade = 0.3) {
    const ctx = audio.ctx
    if (!ctx) return
    const t = ctx.currentTime
    for (const g of [this.mus, this.sfx]) {
      if (!g) continue
      g.gain.cancelScheduledValues(t)
      g.gain.setValueAtTime(g.gain.value, t)
      g.gain.linearRampToValueAtTime(0, t + fade)
    }
    window.setTimeout(() => {
      for (const n of this.nodes) {
        try {
          n.stop()
        } catch {
          /* 已停止 */
        }
      }
      this.mus?.disconnect()
      this.sfx?.disconnect()
    }, fade * 1000 + 80)
  }
}
