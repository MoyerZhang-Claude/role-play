import { createElement } from 'react'
import { parseCardFile } from '@shared/card'
import { parseWorldbookJson, bookFromText, decodeText, auditWorldbook } from '@shared/worldbook'
import { parseRegexJson } from '@shared/regex'
import { looksLikePreset } from '@shared/preset'
import type { Character, RegexScript, Worldbook } from '@shared/types'
import { yt } from './api'
import { useUI, toast } from '../state/ui'
import { useLibrary } from '../state/library'
import { go } from '../state/router'
import { ImportReportModal, AttachModal } from '../pages/ImportModals'
import { audio } from '../audio/engine'

export interface InFile {
  name: string
  bytes: Uint8Array
}

const FILTERS = [{ name: '角色卡 / 世界书 / 正则 / 预设 / 存档', extensions: ['png', 'json', 'yaotang', 'txt'] }]

export async function pickAndImport() {
  const files = await yt.dialog.openFiles({ title: '导入角色卡、世界书或正则', filters: FILTERS })
  if (files.length) await importFiles(files)
}

function waitModal<T>(render: (done: (v: T) => void) => React.ReactNode): Promise<T> {
  return new Promise((resolve) => {
    const done = (v: T) => {
      useUI.getState().closeModal()
      resolve(v)
    }
    useUI.getState().openModal('import', render(done))
  })
}

export async function importFiles(files: InFile[]) {
  let lastChar: Character | null = null
  for (const f of files) {
    const lower = f.name.toLowerCase()
    if (lower.endsWith('.yaotang')) {
      const { importArchiveBytes } = await import('../pages/ArchiveModals')
      await importArchiveBytes(f.bytes)
      continue
    }
    if (lower.endsWith('.txt')) {
      const text = decodeText(f.bytes)
      if (!text.trim()) {
        toast('warn', `「${f.name}」是空文件`)
        continue
      }
      await attachBook(bookFromText(text, f.name), '纯文本设定会作为一条「常驻」条目导入：每次都会发给 AI。如果只想在聊到相关内容时才发送，可以之后在世界书库里给它加上关键词并关闭常驻。')
      continue
    }
    if (!lower.endsWith('.png') && !lower.endsWith('.json')) {
      toast('warn', `无法识别：${f.name}`, '目前支持 PNG 角色卡，角色卡 / 世界书 / 正则 / 预设的 JSON 文件，纯文本设定（.txt），以及 .yaotang 存档')
      continue
    }
    if (lower.endsWith('.json')) {
      // 群聊卡要在角色卡之前认出来
      const head = new TextDecoder('utf-8').decode(f.bytes.subarray(0, 400))
      if (head.includes('yaotang_group_v1')) {
        try {
          const j = JSON.parse(new TextDecoder('utf-8').decode(f.bytes).replace(/^﻿/, ''))
          const { isGroupBundle, importGroupBundle } = await import('./groupImport')
          if (isGroupBundle(j)) {
            await importGroupBundle(j, f.name)
            continue
          }
        } catch {
          /* 交给后面的识别 */
        }
      }
    }
    const card = parseCardFile(f.bytes, f.name)
    if (card && 'error' in card) {
      toast('error', `${f.name}`, card.error)
      continue
    }
    if (card) {
      const ok = await waitModal<boolean>((done) => createElement(ImportReportModal, { report: card.report, image: card.image, onDone: done }))
      if (ok) {
        const saved = await useLibrary.getState().add(card.character, card.image)
        audio.stamp()
        toast('ok', `「${saved.name}」已收入书斋`)
        lastChar = saved
      }
      continue
    }
    // JSON：世界书 / 正则
    let json: unknown
    try {
      json = JSON.parse(new TextDecoder('utf-8').decode(f.bytes).replace(/^﻿/, ''))
    } catch {
      toast('error', `${f.name} 不是有效的 JSON`)
      continue
    }
    const book = parseWorldbookJson(json as any, f.name)
    if (book) {
      await attachBook(book)
      continue
    }
    const rx = parseRegexJson(json)
    if (rx) {
      await attachRegex(rx, f.name)
      continue
    }
    const qr = json as { qrList?: unknown[]; name?: string }
    if (qr && typeof qr === 'object' && Array.isArray(qr.qrList)) {
      toast(
        'warn',
        `「${qr.name || f.name}」是快速回复按钮组`,
        `里面是 SillyTavern 的斜杠命令脚本（${qr.qrList.length} 个按钮），药汤不运行脚本，所以没有导入。角色卡、世界书、预设不受影响。`
      )
      continue
    }
    if (looksLikePreset(json)) {
      const { importPresetJson } = await import('../pages/PresetPanel')
      await importPresetJson(json as Record<string, unknown>, f.name)
      continue
    }
    toast('warn', `无法识别：${f.name}`, '它不像角色卡、世界书、正则或预设文件')
  }
  if (lastChar && files.length === 1) go({ name: 'character', id: lastChar.id })
}

