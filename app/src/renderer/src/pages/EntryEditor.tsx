import { createElement, useState, type KeyboardEvent } from 'react'
import type { WorldEntry, WIPosition, WIRole, SelectiveLogic } from '@shared/types'
import { POSITION_LABEL } from '@shared/worldbook'
import { Modal } from '../components/Overlays'
import { Button, Toggle, TextField, TextArea, Select, Slider } from '../components/ui'
import { Icon } from '../icons/Icon'
import { useUI, confirmDialog } from '../state/ui'
import { audio } from '../audio/engine'

export type EntryResult = { kind: 'save'; entry: WorldEntry } | { kind: 'delete' } | null

/** 打开条目编辑器；返回保存后的条目、删除，或取消 */
export function editEntry(entry: WorldEntry, isNew: boolean): Promise<EntryResult> {
  return new Promise((resolve) => {
    const done = (r: EntryResult) => {
      useUI.getState().closeModal()
      resolve(r)
    }
    useUI.getState().openModal('entry', createElement(EntryEditor, { entry, isNew, onDone: done }))
  })
}

/** 关键词输入：回车或逗号生成一枚「签」，点 × 删除；/正则/ 也可以 */
function KeyInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState('')
  const commit = (raw: string) => {
    const parts = raw
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (!parts.length) return
    onChange([...value, ...parts.filter((p) => !value.includes(p))])
    setText('')
    audio.softClick()
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
      e.preventDefault()
      commit(text)
    } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
  }
  return (
    <div className="keyinput field-input">
      {value.map((k) => (
        <span key={k} className={`key ${/^\/.+\/[a-z]*$/i.test(k) ? 'regex' : ''}`}>
          {k}
          <button type="button" data-sfx="soft" aria-label="删除" onClick={() => onChange(value.filter((x) => x !== k))}>
            ×
          </button>
        </span>
      ))}
      <input value={text} placeholder={value.length ? '' : placeholder} spellCheck={false} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onBlur={() => commit(text)} />
    </div>
  )
}

const LOGIC: { value: string; label: string; hint: string }[] = [
  { value: '0', label: '含任一', hint: '主关键词命中，且次要关键词至少命中一个' },
  { value: '3', label: '含全部', hint: '次要关键词全部命中' },
  { value: '2', label: '全不含', hint: '次要关键词一个都没有出现' },
  { value: '1', label: '非全部', hint: '次要关键词没有全部出现' }
]
const ROLES: { value: string; label: string }[] = [
  { value: '0', label: '系统' },
  { value: '1', label: '用户' },
  { value: '2', label: 'AI' }
]
const TRI: { value: string; label: string }[] = [
  { value: 'inherit', label: '跟随全局' },
  { value: 'yes', label: '是' },
  { value: 'no', label: '否' }
]
const tri = (v: boolean | null) => (v == null ? 'inherit' : v ? 'yes' : 'no')
const untri = (v: string): boolean | null => (v === 'inherit' ? null : v === 'yes')

