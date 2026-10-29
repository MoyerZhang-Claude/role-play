import { createElement, useMemo, useRef, useState } from 'react'
import type { Character, Group, GroupStrategy } from '@shared/types'
import { useLibrary, avatarSrc } from '../state/library'
import { useGroups, membersOf, talkOf } from '../state/groups'
import { useChats } from '../state/chats'
import { go } from '../state/router'
import { useUI, toast, confirmDialog } from '../state/ui'
import { Modal } from '../components/Overlays'
import { Button, IconButton, Toggle, Slider, TextArea, TextField, Medallion, Corners, Divider } from '../components/ui'
import { Icon } from '../icons/Icon'
import { relTime } from '../lib/api'
import { audio } from '../audio/engine'
import { exportGroupBundle } from '../lib/groupImport'

/* ───────── 群像：几位成员的头像错落叠在一起 ───────── */

export function GroupSeal({ group, size = 46 }: { group: Group; size?: number }) {
  const chars = useLibrary((s) => s.chars)
  const ms = membersOf(group, chars).slice(0, 3)
  return (
    <span className="group-seal" style={{ width: size * (1 + (ms.length - 1) * 0.62), height: size }} aria-label={group.name}>
      {ms.map((m, i) => (
        <span key={m.id} className="group-seal-item" style={{ left: i * size * 0.62, zIndex: 3 - i }}>
          <Medallion src={avatarSrc(m)} name={m.name} size={size} />
        </span>
      ))}
    </span>
  )
}

/** 书斋里的群聊卡片：三张立绘错落成一叠 */
export function GroupCard({ group, index }: { group: Group; index: number }) {
  const chars = useLibrary((s) => s.chars)
  const ms = membersOf(group, chars)
  const ref = useRef<HTMLButtonElement>(null)
  const move = (e: React.PointerEvent) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--rx', `${(-((e.clientY - r.top) / r.height - 0.5) * 7).toFixed(2)}deg`)
    el.style.setProperty('--ry', `${(((e.clientX - r.left) / r.width - 0.5) * 9).toFixed(2)}deg`)
  }
  const leave = () => {
    ref.current?.style.setProperty('--rx', '0deg')
    ref.current?.style.setProperty('--ry', '0deg')
  }
  return (
    <button ref={ref} className="char-card group-card" style={{ animationDelay: `${Math.min(index, 16) * 35}ms` }} data-hover-sfx data-sfx="page" onPointerMove={move} onPointerLeave={leave} onClick={() => go({ name: 'group', id: group.id })}>
      <span className="char-card-frame group-card-frame">
        {ms.slice(0, 3).map((m, i, arr) => {
          const src = avatarSrc(m)
          return (
            <span key={m.id} className={`group-card-leaf n${arr.length} i${i}`}>
              {src ? <img src={src} alt="" draggable={false} loading="lazy" /> : <span className="char-card-blank t-display">{Array.from(m.name)[0]}</span>}
            </span>
          )
        })}
        <span className="group-card-ribbon t-pixel">群聊</span>
        <span className="char-card-glint" />
      </span>
      <span className="char-card-name">{group.name}</span>
      <span className="char-card-meta">
        <span>{ms.length} 位成员</span>
        <span className="group-card-names">{ms.map((m) => m.name).join('、')}</span>
      </span>
    </button>
  )
}

/* ───────── 组一个群聊 ───────── */

const STRATEGIES: { value: GroupStrategy; label: string; hint: string }[] = [
  { value: 'natural', label: '自然', hint: '你点到谁的名字，谁先接话；没点名时，按各自的活跃度有人接话。最像真实的聊天。' },
  { value: 'list', label: '轮流', hint: '你每说一句，所有成员按顺序各回一段。适合讨论、会议、「每个人表个态」。' },
  { value: 'manual', label: '点名', hint: '谁也不会自动接话，由你在输入框上方点名让谁说。节奏完全由你掌握。' }
]

export function createGroupDialog(preset: string[] = []): void {
  const close = () => useUI.getState().closeModal()
  useUI.getState().openModal('group-create', createElement(GroupCreateModal, { preset, onDone: close }))
}

