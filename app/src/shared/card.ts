/**
 * 角色卡解析：PNG（chara / ccv3 文本块）或 JSON；支持 V1、V2、V3。
 * 产出药汤的 Character 结构 + 导入报告（说明哪些已启用、有差异或被忽略）。
 */
import type { Character, ImportReport, ReportItem, RegexScript } from './types'
import { readPngText, decodeBase64Utf8, isPng } from './png'
import { bookFromCard, auditWorldbook } from './worldbook'
import { normalizeRegexScript } from './regex'
import { newId } from './id'

type AnyObj = Record<string, any>

export interface ParsedCard {
  character: Character
  report: ImportReport
  /** PNG 原图（作为头像） */
  image?: Uint8Array
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** 从文件字节解析角色卡；不是角色卡时返回 null */
export function parseCardFile(bytes: Uint8Array, fileName: string): ParsedCard | { error: string } | null {
  if (isPng(bytes)) {
    const text = readPngText(bytes)
    const raw = text['ccv3'] ?? text['chara']
    if (!raw) return { error: '这张 PNG 里没有找到角色卡数据（缺少 chara / ccv3 信息块）。它可能只是一张普通图片，或者在转存时被压缩掉了数据。' }
    let json: AnyObj
    try {
      json = JSON.parse(decodeBase64Utf8(raw))
    } catch {
      try {
        json = JSON.parse(raw)
      } catch {
        return { error: '角色卡数据已损坏，无法读取。' }
      }
    }
    // ccv3 与 chara 同时存在时优先 V3；若 V3 损坏则退回 chara
    if (text['ccv3'] && text['chara'] && !json?.data) {
      try {
        json = JSON.parse(decodeBase64Utf8(text['chara']))
      } catch {
        /* 保留 */
      }
    }
    const parsed = cardFromJson(json, fileName)
    if (!parsed) return { error: '无法识别角色卡格式。' }
    parsed.image = bytes
    return parsed
  }
  // JSON
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, ''))
  } catch {
    return null
  }
  return looksLikeCard(json) ? cardFromJson(json as AnyObj, fileName) : null
}

export function looksLikeCard(j: unknown): boolean {
  if (!j || typeof j !== 'object') return false
  const o = j as AnyObj
  if (o.spec === 'chara_card_v2' || o.spec === 'chara_card_v3') return true
  return typeof o.name === 'string' && ('first_mes' in o || 'description' in o || 'char_persona' in o) && !('entries' in o)
}

