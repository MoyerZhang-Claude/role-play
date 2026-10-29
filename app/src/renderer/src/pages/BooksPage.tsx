import { useEffect, useState } from 'react'
import type { Worldbook } from '@shared/types'
import { newId } from '@shared/id'
import { parseWorldbookJson, toSTWorld, bookFromText, decodeText } from '@shared/worldbook'
import { useLibrary, avatarSrc } from '../state/library'
import { useSettings } from '../state/settings'
import { confirmDialog, toast } from '../state/ui'
import { Button, Toggle, TextField, Select, Medallion, MagicCircle } from '../components/ui'
import { BookEntries } from '../components/BookEntries'
import { Icon } from '../icons/Icon'
import { yt } from '../lib/api'
import { audio } from '../audio/engine'

async function listBooks(): Promise<Worldbook[]> {
  const out: Worldbook[] = []
  for (const f of await yt.fs.list('worldbooks')) {
    if (f.dir || !f.name.endsWith('.json')) continue
    const b = await yt.fs.readJSON<Worldbook>(`worldbooks/${f.name}`)
    if (b?.id) out.push(b)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

/** 世界书库：独立世界书的总览与编辑；可设为全局，或绑定到角色 */
export function BooksPage({ id }: { id?: string }) {
  const [books, setBooks] = useState<Worldbook[]>([])
  const [sel, setSel] = useState<string | null>(id ?? null)
  const chars = useLibrary((s) => s.chars)
  const globalIds = useSettings((s) => s.s.chat.globalBookIds)
  const update = useSettings((s) => s.update)
  const reload = async () => {
    const list = await listBooks()
    setBooks(list)
    if (!sel && list[0]) setSel(list[0].id)
  }
  useEffect(() => {
    reload()
  }, [])
  const book = books.find((b) => b.id === sel) ?? null
  const bound = book ? chars.filter((c) => c.linkedBookIds.includes(book.id)) : []

  const save = async (b: Worldbook) => {
    await yt.fs.writeJSON(`worldbooks/${b.id}.json`, b)
    setBooks((ls) => ls.map((x) => (x.id === b.id ? b : x)))
  }
  const create = async () => {
    const b: Worldbook = { id: newId('wb'), name: '新的世界书', entries: [], source: { kind: 'custom', importedAt: Date.now() } }
    await yt.fs.writeJSON(`worldbooks/${b.id}.json`, b)
    setBooks((ls) => [...ls, b])
    setSel(b.id)
    audio.confirm()
  }
  const importFile = async () => {
    const files = await yt.dialog.openFiles({ title: '导入世界书', filters: [{ name: '世界书 JSON / 纯文本设定', extensions: ['json', 'txt'] }] })
    let n = 0
    for (const f of files) {
      try {
        const b = /\.txt$/i.test(f.name) ? bookFromText(decodeText(f.bytes), f.name) : parseWorldbookJson(JSON.parse(decodeText(f.bytes)), f.name)
        if (!b) {
          toast('warn', `「${f.name}」不像世界书文件`)
          continue
        }
        await yt.fs.writeJSON(`worldbooks/${b.id}.json`, b)
        n++
        setSel(b.id)
      } catch {
        toast('error', `无法读取「${f.name}」`)
      }
    }
    if (n) {
      audio.stamp()
      toast('ok', `已收入 ${n} 本世界书`)
      reload()
    }
  }
  const exportST = async () => {
    if (!book) return
    const bytes = new TextEncoder().encode(JSON.stringify(toSTWorld(book), null, 2))
    const p = await yt.dialog.saveFile(`${book.name}.json`, bytes, [{ name: 'SillyTavern 世界书', extensions: ['json'] }])
    if (p) toast('ok', '已导出（SillyTavern 格式）', p)
  }
  const remove = async () => {
    if (!book) return
    if (!(await confirmDialog({ title: `删除世界书「${book.name}」？`, body: bound.length ? `它绑定在 ${bound.map((c) => c.name).join('、')} 身上，删除后会一并解除。` : '删除后无法恢复（存档里的副本不受影响）。', okText: '删除', danger: true }))) return
    for (const c of bound) await useLibrary.getState().save({ ...c, linkedBookIds: c.linkedBookIds.filter((x) => x !== book.id) })
    update((d) => (d.chat.globalBookIds = d.chat.globalBookIds.filter((x) => x !== book.id)))
    await yt.fs.remove(`worldbooks/${book.id}.json`)
    setBooks((ls) => ls.filter((x) => x.id !== book.id))
    setSel(null)
  }
  const bind = async (charId: string) => {
    const c = chars.find((x) => x.id === charId)
    if (!c || !book || c.linkedBookIds.includes(book.id)) return
    await useLibrary.getState().save({ ...c, linkedBookIds: [...c.linkedBookIds, book.id] })
    audio.confirm()
  }
  const unbind = async (charId: string) => {
    const c = chars.find((x) => x.id === charId)
    if (!c || !book) return
    await useLibrary.getState().save({ ...c, linkedBookIds: c.linkedBookIds.filter((x) => x !== book.id) })
  }

  return (
    <div className="page books">
      <aside className="books-side">
        <div className="t-deco">Bibliotheca</div>
        <div className="set-toc-title t-display">世界书</div>
        <div className="books-actions">
          <Button size="sm" icon="plus" onClick={create}>
            新建
          </Button>
          <Button size="sm" icon="upload" onClick={importFile}>
            导入
          </Button>
        </div>
        <div className="books-list">
          {books.map((b) => (
            <button key={b.id} className={`books-item ${b.id === sel ? 'on' : ''}`} data-sfx="soft" onClick={() => setSel(b.id)}>
              <span className="books-item-name">{b.name}</span>
              <span className="books-item-meta t-small">
                {b.entries.length} 条{globalIds.includes(b.id) && <span className="badge gold">全局</span>}
              </span>
            </button>
          ))}
          {books.length === 0 && <p className="t-small t-faint">还没有独立世界书。角色卡里自带的世界书在各自的角色页里。</p>}
        </div>
      </aside>
      <section className="books-main">
        {!book ? (
          <div className="home-empty">
            <MagicCircle size={150} strokeWidth={0.8} />
            <div className="home-empty-text">
              <p className="t-display">世界书库</p>
              <p className="t-soft">独立世界书可以绑定给几位角色共用，也可以设为全局，对所有角色生效。</p>
              <p className="t-faint t-small">支持 SillyTavern 的世界书 JSON；角色卡里内嵌的世界书在各自角色页编辑。</p>
            </div>
          </div>
        ) : (
          <div key={book.id} className="tab-body">
            <div className="books-head">
              <TextField label="书名" value={book.name} onChange={(e) => save({ ...book, name: e.target.value })} />
              <div className="books-head-actions">
                <Button size="sm" icon="download" onClick={exportST}>
                  导出
                </Button>
                <Button size="sm" variant="danger" icon="trash" onClick={remove}>
                  删除
                </Button>
              </div>
            </div>
            <div className="books-scope">
              <Toggle
                checked={globalIds.includes(book.id)}
                onChange={(v) => update((d) => (d.chat.globalBookIds = v ? [...d.chat.globalBookIds.filter((x) => x !== book.id), book.id] : d.chat.globalBookIds.filter((x) => x !== book.id)))}
                label="全局"
                hint="对所有角色的所有对话生效"
              />
              <div className="books-bound">
                <span className="field-label">绑定的角色</span>
                <div className="books-bound-list">
                  {bound.map((c) => (
                    <span key={c.id} className="bound-chip">
                      <Medallion src={avatarSrc(c)} name={c.name} size={22} ring={false} />
                      {c.name}
                      <button data-sfx="soft" aria-label="解除" onClick={() => unbind(c.id)}>
                        ×
                      </button>
                    </span>
                  ))}
                  {chars.some((c) => !c.linkedBookIds.includes(book.id)) && (
                    <Select
                      value=""
                      width={180}
                      placeholder="＋ 绑定到角色"
                      options={chars.filter((c) => !c.linkedBookIds.includes(book.id)).map((c) => ({ value: c.id, label: c.name }))}
                      onChange={(v) => bind(v)}
                    />
                  )}
                </div>
              </div>
            </div>
            <BookEntries book={book} onSave={save} />
          </div>
        )}
      </section>
    </div>
  )
}

export function BooksIcon() {
  return <Icon name="globe" />
}
