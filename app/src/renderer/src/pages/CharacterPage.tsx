import { useEffect, useMemo, useState } from 'react'
import type { Character, Worldbook } from '@shared/types'
import { newId } from '@shared/id'
import { makeMacroContext } from '@shared/prompt'
import { substituteMacros } from '@shared/macros'
import { useLibrary, avatarSrc, loadLinkedBooks } from '../state/library'
import { useChats } from '../state/chats'
import { useSettings } from '../state/settings'
import { go } from '../state/router'
import { confirmDialog, toast } from '../state/ui'
import { Button, IconButton, Toggle, Divider, Corners, Select } from '../components/ui'
import { Icon } from '../icons/Icon'
import { ReportList } from './ImportModals'
import { BookEntries } from '../components/BookEntries'
import { renderRich } from '../render/rich'
import { relTime, yt } from '../lib/api'
import { exportCharacterCard } from './CardExport'
import { needsScript } from '@shared/presetRuntime'
import { isAutoDisabled } from '@shared/regex'

type Tab = 'intro' | 'chats' | 'book' | 'regex' | 'report'

function useRich(ch: Character) {
  const settings = useSettings((s) => s.s)
  return (text: string) => {
    const ctx = makeMacroContext(ch, { id: 'preview', characterId: ch.id, title: '', createdAt: 0, updatedAt: 0, messages: [], vars: {} }, settings.chat, null, [], settings.globalVars)
    return renderRich(text, { scripts: ch.regexScripts, macros: (t) => substituteMacros(t, ctx), placement: 2, depth: 0, quotes: settings.appearance.quoteHighlight })
  }
}

export function CharacterPage({ id }: { id: string }) {
  const ch = useLibrary((s) => s.chars.find((c) => c.id === id))
  const index = useChats((s) => s.index)
  const [tab, setTab] = useState<Tab>('intro')
  const chats = useMemo(
    () =>
      Object.values(index)
        .filter((s) => s.characterId === id)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [index, id]
  )
  if (!ch) {
    return (
      <div className="page">
        <p className="t-faint">这位角色已不在书斋中。</p>
        <Button onClick={() => go({ name: 'home' })}>回到书斋</Button>
      </div>
    )
  }
  const src = avatarSrc(ch)
  const latest = chats[0]
  const warn = ch.source.report?.items.filter((i) => i.level === 'warn').length ?? 0

  const startNew = async () => {
    const c = await useChats.getState().createChat(ch)
    go({ name: 'chat', characterId: ch.id, chatId: c.id })
  }
  const remove = async () => {
    const ok = await confirmDialog({ title: `把「${ch.name}」移出书斋？`, body: `角色卡与它的 ${chats.length} 卷对话都会被删除，无法恢复。`, okText: '移出', danger: true })
    if (!ok) return
    await useLibrary.getState().remove(ch.id)
    for (const c of chats) await useChats.getState().deleteChat(ch.id, c.id)
    toast('ok', `「${ch.name}」已移出书斋`)
    go({ name: 'home' })
  }
  const changeAvatar = async () => {
    const files = await yt.dialog.openFiles({ title: '选择头像图片', filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }], multi: false })
    if (!files[0]) return
    await useLibrary.getState().setAvatar(ch.id, files[0].bytes)
    toast('ok', '头像已更换')
  }

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'intro', label: '简介' },
    { key: 'chats', label: '卷册', count: chats.length },
    { key: 'book', label: '世界书', count: ch.book?.entries.length ?? 0 },
    { key: 'regex', label: '正则与显示', count: ch.regexScripts.length },
    ...(ch.source.report ? [{ key: 'report' as Tab, label: '导入说明', count: warn || undefined }] : [])
  ]

  return (
    <div className="page charpage">
      <div className="cp-grid">
        <aside className="cp-side">
          <div className="cp-frame">
            <Corners size={18} />
            {src ? <img src={src} alt="" draggable={false} /> : <div className="cp-blank t-display">{Array.from(ch.name)[0]}</div>}
          </div>
          <button className="cp-avatar-btn" data-sfx="soft" onClick={changeAvatar}>
            <Icon name="edit" /> 更换头像
          </button>
        </aside>
        <section className="cp-main">
          <div className="t-deco">Persona · {ch.source.format === 'custom' ? '自撰角色' : `角色卡 ${ch.source.format.toUpperCase()}`}</div>
          <h1 className="cp-name t-display">{ch.name}</h1>
          <div className="cp-meta">
            {ch.creator && <span>作者 {ch.creator}</span>}
            {ch.characterVersion && <span>版本 {ch.characterVersion}</span>}
            <span>收入于 {relTime(ch.createdAt)}</span>
            {ch.tags.slice(0, 8).map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
          <div className="cp-actions">
            <Button variant="primary" size="lg" icon="quill" sfx="page" onClick={startNew}>
              开始新的一卷
            </Button>
            {latest && (
              <Button size="lg" icon="book" sfx="page" onClick={() => go({ name: 'chat', characterId: ch.id, chatId: latest.id })}>
                续读最近一卷
              </Button>
            )}
            <Button size="lg" icon="edit" onClick={() => go({ name: 'editor', id: ch.id })}>
              编辑设定
            </Button>
            <span className="section-spacer" />
            <IconButton icon="download" tip="导出为 PNG 角色卡" onClick={() => exportCharacterCard(ch)} />
            <IconButton icon="trash" tip="移出书斋" tone="rubric" onClick={remove} />
          </div>

          <div className="tabs">
            {tabs.map((t) => (
              <button key={t.key} className={`tab ${tab === t.key ? 'on' : ''}`} data-sfx="soft" onClick={() => setTab(t.key)}>
                {t.label}
                {t.count != null && <span className="tab-count t-pixel">{t.count}</span>}
              </button>
            ))}
          </div>
          <div className="tab-body" key={tab}>
            {tab === 'intro' && <Intro ch={ch} />}
            {tab === 'chats' && <ChatList ch={ch} />}
            {tab === 'book' && <BookTab ch={ch} />}
            {tab === 'regex' && <RegexTab ch={ch} />}
            {tab === 'report' && ch.source.report && <ReportList report={ch.source.report} />}
          </div>
        </section>
      </div>
    </div>
  )
}

