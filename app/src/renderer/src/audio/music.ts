/**
 * 生成式背景音乐「书斋夜曲」：
 * D 多利亚调式；柔和长音垫底 + Karplus-Strong 拨弦即兴 + 偶尔的铃音 + 极轻的壁炉噼啪声。
 * 每次都即兴生成，不会完全重复。
 */
import { audio } from './engine'

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

// 和弦（MIDI）：每个和弦约两小节
const PROGRESSIONS: number[][][] = [
  [
    [38, 50, 57, 64, 65], // Dm9
    [36, 48, 55, 62, 64], // Cadd9
    [34, 46, 53, 57, 62], // Bbmaj7
    [36, 48, 55, 60, 64], // C
    [38, 50, 57, 60, 65], // Dm7
    [33, 45, 52, 57, 60], // Am7
    [34, 46, 53, 58, 62], // Bb
    [36, 48, 55, 60, 65] // Csus4
  ],
  [
    [38, 50, 57, 62, 65],
    [41, 53, 57, 60, 64], // Fmaj7
    [36, 48, 55, 59, 62], // C/G
    [38, 50, 55, 59, 62], // G/D
    [34, 46, 53, 57, 62],
    [36, 48, 52, 55, 60],
    [33, 45, 52, 55, 60],
    [38, 50, 57, 62, 64]
  ]
]
const SCALE = [62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81] // D 多利亚，D4 起

const BPM = 64
const BEAT = 60 / BPM
const BAR = BEAT * 4
const CHORD_BARS = 2

class Music {
  private timer: number | null = null
  private nextBeat = 0
  private beatIndex = 0
  private progIndex = 0
  private melody = 4
  private plucks = new Map<number, AudioBuffer>()
  private bus: GainNode | null = null
  private padVoices: { stop: (t: number) => void }[] = []
  private crackleTimer: number | null = null
  playing = false

  start(fadeIn = 4) {
    const ctx = audio.ensure()
    if (this.playing) return
    this.playing = true
    this.bus = ctx.createGain()
    this.bus.gain.setValueAtTime(0.0001, ctx.currentTime)
    this.bus.gain.exponentialRampToValueAtTime(1, ctx.currentTime + fadeIn)
    this.bus.connect(audio.music)
    const send = ctx.createGain()
    send.gain.value = 1
    this.bus.connect(send).connect(audio.musicVerb)
    this.nextBeat = ctx.currentTime + 0.3
    this.beatIndex = 0
    this.progIndex = Math.floor(Math.random() * PROGRESSIONS.length)
    this.timer = window.setInterval(() => this.schedule(), 40)
    this.crackleTimer = window.setInterval(() => this.crackle(), 180)
  }

