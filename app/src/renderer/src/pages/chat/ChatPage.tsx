import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { BuildResult } from '@shared/prompt'
import { makeMacroContext, personaName, swipeText } from '@shared/prompt'
import { substituteMacros } from '@shared/macros'
import { POSITION_LABEL } from '@shared/worldbook'
import { useChats } from '../../state/chats'
import { useLibrary, avatarSrc } from '../../state/library'
import { useSettings } from '../../state/settings'
import { go } from '../../state/router'
import { confirmDialog } from '../../state/ui'
import { Medallion, IconButton, Spinner, Button, usePresence, TextArea, Slider, Divider } from '../../components/ui'
import { Modal } from '../../components/Overlays'
import { Icon } from '../../icons/Icon'
import { MessageItem, openLink } from './MessageItem'
import { Composer, type ComposerHandle } from './Composer'
import { relTime } from '../../lib/api'
import { useGroups, membersOf } from '../../state/groups'
import { GroupBar, GroupSeal } from '../Groups'
import type { Character } from '@shared/types'

export function ChatPage({ characterId, chatId }: { characterId: string; chatId: string }) {
  const chars = useLibrary((s) => s.chars)
  const group = useGroups((s) => s.groups.find((g) => g.id === characterId))
  const members = useMemo(() => (group ? membersOf(group, chars) : []), [group, chars])
  // 群聊时没有「这一位角色」：用第一位成员撑起页面，每条回复再换成真正的说话人
  const ch = group ? members[0] : chars.find((c) => c.id === characterId)
  const chat = useChats((s) => (s.active?.id === chatId ? s.active : null))
  const gen = useChats((s) => s.gen)
  const settings = useSettings((s) => s.s)
  const [missing, setMissing] = useState(false)
  const [left, setLeft] = useState(false)
  const [right, setRight] = useState(false)
  const [inspect, setInspect] = useState<BuildResult | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const composer = useRef<ComposerHandle>(null)
  const stick = useRef(true)
  const [showJump, setShowJump] = useState(false)

  useEffect(() => {
    setMissing(false)
    useChats
      .getState()
      .openChat(characterId, chatId)
      .then((c) => {
        if (!c) setMissing(true)
        else requestAnimationFrame(() => composer.current?.focus())
      })
    return () => useChats.getState().closeChat()
  }, [characterId, chatId])

  const userName = personaName(settings.chat)
  const macros = useMemo(() => {
    if (!ch || !chat) return (s: string) => s
    const ctx = makeMacroContext(ch, chat, settings.chat, null, chat.messages, settings.globalVars)
    return (s: string) => substituteMacros(s, ctx)
    // 宏只依赖人设名与角色名，不随每条消息变化
  }, [ch?.id, ch?.name, ch?.updatedAt, chat?.id, userName, settings.chat.persona.description])
  // 群聊：每位成员各自的宏（{{char}} 是说话的那位）
  const speakerMacros = useMemo(() => {
    const out = new Map<string, (s: string) => string>()
    if (!group || !chat) return out
    const names = members.map((m) => m.name).join(', ')
    for (const m of members) {
      const ctx = { ...makeMacroContext(m, chat, settings.chat, null, chat.messages, settings.globalVars), group: names }
      out.set(m.id, (s: string) => substituteMacros(s, ctx))
    }
    return out
  }, [group?.id, members, chat?.id, userName, settings.chat.persona.description])
  // 群聊里你说的话只走预设的正则，不套某位成员的
  const neutral = useMemo<Character | undefined>(() => (group && ch ? { ...ch, regexScripts: [], display: { ...ch.display, styleMode: 'yaotang' } } : undefined), [group?.id, ch])

  // 自动滚动：用户在底部附近时跟随
  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140
    stick.current = near
    setShowJump(!near)
  }
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  })
  useEffect(() => {
    stick.current = true
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat?.id])
  // 内容高度变化（例如流式书写、图片加载）时保持贴底
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const inner = el.firstElementChild
    if (!inner) return
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(inner)
    return () => ro.disconnect()
  }, [chat?.id])

  const jump = () => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    stick.current = true
  }

  const openInspector = useCallback(async () => {
    const st = useChats.getState()
    const b = st.lastBuild && st.lastBuild.chatId === chat?.id && st.lastBuild.at > (chat?.updatedAt ?? 0) - 60000 ? st.lastBuild : await st.preview()
    if (b) setInspect(b)
  }, [chat?.updatedAt, chat?.id])
  useEffect(() => {
    const h = () => void openInspector()
    window.addEventListener('yt:open-inspector', h)
    return () => window.removeEventListener('yt:open-inspector', h)
  }, [openInspector])

  if (!ch || missing) {
    return (
      <div className="page">
        <p className="t-faint">找不到这一卷对话。</p>
        <Button onClick={() => go({ name: 'home' })}>回到书斋</Button>
      </div>
    )
  }
  if (!chat) {
    return (
      <div className="chat-loading">
        <Spinner size={42} />
      </div>
    )
  }

  const busy = !!gen && gen.chatId === chat.id
  const avatar = avatarSrc(ch)
  const speakingId = busy ? chat.messages.find((m) => m.id === gen!.messageId)?.speakerId : undefined
  const who = (m: (typeof chat.messages)[number]): Character => {
    if (!group) return ch
    if (m.role === 'user') return neutral ?? ch
    return members.find((x) => x.id === m.speakerId) ?? chars.find((x) => x.id === m.speakerId) ?? ch
  }
  const msgs = chat.messages
  const last = msgs[msgs.length - 1]
  const canRetry = !!last && last.role === 'user'

  return (
    <div className="chat">
      <header className="chat-head">
        {group ? (
          <>
            <IconButton icon="back" tip="回到群聊页" sfx="back" onClick={() => go({ name: 'group', id: group.id })} />
            <GroupSeal group={group} size={30} />
          </>
        ) : (
          <>
            <IconButton icon="back" tip="回到角色页" sfx="back" onClick={() => go({ name: 'character', id: ch.id })} />
            <Medallion src={avatar} name={ch.name} size={34} />
          </>
        )}
        <div className="chat-head-text">
          <span className="chat-head-name">{group ? group.name : ch.name}</span>
          <span className="chat-head-title">{chat.title}</span>
        </div>
        <span className="section-spacer" />
        <IconButton icon="list" tip={group ? '卷册（这个群聊的所有对话）' : '卷册（这位角色的所有对话）'} active={left} onClick={() => setLeft(!left)} />
        <IconButton
          icon="plus"
          tip="开始新的一卷"
          onClick={async () => {
            const c = group ? await useChats.getState().createGroupChat(group) : await useChats.getState().createChat(ch)
            go({ name: 'chat', characterId: group ? group.id : ch.id, chatId: c.id })
          }}
        />
        <IconButton icon="eye" tip="查看发给 AI 的提示词" onClick={openInspector} />
        <IconButton icon="panel" tip="侧记：世界书与作者备注" active={right} onClick={() => setRight(!right)} />
      </header>

      <div className="chat-scroll" ref={scroller} onScroll={onScroll} onClick={openLink}>
        <div className="chat-column">
          <div className="chat-opening">
            <div className="t-deco">Incipit</div>
            <div className="chat-opening-title t-display">{chat.title.split(' · ').slice(0, 2).join(' · ')}</div>
            <Divider />
          </div>
          {msgs.length === 0 && (
            <div className="chat-empty t-faint">
              <p>{group ? '这一卷还是空白的。写下第一句话，或在下方点名让一位成员先开口。' : `这一卷还是空白的。${ch.firstMes.trim() ? '' : '这位角色没有开场白，'}写下第一句话吧。`}</p>
            </div>
          )}
          {msgs.map((m, i) => {
            const sp = who(m)
            return (
            <MessageItem
              key={m.id}
              msg={m}
              index={i}
              depth={msgs.length - 1 - i}
              isLast={i === msgs.length - 1}
              ch={sp}
              avatar={group ? avatarSrc(sp) : avatar}
              userName={userName}
              macros={group ? (speakerMacros.get(sp.id) ?? macros) : macros}
              quotes={settings.appearance.quoteHighlight}
              smooth={settings.chat.smoothReveal}
              showReasoning={settings.chat.showReasoning}
              phase={busy && gen!.messageId === m.id ? gen!.phase : null}
              genStartedAt={busy && gen!.messageId === m.id ? gen!.startedAt : 0}
              busy={busy}
            />
            )
          })}
          <div className="chat-tail" />
        </div>
      </div>

      {showJump && (
        <button className="jump-btn" data-sfx="soft" onClick={jump}>
          <Icon name="chevD" /> 回到最新
        </button>
      )}

      {group && <GroupBar group={group} busy={busy} speakingId={speakingId} />}
      <Composer ref={composer} chatId={chat.id} userName={userName} busy={busy} canRetry={canRetry} canContinue={!!last && last.role === 'assistant' && !!swipeText(last).trim()} />

      <VolumesDrawer open={left} onClose={() => setLeft(false)} characterId={group ? group.id : ch.id} currentId={chat.id} isGroup={!!group} />
      <NotesDrawer open={right} onClose={() => setRight(false)} />
      <PromptInspector build={inspect} onClose={() => setInspect(null)} />
    </div>
  )
}