function EntryEditor({ entry, isNew, onDone }: { entry: WorldEntry; isNew: boolean; onDone: (r: EntryResult) => void }) {
  const [e, setE] = useState<WorldEntry>(() => structuredClone(entry))
  const [open, setOpen] = useState(true)
  const [more, setMore] = useState(false)
  const set = <K extends keyof WorldEntry>(k: K, v: WorldEntry[K]) => setE((x) => ({ ...x, [k]: v }))
  const finish = (r: EntryResult) => {
    setOpen(false)
    window.setTimeout(() => onDone(r), 200)
  }
  const save = () => {
    if (!e.constant && !e.keys.length && !e.content.trim()) return finish(null)
    audio.confirm()
    finish({ kind: 'save', entry: e })
  }
  const remove = async () => {
    if (await confirmDialog({ title: '删除这个条目？', body: e.comment || e.keys.join('、') || '（未命名条目）', okText: '删除', danger: true })) finish({ kind: 'delete' })
  }
  const num = (v: string, d: number) => (v.trim() === '' || !Number.isFinite(Number(v)) ? d : Number(v))
  return (
    <Modal
      open={open}
      onClose={() => finish(null)}
      deco="Liber Mundi · 世界书条目"
      title={isNew ? '新的条目' : e.comment || e.keys[0] || '编辑条目'}
      width={820}
      footer={
        <>
          {!isNew && (
            <Button variant="danger" icon="trash" sfx="none" onClick={remove}>
              删除条目
            </Button>
          )}
          <span className="modal-foot-note" />
          <Button sfx="back" onClick={() => finish(null)}>
            取消
          </Button>
          <Button variant="primary" icon="check" sfx="none" onClick={save}>
            保存
          </Button>
        </>
      }
    >
      <div className="entry-editor">
        <div className="ee-row2">
          <TextField label="标题 / 备注" value={e.comment} placeholder="只给自己看，方便辨认" onChange={(ev) => set('comment', ev.target.value)} />
          <div className="ee-toggles">
            <Toggle checked={e.enabled} onChange={(v) => set('enabled', v)} label="启用" />
            <Toggle checked={e.constant} onChange={(v) => set('constant', v)} label="常驻" hint="不看关键词，每次都发送" />
          </div>
        </div>
        {!e.constant && (
          <label className="field">
            <span className="field-label">主关键词</span>
            <KeyInput value={e.keys} onChange={(v) => set('keys', v)} placeholder="输入后按回车；可用 /正则/" />
            <span className="field-hint">最近的聊天里出现任意一个，这个条目就会被激活。</span>
          </label>
        )}
        <TextArea label="内容" value={e.content} minRows={8} placeholder="激活后发给 AI 的设定内容。可以使用 {{char}}、{{user}} 等宏。" onChange={(ev) => set('content', ev.target.value)} />
        <div className="ee-row3">
          <label className="field">
            <span className="field-label">插入位置</span>
            <Select value={String(e.position)} width="100%" options={Object.entries(POSITION_LABEL).map(([v, l]) => ({ value: v, label: l }))} onChange={(v) => set('position', Number(v) as WIPosition)} />
          </label>
          {e.position === 4 && (
            <>
              <TextField label="深度（倒数第几条消息前）" type="number" min={0} value={e.depth} onChange={(ev) => set('depth', Math.max(0, num(ev.target.value, 4)))} />
              <label className="field">
                <span className="field-label">以谁的身份</span>
                <Select value={String(e.role)} width="100%" options={ROLES} onChange={(v) => set('role', Number(v) as WIRole)} />
              </label>
            </>
          )}
          {e.position === 7 && <TextField label="出口名（用 {{outlet::名字}} 取出）" value={e.outletName} onChange={(ev) => set('outletName', ev.target.value)} />}
          <TextField label="顺序（越大越靠后、越优先保留）" type="number" value={e.order} onChange={(ev) => set('order', num(ev.target.value, 100))} />
        </div>
        <div className="ee-prob">
          <span className="field-label">触发概率</span>
          <Slider value={e.useProbability ? e.probability : 100} min={0} max={100} onChange={(v) => setE((x) => ({ ...x, probability: v, useProbability: true }))} format={(v) => `${v}%`} />
        </div>

        <button className="ed-adv-toggle" data-sfx="soft" onClick={() => setMore(!more)}>
          <Icon name={more ? 'chevD' : 'chevR'} /> 更多选项
          <span className="t-faint t-small">次要关键词、分组、递归、时效、匹配方式</span>
        </button>
        {more && (
          <div className="ee-more">
            {!e.constant && (
              <div className="ee-row2">
                <label className="field">
                  <span className="field-label">次要关键词</span>
                  <KeyInput value={e.secondaryKeys} onChange={(v) => setE((x) => ({ ...x, secondaryKeys: v, selective: true }))} placeholder="可留空" />
                </label>
                <label className="field">
                  <span className="field-label">次要关键词逻辑</span>
                  <Select value={String(e.selectiveLogic)} width="100%" options={LOGIC} onChange={(v) => set('selectiveLogic', Number(v) as SelectiveLogic)} />
                </label>
              </div>
            )}
            <div className="ee-row3">
              <TextField label="扫描深度（留空跟随全局）" type="number" min={0} value={e.scanDepth ?? ''} onChange={(ev) => set('scanDepth', ev.target.value.trim() === '' ? null : Math.max(0, num(ev.target.value, 2)))} />
              <label className="field">
                <span className="field-label">区分大小写</span>
                <Select value={tri(e.caseSensitive)} width="100%" options={TRI} onChange={(v) => set('caseSensitive', untri(v))} />
              </label>
              <label className="field">
                <span className="field-label">整词匹配</span>
                <Select value={tri(e.matchWholeWords)} width="100%" options={TRI} onChange={(v) => set('matchWholeWords', untri(v))} />
              </label>
            </div>
            <div className="ee-row3">
              <TextField label="分组（同组只激活一条）" value={e.group} placeholder="可留空" onChange={(ev) => set('group', ev.target.value)} />
              <TextField label="组内权重" type="number" min={0} value={e.groupWeight} onChange={(ev) => set('groupWeight', Math.max(0, num(ev.target.value, 100)))} />
              <div className="ee-toggles">
                <Toggle checked={e.groupOverride} onChange={(v) => set('groupOverride', v)} label="组内优先" />
              </div>
            </div>
            <div className="ee-toggles wrap">
              <Toggle checked={e.excludeRecursion} onChange={(v) => set('excludeRecursion', v)} label="不被递归激活" hint="只看聊天记录，不看其它条目的内容" />
              <Toggle checked={e.preventRecursion} onChange={(v) => set('preventRecursion', v)} label="不触发递归" hint="它的内容不会再去激活别的条目" />
              <Toggle checked={!!e.delayUntilRecursion} onChange={(v) => set('delayUntilRecursion', v)} label="只在递归时激活" />
            </div>
            <div className="ee-row3">
              <TextField label="粘滞（激活后保持几条消息）" type="number" min={0} value={e.sticky} onChange={(ev) => set('sticky', Math.max(0, num(ev.target.value, 0)))} />
              <TextField label="冷却（之后几条消息内不再激活）" type="number" min={0} value={e.cooldown} onChange={(ev) => set('cooldown', Math.max(0, num(ev.target.value, 0)))} />
              <TextField label="延迟（对话满几条才可能激活）" type="number" min={0} value={e.delay} onChange={(ev) => set('delay', Math.max(0, num(ev.target.value, 0)))} />
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
