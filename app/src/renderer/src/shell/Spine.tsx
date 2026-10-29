import { useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../icons/Icon'
import type { IconName } from '../icons/pixel'
import { useRouter, go } from '../state/router'
import { useChats } from '../state/chats'
import { pickAndImport } from '../lib/importer'
import { toast } from '../state/ui'

interface Item {
  key: string
  icon: IconName
  label: string
  onClick: () => void
}

/** 左侧书脊：深色皮革、烫金像素图标；当前页有一条朱砂书签带 */
export function Spine() {
  const route = useRouter((s) => s.route)
  const active = route.name === 'home' || route.name === 'character' || route.name === 'group' ? 'home' : route.name === 'chat' || route.name === 'recent' ? 'chat' : route.name === 'editor' ? 'new' : route.name === 'settings' ? 'settings' : route.name === 'books' ? 'books' : route.name === 'presets' ? 'presets' : ''

  const top: Item[] = [
    { key: 'home', icon: 'book', label: '书斋', onClick: () => go({ name: 'home' }) },
    {
      key: 'chat',
      icon: 'quill',
      label: '续读',
      onClick: () => go({ name: 'recent' })
    },
    { key: 'books', icon: 'globe', label: '世界书', onClick: () => go({ name: 'books' }) },
    { key: 'presets', icon: 'flask', label: '预设', onClick: () => go({ name: 'presets' }) },
    { key: 'import', icon: 'scroll', label: '导入', onClick: () => pickAndImport() },
    { key: 'new', icon: 'plus', label: '新建', onClick: () => go({ name: 'editor' }) }
  ]
  const bottom: Item[] = [{ key: 'settings', icon: 'gear', label: '设置', onClick: () => go({ name: 'settings' }) }]

  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [ribbon, setRibbon] = useState<{ y: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const el = refs.current[active]
    if (!el) {
      setRibbon(null)
      return
    }
    setRibbon({ y: el.offsetTop, h: el.offsetHeight })
  }, [active])

  const render = (it: Item) => (
    <button
      key={it.key}
      ref={(el) => {
        refs.current[it.key] = el
      }}
      className={`spine-item ${active === it.key ? 'active' : ''}`}
      data-hover-sfx
      data-sfx={it.key === 'import' ? 'page' : 'click'}
      onClick={it.onClick}
    >
      <span className="spine-icon">
        <Icon name={it.icon} />
      </span>
      <span className="spine-label">{it.label}</span>
    </button>
  )

  return (
    <nav className="spine on-dark">
      <div className="spine-brand">
        <span className="spine-sigil">
          <Icon name="flask" scale={1.5} />
        </span>
        <span className="spine-name t-display">药汤</span>
      </div>
      <div className="spine-rule" />
      <div className="spine-items">
        {ribbon && <span className="spine-ribbon" style={{ transform: `translateY(${ribbon.y}px)`, height: ribbon.h }} />}
        <div className="spine-group">{top.map(render)}</div>
        <div className="spine-group bottom">{bottom.map(render)}</div>
      </div>
    </nav>
  )
}
