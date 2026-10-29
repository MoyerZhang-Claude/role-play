import { create } from 'zustand'

/**
 * 「卡片原样式」下每条消息贡献的样式表。与 SillyTavern 一致：
 * 一条消息里的 <style> 对整卷对话里所有原样式消息都生效。
 */
interface IsoCssState {
  byMsg: Record<string, string>
  put(id: string, css: string): void
}

export const useIsoCss = create<IsoCssState>((set, get) => ({
  byMsg: {},
  put(id, css) {
    const cur = get().byMsg
    if ((cur[id] ?? '') === css) return
    const next = { ...cur }
    if (css) next[id] = css
    else delete next[id]
    set({ byMsg: next })
  }
}))

/** 去重后合并（很多卡每条消息都带同一份样式） */
export function useSharedCss(): string {
  const by = useIsoCss((s) => s.byMsg)
  return [...new Set(Object.values(by))].join('\n')
}
