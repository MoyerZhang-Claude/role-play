/**
 * 声音引擎：全部用 Web Audio 实时合成，不使用音频文件。
 * 总线：master ← sfx / music；共享一个温暖的混响。
 */

export interface SoundPrefs {
  sfxEnabled: boolean
  sfxVolume: number
  musicEnabled: boolean
  musicVolume: number
}

const SFX_BASE = 0.9
// 背景音乐整体再安静一些（用户反馈）
const MUSIC_BASE = 0.26

class Engine {
  ctx: AudioContext | null = null
  master!: GainNode
  sfx!: GainNode
  music!: GainNode
  reverb!: ConvolverNode
  sfxVerb!: GainNode
  musicVerb!: GainNode
  noise!: AudioBuffer
  prefs: SoundPrefs = { sfxEnabled: true, sfxVolume: 0.7, musicEnabled: true, musicVolume: 0.5 }
  private lastHover = 0

  ensure(): AudioContext {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => undefined)
      return this.ctx
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    this.ctx = ctx
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.knee.value = 12
    comp.ratio.value = 3
    comp.attack.value = 0.004
    comp.release.value = 0.25
    this.master = ctx.createGain()
    this.master.gain.value = 0.9
    this.master.connect(comp).connect(ctx.destination)

    this.sfx = ctx.createGain()
    this.music = ctx.createGain()
    this.sfx.connect(this.master)
    this.music.connect(this.master)

    this.reverb = ctx.createConvolver()
    this.reverb.buffer = makeImpulse(ctx, 3.2, 2.6)
    const verbOut = ctx.createGain()
    verbOut.gain.value = 0.9
    const verbLp = ctx.createBiquadFilter()
    verbLp.type = 'lowpass'
    verbLp.frequency.value = 5200
    this.reverb.connect(verbLp).connect(verbOut).connect(this.master)
    this.sfxVerb = ctx.createGain()
    this.sfxVerb.gain.value = 0.2
    this.musicVerb = ctx.createGain()
    this.musicVerb.gain.value = 0.55
    this.sfxVerb.connect(this.reverb)
    this.musicVerb.connect(this.reverb)