function Intro({ ch }: { ch: Character }) {
  const rich = useRich(ch)
  const [full, setFull] = useState(false)
  const greetings = [ch.firstMes, ...ch.alternateGreetings].filter((g) => g.trim())
  const desc = ch.description.trim()
  return (
    <div className="intro">
      {ch.creatorNotes.trim() && (
        <section>
          <h3 className="intro-h">作者寄语</h3>
          <div className="rich intro-notes selectable" dangerouslySetInnerHTML={{ __html: rich(ch.creatorNotes) }} />
        </section>
      )}
      <section>
        <h3 className="intro-h">角色设定</h3>
        {desc ? (
          <>
            <div className={`rich intro-desc selectable ${full ? 'full' : ''}`} dangerouslySetInnerHTML={{ __html: rich(full ? desc : desc.slice(0, 900)) }} />
            {desc.length > 900 && (
              <button className="link-btn" data-sfx="soft" onClick={() => setFull(!full)}>
                {full ? '收起' : `展开全文（共 ${desc.length} 字）`}
              </button>
            )}
          </>
        ) : (
          <p className="t-faint">设定字段为空{ch.book?.entries.length ? '，内容都写在世界书里。' : '。'}</p>
        )}
      </section>
      {greetings.length > 0 && (
        <section>
          <h3 className="intro-h">开场白 · {greetings.length} 条</h3>
          <div className="greet-preview sheet">
            <div className="rich selectable" dangerouslySetInnerHTML={{ __html: rich(greetings[0].slice(0, 1600)) }} />
          </div>
        </section>
      )}
    </div>
  )
}

