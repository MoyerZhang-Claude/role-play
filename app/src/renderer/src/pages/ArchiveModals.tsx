import { createElement, useState } from 'react'
import type { ApplyOptions, ArchiveSummary } from '@shared/types'
import { Modal } from '../components/Overlays'
import { Button, Toggle, Medallion, Spinner } from '../components/ui'
import { Icon } from '../icons/Icon'
import { useLibrary, avatarSrc } from '../state/library'
import { useChats } from '../state/chats'
import { useGroups } from '../state/groups'
import { useSettings } from '../state/settings'
import { useUI, toast } from '../state/ui'
import { yt } from '../lib/api'
import { audio } from '../audio/engine'

const cleanErr = (e: unknown) => String((e as any)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function show(node: (close: () => void) => React.ReactNode) {
  const close = () => useUI.getState().closeModal()
  useUI.getState().openModal('archive', node(close))
}

/* ───────── 导出 ───────── */

export function openExportArchive() {
  show((close) => createElement(ExportModal, { onClose: close }))
}

function ExportModal({ onClose }: { onClose: () => void }) {
  const chars = useLibrary((s) => s.chars)
  const index = useChats((s) => s.index)
  const [open, setOpen] = useState(true)
  const [all, setAll] = useState(true)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [withSettings, setWithSettings] = useState(true)
  const [busy, setBusy] = useState(false)
  const finish = () => {
    setOpen(false)
    window.setTimeout(onClose, 200)
  }
  const chatCount = (id: string) => Object.values(index).filter((c) => c.characterId === id).length
  const run = async () => {
    setBusy(true)
    try {
      const r = await yt.archive.export({ characterIds: all ? null : [...sel], includeSettings: withSettings })
      if (r) {
        audio.stamp()
        toast('ok', '存档已导出', `${r.counts.characters} 位角色 · ${r.counts.chats} 卷对话 · ${(r.size / 1024 / 1024).toFixed(1)} MB\n${r.path}`)
        finish()
      }
    } catch (e) {
      toast('error', '导出失败', cleanErr(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={finish}
      deco="Archivum · 导出存档"
      title="把书斋装进一个文件"
      width={620}
      footer={
        <>
          <span className="modal-foot-note">不包含 API 密钥</span>
          <Button sfx="back" onClick={finish}>
            取消
          </Button>
          <Button variant="primary" icon="download" sfx="none" disabled={busy || (!all && sel.size === 0)} onClick={run}>
            {busy ? '打包中…' : '选择保存位置'}
          </Button>
        </>
      }
    >
      <p className="t-soft archive-lead">存档是一个 .yaotang 文件，包含角色（设定、头像、内嵌世界书与正则）、所有对话、绑定的世界书，以及可选的设置。可以用来备份，或拷到另一台电脑上导入。</p>
      <div className="archive-opts">
        <Toggle checked={all} onChange={setAll} label="导出全部角色" hint={all ? `${chars.length} 位角色，${Object.keys(index).length} 卷对话` : '在下面选择要导出的角色'} />
        <Toggle checked={withSettings} onChange={setWithSettings} label="包含设置" hint="外观、声音、人设、提示词、接口地址与模型（不含密钥）" />
      </div>
      {!all && (
        <div className="attach-list archive-pick">
          {chars.map((c) => (
            <button
              key={c.id}
              className={`attach-item ${sel.has(c.id) ? 'sel' : ''}`}
              data-sfx="soft"
              onClick={() => {
                const n = new Set(sel)
                if (n.has(c.id)) n.delete(c.id)
                else n.add(c.id)
                setSel(n)
              }}
            >
              <Medallion src={avatarSrc(c)} name={c.name} size={32} />
              <span className="attach-name">{c.name}</span>
              <span className="t-small t-faint">{chatCount(c.id)} 卷</span>
              {sel.has(c.id) && <Icon name="check" />}
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}

/* ───────── 导入 ───────── */

export async function pickImportArchive() {
  try {
    const sum = await yt.archive.pick()
    if (sum) openImportArchive(sum)
  } catch (e) {
    toast('error', '无法读取存档', cleanErr(e))
  }
}

export async function importArchiveBytes(bytes: Uint8Array) {
  try {
    openImportArchive(await yt.archive.inspect(bytes))
  } catch (e) {
    toast('error', '无法读取存档', cleanErr(e))
  }
}

function openImportArchive(sum: ArchiveSummary) {
  show((close) => createElement(ImportModal, { sum, onClose: close }))
}

function ImportModal({ sum, onClose }: { sum: ArchiveSummary; onClose: () => void }) {
  const [open, setOpen] = useState(true)
  const [mode, setMode] = useState<ApplyOptions['mode']>('merge')
  const [conflict, setConflict] = useState<ApplyOptions['conflict']>('overwrite')
  const [applySettings, setApplySettings] = useState(false)
  const [busy, setBusy] = useState(false)
  const finish = (applied: boolean) => {
    if (!applied) yt.archive.discard(sum.token)
    setOpen(false)
    window.setTimeout(onClose, 200)
  }
  const dup = sum.characters.filter((c) => c.exists).length
  const run = async () => {
    setBusy(true)
    try {
      const r = await yt.archive.apply(sum.token, { mode, conflict, applySettings })
      await useLibrary.getState().load()
      await useChats.getState().loadIndex()
      await useGroups.getState().load()
      if (applySettings) await useSettings.getState().load()
      audio.stamp()
      toast('ok', '存档已导入', `${r.characters} 位角色 · ${r.chats} 卷对话 · ${r.worldbooks} 本世界书${r.skipped ? ` · 跳过 ${r.skipped} 项` : ''}\n导入前的数据已自动备份到 data\\backups`)
      finish(true)
    } catch (e) {
      toast('error', '导入失败', cleanErr(e))
      setBusy(false)
    }
  }
  const d = new Date(sum.manifest.createdAt)
  return (
    <Modal
      open={open}
      onClose={() => finish(false)}
      deco="Archivum · 导入存档"
      title="打开一份存档"
      width={640}
      footer={
        <>
          <span className="modal-foot-note">导入前会自动备份当前数据</span>
          <Button sfx="back" onClick={() => finish(false)}>
            取消
          </Button>
          <Button variant={mode === 'replace' ? 'danger' : 'primary'} icon="upload" sfx="none" disabled={busy} onClick={run}>
            {busy ? (
              <>
                <Spinner size={16} /> 导入中…
              </>
            ) : mode === 'replace' ? '替换并导入' : '合并导入'}
          </Button>
        </>
      }
    >
      <p className="t-soft archive-lead">
        创建于 {d.getFullYear()}.{d.getMonth() + 1}.{d.getDate()} {String(d.getHours()).padStart(2, '0')}:{String(d.getMinutes()).padStart(2, '0')}（药汤 {sum.manifest.app}）：{sum.manifest.counts.characters} 位角色、{sum.manifest.counts.chats} 卷对话、{sum.worldbooks} 本独立世界书{sum.hasSettings ? '、设置' : ''}。
      </p>
      <div className="attach-list archive-pick">
        {sum.characters.map((c) => (
          <div key={c.id} className="attach-item static">
            <span className="attach-name">{c.name}</span>
            <span className="t-small t-faint">{c.chats} 卷</span>
            {c.exists && <span className="attach-dup">书斋里已有</span>}
          </div>
        ))}
      </div>
      <div className="archive-opts">
        <div className="seg">
          <button className={`seg-item ${mode === 'merge' ? 'on' : ''}`} data-sfx="soft" onClick={() => setMode('merge')}>
            <b>合并</b>
            <span>保留现有内容，把存档里的加进来</span>
          </button>
          <button className={`seg-item ${mode === 'replace' ? 'on danger' : ''}`} data-sfx="soft" onClick={() => setMode('replace')}>
            <b>完全还原</b>
            <span>清空现有的角色与对话，换成存档里的</span>
          </button>
        </div>
        {mode === 'merge' && dup > 0 && (
          <Toggle checked={conflict === 'overwrite'} onChange={(v) => setConflict(v ? 'overwrite' : 'skip')} label={`有 ${dup} 位角色书斋里已经有了`} hint={conflict === 'overwrite' ? '用存档里的版本覆盖（同一卷对话也会被覆盖）' : '跳过它们，保留现在的版本'} />
        )}
        {sum.hasSettings && <Toggle checked={applySettings} onChange={setApplySettings} label="同时使用存档里的设置" hint="外观、声音、人设、提示词、接口地址与模型；密钥不受影响" />}
      </div>
    </Modal>
  )
}
