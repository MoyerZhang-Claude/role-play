import { create } from 'zustand'
import { audio } from '../audio/engine'

export type Route =
  | { name: 'home' }
  | { name: 'character'; id: string }
  | { name: 'editor'; id?: string }
  | { name: 'chat'; characterId: string; chatId: string }
  | { name: 'settings'; tab?: string }
  | { name: 'books'; id?: string }
  | { name: 'presets' }
  | { name: 'recent' }
  | { name: 'group'; id: string }

interface RouterState {
  route: Route
  /** 每次导航递增，用于触发页面过渡 */
  seq: number
  history: Route[]
  future: Route[]
  go(r: Route): void
  back(): boolean
  forward(): boolean
}

const same = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b)

export const useRouter = create<RouterState>((set, get) => ({
  route: { name: 'home' },
  seq: 0,
  history: [],
  future: [],
  go(r) {
    const cur = get().route
    if (same(cur, r)) return
    set({ route: r, seq: get().seq + 1, history: [...get().history.slice(-50), cur], future: [] })
  },
  back() {
    const h = get().history
    if (!h.length) return false
    const prev = h[h.length - 1]
    set({ route: prev, seq: get().seq + 1, history: h.slice(0, -1), future: [get().route, ...get().future].slice(0, 50) })
    return true
  },
  forward() {
    const f = get().future
    if (!f.length) return false
    const next = f[0]
    set({ route: next, seq: get().seq + 1, history: [...get().history.slice(-50), get().route], future: f.slice(1) })
    return true
  }
}))

export const go = (r: Route) => useRouter.getState().go(r)

/**
 * 鼠标侧键（后退 / 前进）与 Alt+← / Alt+→。
 * 页面里的鼠标第 4、5 键和 Windows 的 app-command 都可能触发，这里去重。
 */
let lastNav = 0
export function navigate(dir: 'back' | 'forward') {
  const now = performance.now()
  if (now - lastNav < 180) return
  lastNav = now
  const ok = dir === 'back' ? useRouter.getState().back() : useRouter.getState().forward()
  if (ok) audio.page()
  else audio.softClick()
}

export function installNavKeys(onAppCommand?: (cb: (cmd: string) => void) => void) {
  const block = (e: MouseEvent) => {
    if (e.button === 3 || e.button === 4) e.preventDefault()
  }
  window.addEventListener('mousedown', block, true)
  window.addEventListener('auxclick', block, true)
  window.addEventListener(
    'mouseup',
    (e) => {
      if (e.button === 3) {
        e.preventDefault()
        navigate('back')
      } else if (e.button === 4) {
        e.preventDefault()
        navigate('forward')
      }
    },
    true
  )
  window.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.shiftKey) return
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      navigate('back')
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      navigate('forward')
    }
  })
  onAppCommand?.((cmd) => {
    if (cmd === 'browser-backward') navigate('back')
    else if (cmd === 'browser-forward') navigate('forward')
  })
}
