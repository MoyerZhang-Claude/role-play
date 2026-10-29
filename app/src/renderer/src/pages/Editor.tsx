import { useEffect, useMemo, useState } from 'react'
import type { Character } from '@shared/types'
import { useLibrary, avatarSrc, blankCharacter } from '../state/library'
import { go, useRouter } from '../state/router'
import { toast, confirmDialog } from '../state/ui'
import { Button, IconButton, TextArea, TextField, Corners, Divider } from '../components/ui'
import { Icon } from '../icons/Icon'
import { yt } from '../lib/api'
import { makeSigilAvatar } from '../lib/avatar'
import { audio } from '../audio/engine'

export function Editor({ id }: { id?: string }) {
  const existing = useLibrary((s) => (id ? s.chars.find((c) => c.id === id) : undefined))
  const [ch, setCh] = useState<Character>(() => (existing ? structuredClone(existing) : blankCharacter()))
  const [image, setImage] = useState<Uint8Array | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [adv, setAdv] = useState(false)
  const [saving, setSaving] = useState(false)
  const dirty = useMemo(() => JSON.stringify(ch) !== JSON.stringify(existing ?? blankCharacterLike(ch)) || !!image, [ch, existing, image])

  useEffect(() => {
    if (image) {
      const u = URL.createObjectURL(new Blob([image as BlobPart]))
      setPreview(u)
      return () => URL.revokeObjectURL(u)
    }
    if (!existing && ch.name.trim()) {
      // 新角色：实时预览印章头像
      let alive = true
      const t = window.setTimeout(async () => {
        const b = await makeSigilAvatar(ch.name)
        if (!alive) return
        setPreview(URL.createObjectURL(new Blob([b as BlobPart], { type: 'image/png' })))
      }, 350)
      return () => {
        alive = false
        window.clearTimeout(t)
      }
    }
    setPreview(existing ? avatarSrc(existing) : null)
  }, [image, existing, existing ? null : ch.name])

  const set = <K extends keyof Character>(k: K, v: Character[K]) => setCh((c) => ({ ...c, [k]: v }))

  const pickImage = async () => {
    const files = await yt.dialog.openFiles({ title: '选择头像图片', filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }], multi: false })
    if (files[0]) setImage(files[0].bytes)
  }

  const save = async () => {
    if (!ch.name.trim()) {
      toast('warn', '先给角色起个名字')
      return
    }
    setSaving(true)
    try {
      const clean: Character = { ...ch, name: ch.name.trim(), alternateGreetings: ch.alternateGreetings.filter((g) => g.trim()) }
      if (existing) {
        await useLibrary.getState().save(clean)
        if (image) await useLibrary.getState().setAvatar(clean.id, image)
        toast('ok', '设定已保存')
      } else {
        await useLibrary.getState().add(clean, image ?? undefined)
        audio.stamp()
        toast('ok', `「${clean.name}」已收入书斋`)
      }
      go({ name: 'character', id: clean.id })
    } catch (e) {
      toast('error', '保存失败', String(e))
    } finally {
      setSaving(false)
    }
  }

  const cancel = async () => {
    if (dirty && !(await confirmDialog({ title: '放弃未保存的修改？', okText: '放弃', danger: true }))) return
    useRouter.getState().back()
  }

  const greetings = ch.alternateGreetings
  return (
    <div className="page editor">
      <div className="ed-grid">
        <aside className="ed-side">
          <div className="cp-frame ed-frame" onClick={pickImage} data-sfx="soft" role="button" data-tip="点击选择图片">
            <Corners size={18} />
            {preview ? <img src={preview} alt="" draggable={false} /> : <div className="cp-blank ed-blank">
                <Icon name="user" scale={3} />
                <span className="t-small">点击选择头像</span>
              </div>}
          </div>
          <div className="ed-side-actions">
            <Button size="sm" icon="upload" onClick={pickImage}>
              选择图片
            </Button>
            {image && (
              <Button size="sm" variant="ghost" onClick={() => setImage(null)}>
                {existing ? '撤销更换' : '改用印章头像'}
              </Button>
            )}
          </div>
          {!existing && !image && <p className="t-small t-faint ed-tip">不选图片时，会用名字的首字生成一枚印章头像。</p>}
          <div className="ed-save">
            <Button variant="primary" size="lg" icon="seal" sfx="none" disabled={saving} onClick={save}>
              {existing ? '保存设定' : '收入书斋'}
            </Button>
            <Button size="lg" sfx="back" onClick={cancel}>
              取消
            </Button>
          </div>
        </aside>
        <section className="ed-main">
          <div className="t-deco">{existing ? 'Emendatio · 修订设定' : 'Creatio · 新的角色'}</div>
          <h1 className="cp-name t-display">{existing ? existing.name : '写一位新角色'}</h1>
          <p className="t-soft ed-lead">只有名字是必填的。其余写多写少都可以，之后随时能改。用 <code>{'{{char}}'}</code> 指代角色，<code>{'{{user}}'}</code> 指代你。</p>

          <div className="ed-form">
            <TextField label="名字" value={ch.name} placeholder="例如：林间药师 · 薇拉" maxLength={60} onChange={(e) => set('name', e.target.value)} />
            <TextArea
              label="设定"
              hint="TA 是谁？外貌、身份、经历、说话方式、与你的关系……写得越具体，扮演越生动。"
              value={ch.description}
              minRows={6}
              placeholder={'{{char}}是一位在边境小镇经营药铺的年轻药师，银发，左眼下有一颗泪痣。说话温吞，但对药材有近乎偏执的讲究。'}
              onChange={(e) => set('description', e.target.value)}
            />
            <div className="ed-two">
              <TextArea label="性格" minRows={3} value={ch.personality} placeholder="温柔、固执、怕黑……" onChange={(e) => set('personality', e.target.value)} />
              <TextArea label="场景" minRows={3} value={ch.scenario} placeholder="故事从哪里开始？" onChange={(e) => set('scenario', e.target.value)} />
            </div>
            <TextArea label="开场白" hint="角色说的第一段话，会作为对话的第一页。" minRows={4} value={ch.firstMes} placeholder={'*药铺的门铃轻响。*\n“欢迎……啊，是你。今天想要什么药？”'} onChange={(e) => set('firstMes', e.target.value)} />
            {greetings.map((g, i) => (
              <div key={i} className="ed-alt">
                <TextArea label={`备选开场白 ${i + 1}`} minRows={3} value={g} onChange={(e) => set('alternateGreetings', greetings.map((x, k) => (k === i ? e.target.value : x)))} />
                <IconButton icon="trash" tip="删除这条" onClick={() => set('alternateGreetings', greetings.filter((_, k) => k !== i))} />
              </div>
            ))}
            <div>
              <Button size="sm" icon="plus" onClick={() => set('alternateGreetings', [...greetings, ''])}>
                添加备选开场白
              </Button>
            </div>

            <Divider glyph="diamond" />
            <button className="ed-adv-toggle" data-sfx="soft" onClick={() => setAdv(!adv)}>
              <Icon name={adv ? 'chevD' : 'chevR'} /> 进阶设定
              <span className="t-faint t-small">对话示例、系统提示词、角色备注等</span>
            </button>
            {adv && (
              <div className="ed-adv">
                <TextArea label="对话示例" hint="用 <START> 分隔多段示例，帮助 AI 把握说话风格。" minRows={4} value={ch.mesExample} placeholder={'<START>\n{{user}}：这是什么药？\n{{char}}：*她眯起眼睛* 安神的。别闻太久。'} onChange={(e) => set('mesExample', e.target.value)} />
                <TextArea label="系统提示词（覆盖默认）" hint="留空则使用设置里的主提示词。可用 {{original}} 引用默认内容。" minRows={3} value={ch.systemPrompt} onChange={(e) => set('systemPrompt', e.target.value)} />
                <TextArea label="历史后指令" hint="放在聊天记录之后，对 AI 的影响最强。" minRows={3} value={ch.postHistoryInstructions} onChange={(e) => set('postHistoryInstructions', e.target.value)} />
                <div className="ed-two">
                  <TextArea
                    label="角色备注（深度插入）"
                    hint="每次都插在倒数第 N 条消息处，适合提醒 AI 保持某种状态。"
                    minRows={3}
                    value={ch.depthPrompt?.prompt ?? ''}
                    onChange={(e) => set('depthPrompt', e.target.value.trim() ? { prompt: e.target.value, depth: ch.depthPrompt?.depth ?? 4, role: ch.depthPrompt?.role ?? 'system' } : null)}
                  />
                  <TextField
                    label="插入深度"
                    type="number"
                    min={0}
                    max={100}
                    value={ch.depthPrompt?.depth ?? 4}
                    onChange={(e) => ch.depthPrompt && set('depthPrompt', { ...ch.depthPrompt, depth: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </div>
                <TextArea label="作者寄语" hint="只给人看，不发给 AI。" minRows={2} value={ch.creatorNotes} onChange={(e) => set('creatorNotes', e.target.value)} />
                <div className="ed-two">
                  <TextField label="标签（用逗号分隔）" value={ch.tags.join('，')} onChange={(e) => set('tags', e.target.value.split(/[,，]/).map((t) => t.trim()).filter(Boolean))} />
                  <TextField label="作者" value={ch.creator} onChange={(e) => set('creator', e.target.value)} />
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function blankCharacterLike(ch: Character): Character {
  const b = blankCharacter()
  return { ...b, id: ch.id, createdAt: ch.createdAt, updatedAt: ch.updatedAt }
}