    this.noise = makeNoise(ctx, 2)
    this.applyPrefs(true)
    return ctx
  }

  setPrefs(p: SoundPrefs) {
    this.prefs = { ...p }
    if (this.ctx) this.applyPrefs(false)
  }

  private applyPrefs(instant: boolean) {
    const ctx = this.ctx!
    const t = ctx.currentTime
    const sv = this.prefs.sfxEnabled ? SFX_BASE * this.prefs.sfxVolume : 0
    const mv = this.prefs.musicEnabled ? MUSIC_BASE * this.prefs.musicVolume : 0
    for (const [node, v] of [
      [this.sfx, sv],
      [this.music, mv]
    ] as const) {
      node.gain.cancelScheduledValues(t)
      if (instant) node.gain.setValueAtTime(v, t)
      else {
        node.gain.setValueAtTime(node.gain.value, t)
        node.gain.linearRampToValueAtTime(v, t + 0.35)
      }
    }
    this.musicVerb.gain.setValueAtTime(this.prefs.musicEnabled ? 0.55 : 0, t)
  }

  get sfxOn() {
    return this.prefs.sfxEnabled && this.prefs.sfxVolume > 0
  }

  /* ───────── 基础合成积木 ───────── */

  /** 一个带包络的振荡器 */
  tone(o: { type?: OscillatorType; f0: number; f1?: number; glide?: number; at?: number; peak: number; attack?: number; decay: number; dest?: AudioNode; verb?: number; pan?: number; detune?: number }) {
    const ctx = this.ensure()
    const t = (o.at ?? ctx.currentTime) + 0.002
    const osc = ctx.createOscillator()
    osc.type = o.type ?? 'sine'
    osc.frequency.setValueAtTime(o.f0, t)
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + (o.glide ?? o.decay * 0.6))
    if (o.detune) osc.detune.value = o.detune
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(o.peak, t + (o.attack ?? 0.002))
    g.gain.exponentialRampToValueAtTime(0.0001, t + (o.attack ?? 0.002) + o.decay)
    let out: AudioNode = g
    if (o.pan) {
      const p = ctx.createStereoPanner()
      p.pan.value = o.pan
      g.connect(p)
      out = p
    }
    osc.connect(g)
    out.connect(o.dest ?? this.sfx)
    if (o.verb) {
      const s = ctx.createGain()
      s.gain.value = o.verb
      out.connect(s).connect(this.sfxVerb)
    }
    osc.start(t)
    osc.stop(t + (o.attack ?? 0.002) + o.decay + 0.05)
  }

  /** 滤波噪声爆发 */
  burst(o: { at?: number; type?: BiquadFilterType; freq: number; freq1?: number; q?: number; peak: number; attack?: number; decay: number; dest?: AudioNode; verb?: number; pan?: number }) {
    const ctx = this.ensure()
    const t = (o.at ?? ctx.currentTime) + 0.002
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const f = ctx.createBiquadFilter()
    f.type = o.type ?? 'bandpass'
    f.frequency.setValueAtTime(o.freq, t)
    if (o.freq1) f.frequency.exponentialRampToValueAtTime(o.freq1, t + o.decay)
    f.Q.value = o.q ?? 1
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(o.peak, t + (o.attack ?? 0.002))
    g.gain.exponentialRampToValueAtTime(0.0001, t + (o.attack ?? 0.002) + o.decay)
    src.connect(f).connect(g)
    let out: AudioNode = g
    if (o.pan) {
      const p = ctx.createStereoPanner()
      p.pan.value = o.pan
      g.connect(p)
      out = p
    }
    out.connect(o.dest ?? this.sfx)
    if (o.verb) {
      const s = ctx.createGain()
      s.gain.value = o.verb
      out.connect(s).connect(this.sfxVerb)
    }
    src.start(t, Math.random() * 1.5)
    src.stop(t + (o.attack ?? 0.002) + o.decay + 0.05)
  }

  /** 柔和的 FM 铃音 */
  bell(o: { f: number; at?: number; peak: number; decay: number; ratio?: number; index?: number; dest?: AudioNode; verb?: number; pan?: number }) {
    const ctx = this.ensure()
    const t = (o.at ?? ctx.currentTime) + 0.002
    const car = ctx.createOscillator()
    const mod = ctx.createOscillator()
    const mg = ctx.createGain()
    car.frequency.value = o.f
    mod.frequency.value = o.f * (o.ratio ?? 3.5)
    const idx = o.f * (o.index ?? 1.2)
    mg.gain.setValueAtTime(idx, t)
    mg.gain.exponentialRampToValueAtTime(idx * 0.02 + 0.01, t + o.decay * 0.7)
    mod.connect(mg).connect(car.frequency)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(o.peak, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.decay)
    car.connect(g)
    let out: AudioNode = g
    if (o.pan) {
      const p = ctx.createStereoPanner()
      p.pan.value = o.pan
      g.connect(p)
      out = p
    }
    out.connect(o.dest ?? this.sfx)
    if (o.verb) {
      const s = ctx.createGain()
      s.gain.value = o.verb
      out.connect(s).connect(o.dest === this.music ? this.musicVerb : this.sfxVerb)
    }
    car.start(t)
    mod.start(t)
    car.stop(t + o.decay + 0.05)
    mod.stop(t + o.decay + 0.05)
  }

  /* ───────── 界面音效 ───────── */

  click() {
    if (!this.sfxOn) return
    const j = 1 + (Math.random() - 0.5) * 0.08
    this.tone({ f0: 360 * j, f1: 170 * j, glide: 0.05, peak: 0.2, decay: 0.085, verb: 0.15 })
    this.tone({ type: 'triangle', f0: 760 * j, f1: 520 * j, glide: 0.03, peak: 0.035, decay: 0.04 })
    this.burst({ freq: 2400 * j, q: 1.4, peak: 0.05, decay: 0.03 })
  }

  softClick() {
    if (!this.sfxOn) return
    const j = 1 + (Math.random() - 0.5) * 0.08
    this.tone({ f0: 520 * j, f1: 300 * j, glide: 0.04, peak: 0.1, decay: 0.06, verb: 0.1 })
    this.burst({ freq: 3000 * j, q: 1.2, peak: 0.025, decay: 0.02 })
  }

  hover() {
    if (!this.sfxOn) return
    const now = performance.now()
    if (now - this.lastHover < 70) return
    this.lastHover = now
    this.burst({ type: 'highpass', freq: 3800, q: 0.7, peak: 0.012, decay: 0.035 })
    this.tone({ f0: 1650 + Math.random() * 120, peak: 0.009, decay: 0.05 })
  }

  confirm() {
    if (!this.sfxOn) return
    const ctx = this.ensure()
    const t = ctx.currentTime
    this.bell({ f: 880, at: t, peak: 0.07, decay: 0.7, ratio: 3.01, index: 0.9, verb: 0.5, pan: -0.15 })
    this.bell({ f: 1318.5, at: t + 0.075, peak: 0.06, decay: 0.9, ratio: 3.01, index: 0.8, verb: 0.55, pan: 0.15 })
    this.tone({ f0: 300, f1: 180, peak: 0.08, decay: 0.08 })
  }

  back() {
    if (!this.sfxOn) return
    const ctx = this.ensure()
    const t = ctx.currentTime
    this.tone({ f0: 300, f1: 160, peak: 0.12, decay: 0.08, verb: 0.1 })
    this.bell({ f: 659.3, at: t + 0.02, peak: 0.03, decay: 0.4, ratio: 3, index: 0.5, verb: 0.4 })
  }

  toggle(on: boolean) {
    if (!this.sfxOn) return
    this.tone({ f0: on ? 420 : 640, f1: on ? 680 : 380, glide: 0.06, peak: 0.08, decay: 0.09, verb: 0.15 })
    this.burst({ freq: 2600, q: 1.5, peak: 0.03, decay: 0.02 })
  }

  page() {
    if (!this.sfxOn) return
    this.burst({ freq: 900, freq1: 2600, q: 0.8, peak: 0.06, attack: 0.04, decay: 0.18, verb: 0.2 })
    this.burst({ type: 'lowpass', freq: 600, peak: 0.03, attack: 0.01, decay: 0.08 })
  }

  send() {
    if (!this.sfxOn) return
    const ctx = this.ensure()
    const t = ctx.currentTime
    // 羽毛笔一划
    for (let i = 0; i < 4; i++) this.burst({ at: t + i * 0.022, type: 'highpass', freq: 3200 + i * 300, q: 0.8, peak: 0.022, decay: 0.03 })
    // 落印
    this.tone({ at: t + 0.1, f0: 140, f1: 58, glide: 0.08, peak: 0.26, decay: 0.16, verb: 0.2 })
    this.burst({ at: t + 0.1, type: 'lowpass', freq: 900, peak: 0.07, decay: 0.07 })
  }

  receive() {
    if (!this.sfxOn) return
    const ctx = this.ensure()
    const t = ctx.currentTime
    const notes = [587.33, 739.99, 880]
    notes.forEach((f, i) => this.bell({ f, at: t + i * 0.09, peak: 0.035, decay: 1.1, ratio: 2.0, index: 0.6, verb: 0.6, pan: (i - 1) * 0.3 }))
  }

  error() {
    if (!this.sfxOn) return
    const ctx = this.ensure()
    const t = ctx.currentTime
    this.tone({ at: t, f0: 196, f1: 150, peak: 0.12, decay: 0.16, verb: 0.15 })
    this.tone({ at: t + 0.13, f0: 185, f1: 130, peak: 0.1, decay: 0.2, verb: 0.15 })
  }

  stamp() {
    if (!this.sfxOn) return
    this.tone({ f0: 120, f1: 52, glide: 0.09, peak: 0.3, decay: 0.2, verb: 0.25 })
    this.burst({ type: 'lowpass', freq: 1200, peak: 0.08, decay: 0.09 })
    this.burst({ freq: 3500, q: 0.6, peak: 0.02, decay: 0.12 })
  }

  /** 拿起一张卡片：纸页轻轻离开桌面 */
  lift() {
    if (!this.sfxOn) return
    this.burst({ freq: 1400, freq1: 2600, q: 0.9, peak: 0.035, attack: 0.03, decay: 0.12 })
    this.tone({ f0: 380, f1: 520, glide: 0.08, peak: 0.05, decay: 0.1, verb: 0.15 })
  }

  /** 放下卡片 */
  place() {
    if (!this.sfxOn) return
    this.tone({ f0: 260, f1: 150, glide: 0.05, peak: 0.14, decay: 0.09, verb: 0.12 })
    this.burst({ type: 'lowpass', freq: 900, peak: 0.04, decay: 0.05 })
  }

  /** 焚化：火焰吞没的呼声 + 噼啪 + 低沉一响 */
  burn() {
    if (!this.sfxOn) return
    const ctx = this.ensure()
    const t = ctx.currentTime
    this.burst({ at: t, freq: 500, freq1: 2400, q: 0.7, peak: 0.07, attack: 0.08, decay: 0.45, verb: 0.35 })
    for (let i = 0; i < 9; i++) this.burst({ at: t + 0.05 + Math.random() * 0.4, freq: 1500 + Math.random() * 3500, q: 2 + Math.random() * 3, peak: 0.02 + Math.random() * 0.03, decay: 0.01 + Math.random() * 0.03 })
    this.tone({ at: t + 0.02, f0: 140, f1: 50, glide: 0.25, peak: 0.16, decay: 0.4, verb: 0.3 })
    this.bell({ f: 1174.7, at: t + 0.12, peak: 0.02, decay: 0.9, ratio: 3.5, index: 0.8, verb: 0.6 })
  }

  drop() {
    if (!this.sfxOn) return
    this.tone({ f0: 1300, f1: 340, glide: 0.05, peak: 0.12, decay: 0.12, verb: 0.5 })
    this.burst({ freq: 1800, q: 6, peak: 0.03, decay: 0.08, verb: 0.3 })
  }
}

function makeNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return buf
}

/** 生成混响冲激响应：指数衰减的立体声噪声，带一点低通，听起来温暖 */
function makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const t = i / len
      const n = Math.random() * 2 - 1
      lp += (n - lp) * (0.35 - 0.25 * t)
      const early = i < ctx.sampleRate * 0.08 && Math.random() < 0.002 ? (Math.random() - 0.5) * 2 : 0
      d[i] = (lp + early) * Math.pow(1 - t, decay)
    }
  }
  return buf
}

export const audio = new Engine()