export function cardFromJson(j: AnyObj, fileName: string): ParsedCard | null {
  if (!j || typeof j !== 'object') return null
  let format: Character['source']['format']
  let d: AnyObj
  if (j.spec === 'chara_card_v3' && j.data) {
    format = 'v3'
    d = j.data
  } else if (j.spec === 'chara_card_v2' && j.data) {
    format = 'v2'
    d = j.data
  } else if (j.data && typeof j.data === 'object' && j.data.name) {
    format = 'v2'
    d = j.data
  } else {
    format = 'v1'
    d = {
      name: j.name ?? j.char_name,
      description: j.description ?? j.char_persona,
      personality: j.personality,
      scenario: j.scenario ?? j.world_scenario,
      first_mes: j.first_mes ?? j.char_greeting,
      mes_example: j.mes_example ?? j.example_dialogue,
      creator_notes: j.creatorcomment,
      tags: j.tags
    }
  }

  const name = str(d.name).trim() || fileName.replace(/\.(png|json)$/i, '')
  const items: ReportItem[] = []
  const ext: AnyObj = d.extensions && typeof d.extensions === 'object' ? d.extensions : {}

  const now = Date.now()
  const ch: Character = {
    id: newId('ch'),
    name,
    avatar: null,
    description: str(d.description),
    personality: str(d.personality),
    scenario: str(d.scenario),
    firstMes: str(d.first_mes),
    alternateGreetings: Array.isArray(d.alternate_greetings) ? d.alternate_greetings.map(str).filter((s: string) => s.trim()) : [],
    mesExample: str(d.mes_example),
    systemPrompt: str(d.system_prompt),
    postHistoryInstructions: str(d.post_history_instructions),
    creatorNotes: str(d.creator_notes ?? j.creatorcomment),
    tags: Array.isArray(d.tags) ? d.tags.map(str).filter(Boolean) : [],
    creator: str(d.creator),
    characterVersion: str(d.character_version),
    depthPrompt: null,
    book: null,
    regexScripts: [],
    linkedBookIds: [],
    source: { format, fileName, importedAt: now },
    raw: j,
    display: { styleMode: 'yaotang' },
    createdAt: now,
    updatedAt: now
  }

  // —— 基本字段
  const fmtLabel = format === 'v3' ? 'Character Card V3' : format === 'v2' ? 'Character Card V2' : '旧版 V1 角色卡'
  const len = (s: string) => s.trim().length
  const basics: string[] = []
  if (len(ch.description)) basics.push(`描述 ${len(ch.description)} 字`)
  if (len(ch.personality)) basics.push(`性格 ${len(ch.personality)} 字`)
  if (len(ch.scenario)) basics.push(`场景 ${len(ch.scenario)} 字`)
  if (len(ch.mesExample)) basics.push(`对话示例 ${len(ch.mesExample)} 字`)
  items.push({ level: 'ok', title: '角色设定', detail: basics.length ? basics.join('，') : '设定字段为空（内容可能都放在世界书里）' })

  const greetCount = (len(ch.firstMes) ? 1 : 0) + ch.alternateGreetings.length
  items.push({
    level: greetCount ? 'ok' : 'info',
    title: '开场白',
    detail: greetCount ? `${greetCount} 条${ch.alternateGreetings.length ? '（可在对话第一条消息上左右切换）' : ''}` : '没有开场白，对话将从你的第一句话开始'
  })
  if (len(ch.systemPrompt)) items.push({ level: 'ok', title: '卡片自带系统提示词', detail: `${len(ch.systemPrompt)} 字，将替代默认主提示词（可在设置中关闭）` })
  if (len(ch.postHistoryInstructions)) items.push({ level: 'ok', title: '卡片自带历史后指令', detail: `${len(ch.postHistoryInstructions)} 字，放在聊天记录之后` })

  // —— 深度提示词
  const dp = ext.depth_prompt
  if (dp && typeof dp === 'object' && str(dp.prompt).trim()) {
    const role = dp.role === 'user' || dp.role === 'assistant' ? dp.role : 'system'
    ch.depthPrompt = { prompt: str(dp.prompt), depth: Number(dp.depth) || 4, role }
    items.push({ level: 'ok', title: '角色备注（深度提示词）', detail: `在倒数第 ${ch.depthPrompt.depth} 条消息处插入` })
  }

  // —— 内嵌世界书
  if (d.character_book && typeof d.character_book === 'object') {
    const book = bookFromCard(d.character_book, ext.world ? str(ext.world) : `${name}的世界书`)
    ch.book = book
    const enabled = book.entries.filter((e) => e.enabled)
    const constant = enabled.filter((e) => e.constant).length
    items.push({
      level: 'ok',
      title: `世界书「${book.name}」`,
      detail: `${book.entries.length} 条，启用 ${enabled.length} 条（常驻 ${constant} 条，关键词触发 ${enabled.length - constant} 条）`
    })
    const audit = auditWorldbook(book)
    for (const u of audit.unsupported) items.push({ level: 'warn', title: '世界书：部分功能不支持', detail: u })
    for (const n of audit.notes) items.push({ level: 'info', title: '世界书', detail: n })
  } else if (ext.world) {
    items.push({ level: 'warn', title: '引用了外部世界书', detail: `卡片指向名为「${str(ext.world)}」的世界书，但没有把它打包进卡片。若作者另外提供了世界书 JSON，请一并导入（第二阶段支持绑定）。` })
  }

  // —— 正则
  const rx: RegexScript[] = Array.isArray(ext.regex_scripts) ? ext.regex_scripts.map((r: AnyObj) => normalizeRegexScript(r)) : []
  if (rx.length) {
    for (const r of rx) {
      if (r.markdownOnly && /<script\b/i.test(r.replaceString)) {
        items.push({
          level: 'warn',
          title: `正则「${r.scriptName}」依赖脚本`,
          detail: '它输出的是需要运行脚本的前端界面（SillyTavern 里靠酒馆助手扩展运行）。药汤不运行脚本，这条正则不会用来显示，被它替换的内容按原文显示。'
        })
      } else if (r.ytKind === 'beautify' && r.markdownOnly && !r.disabled) {
        r.disabled = true
        r.ytAutoDisabled = true
        items.push({
          level: 'warn',
          title: `正则「${r.scriptName}」默认不启用`,
          detail: '它用于把内容排版成卡片作者设计的界面（带 CSS 样式的整段 HTML）。为保持药汤的视觉，默认关闭，改由药汤以自己的风格显示这些内容。如果想看作者设计的界面，可以在角色页「正则与显示」里把显示方式改为「卡片原样式」——它会放进一块独立的底板，样式不影响药汤的其它界面。'
        })
      } else if (r.ytKind === 'beautify') {
        items.push({ level: 'warn', title: `正则「${r.scriptName}」含样式代码`, detail: `${r.ytNote} 输出中的样式、脚本会在显示时被过滤。` })
      } else {
        items.push({ level: r.disabled ? 'info' : 'ok', title: `正则「${r.scriptName}」${r.disabled ? '（卡片中原本就是关闭的）' : ''}`, detail: r.ytNote })
      }
    }
    ch.regexScripts = rx
  }

  // —— 显示相关的提示
  const allText = [ch.firstMes, ...ch.alternateGreetings].join('\n')
  if (/<\s*(style|script|iframe|link)\b/i.test(allText)) {
    items.push({ level: 'warn', title: '开场白含样式或脚本', detail: '其中的 <style>、<script> 等会被移除，只保留文字与安全的排版标签。' })
  } else if (/<!--[\s\S]*?-->/.test(allText)) {
    items.push({ level: 'info', title: '开场白含 HTML 注释', detail: '注释不会显示，但会原样发给 AI（通常是写给 AI 的格式要求）。' })
  }
  if (/<[A-Za-z][\w-]*>[\s\S]*?<\/[A-Za-z][\w-]*>/.test(allText)) {
    items.push({ level: 'info', title: '开场白含自定义标签', detail: '类似 <StatusBlock> 的标签会被渲染成药汤风格的状态栏或段落框。' })
  }

  // —— 被忽略的内容
  const ignored: string[] = []
  const knownExt = new Set(['talkativeness', 'fav', 'world', 'depth_prompt', 'regex_scripts'])
  for (const k of Object.keys(ext)) if (!knownExt.has(k)) ignored.push(k)
  if (ignored.length) items.push({ level: 'skip', title: '未使用的扩展字段', detail: `${ignored.join('、')}（属于其它软件或插件的数据，已原样保存，不影响聊天）` })
  if (Array.isArray(d.group_only_greetings) && d.group_only_greetings.length) items.push({ level: 'skip', title: '群聊专用开场白', detail: `${d.group_only_greetings.length} 条，药汤暂不支持群聊` })
  if (format === 'v3' && Array.isArray(d.assets) && d.assets.length) items.push({ level: 'skip', title: 'V3 附带资源', detail: `${d.assets.length} 项（表情图、背景等），暂不使用` })

  const report: ImportReport = { kind: 'character', name, format: fmtLabel, items }
  ch.source.report = report
  return { character: ch, report }
}