  stop(fadeOut = 1.5) {
    if (!this.playing || !this.bus || !audio.ctx) return
    this.playing = false
    if (this.timer) window.clearInterval(this.timer)
    if (this.crackleTimer) window.clearInterval(this.crackleTimer)
    this.timer = this.crackleTimer = null
    const ctx = audio.ctx
    const bus = this.bus
    bus.gain.cancelScheduledValues(ctx.currentTime)
    bus.gain.setValueAtTime(bus.gain.value, ctx.currentTime)
    bus.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + fadeOut)
    for (const v of this.padVoices) v.stop(ctx.currentTime + fadeOut)
    this.padVoices = []
    window.setTimeout(() => bus.disconnect(), fadeOut * 1000 + 200)
    this.bus = null
  }

  private schedule() {
    const ctx = audio.ctx
    if (!ctx || !this.bus) return
    while (this.nextBeat < ctx.currentTime + 0.25) {
      this.beat(this.nextBeat, this.beatIndex)
      this.nextBeat += BEAT
      this.beatIndex++
    }
  }

  private beat(t: number, i: number) {
    const prog = PROGRESSIONS[this.progIndex]
    const beatsPerChord = 4 * CHORD_BARS
    const chordIdx = Math.floor(i / beatsPerChord) % prog.length
    const chord = prog[chordIdx]
    const inChord = i % beatsPerChord
    if (inChord === 0) {
      this.pad(t, chord, BAR * CHORD_BARS)
      if (chordIdx === 0 && i > 0 && Math.random() < 0.35) this.progIndex = (this.progIndex + 1) % PROGRESSIONS.length
    }
    // 拨弦：每拍决定是否落音
    const r = Math.random()
    if (inChord === 0 && Math.random() < 0.5) {
      // 和弦分解
      const tones = chord.slice(1).map((m) => m + 12)
      tones.forEach((m, k) => this.pluck(t + k * BEAT * 0.5, m, 0.24 - k * 0.03, (k - 1.5) * 0.25))
      return
    }
    const density = inChord % 2 === 0 ? 0.55 : 0.32
    if (r < density) {
      this.melody = Math.max(0, Math.min(SCALE.length - 1, this.melody + [-2, -1, -1, 1, 1, 2, 0][Math.floor(Math.random() * 7)]))
      let note = SCALE[this.melody]
      // 和弦外音时偏向和弦音
      const pcs = chord.map((m) => m % 12)
      if (!pcs.includes(note % 12) && Math.random() < 0.6) {
        this.melody = Math.max(0, Math.min(SCALE.length - 1, this.melody + (Math.random() < 0.5 ? 1 : -1)))
        note = SCALE[this.melody]
      }
      const swing = Math.random() < 0.3 ? BEAT * 0.5 : 0
      this.pluck(t + swing, note, 0.2 + Math.random() * 0.08, (Math.random() - 0.5) * 0.6)
      if (Math.random() < 0.18) this.pluck(t + swing + BEAT * 0.5, SCALE[Math.max(0, this.melody - 2)], 0.13, (Math.random() - 0.5) * 0.6)
    }
    // 偶尔一声高处的铃
    if (Math.random() < 0.035) {
      const m = chord[Math.floor(Math.random() * 3) + 2] + 24
      audio.bell({ f: mtof(m), at: t, peak: 0.018, decay: 3.2, ratio: 3.01, index: 0.5, dest: this.bus!, verb: 0.9, pan: (Math.random() - 0.5) * 0.8 })
    }
  }

  private pad(t: number, chord: number[], dur: number) {
    const ctx = audio.ctx!
    const bus = this.bus!
    const att = 2.2
    const rel = 2.8
    const end = t + dur + 0.6
    // 上一组声部提前淡出，交叉过渡
    for (const v of this.padVoices) v.stop(t + rel * 0.6)
    this.padVoices = []
    chord.forEach((m, k) => {
      const f = mtof(k === 0 ? m : m)
      const g = ctx.createGain()
      const peak = k === 0 ? 0.062 : 0.034
      g.gain.setValueAtTime(0.0001, t)
      g.gain.linearRampToValueAtTime(peak, t + att)
      g.gain.setValueAtTime(peak, end - 0.1)
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(k === 0 ? 420 : 1100, t)
      lp.Q.value = 0.4
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 0.07 + Math.random() * 0.08
      const lfoG = ctx.createGain()
      lfoG.gain.value = k === 0 ? 60 : 280
      lfo.connect(lfoG).connect(lp.frequency)
      const oscs: OscillatorNode[] = []
      const types: OscillatorType[] = k === 0 ? ['sine', 'triangle'] : ['triangle', 'sawtooth']
      types.forEach((type, j) => {
        const o = ctx.createOscillator()
        o.type = type
        o.frequency.value = f
        o.detune.value = (j === 0 ? -1 : 1) * (4 + Math.random() * 4)
        const og = ctx.createGain()
        og.gain.value = type === 'sawtooth' ? 0.32 : 1
        o.connect(og).connect(lp)
        oscs.push(o)
      })
      const pan = ctx.createStereoPanner()
      pan.pan.value = k === 0 ? 0 : ((k % 2) * 2 - 1) * 0.35
      lp.connect(g).connect(pan).connect(bus)
      oscs.forEach((o) => o.start(t))
      lfo.start(t)
      let stopped = false
      const stop = (at: number) => {
        if (stopped) return
        stopped = true
        const s = Math.max(at, ctx.currentTime)
        g.gain.cancelScheduledValues(s)
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), s)
        g.gain.linearRampToValueAtTime(0.0001, s + rel)
        oscs.forEach((o) => o.stop(s + rel + 0.1))
        lfo.stop(s + rel + 0.1)
      }
      this.padVoices.push({ stop })
      window.setTimeout(() => stop(end), Math.max(0, (end - ctx.currentTime) * 1000))
    })
  }

  /** Karplus-Strong 拨弦，按音高缓存 */
  private pluckBuffer(m: number): AudioBuffer {
    const hit = this.plucks.get(m)
    if (hit) return hit
    const ctx = audio.ctx!
    const sr = ctx.sampleRate
    const f = mtof(m)
    const len = Math.floor(sr * 3.2)
    const buf = ctx.createBuffer(1, len, sr)
    const d = buf.getChannelData(0)
    const N = Math.max(2, Math.round(sr / f))
    const ring = new Float32Array(N)
    // 用低通过的噪声激励，声音更柔
    let lp = 0
    for (let i = 0; i < N; i++) {
      lp += (Math.random() * 2 - 1 - lp) * 0.5
      ring[i] = lp
    }
    let idx = 0
    const damp = 0.4965 + Math.min(0.0025, f / 400000)
    for (let i = 0; i < len; i++) {
      const a = ring[idx]
      const b = ring[(idx + 1) % N]
      const v = (a + b) * damp
      ring[idx] = v
      d[i] = a
      idx = (idx + 1) % N
    }
    // 起音稍软
    for (let i = 0; i < 64; i++) d[i] *= i / 64
    this.plucks.set(m, buf)
    return buf
  }

  private pluck(t: number, m: number, vel: number, pan: number) {
    const ctx = audio.ctx!
    if (!this.bus) return
    const src = ctx.createBufferSource()
    src.buffer = this.pluckBuffer(m)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2600 + vel * 3000
    const g = ctx.createGain()
    g.gain.value = vel * 0.9
    const p = ctx.createStereoPanner()
    p.pan.value = pan
    src.connect(lp).connect(g).connect(p).connect(this.bus)
    src.start(t)
  }

  /** 壁炉：极轻的噼啪声与低沉的炉火 */
  private crackle() {
    const ctx = audio.ctx
    if (!ctx || !this.bus) return
    if (Math.random() < 0.42) {
      const t = ctx.currentTime + Math.random() * 0.15
      audio.burst({ at: t, freq: 1200 + Math.random() * 3500, q: 1.5 + Math.random() * 3, peak: 0.006 + Math.random() * 0.016, decay: 0.006 + Math.random() * 0.02, dest: this.bus, pan: (Math.random() - 0.5) * 0.6 })
    }
    if (Math.random() < 0.06) {
      const t = ctx.currentTime
      audio.burst({ at: t, type: 'lowpass', freq: 160, q: 0.5, peak: 0.02, attack: 0.3, decay: 0.9, dest: this.bus })
    }
  }
}

export const music = new Music()