function Drawer({ open, side, onClose, title, deco, children }: { open: boolean; side: 'left' | 'right'; onClose: () => void; title: string; deco: string; children: React.ReactNode }) {
  const { mounted, leaving } = usePresence(open, 240)
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open])
  if (!mounted) return null
  return (
    <>
      <div className={`drawer-scrim ${leaving ? 'leaving' : ''}`} onPointerDown={onClose} />
      <aside className={`drawer drawer-${side} sheet ${leaving ? 'leaving' : ''}`}>
        <header className="drawer-head">
          <div className="t-deco">{deco}</div>
          <div className="drawer-title">{title}</div>
          <IconButton icon="close" tip="收起" sfx="back" className="drawer-x" onClick={onClose} />
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  )
}

function VolumesDrawer({ open, onClose, characterId, currentId, isGroup }: { open: boolean; onClose: () => void; characterId: string; currentId: string; isGroup?: boolean }) {
  const index = useChats((s) => s.index)
  const list = Object.values(index)
    .filter((s) => s.characterId === characterId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  return (
    <Drawer open={open} side="left" onClose={onClose} title="卷册" deco="Volumina">
      <div className="vol-list">
        {list.map((c) => (
          <div key={c.id} className={`vol-item ${c.id === currentId ? 'cur' : ''}`}>
            <button
              className="vol-main"
              data-sfx="page"
              onClick={() => {
                onClose()
                if (c.id !== currentId) go({ name: 'chat', characterId, chatId: c.id })
              }}
            >
              <span className="vol-title">{c.title}</span>
              <span className="vol-preview">{c.preview || '（尚未落笔）'}</span>
              <span className="vol-meta t-small t-faint">
                {c.count} 页 · {relTime(c.updatedAt)}
              </span>
            </button>
            <IconButton
              icon="trash"
              tip="删除这一卷"
              onClick={async () => {
                if (!(await confirmDialog({ title: '删除这一卷对话？', body: c.title, okText: '删除', danger: true }))) return
                await useChats.getState().deleteChat(characterId, c.id)
                if (c.id === currentId) go(isGroup ? { name: 'group', id: characterId } : { name: 'character', id: characterId })
              }}
            />
          </div>
        ))}
      </div>
    </Drawer>
  )
}

function NotesDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const chat = useChats((s) => s.active)
  const build = useChats((s) => s.lastBuild)
  const [note, setNote] = useState(chat?.authorNote?.text ?? '')
  const [depth, setDepth] = useState(chat?.authorNote?.depth ?? 4)
  useEffect(() => {
    setNote(chat?.authorNote?.text ?? '')
    setDepth(chat?.authorNote?.depth ?? 4)
  }, [chat?.id])
  return (
    <Drawer open={open} side="right" onClose={onClose} title="侧记" deco="Marginalia">
      <section className="notes-sec">
        <h4>作者备注</h4>
        <p className="t-small t-faint">只对这一卷生效。每次都会插在倒数第 N 条消息处，适合写当前剧情的提醒，比如「现在是深夜，下着雨」。</p>
        <TextArea value={note} minRows={4} placeholder="例如：{{char}}此刻还在生气，但不会直说。" onChange={(e) => setNote(e.target.value)} onBlur={() => useChats.getState().setAuthorNote(note, depth)} />
        <div className="notes-row">
          <span className="t-small">插入深度</span>
          <Slider
            value={depth}
            min={0}
            max={12}
            onChange={(v) => {
              setDepth(v)
              useChats.getState().setAuthorNote(note, v)
            }}
            width={200}
          />
        </div>
      </section>
      <RecapSection />
      <section className="notes-sec">
        <h4>上一轮触发的世界书</h4>
        {!build ? (
          <p className="t-small t-faint">生成一次回复后，这里会列出被关键词或常驻规则激活的条目。</p>
        ) : (
          <>
            <p className="t-small t-faint">
              共 {build.activated.length} 条{build.budgetOverflow ? '（已达预算上限，部分低优先级条目未放入）' : ''}
            </p>
            <ul className="wi-list">
              {[...build.activated]
                .sort((a, b) => (a.reason === 'constant' ? 1 : 0) - (b.reason === 'constant' ? 1 : 0))
                .map((a) => (
                  <li key={a.entry.bookId + a.entry.uid}>
                    <span className={`badge ${a.reason === 'constant' ? 'gold' : a.reason === 'recursion' ? '' : 'rubric'}`}>{a.reason === 'constant' ? '常驻' : a.reason === 'recursion' ? '递归' : a.reason === 'sticky' ? '粘滞' : '触发'}</span>
                    <span className="wi-name">{a.entry.comment || a.entry.keys[0] || `#${a.entry.uid}`}</span>
                    {a.matchedKey && <span className="key">{a.matchedKey}</span>}
                    <span className="t-faint t-small">{POSITION_LABEL[a.entry.position]}</span>
                  </li>
                ))}
            </ul>
          </>
        )}
      </section>
    </Drawer>
  )
}

