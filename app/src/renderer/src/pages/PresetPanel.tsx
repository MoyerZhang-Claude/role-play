import { createElement, useEffect, useRef, useState } from 'react'
import type { PromptPreset } from '@shared/types'
import { parsePreset } from '@shared/preset'
import { BLOCK_LABEL, MARKERS } from '@shared/prompt'
import { Modal } from '../components/Overlays'
import { Button, IconButton, Toggle, Select, TextArea } from '../components/ui'
import { Icon } from '../icons/Icon'
import { ReportList } from './ImportModals'
import { useSettings } from '../state/settings'
import { useUI, toast, confirmDialog } from '../state/ui'
import { yt } from '../lib/api'
import { hasEjs, needsScript } from '@shared/presetRuntime'
import { usePresets } from '../state/presets'
import { audio } from '../audio/engine'

async function listPresets(): Promise<PromptPreset[]> {
  const out: PromptPreset[] = []
  for (const f of await yt.fs.list('presets')) {
    if (f.dir || !f.name.endsWith('.json')) continue
    const p = await yt.fs.readJSON<PromptPreset>(`presets/${f.name}`)
    if (p?.id) out.push(p)
  }
  return out.sort((a, b) => (b.source?.importedAt ?? 0) - (a.source?.importedAt ?? 0))
}

/** 导入一个 SillyTavern 预设：先给报告，再保存 */
export function importPresetJson(json: Record<string, unknown>, fileName: string): Promise<void> {
  const { preset, report } = parsePreset(json as any, fileName)
  return new Promise((resolve) => {
    const done = () => {
      useUI.getState().closeModal()
      resolve()
    }
    useUI.getState().openModal('preset', createElement(PresetImportModal, { preset, report, onDone: done }))
  })
}

function PresetImportModal({ preset, report, onDone }: { preset: PromptPreset; report: ReturnType<typeof parsePreset>['report']; onDone: () => void }) {
  const [open, setOpen] = useState(true)
  const [activate, setActivate] = useState(true)
  const [applyParams, setApplyParams] = useState(false)
  const finish = () => {
    setOpen(false)
    window.setTimeout(onDone, 200)
  }
  const p = preset.params ?? {}
  const paramText = [p.temperature != null && `温度 ${p.temperature}`, p.topP != null && `Top P ${p.topP}`, p.maxTokens != null && `回复上限 ${p.maxTokens}`, p.contextSize != null && `上下文 ${Math.round(p.contextSize / 1000)}K`].filter(Boolean).join('、')
  const save = async () => {
    await yt.fs.writeJSON(`presets/${preset.id}.json`, preset)
    const upd = useSettings.getState().update
    if (activate) upd((d) => (d.chat.activePresetId = preset.id))
    if (applyParams)
      upd((d) => {
        const prof = d.api.profiles.find((x) => x.id === d.api.activeProfileId) ?? d.api.profiles[0]
        if (!prof) return
        if (p.temperature != null) prof.temperature = p.temperature
        if (p.topP != null) prof.topP = p.topP
        if (p.maxTokens != null) prof.maxTokens = p.maxTokens
        if (p.contextSize != null) prof.contextSize = p.contextSize
        if (p.presencePenalty != null) prof.presencePenalty = p.presencePenalty
        if (p.frequencyPenalty != null) prof.frequencyPenalty = p.frequencyPenalty
      })
    audio.stamp()
    toast('ok', `预设「${preset.name}」已导入`, activate ? '已启用，之后的回复会按它的顺序组装提示词' : '可在「设置 → 对话与人设」启用')
    finish()
  }
  return (
    <Modal
      open={open}
      onClose={finish}
      deco="Formula · 导入预设"
      title={preset.name}
      width={680}
      footer={
        <>
          <Button sfx="back" onClick={finish}>
            取消
          </Button>
          <Button variant="primary" icon="seal" sfx="none" onClick={save}>
            保存预设
          </Button>
        </>
      }
    >
      <div className="t-deco">{report.format}</div>
      <ReportList report={report} />
      <div className="archive-opts">
        <Toggle checked={activate} onChange={setActivate} label="立即启用" hint="启用后，所有角色都按这个预设的顺序组装提示词" />
        {paramText && <Toggle checked={applyParams} onChange={setApplyParams} label="同时把采样参数用到当前接口" hint={paramText} />}
      </div>
    </Modal>
  )
}

