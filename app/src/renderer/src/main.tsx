import { createRoot } from 'react-dom/client'
import './theme/fonts'
import './styles/base.css'
import './styles/components.css'
import './styles/shell.css'
import './styles/pages.css'
import './styles/rich.css'
import './styles/detail.css'
import './styles/chat.css'
import './styles/shelf.css'
import './styles/books.css'
import { applyPixelScale, applyTheme } from './theme/apply'
import { preloadFonts } from './theme/fonts'
import { installFeedback } from './fx/feedback'
import { useSettings } from './state/settings'
import { useLibrary } from './state/library'
import { useChats } from './state/chats'
import { usePresets } from './state/presets'
import { App } from './App'
import { installNavKeys, useRouter } from './state/router'
import { yt } from './lib/api'

async function boot() {
  applyPixelScale()
  applyTheme('parchment')
  installFeedback()
  installNavKeys((cb) => yt.app.onCommand(cb))
  await useSettings.getState().load()
  const fonts = preloadFonts()
  await Promise.all([useLibrary.getState().load(), useChats.getState().loadIndex(), usePresets.getState().load()])
  const s = useSettings.getState().s
  const params = new URLSearchParams(location.search)
  const playOpening = s.opening.enabled && params.get('opening') !== '0'
  // 字体都在本地，通常几十毫秒就绪；开场需要毛笔字体，等它到位再开始（最多 1.2 秒）
  await Promise.race([fonts, new Promise((r) => setTimeout(r, playOpening ? 1200 : 400))])
  createRoot(document.getElementById('root')!).render(<App playOpening={playOpening} />)
}

window.addEventListener('resize', applyPixelScale)
// 自动化测试入口
;(window as any).__yt = { chats: useChats, library: useLibrary, settings: useSettings, router: useRouter }
;(window as any).__importFiles = (files: { name: string; bytes: Uint8Array }[]) => import('./lib/importer').then((m) => m.importFiles(files))
boot().catch((e) => {
  document.body.innerHTML = `<pre style="color:#c00;padding:20px;white-space:pre-wrap">启动失败：${String(e?.stack || e)}</pre>`
})