function PromptInspector({ build, onClose }: { build: BuildResult | null; onClose: () => void }) {
  const [last, setLast] = useState(build)
  useEffect(() => {
    if (build) setLast(build)
  }, [build])
  const b = build ?? last
  return (
    <Modal open={!!build} onClose={onClose} deco="Speculum · 提示词透镜" title="发给 AI 的内容" width={900}>
      {b && (
        <div className="inspector">
          <BudgetBar b={b} />
          <p className="t-small t-faint">
            约 {b.tokens.toLocaleString()} tokens（{b.budget.calibrated ? '已按实际用量校准' : '估算'}）· 发送聊天记录 {b.includedHistory} 条{b.trimmedHistory ? `，较早的 ${b.trimmedHistory} 条因上下文预算未发送` : ''} · 世界书激活 {b.activated.length} 条{b.budgetOverflow ? '（世界书超出预算，优先级低的条目没有发送）' : ''}
          </p>
          {b.blocks.map((blk, i) => (
            <details key={i} className="insp-block" open={i === 0}>
              <summary>
                <span className="insp-label">{blk.label}</span>
                <span className="insp-role t-pixel">{blk.role}</span>
                <span className="insp-tokens t-small t-faint">≈ {blk.tokens} tokens</span>
              </summary>
              <pre className="selectable">{blk.content}</pre>
            </details>
          ))}
        </div>
      )}
    </Modal>
  )
}