/** 设置页里的预设面板 */
export function PresetPanel() {
  const activeId = useSettings((s) => s.s.chat.activePresetId)
  const update = useSettings((s) => s.update)
  const [presets, setPresets] = useState<PromptPreset[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const reload = () => listPresets().then(setPresets)
  useEffect(() => {
    reload()
  }, [activeId])
  const cur = presets.find((p) => p.id === activeId) ?? null

  // 大预设可能有上百段、上 MB：界面立即更新，写盘稍后合并进行
  const pending = useRef<PromptPreset | null>(null)
  const timer = useRef(0)
  const flush = () => {
    window.clearTimeout(timer.current)
    const p = pending.current
    pending.current = null
    if (p) void yt.fs.writeJSON(`presets/${p.id}.json`, p)
  }
  useEffect(() => flush, [])
  const save = (p: PromptPreset) => {
    setPresets((ls) => ls.map((x) => (x.id === p.id ? p : x)))
    usePresets.getState().put(p)
    if (pending.current && pending.current.id !== p.id) flush()
    pending.current = p
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 500)
  }
  const pick = async () => {
    const files = await yt.dialog.openFiles({ title: '导入 SillyTavern 预设', filters: [{ name: '预设 JSON', extensions: ['json'] }], multi: false })
    if (!files[0]) return
    try {
      await importPresetJson(JSON.parse(new TextDecoder().decode(files[0].bytes).replace(/^﻿/, '')), files[0].name)
      reload()
    } catch {
      toast('error', '无法读取这个文件')
    }
  }
  const remove = async () => {
    if (!cur) return
    if (!(await confirmDialog({ title: `删除预设「${cur.name}」？`, okText: '删除', danger: true }))) return
    if (pending.current?.id === cur.id) pending.current = null
    await yt.fs.remove(`presets/${cur.id}.json`)
    update((d) => (d.chat.activePresetId = null))
  }
  const move = (i: number, dir: -1 | 1) => {
    if (!cur) return
    const j = i + dir
    if (j < 0 || j >= cur.order.length) return
    const order = cur.order.slice()
    ;[order[i], order[j]] = [order[j], order[i]]
    save({ ...cur, order })
  }

  return (
    <div className="preset-panel">
      <div className="profile-bar">
        <Select
          value={activeId ?? ''}
          width={300}
          options={[{ value: '', label: '药汤内置顺序', hint: '主提示词 → 世界书 → 人设 → 角色 → 示例 → 聊天 → 历史后指令' }, ...presets.map((p) => ({ value: p.id, label: p.name, hint: p.source?.fileName }))]}
          onChange={(v) => update((d) => (d.chat.activePresetId = v || null))}
        />
        <Button size="sm" icon="upload" onClick={pick}>
          导入预设
        </Button>
        {cur && <IconButton icon="trash" tip="删除这个预设" onClick={remove} />}
      </div>
      {cur ? (
        <>
          <p className="t-small t-faint">按从上到下的顺序发给 AI。「药汤填充」的段落由角色卡、世界书、聊天记录等自动生成；其余段落可以展开修改。{cur.prompts.some((p) => p.identifier === 'main') ? '这个预设自带主提示词，会代替上面的「主提示词」。' : ''}</p>
          <div className="preset-order">
            {cur.order.map((o, i) => {
              const pr = cur.prompts.find((p) => p.identifier === o.identifier)
              const marker = (MARKERS as readonly string[]).includes(o.identifier) || !!pr?.marker
              const name = BLOCK_LABEL[o.identifier] ?? pr?.name ?? o.identifier
              const expanded = openId === o.identifier
              return (
                <div key={o.identifier} className={`preset-item ${o.enabled ? '' : 'off'} ${o.identifier === 'chatHistory' ? 'history' : ''}`}>
                  <div className="preset-row">
                    <Toggle checked={o.enabled} onChange={(v) => save({ ...cur, order: cur.order.map((x, k) => (k === i ? { ...x, enabled: v } : x)) })} />
                    <button className="preset-name" data-sfx="soft" disabled={marker} onClick={() => setOpenId(expanded ? null : o.identifier)}>
                      {name}
                      {marker ? <span className="badge">药汤填充</span> : pr?.injection === 'depth' ? <span className="badge">深度 {pr.depth}</span> : null}
                      {pr && pr.role !== 'system' && <span className="badge">{pr.role === 'user' ? '用户' : 'AI'}</span>}
                      {pr?.triggers?.length ? <span className="badge">仅{pr.triggers.map((t) => TRIGGER_LABEL[t] ?? t).join('、')}</span> : null}
                      {hasEjs(pr?.content) && (
                        <span className="badge warn" data-tip="模板代码不执行，发送时去掉，只留普通文字">
                          EJS
                        </span>
                      )}
                    </button>
                    <IconButton icon="chevL" tip="上移" className="rot90" onClick={() => move(i, -1)} />
                    <IconButton icon="chevR" tip="下移" className="rot90" onClick={() => move(i, 1)} />
                  </div>
                  {expanded && pr && !marker && (
                    <TextArea value={pr.content} minRows={4} onChange={(e) => save({ ...cur, prompts: cur.prompts.map((x) => (x.identifier === pr.identifier ? { ...x, content: e.target.value } : x)) })} />
                  )}
                </div>
              )
            })}
          </div>
          {cur.regexScripts?.length ? <PresetRegex preset={cur} onChange={save} /> : null}
          {cur.source?.ignored?.length ? (
            <p className="t-small t-faint">
              <Icon name="info" /> 未使用：{cur.source.ignored.join('、')}
            </p>
          ) : null}
        </>
      ) : (
        <p className="t-small t-faint">没有启用预设时，药汤按 SillyTavern 的默认顺序组装提示词。可以导入 SillyTavern 的「对话补全预设」JSON。</p>
      )}
    </div>
  )
}