function ChatList({ ch }: { ch: Character }) {
  const index = useChats((s) => s.index)
  const chats = Object.values(index)
    .filter((s) => s.characterId === ch.id)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const [editing, setEditing] = useState<string | null>(null)
  const [val, setVal] = useState('')
  if (!chats.length) return <p className="t-faint">还没有对话。点「开始新的一卷」落下第一笔。</p>
  return (
    <div className="volume-list">
      {chats.map((c, i) => (
        <div key={c.id} className="volume" style={{ animationDelay: `${i * 30}ms` }}>
          <span className="volume-no t-pixel">{String(chats.length - i).padStart(2, '0')}</span>
          {editing === c.id ? (
            <input
              className="field-input volume-edit"
              autoFocus
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onBlur={() => {
                if (val.trim()) useChats.getState().renameChat(c.id, val.trim())
                setEditing(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setEditing(null)
              }}
            />
          ) : (
            <button className="volume-main" data-sfx="page" onClick={() => go({ name: 'chat', characterId: ch.id, chatId: c.id })}>
              <span className="volume-title">{c.title}</span>
              <span className="volume-preview">{c.preview || '（尚未落笔）'}</span>
            </button>
          )}
          <span className="volume-meta t-small t-faint">
            {c.count} 页 · {relTime(c.updatedAt)}
          </span>
          <IconButton
            icon="edit"
            tip="改名"
            onClick={() => {
              setVal(c.title)
              setEditing(c.id)
            }}
          />
          <IconButton
            icon="trash"
            tip="删除这一卷"
            onClick={async () => {
              if (await confirmDialog({ title: '删除这一卷对话？', body: c.title, okText: '删除', danger: true })) useChats.getState().deleteChat(ch.id, c.id)
            }}
          />
        </div>
      ))}
    </div>
  )
}

/** 世界书：角色自带的一本 + 绑定的独立世界书，都可以编辑 */
function BookTab({ ch }: { ch: Character }) {
  const [linked, setLinked] = useState<Worldbook[]>([])
  const [which, setWhich] = useState<string>('own')
  const globalIds = useSettings((s) => s.s.chat.globalBookIds)
  useEffect(() => {
    loadLinkedBooks(ch).then(setLinked)
  }, [ch.id, ch.linkedBookIds.join(',')])

  const book: Worldbook | null = which === 'own' ? ch.book : (linked.find((b) => b.id === which) ?? null)
  const saveBook = async (b: Worldbook) => {
    if (which === 'own') await useLibrary.getState().save({ ...ch, book: b })
    else {
      await yt.fs.writeJSON(`worldbooks/${b.id}.json`, b)
      setLinked((ls) => ls.map((x) => (x.id === b.id ? b : x)))
    }
  }
  const createOwn = async () => {
    const b: Worldbook = { id: newId('wb'), name: `${ch.name}的世界书`, entries: [], source: { kind: 'custom', importedAt: Date.now() } }
    await useLibrary.getState().save({ ...ch, book: b })
    setWhich('own')
  }
  const unlink = async (id: string) => {
    const b = linked.find((x) => x.id === id)
    if (!(await confirmDialog({ title: '解除绑定？', body: `「${b?.name ?? id}」不再用于这位角色（世界书本身仍在「世界书」页里）。`, okText: '解除' }))) return
    await useLibrary.getState().save({ ...ch, linkedBookIds: ch.linkedBookIds.filter((x) => x !== id) })
    setWhich('own')
  }
  const books = [{ value: 'own', label: ch.book ? `《${ch.book.name}》` : '角色自带（未创建）', hint: '角色卡内嵌' }, ...linked.map((b) => ({ value: b.id, label: `《${b.name}》`, hint: '绑定的独立世界书' }))]

  return (
    <div className="book-tab">
      <div className="book-pick-row">
        {books.length > 1 ? <Select value={which} width={320} options={books} onChange={(v) => setWhich(v)} /> : <div className="book-name">{book ? `《${book.name}》` : '还没有世界书'}</div>}
        {globalIds.length > 0 && (
          <span className="t-small t-faint">
            另有 {globalIds.length} 本全局世界书对所有角色生效（在「世界书」页管理）
          </span>
        )}
      </div>
      {!book ? (
        <div className="book-empty">
          <p className="t-faint">世界书是按关键词自动出现的设定：地点、人物、规则……聊天里提到时才发给 AI，既省字数又不会遗忘。</p>
          <Button icon="globe" onClick={createOwn}>
            为「{ch.name}」新建世界书
          </Button>
        </div>
      ) : (
        <BookEntries
          key={book.id}
          book={book}
          onSave={saveBook}
          toolbarExtra={
            which !== 'own' ? (
              <Button size="sm" variant="ghost" onClick={() => unlink(which)}>
                解除绑定
              </Button>
            ) : null
          }
        />
      )}
    </div>
  )
}

function DisplayMode({ ch }: { ch: Character }) {
  const mode = ch.display?.styleMode ?? 'yaotang'
  const beautify = ch.regexScripts.filter((r) => r.ytKind === 'beautify' && !needsScript(r))
  const setMode = async (m: Character['display']['styleMode']) => {
    if (m === mode) return
    let scripts = ch.regexScripts
    let auto = ch.display?.autoEnabled ?? []
    if (m === 'isolated') {
      auto = scripts.filter((r) => isAutoDisabled(r, ch.raw) && !needsScript(r)).map((r) => r.id)
      scripts = scripts.map((r) => (auto.includes(r.id) ? { ...r, disabled: false } : r))
    } else {
      scripts = scripts.map((r) => (auto.includes(r.id) ? { ...r, disabled: true } : r))
      auto = []
    }
    await useLibrary.getState().save({ ...ch, regexScripts: scripts, display: { ...ch.display, styleMode: m, autoEnabled: auto } })
    toast(
      'ok',
      m === 'isolated' ? '已改为卡片原样式' : '已改回药汤风格',
      m === 'isolated' ? (auto.length ? `同时打开了 ${auto.length} 条界面美化正则；切回时会自动关上` : '带样式的消息会放进独立的底板里显示') : undefined
    )
  }
  return (
    <div className="display-mode">
      <div className="field-label">显示方式</div>
      <div className="seg">
        <button className={`seg-item ${mode === 'yaotang' ? 'on' : ''}`} data-sfx="soft" onClick={() => setMode('yaotang')}>
          <b>药汤风格</b>
          <span>所有内容都按药汤的纸墨排版；卡片自带的颜色会被调和，布局与样式会被过滤</span>
        </button>
        <button className={`seg-item ${mode === 'isolated' ? 'on' : ''}`} data-sfx="soft" onClick={() => setMode('isolated')}>
          <b>卡片原样式</b>
          <span>带样式的消息放进一块独立底板，按作者的设计显示；样式不会影响药汤界面</span>
        </button>
      </div>
      <p className="t-small t-faint">
        {mode === 'isolated'
          ? `原样式中不运行脚本，外部图片与字体不加载；正在生成的回复仍先用药汤风格书写，写完后再换成原样式。${beautify.length ? '' : '这张卡没有界面美化正则，只有消息里自带样式时才会用到底板。'}`
          : beautify.length
            ? `这张卡有 ${beautify.length} 条界面美化正则。改为「卡片原样式」时会自动打开它们。`
            : '大多数卡片用药汤风格就很好；如果作者为卡片设计了专门的界面，可以试试「卡片原样式」。'}
      </p>
    </div>
  )
}

function RegexTab({ ch }: { ch: Character }) {
  const iso = ch.display?.styleMode === 'isolated'
  const set = (id: string, disabled: boolean) => useLibrary.getState().save({ ...ch, regexScripts: ch.regexScripts.map((r) => (r.id === id ? { ...r, disabled, ytAutoDisabled: false } : r)) })
  return (
    <div className="regex-list">
      <DisplayMode ch={ch} />
      {!ch.regexScripts.length && <p className="t-faint">没有正则脚本。</p>}
      {ch.regexScripts.map((r) => (
        <div key={r.id} className={`regex ${r.disabled ? 'off' : ''}`}>
          <Toggle checked={!r.disabled} onChange={(v) => set(r.id, !v)} />
          <div className="regex-body">
            <div className="regex-name">
              {r.scriptName}
              {needsScript(r) ? <span className="badge warn">需要脚本</span> : r.ytKind === 'beautify' && <span className="badge warn">界面美化</span>}
              {r.promptOnly && <span className="badge">仅发送</span>}
              {r.markdownOnly && <span className="badge">仅显示</span>}
            </div>
            <div className="t-small t-faint">{r.ytNote}</div>
            {needsScript(r) ? (
              <div className="t-small regex-warn">它输出的界面需要运行脚本，药汤不运行脚本，所以不会用它来显示；被它替换的内容按原文显示。</div>
            ) : r.ytKind === 'beautify' && (
              <div className="t-small regex-warn">
                {iso ? '在「卡片原样式」下，它输出的界面会按原样式显示（脚本不运行）。' : '在药汤风格下开启它，HTML 结构会保留，但样式（颜色、边框、布局）会被过滤，可能显得零散。想看原样式，请把上面的显示方式改为「卡片原样式」。'}
              </div>
            )}
            <code className="regex-src selectable">{r.findRegex.length > 160 ? r.findRegex.slice(0, 160) + '…' : r.findRegex}</code>
          </div>
        </div>
      ))}
      <Divider glyph="diamond" />
    </div>
  )
}
