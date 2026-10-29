import { createElement, useEffect, useMemo, useState } from 'react'
import type { Character, Worldbook } from '@shared/types'
import { embedCardInPng } from '@shared/cardExport'
import { isPng } from '@shared/png'
import { Modal } from '../components/Overlays'
import { Button, Toggle } from '../components/ui'
import { useUI, toast } from '../state/ui'
import { avatarSrc } from '../state/library'
import { makeSigilAvatar } from '../lib/avatar'
import { yt } from '../lib/api'
import { audio } from '../audio/engine'

async function toPng(bytes: Uint8Array): Promise<Uint8Array> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart]))
  const c = document.createElement('canvas')
  c.width = bmp.width
  c.height = bmp.height
  c.getContext('2d')!.drawImage(bmp, 0, 0)
  bmp.close()
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
  if (!blob) throw new Error('图片转换失败')
  return new Uint8Array(await blob.arrayBuffer())
}

export async function avatarPng(ch: Character): Promise<Uint8Array> {
  const raw = ch.avatar ? await yt.fs.readBytes(`characters/${ch.id}/${ch.avatar}`) : null
  if (raw && isPng(raw)) return raw
  if (raw) {
    try {
      return await toPng(raw)
    } catch {
      /* 读不了就换成印章头像 */
    }
  }
  return makeSigilAvatar(ch.name)
}

/** 把绑定的独立世界书并进卡内世界书（条目重新编号，避免冲突） */
export function mergeBooks(ch: Character, books: Worldbook[]): Character {
  if (!books.length) return ch
  const base: Worldbook = ch.book ? structuredClone(ch.book) : { id: 'merged', name: books[0].name, entries: [] }
  let uid = base.entries.reduce((m, e) => Math.max(m, e.uid), -1) + 1
  for (const b of books) for (const e of b.entries) base.entries.push({ ...structuredClone(e), uid: uid++ })
  return { ...ch, book: base }
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\r\n]+/g, '_').trim() || '角色'

export function exportCharacterCard(ch: Character): void {
  const close = () => useUI.getState().closeModal()
  useUI.getState().openModal('card-export', createElement(CardExportModal, { ch, onDone: close }))
}

function CardExportModal({ ch, onDone }: { ch: Character; onDone: () => void }) {
  const [open, setOpen] = useState(true)
  const [books, setBooks] = useState<Worldbook[]>([])
  const [merge, setMerge] = useState(true)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    ;(async () => {
      const out: Worldbook[] = []
      for (const id of ch.linkedBookIds ?? []) {
        const b = await yt.fs.readJSON<Worldbook>(`worldbooks/${id}.json`)
        if (b) out.push(b)
      }
      if (live) setBooks(out)
    })()
    return () => {
      live = false
    }
  }, [ch])
  const finish = () => {
    setOpen(false)
    window.setTimeout(onDone, 200)
  }
  const src = avatarSrc(ch)
  const linkedCount = books.reduce((n, b) => n + b.entries.length, 0)
  const summary = useMemo(() => {
    const parts = [`设定与开场白`, ch.alternateGreetings.length ? `${ch.alternateGreetings.length} 条备选开场白` : '', ch.book ? `卡内世界书 ${ch.book.entries.length} 条` : '', ch.regexScripts.length ? `${ch.regexScripts.length} 条正则` : '', ch.depthPrompt?.prompt ? '角色备注（深度提示）' : '']
    return parts.filter(Boolean).join('、')
  }, [ch])

  const run = async () => {
    setBusy(true)
    try {
      const target = merge ? mergeBooks(ch, books) : ch
      const out = embedCardInPng(await avatarPng(ch), target)
      const p = await yt.dialog.saveFile(`${safeName(ch.name)}.png`, out, [{ name: 'PNG 角色卡', extensions: ['png'] }])
      if (p) {
        audio.stamp()
        toast('ok', '角色卡已导出', p)
        finish()
      }
    } catch (e) {
      toast('error', '导出失败', String((e as Error)?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={finish}
      deco="Exportatio · 导出角色卡"
      title={ch.name}
      width={640}
      footer={
        <>
          <span className="modal-foot-note">SillyTavern 与其它支持 V2 / V3 卡片的软件都能读取</span>
          <Button sfx="back" onClick={finish}>
            取消
          </Button>
          <Button variant="primary" icon="seal" sfx="none" disabled={busy} onClick={run}>
            {busy ? '正在封装…' : '另存为 PNG'}
          </Button>
        </>
      }
    >
      <div className="import-layout">
        {src && (
          <div className="import-portrait">
            <img src={src} alt="" draggable={false} />
          </div>
        )}
        <div className="import-info">
          <p className="selectable">将写入卡片：{summary}。</p>
          <p className="t-faint">对话记录、接口密钥、药汤的显示设置都不会写进卡片。原卡里药汤没有用到的扩展字段会原样保留。</p>
          {books.length > 0 && (
            <div className="archive-opts">
              <Toggle
                checked={merge}
                onChange={setMerge}
                label={`把绑定的 ${books.length} 本世界书并进卡内`}
                hint={`共 ${linkedCount} 条：${books.map((b) => `「${b.name}」`).join('')}。关闭后只带卡内世界书；全局世界书不会写入。`}
              />
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