const TRIGGER_LABEL: Record<string, string> = { normal: '正常回复', swipe: '重写', regenerate: '重新生成', continue: '续写', impersonate: '代写', quiet: '后台' }

/** 预设自带的正则 */
function PresetRegex({ preset, onChange }: { preset: PromptPreset; onChange: (p: PromptPreset) => void }) {
  const list = preset.regexScripts ?? []
  const set = (id: string, disabled: boolean) => onChange({ ...preset, regexScripts: list.map((r) => (r.id === id ? { ...r, disabled } : r)) })
  return (
    <div className="preset-regex">
      <div className="field-label">预设自带的正则 · {list.length} 条</div>
      <p className="t-small t-faint">启用这个预设时对所有角色生效。标着「界面美化」的只在显示方式为「卡片原样式」的角色里生效；在药汤风格下会跳过，以免样式被过滤后显得零散。</p>
      {list.map((r) => (
        <div key={r.id} className={`regex ${r.disabled ? 'off' : ''}`}>
          <Toggle checked={!r.disabled} onChange={(v) => set(r.id, !v)} />
          <div className="regex-body">
            <div className="regex-name">
              {r.scriptName}
              {needsScript(r) ? (
                <span className="badge warn" data-tip="需要运行脚本，药汤不使用这一条">
                  需要脚本
                </span>
              ) : (
                r.ytKind === 'beautify' && r.markdownOnly && <span className="badge warn">界面美化</span>
              )}
              {r.promptOnly && <span className="badge">仅发送</span>}
              {r.markdownOnly && <span className="badge">仅显示</span>}
            </div>
            <div className="t-small t-faint">{r.ytNote}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
