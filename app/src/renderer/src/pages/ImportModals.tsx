import { useEffect, useMemo, useState } from 'react'
import type { Character, ImportReport, ReportItem } from '@shared/types'
import { Modal } from '../components/Overlays'
import { Button, Medallion } from '../components/ui'
import { Icon } from '../icons/Icon'
import type { IconName } from '../icons/pixel'
import { avatarSrc } from '../state/library'

const LEVEL: Record<ReportItem['level'], { icon: IconName; label: string }> = {
  ok: { icon: 'check', label: '已启用' },
  info: { icon: 'info', label: '说明' },
  warn: { icon: 'warn', label: '有差异' },
  skip: { icon: 'minimize', label: '未使用' }
}

export function ReportList({ report }: { report: ImportReport }) {
  const groups = (['ok', 'warn', 'info', 'skip'] as const).map((lv) => ({ lv, items: report.items.filter((i) => i.level === lv) })).filter((g) => g.items.length)
  return (
    <div className="report">
      {groups.map((g) => (
        <section key={g.lv} className={`report-group lv-${g.lv}`}>
          <div className="report-group-head">
            <Icon name={LEVEL[g.lv].icon} />
            <span>{LEVEL[g.lv].label}</span>
          </div>
          <ul>
            {g.items.map((it, i) => (
              <li key={i}>
                <div className="report-title">{it.title}</div>
                {it.detail && <div className="report-detail">{it.detail}</div>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function ImportReportModal({ report, image, onDone }: { report: ImportReport; image?: Uint8Array; onDone: (ok: boolean) => void }) {
  const [open, setOpen] = useState(true)
  const url = useMemo(() => (image ? URL.createObjectURL(new Blob([image as BlobPart], { type: 'image/png' })) : null), [image])
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url])
  const finish = (ok: boolean) => {
    setOpen(false)
    window.setTimeout(() => onDone(ok), 200)
  }
  const warns = report.items.filter((i) => i.level === 'warn').length
  return (
    <Modal
      open={open}
      onClose={() => finish(false)}
      deco="Importatio · 导入卷宗"
      title={report.name}
      width={760}
      footer={
        <>
          <span className="modal-foot-note">{warns ? `有 ${warns} 处与原卡效果可能不同，详见上方说明` : '所有内容都已识别'}</span>
          <Button sfx="back" onClick={() => finish(false)}>
            取消
          </Button>
          <Button variant="primary" sfx="none" icon="seal" onClick={() => finish(true)}>
            收入书斋
          </Button>
        </>
      }
    >
      <div className="import-layout">
        {url && (
          <div className="import-portrait">
            <img src={url} alt="" draggable={false} />
          </div>
        )}
        <div className="import-info">
          <div className="t-deco">{report.format}</div>
          <ReportList report={report} />
        </div>
      </div>
    </Modal>
  )
}

export function AttachModal({
  kind,
  title,
  summary,
  chars,
  duplicateOf,
  onDone
}: {
  kind: 'worldbook' | 'regex'
  title: string
  summary: string
  chars: Character[]
  duplicateOf: (c: Character) => boolean
  onDone: (r: { charId: string } | null) => void
}) {
  const [open, setOpen] = useState(true)
  const [sel, setSel] = useState<string | null>(null)
  const finish = (r: { charId: string } | null) => {
    setOpen(false)
    window.setTimeout(() => onDone(r), 200)
  }
  return (
    <Modal
      open={open}
      onClose={() => finish(null)}
      deco={kind === 'worldbook' ? 'Liber Mundi · 世界书' : 'Regula · 正则'}
      title={title}
      width={620}
      footer={
        <>
          <Button sfx="back" onClick={() => finish(null)}>
            取消
          </Button>
          {kind === 'worldbook' && (
            <Button sfx="none" icon="globe" onClick={() => finish({ charId: '' })}>
              只收入世界书库
            </Button>
          )}
          <Button variant="primary" sfx="none" icon="seal" disabled={!sel} onClick={() => sel && finish({ charId: sel })}>
            绑定到这位角色
          </Button>
        </>
      }
    >
      <p className="attach-summary selectable">{summary}</p>
      {chars.length === 0 ? (
        <p className="t-faint">书斋里还没有角色。请先导入或新建一位角色，再来绑定。</p>
      ) : (
        <>
          <div className="field-label" style={{ marginBottom: 8 }}>
            选择要绑定的角色
          </div>
          <div className="attach-list">
            {chars.map((c) => {
              const dup = duplicateOf(c)
              return (
                <button key={c.id} className={`attach-item ${sel === c.id ? 'sel' : ''}`} data-sfx="soft" onClick={() => setSel(c.id)}>
                  <Medallion src={avatarSrc(c)} name={c.name} size={36} />
                  <span className="attach-name">{c.name}</span>
                  {dup && <span className="attach-dup">角色卡已内嵌相同内容，无需重复绑定</span>}
                </button>
              )
            })}
          </div>
        </>
      )}
    </Modal>
  )
}
