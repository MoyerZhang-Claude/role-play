import { useRef, useState } from 'react'
import type { Character } from '@shared/types'
import { useLibrary, avatarSrc } from '../state/library'
import { useChats } from '../state/chats'
import { go } from '../state/router'
import { Button, MagicCircle, Medallion, Divider } from '../components/ui'
import { Icon } from '../icons/Icon'
import { pickAndImport } from '../lib/importer'
import { RecentShelf, useRecentList } from './home/RecentShelf'

const GREETINGS = ['今夜，想翻开哪一卷故事？', '炉火正旺，墨还未干。', '药已煎好，故事正温。', '每一位角色，都在书页里等你。', '落笔之前，先选一位同行者。']

function CharCard({ ch, index }: { ch: Character; index: number }) {
  const ref = useRef<HTMLButtonElement>(null)
  const src = avatarSrc(ch)
  const wb = (ch.book?.entries.length ?? 0) + (ch.linkedBookIds.length ? 1 : 0)
  const rx = ch.regexScripts.filter((r) => !r.disabled).length
  const move = (e: React.PointerEvent) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    el.style.setProperty('--rx', `${(-y * 7).toFixed(2)}deg`)
    el.style.setProperty('--ry', `${(x * 9).toFixed(2)}deg`)
    el.style.setProperty('--gx', `${((x + 0.5) * 100).toFixed(1)}%`)
    el.style.setProperty('--gy', `${((y + 0.5) * 100).toFixed(1)}%`)
  }
  const leave = () => {
    const el = ref.current
    if (!el) return
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--ry', '0deg')
  }
  return (
    <button ref={ref} className="char-card" style={{ animationDelay: `${Math.min(index, 16) * 35}ms` }} data-hover-sfx data-sfx="page" onPointerMove={move} onPointerLeave={leave} onClick={() => go({ name: 'character', id: ch.id })}>
      <span className="char-card-frame">
        {src ? <img src={src} alt="" draggable={false} loading="lazy" /> : <span className="char-card-blank t-display">{Array.from(ch.name)[0]}</span>}
        <span className="char-card-glint" />
        <span className="char-card-edge" />
      </span>
      <span className="char-card-name">{ch.name}</span>
      <span className="char-card-meta">
        {ch.source.format === 'custom' ? <span>自撰</span> : <span>{ch.source.format.toUpperCase()}</span>}
        {wb > 0 && (
          <span data-tip="世界书条目">
            <Icon name="globe" /> {ch.book?.entries.length ?? 0}
          </span>
        )}
        {rx > 0 && (
          <span data-tip="启用的正则">
            <Icon name="rune" /> {rx}
          </span>
        )}
      </span>
    </button>
  )
}

export function Home() {
  const chars = useLibrary((s) => s.chars)
  const index = useChats((s) => s.index)
  const recent = useRecentList(index, chars)
  const [greet] = useState(() => GREETINGS[Math.floor(Math.random() * GREETINGS.length)])
  const [q, setQ] = useState('')
  const shown = q.trim() ? chars.filter((c) => (c.name + c.tags.join(' ') + c.creator).toLowerCase().includes(q.trim().toLowerCase())) : chars

  return (
    <div className="page home">
      <div className="home-watermark" aria-hidden>
        <MagicCircle size={620} strokeWidth={0.5} runes={36} />
      </div>
      <header className="home-head">
        <div>
          <div className="t-deco">Librarium · 书斋</div>
          <h1 className="home-title t-display">{greet}</h1>
        </div>
        <div className="home-actions">
          <Button icon="scroll" sfx="page" onClick={() => pickAndImport()}>
            导入角色卡
          </Button>
          <Button variant="primary" icon="quill" onClick={() => go({ name: 'editor' })}>
            亲手写一位角色
          </Button>
        </div>
      </header>

      {recent.length > 0 && (
        <section className="home-section">
          <div className="section-head">
            <span className="section-title">续读</span>
            <span className="t-deco">Continua</span>
            <span className="section-spacer" />
            <span className="section-hint">长按卡片可拖动排序 · 拖到上方的焚化阵可移出续读</span>
          </div>
          <RecentShelf items={recent} chars={chars} />
        </section>
      )}

      <section className="home-section">
        <div className="section-head">
          <span className="section-title">角色卷宗</span>
          <span className="t-deco">Personae · {chars.length}</span>
          <span className="section-spacer" />
          {chars.length > 6 && (
            <label className="search">
              <Icon name="search" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="寻找角色…" spellCheck={false} />
            </label>
          )}
        </div>
        {chars.length === 0 ? (
          <div className="home-empty">
            <MagicCircle size={180} strokeWidth={0.8} />
            <div className="home-empty-text">
              <p className="t-display">书斋还空着</p>
              <p className="t-soft">把角色卡（PNG / JSON）拖进窗口，或者亲手写一位角色。</p>
              <p className="t-faint t-small">支持 SillyTavern 的角色卡 V1 / V2 / V3，以及其中的世界书与正则。</p>
            </div>
          </div>
        ) : (
          <div className="char-grid">
            <button className="char-card char-card-new" data-hover-sfx onClick={() => go({ name: 'editor' })}>
              <span className="char-card-frame">
                <span className="new-glyph">
                  <MagicCircle size={92} strokeWidth={1} runes={12} />
                  <Icon name="plus" scale={2} />
                </span>
              </span>
              <span className="char-card-name">新建角色</span>
              <span className="char-card-meta">
                <span>或把卡片拖进来</span>
              </span>
            </button>
            {shown.map((c, i) => (
              <CharCard key={c.id} ch={c} index={i} />
            ))}
          </div>
        )}
      </section>
      <Divider className="home-foot" />
    </div>
  )
}
