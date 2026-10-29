import { create } from 'zustand'
import type { PromptPreset } from '@shared/types'
import { yt } from '../lib/api'
import { useSettings } from './settings'

/** 当前启用的 SillyTavern 预设（显示与生成都要用它自带的正则，所以放在内存里） */
interface PresetState {
  active: PromptPreset | null
  loadedId: string | null
  load(): Promise<PromptPreset | null>
  /** 预设被编辑保存后更新内存里的副本 */
  put(p: PromptPreset): void
}

export const usePresets = create<PresetState>((set, get) => ({
  active: null,
  loadedId: null,
  async load() {
    const id = useSettings.getState().s.chat.activePresetId
    if (!id) {
      if (get().active) set({ active: null, loadedId: null })
      return null
    }
    if (get().loadedId === id) return get().active
    const p = (await yt.fs.readJSON<PromptPreset>(`presets/${id}.json`)) ?? null
    if (useSettings.getState().s.chat.activePresetId === id) set({ active: p, loadedId: id })
    return p
  },
  put(p) {
    if (p.id === useSettings.getState().s.chat.activePresetId) set({ active: p, loadedId: p.id })
  }
}))

useSettings.subscribe((st, prev) => {
  if (st.s.chat.activePresetId !== prev.s.chat.activePresetId) void usePresets.getState().load()
})