/** 导入独立世界书时附带的说明（不支持的功能、不会触发的条目等） */
function worldbookNotes(book: Worldbook): string {
  const { unsupported, notes } = auditWorldbook(book)
  const all = [...unsupported, ...notes]
  return all.length ? '\n' + all.map((x) => `· ${x}`).join('\n') : ''
}

/** 世界书是否与角色内嵌的那本相同（避免重复插入） */
function sameBook(a: Worldbook | null, b: Worldbook): boolean {
  if (!a) return false
  if (a.entries.length !== b.entries.length) return false
  const sig = (w: Worldbook) =>
    w.entries
      .map((e) => e.content.slice(0, 40))
      .sort()
      .join('|')
  return sig(a) === sig(b)
}

async function attachBook(book: Worldbook, note?: string) {
  const chars = useLibrary.getState().chars
  const res = await waitModal<{ charId: string } | null>((done) =>
    createElement(AttachModal, {
      kind: 'worldbook',
      title: `世界书「${book.name}」`,
      summary: `${book.entries.length} 条，启用 ${book.entries.filter((e) => e.enabled).length} 条${worldbookNotes(book)}${note ? `\n\n${note}` : ''}`,
      chars,
      duplicateOf: (c: Character) => sameBook(c.book, book),
      onDone: done
    })
  )
  if (!res) return
  await yt.fs.writeJSON(`worldbooks/${book.id}.json`, book)
  if (res.charId === '') {
    audio.stamp()
    toast('ok', `世界书「${book.name}」已收入世界书库`, '可在左侧「世界书」页设为全局或绑定到角色')
    return
  }
  const ch = useLibrary.getState().get(res.charId)
  if (!ch) return
  await useLibrary.getState().save({ ...ch, linkedBookIds: [...ch.linkedBookIds.filter((x) => x !== book.id), book.id] })
  audio.stamp()
  toast('ok', `世界书已绑定到「${ch.name}」`)
}

async function attachRegex(rx: RegexScript[], fileName: string) {
  const chars = useLibrary.getState().chars
  const names = rx.map((r) => r.scriptName).join('、')
  const res = await waitModal<{ charId: string } | null>((done) =>
    createElement(AttachModal, {
      kind: 'regex',
      title: `正则「${names}」`,
      summary: rx.map((r) => `${r.scriptName}：${r.ytNote}${r.ytKind === 'beautify' && r.markdownOnly ? '（界面美化类，导入后默认关闭）' : ''}`).join('\n'),
      chars,
      duplicateOf: (c: Character) => rx.every((r) => c.regexScripts.some((x) => x.findRegex === r.findRegex && x.replaceString === r.replaceString)),
      onDone: done
    })
  )
  if (!res) return
  const ch = useLibrary.getState().get(res.charId)
  if (!ch) return
  const add = rx
    .filter((r) => !ch.regexScripts.some((x) => x.findRegex === r.findRegex && x.replaceString === r.replaceString))
    .map((r) => (r.ytKind === 'beautify' && r.markdownOnly && !r.disabled ? { ...r, disabled: true, ytAutoDisabled: true } : r))
  await useLibrary.getState().save({ ...ch, regexScripts: [...ch.regexScripts, ...add] })
  audio.stamp()
  toast('ok', `已为「${ch.name}」添加 ${add.length} 条正则`, fileName)
}
