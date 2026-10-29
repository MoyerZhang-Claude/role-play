import { useState } from 'react'
import type { Worldbook, WorldEntry } from '@shared/types'
import { POSITION_LABEL, blankEntry } from '@shared/worldbook'
import { Button, IconButton, Toggle } from './ui'
import { Icon } from '../icons/Icon'
import { editEntry } from '../pages/EntryEditor'
import { toast } from '../state/ui'

/** 世界书条目列表：搜索、开关、编辑、复制、新增（角色页与世界书页共用） */
export function BookEntries({ book, onSave, toolbarExtra }: { book: Worldbook; onSave: (b: Worldbook) => void | Promise<void>; toolbarExtra?: React.ReactNode }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const setEntry = (uid: number, patch: Partial<WorldEntry>) => onSave({ ...book, entries: book.entries.map((e) => (e.uid === uid ? { ...e, ...patch } : e)) })
  const nextUid = () => book.entries.reduce((m, e) => Math.max(m, e.uid), -1) + 1
  const edit = async (e: WorldEntry, isNew = false) => {
    const r = await editEntry(e, isNew)
    if (!r) return
    if (r.kind === 'delete') {
      await onSave({ ...book, entries: book.entries.filter((x) => x.uid !== e.uid) })
      toast('ok', '条目已删除')
      return
    }
    const exists = book.entries.some((x) => x.uid === r.entry.uid)
    await onSave({ ...book, entries: exists ? book.entries.map((x) => (x.uid === r.entry.uid ? r.entry : x)) : [...book.entries, r.entry] })
  }
  const duplicate = (e: WorldEntry) => onSave({ ...book, entries: [...book.entries, { ...structuredClone(e), uid: nextUid(), comment: `${e.comment || '条目'}（副本）` }] })
  const shown = q.trim() ? book.entries.filter((e) => (e.comment + e.keys.join(' ') + e.content).toLowerCase().includes(q.trim().toLowerCase())) : book.entries
  const enabled = book.entries.filter((e) => e.enabled).length
  return (
    <>
      <div className="book-head">
        <div className="t-small t-faint">
          共 {book.entries.length} 条，启用 {enabled} 条
        </div>
        <div className="book-actions">
          <label className="search">
            <Icon name="search" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索条目、关键词…" spellCheck={false} />
          </label>
          <Button size="sm" icon="plus" onClick={() => edit({ ...blankEntry(nextUid()), order: 100 }, true)}>
            新增条目
          </Button>
          {toolbarExtra}
        </div>
      </div>
      <div className="entries">
        {shown.length === 0 && <p className="t-faint t-small">{q ? '没有匹配的条目。' : '还没有条目，点「新增条目」写下第一条。'}</p>}
        {shown.map((e) => (
          <div key={e.uid} className={`entry ${e.enabled ? '' : 'off'} ${open === e.uid ? 'open' : ''}`}>
            <div className="entry-row">
              <Toggle checked={e.enabled} onChange={(v) => setEntry(e.uid, { enabled: v })} />
              <button className="entry-main" data-sfx="soft" onClick={() => setOpen(open === e.uid ? null : e.uid)}>
                <span className="entry-title">{e.comment || e.keys[0] || `条目 ${e.uid}`}</span>
                <span className="entry-keys">
                  {e.constant ? (
                    <span className="badge gold">常驻</span>
                  ) : (
                    e.keys.slice(0, 6).map((k) => (
                      <span key={k} className="key">
                        {k}
                      </span>
                    ))
                  )}
                  {!e.constant && e.keys.length > 6 && <span className="t-faint">+{e.keys.length - 6}</span>}
                </span>
              </button>
              <span className="entry-pos t-small t-faint">
                {POSITION_LABEL[e.position]}
                {e.position === 4 ? ` ${e.depth}` : ''} · 序 {e.order}
              </span>
              <span className="entry-tools">
                <IconButton icon="copy" tip="复制一份" onClick={() => duplicate(e)} />
                <IconButton icon="edit" tip="编辑条目" onClick={() => edit(e)} />
              </span>
            </div>
            {open === e.uid && (
              <div className="entry-content selectable" onDoubleClick={() => edit(e)}>
                {e.secondaryKeys.length > 0 && <div className="t-small t-faint">次要关键词：{e.secondaryKeys.join('、')}</div>}
                <pre>{e.content}</pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
