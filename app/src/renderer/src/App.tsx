import { useEffect, useState } from 'react'
import { useRouter, type Route } from './state/router'
import { useSettings } from './state/settings'
import { TitleBar } from './shell/TitleBar'
import { Spine } from './shell/Spine'
import { DropOverlay } from './shell/DropOverlay'
import { Toasts, ConfirmHost, ModalHost, TooltipHost } from './components/Overlays'
import { Home } from './pages/Home'
import { CharacterPage } from './pages/CharacterPage'
import { Editor } from './pages/Editor'
import { ChatPage } from './pages/ChatPage'
import { SettingsPage } from './pages/Settings'
import { BooksPage } from './pages/BooksPage'
import { Opening } from './opening/Opening'
import { music } from './audio/music'

function RouteView({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <Home />
    case 'character':
      return <CharacterPage id={route.id} />
    case 'editor':
      return <Editor id={route.id} />
    case 'chat':
      return <ChatPage characterId={route.characterId} chatId={route.chatId} />
    case 'settings':
      return <SettingsPage tab={route.tab} />
    case 'books':
      return <BooksPage id={route.id} />
  }
}

export function App({ playOpening }: { playOpening: boolean }) {
  const route = useRouter((s) => s.route)
  const seq = useRouter((s) => s.seq)
  const [opening, setOpening] = useState(playOpening)
  const [revealed, setRevealed] = useState(!playOpening)
  const [booted, setBooted] = useState(!playOpening)

  useEffect(() => {
    const replay = () => setOpening(true)
    window.addEventListener('yt:replay-opening', replay)
    return () => window.removeEventListener('yt:replay-opening', replay)
  }, [])

  // 开场完全结束（或关闭开场时立即）再开始背景音乐，避免与退场动画抢资源
  useEffect(() => {
    if (!booted) return
    const s = useSettings.getState().s
    if (s.sound.musicEnabled && !music.playing) music.start(playOpening ? 2.5 : 4)
  }, [booted])

  return (
    <>
      <div className="candle-light" aria-hidden />
      <div className={`app ${revealed ? 'is-revealed' : ''} ${playOpening ? '' : 'fade-boot'}`}>
        <Spine />
        <TitleBar />
        <main className="main">
          <div key={seq} className={`page-host route-${route.name} ${seq === 0 ? 'first' : ''}`}>
            <RouteView route={route} />
          </div>
        </main>
      </div>
      <DropOverlay />
      <Toasts />
      <ConfirmHost />
      <ModalHost />
      <TooltipHost />
      {opening && (
        <Opening
          onReveal={() => setRevealed(true)}
          onDone={() => {
            setRevealed(true)
            setOpening(false)
            setBooted(true)
          }}
        />
      )}
    </>
  )
}