/** 上下文用量条：固定内容 / 聊天记录 / 回复预留 */
function BudgetBar({ b }: { b: BuildResult }) {
  const { context, reserve, fixed, history, over } = b.budget
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / context) * 100)).toFixed(1)}%`
  return (
    <div className={`budget-bar ${over ? 'over' : ''}`}>
      <div className="budget-track">
        <span className="budget-fixed" style={{ width: pct(fixed) }} />
        <span className="budget-history" style={{ width: pct(history) }} />
        <span className="budget-reserve" style={{ width: pct(reserve) }} />
      </div>
      <div className="budget-legend t-small">
        <span><i className="budget-fixed" />固定内容 {fixed.toLocaleString()}</span>
        <span><i className="budget-history" />聊天记录 {history.toLocaleString()}</span>
        <span><i className="budget-reserve" />回复预留 {reserve.toLocaleString()}</span>
        <span className="t-faint">上下文 {context.toLocaleString()}</span>
      </div>
      {over && <p className="t-small budget-warn">固定内容已经超过可用空间，这次不会发送。</p>}
    </div>
  )
}

/** 侧记：前情提要 */
function RecapSection() {
  const chat = useChats((s) => s.active)
  const busy = useChats((s) => s.recapping === s.active?.id)
  const auto = useSettings((s) => s.s.chat.autoSummary !== false)
  const [text, setText] = useState(chat?.summary?.text ?? '')
  useEffect(() => setText(chat?.summary?.text ?? ''), [chat?.id, chat?.summary?.updatedAt])
  const sum = chat?.summary
  return (
    <section className="notes-sec recap-sec">
      <h4>
        前情提要
        {busy && (
          <span className="recap-busy t-small">
            <Spinner size={14} /> 正在整理
          </span>
        )}
      </h4>
      <p className="t-small t-faint">
        对话长到上下文放不下时，最早的消息不再发送。{auto ? '药汤会在后台把它们整理成前情提要，代替原文发给 AI，免得前面的剧情被忘掉。' : '自动整理已在「设置 → 对话与人设」关闭，可以手动整理。'}
        角色设定、世界书与预设不受影响，始终完整发送。
      </p>
      {sum ? (
        <>
          <div className="recap-meta t-small">
            概括了最早的 {sum.covered} 条对话{sum.edited ? ' · 已手动修改' : ''} · {relTime(sum.updatedAt)}
          </div>
          <TextArea value={text} minRows={6} onChange={(e) => setText(e.target.value)} onBlur={() => text !== sum.text && useChats.getState().setRecap(text)} />
        </>
      ) : (
        <p className="t-small recap-empty">这一卷还没有前情提要。{auto ? '需要时会自动整理。' : ''}</p>
      )}
      <div className="notes-row">
        <Button size="sm" icon="refresh" disabled={busy} onClick={() => useChats.getState().rebuildRecap()}>
          {sum ? '重新整理' : '现在整理'}
        </Button>
        {sum && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => useChats.getState().clearRecap()}>
            清除
          </Button>
        )}
      </div>
    </section>
  )
}
