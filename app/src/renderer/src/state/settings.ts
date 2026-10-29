import { create } from 'zustand'
import type { Settings, ApiProfile } from '@shared/types'
import { defaultSettings, mergeSettings } from '@shared/defaults'
import { yt, debounce } from '../lib/api'
import { audio } from '../audio/engine'
import { applyAppearance, applyTheme } from '../theme/apply'
import { setReducedMotion } from '../fx/inkLayer'

interface SettingsState {
  s: Settings
  loaded: boolean
  load(): Promise<void>
  update(fn: (draft: Settings) => void): void
  activeProfile(): ApiProfile | null
}

const persist = debounce((s: Settings) => {
  yt.fs.writeJSON('settings.json', s).catch((e) => console.error('保存设置失败', e))
}, 300)

function sideEffects(prev: Settings | null, next: Settings) {
  if (!prev || prev.appearance.themeId !== next.appearance.themeId) applyTheme(next.appearance.themeId)
  applyAppearance(next.appearance)
  setReducedMotion(next.appearance.reduceMotion)
  audio.setPrefs(next.sound)
}

export const useSettings = create<SettingsState>((set, get) => ({
  s: defaultSettings(),
  loaded: false,
  async load() {
    const raw = await yt.fs.readJSON('settings.json')
    const s = mergeSettings(raw)
    sideEffects(null, s)
    set({ s, loaded: true })
    if (!raw) persist(s)
  },
  update(fn) {
    const prev = get().s
    const draft = structuredClone(prev)
    fn(draft)
    sideEffects(prev, draft)
    set({ s: draft })
    persist(draft)
  },
  activeProfile() {
    const { s } = get()
    return s.api.profiles.find((p) => p.id === s.api.activeProfileId) ?? s.api.profiles[0] ?? null
  }
}))

window.addEventListener('beforeunload', () => persist.flush(useSettings.getState().s))
