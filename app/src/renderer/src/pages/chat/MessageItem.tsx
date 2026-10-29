import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Character, ChatMessage } from '@shared/types'
import { renderRich } from '../../render/rich'
import { renderIsolated } from '../../render/isolated'
import { effectiveScripts, displayScripts } from '@shared/presetRuntime'
import { usePresets } from '../../state/presets'
import { useIsoCss } from '../../state/isoCss'
import { IsoBody } from '../../components/IsoBody'
import { useSmoothText, InkTrail } from './reveal'
import { Medallion, IconButton, Spinner, Button } from '../../components/ui'
import { Icon } from '../../icons/Icon'
import { useChats, type GenPhase } from '../../state/chats'
import { toast } from '../../state/ui'
import { go } from '../../state/router'
import { clock, yt } from '../../lib/api'
import { audio } from '../../audio/engine'

export interface MsgViewProps {
  msg: ChatMessage
  index: number
  depth: number
  isLast: boolean
  ch: Character
  avatar: string | null
  userName: string
  macros: (s: string) => string
  quotes: boolean
  smooth: boolean
  showReasoning: boolean
  /** 正在生成这一条时的阶段 */
  phase: GenPhase | null
  genStartedAt: number
  busy: boolean
}

export const MessageItem = memo(function MessageItem(p: MsgViewProps) {
  const { msg, ch } = p
  const sw = msg.swipes[msg.swipeIndex] ?? msg.swipes[0]
  const streaming = p.phase !== null
  const isUser = msg.role === 'user'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const text = useSmoothText(sw?.text ?? '', streaming, p.smooth)
  const preset = usePresets((s) => s.active)
  const scripts = useMemo(() => displayScripts(effectiveScripts(ch, preset)), [ch, preset])

  const html = useMemo(
    () => renderRich(text, { scripts, macros: p.macros, placement: isUser ? 1 : 2, depth: p.depth, quotes: p.quotes }),
    [text, scripts, p.macros, isUser, p.depth, p.quotes]
  )

  // 卡片原样式：生成结束后才切换（生成中仍用药汤的渐显）
  const isoMode = ch.display?.styleMode === 'isolated' && !streaming
  const iso = useMemo(
    () => (isoMode ? renderIsolated(sw?.text ?? '', { scripts, macros: p.macros, placement: isUser ? 1 : 2, depth: p.depth }) : null),
    [isoMode, sw?.text, scripts, p.macros, isUser, p.depth]
  )
  const useIso = !!iso?.styled && !editing
  // 这条消息的样式交给整卷共享（生成中、编辑中暂时撤下）
  useEffect(() => {
    useIsoCss.getState().put(msg.id, iso?.styled ? iso.css.join('\n') : '')
  }, [msg.id, iso])
  useEffect(() => () => useIsoCss.getState().put(msg.id, ''), [msg.id])

  const bodyRef = useRef<HTMLDivElement>(null)
  const trail = useRef(new InkTrail())
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.innerHTML = html
    if (streaming || trail.current) {
      if (streaming && p.smooth) trail.current.apply(el, true)
      if (streaming && sw?.text) {
        const caret = document.createElement('span')
        caret.className = 'ink-caret'
        const last = deepestLastBlock(el)
        last.appendChild(caret)
      }
    }
  }, [html, streaming, useIso])
  useEffect(() => {
    if (!streaming) trail.current.reset()
  }, [streaming, msg.swipeIndex])

  const copy = async () => {
    await navigator.clipboard.writeText(sw?.text ?? '')
    toast('ok', '已复制这一页')
  }
  const startEdit = () => {
    setDraft(sw?.text ?? '')
    setEditing(true)
  }
  const saveEdit = () => {
    useChats.getState().editMessage(msg.id, draft)
    setEditing(false)
    audio.confirm()
  }

  const showSwipes = !isUser && (msg.swipes.length > 1 || (p.isLast && !msg.isGreeting))
  const thinking = p.phase === 'thinking' || p.phase === 'waiting'

  return (
    <article className={`msg ${isUser ? 'msg-user' : 'msg-char'} ${streaming ? 'is-streaming' : ''}`} data-id={msg.id}>
      <header className="msg-head">
        {!isUser && <Medallion src={p.avatar} name={ch.name} size={40} />}
        <span className="msg-name">{isUser ? p.userName : ch.name}</span>
        <span className="msg-time t-pixel">{clock(sw?.createdAt ?? msg.createdAt)}</span>
        {msg.isGreeting && <span className="msg-tag">开场</span>}
        {useIso && (
          <span className="msg-tag" data-tip="按卡片作者的样式显示；脚本不运行，外部图片不加载">
            原样式
          </span>
        )}
        <span className="msg-spacer" />
        {!editing && !streaming && (
          <span className="msg-actions">
            <IconButton icon="copy" tip="复制" onClick={copy} />
            <IconButton icon="edit" tip="修改这一页" onClick={startEdit} />
            {!isUser && p.isLast && !msg.isGreeting && <IconButton icon="refresh" tip="重写（保留旧版本）" disabled={p.busy} onClick={() => useChats.getState().regenerate()} />}
            <IconButton
              icon="branch"
              tip="从这里分出一卷新对话"
              onClick={async () => {
                const nc = await useChats.getState().branchFrom(msg.id)
                if (nc) {
                  audio.page()
                  toast('ok', '已分出新的一卷', '之后的内容不会影响原来那卷')
                  go({ name: 'chat', characterId: nc.characterId, chatId: nc.id })
                }
              }}
            />
            <IconButton icon="trash" tip="删除这一页" onClick={() => useChats.getState().deleteMessage(msg.id)} />
          </span>
        )}
      </header>

      {!isUser && p.showReasoning && sw?.reasoning && <Reasoning text={sw.reasoning} live={p.phase === 'thinking'} />}

      {editing ? (
        <div className="msg-edit">
          <textarea
            className="field-area"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault()
                saveEdit()
              }
              if (e.key === 'Escape') setEditing(false)
            }}
            ref={(el) => {
              if (el) {
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight + 4, 640)}px`
              }
            }}
          />
          <div className="msg-edit-bar">
            <span className="t-small t-faint">Ctrl+Enter 保存 · Esc 取消</span>
            <Button size="sm" sfx="back" onClick={() => setEditing(false)}>
              取消
            </Button>
            <Button size="sm" variant="primary" sfx="none" onClick={saveEdit}>
              保存
            </Button>
          </div>
        </div>
      ) : (
        <>
          {streaming && !sw?.text && (
            <div className="msg-waiting">
              <Spinner size={22} />
              <span>{thinking ? (sw?.reasoning ? '思索中' : '墨迹渐显') : '落笔中'}</span>
              <Elapsed since={p.genStartedAt} />
            </div>
          )}
          {useIso ? <IsoBody html={iso!.html} /> : <div ref={bodyRef} className={`rich msg-body selectable ${isUser ? 'user-ink' : ''}`} />}
        </>
      )}

      {sw?.error && !streaming && (
        <div className="msg-error">
          <Icon name="warn" />
          <span className="selectable">这一页没能写成：{sw.error}</span>
          {p.isLast && (
            <Button size="sm" icon="refresh" onClick={() => useChats.getState().regenerate()}>
              重试
            </Button>
          )}
        </div>
      )}
      {sw?.partial && !streaming && !sw.error && <div className="msg-note t-small">（书写在中途停下了）</div>}

      {showSwipes && !editing && (
        <footer className="msg-swipes">
          <IconButton icon="chevL" tip={msg.isGreeting ? '上一条开场白' : '上一个版本'} disabled={p.busy || (!msg.isGreeting && msg.swipeIndex === 0)} onClick={() => useChats.getState().swipe(msg.id, -1)} />
          <span className="t-pixel">
            {msg.swipeIndex + 1} / {msg.swipes.length}
          </span>
          <IconButton
            icon="chevR"
            tip={msg.isGreeting ? '下一条开场白' : msg.swipeIndex < msg.swipes.length - 1 ? '下一个版本' : '再写一版'}
            disabled={p.busy || (msg.isGreeting && msg.swipes.length < 2)}
            onClick={() => useChats.getState().swipe(msg.id, 1)}
          />
          {sw?.usage?.completion != null && !streaming && (
            <span className="msg-usage t-small" data-tip={`提示 ${sw.usage.prompt ?? '?'} · 回复 ${sw.usage.completion}${sw.usage.reasoning ? `（含思考 ${sw.usage.reasoning}）` : ''}${sw.usage.cached ? ` · 缓存命中 ${sw.usage.cached}` : ''}`}>
              {sw.model}
            </span>
          )}
        </footer>
      )}
    </article>
  )
})

function deepestLastBlock(el: HTMLElement): HTMLElement {
  let cur: HTMLElement = el
  for (let i = 0; i < 6; i++) {
    const last = cur.lastElementChild as HTMLElement | null
    if (!last || !/^(P|LI|DIV|BLOCKQUOTE|UL|OL|DETAILS)$/.test(last.tagName)) break
    if (last.tagName === 'DETAILS') break
    cur = last
  }
  return cur
}

function Reasoning({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(live)
  const touched = useRef(false)
  useEffect(() => {
    if (!touched.current) setOpen(live)
  }, [live])
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (live && open && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [text, live, open])
  return (
    <div className={`reasoning ${open ? 'open' : ''} ${live ? 'live' : ''}`}>
      <button
        className="reasoning-head"
        data-sfx="soft"
        onClick={() => {
          touched.current = true
          setOpen(!open)
        }}
      >
        <Icon name={open ? 'chevD' : 'chevR'} />
        <span>{live ? '思索中…' : '思绪'}</span>
        <span className="t-faint t-small">{text.length} 字</span>
      </button>
      {open && (
        <div ref={ref} className="reasoning-body selectable">
          {text}
        </div>
      )}
    </div>
  )
}

function Elapsed({ since }: { since: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => tick((x) => x + 1), 250)
    return () => window.clearInterval(t)
  }, [])
  const s = Math.max(0, (Date.now() - since) / 1000)
  return <span className="t-pixel msg-elapsed">{s.toFixed(1)}s</span>
}

export async function openLink(e: React.MouseEvent) {
  // 原样式消息在 Shadow DOM 里，要顺着事件路径找链接
  const a = (e.nativeEvent.composedPath().find((n) => n instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined) ?? (e.target as HTMLElement).closest('a')
  if (a && a.getAttribute('href')) {
    e.preventDefault()
    await yt.app.openExternal(a.getAttribute('href')!)
  }
}
