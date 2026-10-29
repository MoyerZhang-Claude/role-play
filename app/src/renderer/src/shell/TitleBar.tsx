import { useEffect, useState } from 'react'
import { yt } from '../lib/api'
import { Icon } from '../icons/Icon'
import { IconButton } from '../components/ui'
import { useSettings } from '../state/settings'
import { useRouter, go } from '../state/router'
import { useLibrary } from '../state/library'
import { useChats } from '../state/chats'
import { music } from '../audio/music'

function Crumbs() {
  const route = useRouter((s) => s.route)
  const chars = useLibrary((s) => s.chars)
  const index = useChats((s) => s.index)
  const parts: { label: string; onClick?: () => void }[] = [{ label: '书斋', onClick: () => go({ name: 'home' }) }]
  if (route.name === 'character' || route.name === 'chat' || (route.name === 'editor' && route.id)) {
    const id = route.name === 'chat' ? route.characterId : route.id!
    const ch = chars.find((c) => c.id === id)
    if (ch) parts.push({ label: ch.name, onClick: () => go({ name: 'character', id: ch.id }) })
    if (route.name === 'chat') {
      const s = index[route.chatId]
      parts.push({ label: s?.title?.split(' · ').slice(1).join(' · ') || '对话' })
    }
    if (route.name === 'editor') parts.push({ label: '编辑' })
  } else if (route.name === 'editor') parts.push({ label: '新建角色' })
  else if (route.name === 'settings') parts.push({ label: '设置' })
  else if (route.name === 'books') parts.push({ label: '世界书' })
  return (
    <div className="tb-crumbs">
      {parts.map((p, i) => (
        <span key={i} className="tb-crumb">
          {i > 0 && <span className="tb-crumb-sep">›</span>}
          {p.onClick && i < parts.length - 1 ? (
            <button className="tb-crumb-link" data-sfx="soft" onClick={p.onClick}>
              {p.label}
            </button>
          ) : (
            <span className={i === parts.length - 1 ? 'tb-crumb-cur' : ''}>{p.label}</span>
          )}
        </span>
      ))}
    </div>
  )
}

export function TitleBar() {
  const [max, setMax] = useState(false)
  const sound = useSettings((s) => s.s.sound)
  const update = useSettings((s) => s.update)
  useEffect(() => {
    yt.win.isMaximized().then(setMax)
    return yt.win.onMaximized(setMax)
  }, [])
  return (
    <header className="titlebar">
      <Crumbs />
      <div className="tb-actions">
        <IconButton
          icon={sound.sfxEnabled ? 'bell' : 'bellOff'}
          tip={sound.sfxEnabled ? '音效：开' : '音效：关'}
          className={sound.sfxEnabled ? '' : 'is-off'}
          onClick={() => update((d) => (d.sound.sfxEnabled = !d.sound.sfxEnabled))}
        />
        <IconButton
          icon={sound.musicEnabled ? 'music' : 'musicOff'}
          tip={sound.musicEnabled ? '背景音乐：开' : '背景音乐：关'}
          className={sound.musicEnabled ? '' : 'is-off'}
          onClick={() => {
            const on = !sound.musicEnabled
            update((d) => (d.sound.musicEnabled = on))
            if (on && !music.playing) music.start(2.5)
          }}
        />
        <span className="tb-sep" />
        <button className="win-btn" data-sfx="soft" data-fx="none" aria-label="最小化" onClick={() => yt.win.minimize()}>
          <Icon name="minimize" />
        </button>
        <button className="win-btn" data-sfx="soft" data-fx="none" aria-label={max ? '还原' : '最大化'} onClick={() => yt.win.toggleMaximize()}>
          <Icon name={max ? 'restore' : 'maximize'} />
        </button>
        <button className="win-btn close" data-sfx="back" data-fx="none" aria-label="关闭" onClick={() => yt.win.close()}>
          <Icon name="close" />
        </button>
      </div>
    </header>
  )
}