function GroupCreateModal({ preset, onDone }: { preset: string[]; onDone: () => void }) {
  const chars = useLibrary((s) => s.chars)
  const [open, setOpen] = useState(true)
  const [sel, setSel] = useState<string[]>(preset)
  const [name, setName] = useState('')
  const [strategy, setStrategy] = useState<GroupStrategy>('natural')
  const finish = () => {
    setOpen(false)
    window.setTimeout(onDone, 200)
  }
  const picked = sel.map((id) => chars.find((c) => c.id === id)).filter((c): c is Character => !!c)
  const autoName = picked.length ? picked.map((c) => c.name).join('、').slice(0, 24) : ''
  const create = async () => {
    const g = await useGroups.getState().create(name.trim() || autoName || '新的群聊', sel, { strategy })
    audio.stamp()
    toast('ok', `群聊「${g.name}」组好了`, '在群聊页可以调整顺序、活跃度和场景')
    finish()
    go({ name: 'group', id: g.id })
  }
  return (
    <Modal
      open={open}
      onClose={finish}
      deco="Convivium · 组一个群聊"
      title="把几位角色请到同一桌"
      width={760}
      footer={
        <>
          <span className="modal-foot-note">{sel.length < 2 ? '至少选两位角色' : `已选 ${sel.length} 位`}</span>
          <Button sfx="back" onClick={finish}>
            取消
          </Button>
          <Button variant="primary" icon="seal" sfx="none" disabled={sel.length < 2} onClick={create}>
            组成群聊
          </Button>
        </>
      }
    >
      <div className="group-create">
        <TextField label="群名" value={name} placeholder={autoName || '比如：雨夜茶馆'} onChange={(e) => setName(e.target.value)} />
        <div>
          <div className="field-label">成员（按点选的顺序）</div>
          {chars.length < 2 ? (
            <p className="t-faint">书斋里至少要有两位角色才能组群聊。</p>
          ) : (
            <div className="group-pick">
              {chars.map((c) => {
                const i = sel.indexOf(c.id)
                return (
                  <button key={c.id} className={`group-pick-item ${i >= 0 ? 'on' : ''}`} data-sfx="soft" onClick={() => setSel(i >= 0 ? sel.filter((x) => x !== c.id) : [...sel, c.id])}>
                    <Medallion src={avatarSrc(c)} name={c.name} size={44} />
                    <span className="group-pick-name">{c.name}</span>
                    {i >= 0 && <span className="group-pick-no t-pixel">{i + 1}</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <div>
          <div className="field-label">谁来接话</div>
          <StrategySeg value={strategy} onChange={setStrategy} />
        </div>
      </div>
    </Modal>
  )
}

function StrategySeg({ value, onChange }: { value: GroupStrategy; onChange: (v: GroupStrategy) => void }) {
  return (
    <div className="seg seg3">
      {STRATEGIES.map((s) => (
        <button key={s.value} className={`seg-item ${value === s.value ? 'on' : ''}`} data-sfx="soft" onClick={() => onChange(s.value)}>
          <b>{s.label}</b>
          <span>{s.hint}</span>
        </button>
      ))}
    </div>
  )
}

/* ───────── 群聊页 ───────── */

export function GroupPage({ id }: { id: string }) {
  const group = useGroups((s) => s.groups.find((g) => g.id === id))
  const chars = useLibrary((s) => s.chars)
  const index = useChats((s) => s.index)
  const [adding, setAdding] = useState(false)
  const chats = useMemo(
    () =>
      Object.values(index)
        .filter((s) => s.characterId === id)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [index, id]
  )
  if (!group) {
    return (
      <div className="page">
        <p className="t-faint">这个群聊已经不在了。</p>
        <Button onClick={() => go({ name: 'home' })}>回到书斋</Button>
      </div>
    )
  }
  const members = membersOf(group, chars)
  const save = (patch: Partial<Group>) => useGroups.getState().save({ ...group, ...patch })
  const move = (i: number, d: -1 | 1) => {
    const ids = [...group.memberIds]
    const j = i + d
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    save({ memberIds: ids })
  }
  const start = async () => {
    if (members.length < 1) return toast('warn', '群里还没有成员')
    const c = await useChats.getState().createGroupChat(group)
    go({ name: 'chat', characterId: group.id, chatId: c.id })
  }
  const remove = async () => {
    const ok = await confirmDialog({ title: `解散群聊「${group.name}」？`, body: `它的 ${chats.length} 卷对话会被删除；成员角色本身不受影响。`, okText: '解散', danger: true })
    if (!ok) return
    await useGroups.getState().remove(group.id)
    for (const c of chats) await useChats.getState().deleteChat(group.id, c.id)
    toast('ok', `群聊「${group.name}」已解散`)
    go({ name: 'home' })
  }
  const others = chars.filter((c) => !group.memberIds.includes(c.id))

  return (
    <div className="page charpage group-page">
      <div className="cp-grid">
        <aside className="cp-side">
          <div className="cp-frame group-frame">
            <Corners size={18} />
            <div className="group-frame-fan">
              {members.slice(0, 3).map((m, i, arr) => {
                const src = avatarSrc(m)
                return <span key={m.id} className={`group-card-leaf n${arr.length} i${i}`}>{src ? <img src={src} alt="" draggable={false} /> : <span className="char-card-blank t-display">{Array.from(m.name)[0]}</span>}</span>
              })}
            </div>
          </div>
        </aside>
        <section className="cp-main">
          <div className="t-deco">Convivium · 群聊 · {members.length} 位成员</div>
          <input className="cp-name t-display group-name-input" value={group.name} spellCheck={false} onChange={(e) => save({ name: e.target.value })} />
          <div className="cp-actions">
            <Button variant="primary" size="lg" icon="quill" sfx="page" onClick={start}>
              开始新的一卷
            </Button>
            {chats[0] && (
              <Button size="lg" icon="book" sfx="page" onClick={() => go({ name: 'chat', characterId: group.id, chatId: chats[0].id })}>
                续读最近一卷
              </Button>
            )}
            <span className="section-spacer" />
            <IconButton icon="download" tip="导出群聊卡（连同成员的角色卡与头像，一个文件分享出去）" onClick={() => void exportGroupBundle(group)} />
            <IconButton icon="trash" tip="解散群聊" tone="rubric" onClick={remove} />
          </div>

          <h3 className="set-sub">成员</h3>
          <p className="t-small t-faint">顺序就是「轮流」时的发言顺序。活跃度越高，没被点名时越容易接话；静默的成员暂时不说话，也不会出现在新一卷的开场。</p>
          <div className="group-members">
            {group.memberIds.map((mid, i) => {
              const m = chars.find((c) => c.id === mid)
              if (!m) return null
              const muted = group.mutedIds.includes(m.id)
              return (
                <div key={m.id} className={`group-member ${muted ? 'muted' : ''}`}>
                  <span className="group-member-no t-pixel">{i + 1}</span>
                  <button className="group-member-who" data-sfx="soft" onClick={() => go({ name: 'character', id: m.id })} data-tip="打开角色页">
                    <Medallion src={avatarSrc(m)} name={m.name} size={40} />
                    <span>{m.name}</span>
                  </button>
                  <span className="group-member-talk">
                    <span className="t-small t-faint">活跃度</span>
                    <Slider value={talkOf(group, m)} min={0} max={1} step={0.05} width={210} onChange={(v) => save({ talk: { ...group.talk, [m.id]: v } })} format={(v) => `${Math.round(v * 100)}%`} />
                  </span>
                  <Toggle checked={!muted} onChange={(v) => save({ mutedIds: v ? group.mutedIds.filter((x) => x !== m.id) : [...group.mutedIds, m.id] })} label={muted ? '静默' : '发言'} />
                  <IconButton icon="chevL" tip="上移" className="rot90" onClick={() => move(i, -1)} />
                  <IconButton icon="chevR" tip="下移" className="rot90" onClick={() => move(i, 1)} />
                  <IconButton
                    icon="close"
                    tip="移出群聊"
                    onClick={() => (group.memberIds.length <= 2 ? toast('info', '群聊至少要有两位成员') : save({ memberIds: group.memberIds.filter((x) => x !== m.id), mutedIds: group.mutedIds.filter((x) => x !== m.id) }))}
                  />
                </div>
              )
            })}
          </div>
          {others.length > 0 &&
            (adding ? (
              <div className="group-add">
                {others.map((c) => (
                  <button
                    key={c.id}
                    className="group-pick-item"
                    data-sfx="soft"
                    onClick={() => {
                      save({ memberIds: [...group.memberIds, c.id] })
                      setAdding(false)
                    }}
                  >
                    <Medallion src={avatarSrc(c)} name={c.name} size={36} />
                    <span className="group-pick-name">{c.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <Button size="sm" variant="ghost" icon="plus" onClick={() => setAdding(true)}>
                请一位角色入群
              </Button>
            ))}

          <h3 className="set-sub">谁来接话</h3>
          <StrategySeg value={group.strategy} onChange={(v) => save({ strategy: v })} />
          <Toggle checked={group.allowSelfReply} onChange={(v) => save({ allowSelfReply: v })} label="允许同一位角色连着说两段" hint="关闭时，「接着聊」和活跃度挑人都会跳过刚说完话的那位。" />

          <h3 className="set-sub">群聊场景</h3>
          <p className="t-small t-faint">写下这群人此刻在哪里、在做什么。不填时，每位角色用自己卡里的场景。</p>
          <TextArea value={group.scenario} minRows={3} placeholder="例如：雨夜，城南的茶馆「听雨楼」，打烊前的最后一个时辰。" onChange={(e) => save({ scenario: e.target.value })} />

          <Divider glyph="diamond" />
          <h3 className="set-sub">卷册 · {chats.length}</h3>
          {chats.length === 0 ? (
            <p className="t-faint">还没有对话。点「开始新的一卷」，成员们会依次说出各自的开场白。</p>
          ) : (
            <div className="volume-list">
              {chats.map((c, i) => (
                <div key={c.id} className="volume" style={{ animationDelay: `${i * 30}ms` }}>
                  <span className="volume-no t-pixel">{String(chats.length - i).padStart(2, '0')}</span>
                  <button className="volume-main" data-sfx="page" onClick={() => go({ name: 'chat', characterId: group.id, chatId: c.id })}>
                    <span className="volume-title">{c.title}</span>
                    <span className="volume-preview">{c.preview || '（尚未落笔）'}</span>
                  </button>
                  <span className="volume-meta t-small t-faint">
                    {c.count} 页 · {relTime(c.updatedAt)}
                  </span>
                  <IconButton
                    icon="trash"
                    tip="删除这一卷"
                    onClick={async () => {
                      if (await confirmDialog({ title: `删除「${c.title}」？`, okText: '删除', danger: true })) useChats.getState().deleteChat(group.id, c.id)
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/* ───────── 对话页：成员栏 ───────── */

export function GroupBar({ group, busy, speakingId }: { group: Group; busy: boolean; speakingId?: string }) {
  const chars = useLibrary((s) => s.chars)
  const ms = membersOf(group, chars)
  const strategy = STRATEGIES.find((s) => s.value === group.strategy)!
  return (
    <div className="group-bar">
      <span className="group-bar-label t-small" data-tip={strategy.hint}>
        <Icon name="user" /> {strategy.label}
      </span>
      <div className="group-bar-members">
        {ms.map((m) => {
          const muted = group.mutedIds.includes(m.id)
          return (
            <button
              key={m.id}
              className={`group-chip ${muted ? 'muted' : ''} ${speakingId === m.id ? 'speaking' : ''}`}
              data-sfx="soft"
              disabled={busy}
              data-tip={muted ? `${m.name}（静默中，点一下也可以让 TA 说）` : `让${m.name}接着说`}
              onClick={() => useChats.getState().speakAs(m.id)}
            >
              <Medallion src={avatarSrc(m)} name={m.name} size={24} ring={false} />
              <span>{m.name}</span>
            </button>
          )
        })}
      </div>
      <button className="group-bar-more t-small" data-sfx="soft" disabled={busy} data-tip="不等你开口，让他们接着聊一轮" onClick={() => useChats.getState().continueGroup()}>
        <Icon name="refresh" /> 让他们接着聊
      </button>
    </div>
  )
}
