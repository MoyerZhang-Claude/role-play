import { useEffect, useState, type ReactNode } from 'react'
import type { ApiProfile, ProviderKind, ThinkingMode } from '@shared/types'
import { defaultProfile } from '@shared/defaults'
import { DEFAULT_MAIN_PROMPT } from '@shared/prompt'
import { newId } from '@shared/id'
import { useSettings } from '../state/settings'
import { go } from '../state/router'
import { toast, confirmDialog } from '../state/ui'
import { Button, IconButton, Toggle, Slider, TextField, TextArea, Select, Divider, Spinner } from '../components/ui'
import { Icon } from '../icons/Icon'
import type { IconName } from '../icons/pixel'
import { yt } from '../lib/api'
import type { AppInfo } from '../../../preload/api'
import { audio } from '../audio/engine'
import { music } from '../audio/music'
import { renderRich } from '../render/rich'
import { THEMES } from '../theme/parchment'
import { openExportArchive, pickImportArchive } from './ArchiveModals'
import { PresetPanel } from './PresetPanel'
import { HelpSection } from './Help'

const TABS: { key: string; label: string; deco: string; icon: IconName }[] = [
  { key: 'api', label: '接口', deco: 'Fons', icon: 'sparkle' },
  { key: 'chat', label: '对话与人设', deco: 'Colloquium', icon: 'quill' },
  { key: 'look', label: '外观', deco: 'Species', icon: 'eye' },
  { key: 'sound', label: '声音', deco: 'Sonus', icon: 'music' },
  { key: 'opening', label: '开场动画', deco: 'Prologus', icon: 'flask' },
  { key: 'data', label: '数据', deco: 'Archivum', icon: 'folder' },
  { key: 'help', label: '帮助', deco: 'Enchiridion', icon: 'scroll' },
  { key: 'about', label: '关于', deco: 'De Libro', icon: 'info' }
]

export function SettingsPage({ tab }: { tab?: string }) {
  const [cur, setCur] = useState(tab && TABS.some((t) => t.key === tab) ? tab : 'api')
  const t = TABS.find((x) => x.key === cur)!
  return (
    <div className="page settings">
      <nav className="set-toc">
        <div className="t-deco">Index</div>
        <div className="set-toc-title t-display">设置</div>
        {TABS.map((x, i) => (
          <button key={x.key} className={`set-toc-item ${cur === x.key ? 'on' : ''}`} data-sfx="soft" onClick={() => setCur(x.key)}>
            <span className="set-toc-no t-pixel">{['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'][i]}</span>
            <span>{x.label}</span>
          </button>
        ))}
      </nav>
      <section className="set-body" key={cur}>
        {cur !== 'help' && (
          <>
            <div className="t-deco">{t.deco}</div>
            <h1 className="set-title t-display">{t.label}</h1>
          </>
        )}
        {cur === 'api' && <ApiSection />}
        {cur === 'chat' && <ChatSection />}
        {cur === 'look' && <LookSection />}
        {cur === 'sound' && <SoundSection />}
        {cur === 'opening' && <OpeningSection />}
        {cur === 'data' && <DataSection />}
        {cur === 'help' && <HelpSection />}
        {cur === 'about' && <AboutSection />}
      </section>
    </div>
  )
}

function Row({ label, hint, children, wide }: { label: ReactNode; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`set-row ${wide ? 'wide' : ''}`}>
      <div className="set-row-label">
        <div>{label}</div>
        {hint && <div className="set-row-hint">{hint}</div>}
      </div>
      <div className="set-row-ctrl">{children}</div>
    </div>
  )
}

/* ───────── 接口 ───────── */

const PROVIDERS: { value: ProviderKind; label: string; hint: string }[] = [
  { value: 'openai', label: 'OpenAI 兼容格式', hint: '已实测（DeepSeek）· 绝大多数服务都兼容' },
  { value: 'anthropic', label: 'Claude（Anthropic）', hint: '已实现，尚未实测' },
  { value: 'gemini', label: 'Gemini（Google）', hint: '已实测（gemini-2.5-flash 免费层级）· 地址可以不填' }
]
const THINKING: { value: ThinkingMode; label: string; hint?: string }[] = [
  { value: 'default', label: '模型默认' },
  { value: 'off', label: '关闭思考', hint: '回复更快、更省' },
  { value: 'low', label: '浅思' },
  { value: 'high', label: '深思' },
  { value: 'max', label: '极致' }
]
const BASE_HINT: Record<ProviderKind, string> = {
  openai: '例如 https://api.deepseek.com 或 https://api.openai.com/v1',
  anthropic: '可以不填，默认 https://api.anthropic.com',
  gemini: '可以不填，默认 https://generativelanguage.googleapis.com'
}

/** 上下文预算的说明：超出时怎么办、模型上限、按实际用量的校准 */
function ContextHint({ p, limit, onUse }: { p: ApiProfile; limit?: number; onUse: (v: number) => void }) {
  return (
    <>
      发送内容的上限（token）。超出时先省略最早的聊天记录；预设、角色、世界书这些固定内容本身放不下时不会发送，并提示是哪几段太大。
      {limit ? (
        <>
          {' '}这个模型的上限是 {limit.toLocaleString()}。
          {p.contextSize !== limit && (
            <button className="link-btn" data-sfx="soft" onClick={() => onUse(limit)}>
              设为上限
            </button>
          )}
        </>
      ) : null}
      {p.tokenRatio ? ` 已按实际用量校准估算（×${p.tokenRatio.toFixed(2)}）。` : ''}
    </>
  )
}

function ApiSection() {
  const s = useSettings((x) => x.s)
  const update = useSettings((x) => x.update)
  const p = s.api.profiles.find((x) => x.id === s.api.activeProfileId) ?? s.api.profiles[0]
  const [keyInput, setKeyInput] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [models, setModels] = useState<{ id: string; context?: number }[] | null>(null)
  const [loadingModels, setLoadingModels] = useState(false)
  const [test, setTest] = useState<{ state: 'idle' | 'run' | 'ok' | 'err'; text?: string }>({ state: 'idle' })
  const [adv, setAdv] = useState(false)

  useEffect(() => {
    setKeyInput('')
    setModels(null)
    setTest({ state: 'idle' })
    if (p) yt.secrets.hint(p.id).then(setHint)
  }, [p?.id])

  if (!p) return null
  const setP = (patch: Partial<ApiProfile>) =>
    update((d) => {
      const i = d.api.profiles.findIndex((x) => x.id === p.id)
      if (i >= 0) d.api.profiles[i] = { ...d.api.profiles[i], ...patch }
    })

  const saveKey = async () => {
    await yt.secrets.set(p.id, keyInput)
    setKeyInput('')
    setHint(await yt.secrets.hint(p.id))
    audio.confirm()
    toast('ok', keyInput.trim() ? '密钥已加密保存' : '密钥已清除')
  }
  /** 输入框里还有没保存的密钥：先保存（离开输入框、测试连接、获取模型列表时） */
  const saveTypedKey = async () => {
    if (keyInput.trim()) await saveKey()
  }
  const fetchModels = async () => {
    await saveTypedKey()
    setLoadingModels(true)
    try {
      const list = await yt.llm.models(p)
      setModels(list)
      if (!list.length) toast('info', '服务没有返回模型列表')
    } catch (e: any) {
      toast('error', '获取模型列表失败', String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setLoadingModels(false)
    }
  }
  const runTest = async () => {
    await saveTypedKey()
    setTest({ state: 'run' })
    const r = await yt.llm.test(p)
    if (r.ok) {
      setTest({ state: 'ok', text: `连接成功 · 首字 ${r.ms} ms${r.text ? ` · 「${r.text}」` : ''}` })
      audio.confirm()
    } else {
      setTest({ state: 'err', text: r.error })
      audio.error()
    }
  }
  const addProfile = () => {
    const np: ApiProfile = { ...defaultProfile(), id: newId('api'), name: '新的接口', baseUrl: '', model: '', thinking: 'default' }
    update((d) => {
      d.api.profiles.push(np)
      d.api.activeProfileId = np.id
    })
  }
  const removeProfile = async () => {
    if (s.api.profiles.length <= 1) return toast('info', '至少保留一个接口配置')
    if (!(await confirmDialog({ title: `删除接口「${p.name}」？`, okText: '删除', danger: true }))) return
    await yt.secrets.remove(p.id)
    update((d) => {
      d.api.profiles = d.api.profiles.filter((x) => x.id !== p.id)
      d.api.activeProfileId = d.api.profiles[0]?.id ?? null
    })
  }

  return (
    <div className="set-section">
      <div className="profile-bar">
        <Select value={p.id} width={260} options={s.api.profiles.map((x) => ({ value: x.id, label: x.name, hint: x.model }))} onChange={(v) => update((d) => (d.api.activeProfileId = v))} />
        <Button size="sm" icon="plus" onClick={addProfile}>
          新增接口
        </Button>
        <IconButton icon="trash" tip="删除这个接口配置" onClick={removeProfile} />
      </div>
      <Row label="名称">
        <TextField value={p.name} onChange={(e) => setP({ name: e.target.value })} />
      </Row>
      <Row label="接口格式" hint={PROVIDERS.find((x) => x.value === p.provider)?.hint}>
        <Select value={p.provider} width={300} options={PROVIDERS} onChange={(v) => setP({ provider: v })} />
      </Row>
      <Row label="接口地址" hint={BASE_HINT[p.provider]}>
        <TextField value={p.baseUrl} placeholder={BASE_HINT[p.provider]} onChange={(e) => setP({ baseUrl: e.target.value.trim() })} />
      </Row>
      <Row label="密钥" hint={hint ? `已加密保存：${hint}` : '尚未保存。密钥用 Windows 加密存放在本机，不会写进设置文件，也不会随存档导出。'}>
        <div className="inline">
          <TextField type="password" value={keyInput} placeholder={hint ? '输入新密钥以替换' : 'sk-...'} autoComplete="off" onChange={(e) => setKeyInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveKey()} onBlur={() => void saveTypedKey()} />
          <Button size="sm" variant="primary" sfx="none" disabled={!keyInput.trim()} onClick={saveKey}>
            保存
          </Button>
          {hint && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await yt.secrets.remove(p.id)
                setHint(null)
              }}
            >
              清除
            </Button>
          )}
        </div>
      </Row>
      <Row label="模型">
        <div className="inline">
          <TextField value={p.model} placeholder="例如 deepseek-flash" onChange={(e) => setP({ model: e.target.value.trim() })} />
          <Button size="sm" icon="download" disabled={loadingModels} onClick={fetchModels}>
            {loadingModels ? '获取中…' : '获取模型列表'}
          </Button>
        </div>
        {models && models.length > 0 && (
          <div className="model-chips">
            {models.map((m) => (
              <button
                key={m.id}
                className={`chip ${m.id === p.model ? 'on' : ''}`}
                data-sfx="soft"
                data-tip={m.context ? `上下文上限 ${m.context.toLocaleString()} tokens` : undefined}
                onClick={() => setP({ model: m.id, tokenRatio: undefined, ...(m.context && p.contextSize > m.context ? { contextSize: m.context } : {}) })}
              >
                {m.id}
              </button>
            ))}
          </div>
        )}
      </Row>
      <Row label="思考模式" hint="支持思考的模型会先「打草稿」，质量更好但更慢、更费。关闭思考目前按 DeepSeek 的写法发送。">
        <Select value={p.thinking} width={200} options={THINKING} onChange={(v) => setP({ thinking: v })} />
      </Row>
      <Row label="温度" hint="越高越有想象力，越低越稳定。">
        <Slider value={p.temperature} min={0} max={2} step={0.05} onChange={(v) => setP({ temperature: v })} format={(v) => v.toFixed(2)} />
      </Row>
      <Row label="单次回复上限" hint="单位 token，含思考内容。">
        <Slider value={p.maxTokens} min={256} max={16384} step={256} onChange={(v) => setP({ maxTokens: v })} />
      </Row>
      <Row label="上下文预算" hint={<ContextHint p={p} limit={models?.find((m) => m.id === p.model)?.context} onUse={(v) => setP({ contextSize: v })} />}>
        <Slider value={p.contextSize} min={4000} max={2_000_000} step={4000} onChange={(v) => setP({ contextSize: v })} format={(v) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : `${Math.round(v / 1000)}K`)} />
      </Row>
      <div className="set-actions">
        <Button icon="sparkle" disabled={test.state === 'run'} onClick={runTest}>
          测试连接
        </Button>
        {test.state === 'run' && <Spinner />}
        {test.state === 'ok' && <span className="test-ok">{test.text}</span>}
        {test.state === 'err' && <span className="test-err selectable">{test.text}</span>}
      </div>
      <button className="ed-adv-toggle" data-sfx="soft" onClick={() => setAdv(!adv)}>
        <Icon name={adv ? 'chevD' : 'chevR'} /> 进阶参数
      </button>
      {adv && (
        <>
          <Row label="Top P">
            <Slider value={p.topP} min={0} max={1} step={0.01} onChange={(v) => setP({ topP: v })} format={(v) => v.toFixed(2)} />
          </Row>
          <Row label="存在惩罚">
            <Slider value={p.presencePenalty} min={-2} max={2} step={0.05} onChange={(v) => setP({ presencePenalty: v })} format={(v) => v.toFixed(2)} />
          </Row>
          <Row label="频率惩罚">
            <Slider value={p.frequencyPenalty} min={-2} max={2} step={0.05} onChange={(v) => setP({ frequencyPenalty: v })} format={(v) => v.toFixed(2)} />
          </Row>
          <Row label="附加请求参数" hint="JSON 对象，会合并进请求体，用于服务商特有的参数。" wide>
            <TextArea value={p.extraBody} minRows={3} placeholder={'{ "top_k": 40 }'} onChange={(e) => setP({ extraBody: e.target.value })} />
          </Row>
        </>
      )}
    </div>
  )
}

/* ───────── 对话 ───────── */

function ChatSection() {
  const c = useSettings((x) => x.s.chat)
  const update = useSettings((x) => x.update)
  const set = (fn: (d: typeof c) => void) => update((d) => fn(d.chat))
  return (
    <div className="set-section">
      <h3 className="set-sub">你的人设</h3>
      <Row label="名字" hint="角色卡里的 {{user}} 会替换成它。">
        <TextField value={c.persona.name} placeholder="旅人" onChange={(e) => set((d) => (d.persona.name = e.target.value))} />
      </Row>
      <Row label="人设描述" hint="你在故事里是谁？会发给 AI。" wide>
        <TextArea value={c.persona.description} minRows={3} placeholder="例如：{{user}}是一名游历四方的抄书人，带着一本没有写完的旧书。" onChange={(e) => set((d) => (d.persona.description = e.target.value))} />
      </Row>
      <Divider glyph="diamond" />
      <h3 className="set-sub">提示词预设</h3>
      <PresetPanel />
      <Divider glyph="diamond" />
      <h3 className="set-sub">提示词</h3>
      <Row label="主提示词" hint="放在最前面，告诉 AI 这是一场角色扮演。" wide>
        <TextArea value={c.mainPrompt} minRows={3} onChange={(e) => set((d) => (d.mainPrompt = e.target.value))} />
        <Button size="sm" variant="ghost" onClick={() => set((d) => (d.mainPrompt = DEFAULT_MAIN_PROMPT))}>
          恢复默认
        </Button>
      </Row>
      <Row label="历史后指令" hint="放在聊天记录之后（影响最强），留空即不发送。" wide>
        <TextArea value={c.postHistoryPrompt} minRows={2} placeholder="例如：用第三人称描写，回复 300～600 字。" onChange={(e) => set((d) => (d.postHistoryPrompt = e.target.value))} />
      </Row>
      <Row label="使用角色卡的系统提示词">
        <Toggle checked={c.useCardSystemPrompt} onChange={(v) => set((d) => (d.useCardSystemPrompt = v))} hint="卡片自带时，替代上面的主提示词" />
      </Row>
      <Row label="使用角色卡的历史后指令">
        <Toggle checked={c.useCardPostHistory} onChange={(v) => set((d) => (d.useCardPostHistory = v))} />
      </Row>
      <Divider glyph="diamond" />
      <h3 className="set-sub">世界书</h3>
      <Row label="扫描深度" hint="检查最近几条消息里的关键词（条目可单独设置）。">
        <Slider value={c.wiScanDepth} min={1} max={20} onChange={(v) => set((d) => (d.wiScanDepth = v))} format={(v) => `${v} 条`} />
      </Row>
      <Row label="自动整理前情提要" hint="对话长到上下文放不下时，最早的消息不再发送；打开后药汤会在后台把它们整理成前情提要代替原文，免得 AI 忘掉前面的剧情（会额外调用一次接口）。">
        <Toggle checked={c.autoSummary !== false} onChange={(v) => set((d) => (d.autoSummary = v))} />
      </Row>
      <Row label="提要篇幅" hint="前情提要最多写多少字。放不下的旧对话会全部并入提要，篇幅越长、保留的细节越多，但每次发送也多占一些上下文（1500 字约占 1000–1500 token）。改了之后，到对话页「侧记」里点「重新整理」可以立刻按新篇幅重写。">
        <Select
          value={String(c.recapLength ?? 1500)}
          width={200}
          options={[
            { value: '900', label: '简要 · 900 字' },
            { value: '1500', label: '标准 · 1500 字' },
            { value: '2500', label: '详细 · 2500 字' },
            { value: '4000', label: '很详细 · 4000 字' }
          ]}
          onChange={(v) => set((d) => (d.recapLength = Number(v)))}
        />
      </Row>
      <Row label="预算" hint="世界书最多占上下文预算的比例。">
        <Slider value={c.wiBudgetPercent} min={5} max={80} onChange={(v) => set((d) => (d.wiBudgetPercent = v))} format={(v) => `${v}%`} />
      </Row>
      <Row label="递归扫描">
        <Toggle checked={c.wiRecursive} onChange={(v) => set((d) => (d.wiRecursive = v))} hint="被激活条目的内容里提到的关键词，也能再激活其它条目" />
      </Row>
      <Row label="匹配时包含说话人名字">
        <Toggle checked={c.wiIncludeNames} onChange={(v) => set((d) => (d.wiIncludeNames = v))} />
      </Row>
      <Divider glyph="diamond" />
      <h3 className="set-sub">书写</h3>
      <Row label="匀速书写">
        <Toggle checked={c.smoothReveal} onChange={(v) => set((d) => (d.smoothReveal = v))} hint="把一阵一阵到达的文字按平稳节奏写出来，并有墨迹渗入的效果" />
      </Row>
      <Row label="显示思考内容">
        <Toggle checked={c.showReasoning} onChange={(v) => set((d) => (d.showReasoning = v))} hint="模型的思考过程折叠显示在回复上方" />
      </Row>
    </div>
  )
}

/* ───────── 外观 ───────── */

const SAMPLE = '*炉火噼啪作响，她把一缕银发别到耳后，抬眼看你。*\n“这么晚了，还在赶路吗？”\n她把一碗冒着热气的药汤推到桌边——**小心烫**。'

function LookSection() {
  const a = useSettings((x) => x.s.appearance)
  const update = useSettings((x) => x.update)
  const set = (fn: (d: typeof a) => void) => update((d) => fn(d.appearance))
  const html = renderRich(SAMPLE, { scripts: [], macros: (s) => s, placement: 2, depth: 0, quotes: a.quoteHighlight })
  return (
    <div className="set-section">
      <Row label="主题" hint="以后会加入更多主题。">
        <div className="theme-cards">
          {Object.values(THEMES).map((t) => (
            <button key={t.id} className={`theme-card ${a.themeId === t.id ? 'on' : ''}`} data-sfx="soft" onClick={() => set((d) => (d.themeId = t.id))}>
              <span className="theme-swatch" style={{ background: t.colors.paper, color: t.colors.ink, borderColor: t.colors['ink-line'] }}>
                <span style={{ background: t.colors.ink }} />
                <span style={{ background: t.colors.rubric }} />
                <span style={{ background: t.colors.gold }} />
              </span>
              <span>{t.name}</span>
            </button>
          ))}
        </div>
      </Row>
      <div className="look-preview sheet">
        <div className="rich" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <Row label="正文字体">
        <Select
          value={a.bodyFont}
          width={240}
          options={[
            { value: 'wenkai', label: '霞鹜文楷', hint: '默认，手写感，适合长读' },
            { value: 'notoserif', label: '思源宋体', hint: '端正的书籍字体' },
            { value: 'system', label: '微软雅黑', hint: '系统无衬线字体' }
          ]}
          onChange={(v) => set((d) => (d.bodyFont = v))}
        />
      </Row>
      <Row label="字号">
        <Slider value={a.fontSize} min={13} max={26} step={0.5} onChange={(v) => set((d) => (d.fontSize = v))} format={(v) => `${v}px`} />
      </Row>
      <Row label="行距">
        <Slider value={a.lineHeight} min={1.3} max={2.6} step={0.05} onChange={(v) => set((d) => (d.lineHeight = v))} format={(v) => v.toFixed(2)} />
      </Row>
      <Row label="阅读栏宽度">
        <Slider value={a.chatWidth} min={560} max={1200} step={20} onChange={(v) => set((d) => (d.chatWidth = v))} format={(v) => `${v}px`} />
      </Row>
      <Row label="段首缩进">
        <Toggle checked={a.paragraphIndent} onChange={(v) => set((d) => (d.paragraphIndent = v))} hint="每段开头空两格，像书一样" />
      </Row>
      <Row label="对白着色">
        <Toggle checked={a.quoteHighlight} onChange={(v) => set((d) => (d.quoteHighlight = v))} hint="引号里的话用深赭色" />
      </Row>
      <Row label="烛光">
        <Toggle checked={a.ambient} onChange={(v) => set((d) => (d.ambient = v))} hint="纸面上极轻微的烛光明暗" />
      </Row>
      <Row label="减少动效">
        <Toggle checked={a.reduceMotion} onChange={(v) => set((d) => (d.reduceMotion = v))} hint="关闭大部分过渡与墨点特效" />
      </Row>
    </div>
  )
}

/* ───────── 声音 ───────── */

function SoundSection() {
  const so = useSettings((x) => x.s.sound)
  const update = useSettings((x) => x.update)
  return (
    <div className="set-section">
      <p className="set-lead t-soft">所有声音都是程序实时合成的：木质的轻叩、纸页翻动、落印、铃音；背景音乐是在 D 多利亚调式里即兴生成的拨弦与长音，配一点壁炉的噼啪声，每次都不一样。</p>
      <Row label="界面音效">
        <Toggle checked={so.sfxEnabled} onChange={(v) => update((d) => (d.sound.sfxEnabled = v))} />
      </Row>
      <Row label="音效音量">
        <div className="inline">
          <Slider value={so.sfxVolume} min={0} max={1} step={0.05} onChange={(v) => update((d) => (d.sound.sfxVolume = v))} format={(v) => `${Math.round(v * 100)}%`} />
          <Button size="sm" sfx="confirm">
            试听
          </Button>
        </div>
      </Row>
      <Row label="背景音乐">
        <Toggle
          checked={so.musicEnabled}
          onChange={(v) => {
            update((d) => (d.sound.musicEnabled = v))
            if (v && !music.playing) music.start(2)
          }}
        />
      </Row>
      <Row label="音乐音量">
        <Slider value={so.musicVolume} min={0} max={1} step={0.05} onChange={(v) => update((d) => (d.sound.musicVolume = v))} format={(v) => `${Math.round(v * 100)}%`} />
      </Row>
    </div>
  )
}

/* ───────── 开场 ───────── */

function OpeningSection() {
  const o = useSettings((x) => x.s.opening)
  const update = useSettings((x) => x.update)
  return (
    <div className="set-section">
      <p className="set-lead t-soft">「墨落成阵，汤沸成章」—— 一滴墨落在纸上，晕开成魔法阵，阵心煎出一碗药汤，蒸汽里浮出书名。全部由代码实时绘制，约 5.6 秒。双击或按 Esc 可以跳过。</p>
      <Row label="启动时播放开场动画">
        <Toggle checked={o.enabled} onChange={(v) => update((d) => (d.opening.enabled = v))} hint={o.enabled ? '每次打开药汤都会播放' : '关闭后，启动时只保留一个很短的淡入'} />
      </Row>
      <div className="set-actions">
        <Button icon="flask" sfx="page" onClick={() => window.dispatchEvent(new CustomEvent('yt:replay-opening'))}>
          现在重播一次
        </Button>
      </div>
    </div>
  )
}

/* ───────── 数据 ───────── */

function DataSection() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    yt.app.info().then(setInfo)
  }, [])
  return (
    <div className="set-section">
      <Row label="数据目录" hint={info?.dataFallback ? '程序目录无法写入，已改用此处。建议把药汤安装到普通文件夹（不要装在 Program Files）。' : '程序与数据放在一起，拷走整个文件夹即可迁移。'}>
        <div className="inline">
          <code className="path selectable">{info?.dataDir ?? '…'}</code>
          <Button size="sm" icon="folder" onClick={() => yt.app.openDataDir()}>
            打开
          </Button>
        </div>
      </Row>
      <div className="data-explain sheet">
        <h4>里面有什么</h4>
        <ul>
          <li>
            <code>characters/</code> 角色（设定、头像、内嵌世界书与正则、原始卡片数据）
          </li>
          <li>
            <code>chats/</code> 每一卷对话一个文件，自动保存
          </li>
          <li>
            <code>worldbooks/</code> 独立导入并绑定的世界书
          </li>
          <li>
            <code>settings.json</code> 设置（不含密钥）
          </li>
          <li>
            <code>secrets.json</code> 加密后的 API 密钥（只能在本机解密）
          </li>
          <li>
            <code>backups/</code> 导入存档前的自动备份（保留最近 5 份）
          </li>
          <li>
            <code>runtime/</code> 运行缓存，可随时删除
          </li>
        </ul>
      </div>
      <Row label="存档导出 / 导入" hint="打包成一个 .yaotang 文件，便于备份与迁移；不含 API 密钥。导入前会自动备份当前数据到 data\backups。也可以直接把 .yaotang 文件拖进窗口。">
        <div className="inline">
          <Button size="sm" icon="download" onClick={() => openExportArchive()}>
            导出存档
          </Button>
          <Button size="sm" icon="upload" onClick={() => pickImportArchive()}>
            导入存档
          </Button>
          <Button size="sm" variant="ghost" icon="folder" onClick={() => yt.app.openDataDir('backups')}>
            自动备份
          </Button>
        </div>
      </Row>
    </div>
  )
}

/* ───────── 关于 ───────── */

function AboutSection() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [fps, setFps] = useState<number | null>(null)
  useEffect(() => {
    yt.app.info().then(setInfo)
    let n = 0
    let raf = 0
    const t0 = performance.now()
    const f = (t: number) => {
      n++
      if (t - t0 < 1000) raf = requestAnimationFrame(f)
      else setFps(Math.round((n * 1000) / (t - t0)))
    }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [])
  const caps: { ok: boolean | 'part'; text: string }[] = [
    { ok: true, text: 'OpenAI 兼容接口：流式、停止、思考内容、用量、模型列表（DeepSeek 实测）' },
    { ok: 'part', text: 'Claude / Gemini 接口：已按官方格式实现，尚未实测' },
    { ok: true, text: '角色卡 PNG / JSON（V1、V2、V3）导入，含内嵌世界书与正则' },
    { ok: true, text: '世界书：关键词、正则键、次要键逻辑、常驻、概率、递归、分组、插入位置与深度、预算、粘滞/冷却/延迟' },
    { ok: true, text: '正则：作用范围、仅显示 / 仅发送、深度范围、修剪' },
    { ok: 'part', text: '独立世界书 / 正则：可导入并绑定到角色；完整管理界面在第二阶段' },
    { ok: true, text: '存档导出 / 导入（合并或完全还原，导入前自动备份，不含密钥）' },
    { ok: false, text: 'SillyTavern 预设导入、群聊：之后的阶段' }
  ]
  return (
    <div className="set-section">
      <Row label="版本">
        <span>药汤 {info?.version}</span>
      </Row>
      <Row label="运行环境">
        <span className="t-small t-soft">
          Electron {info?.electron} · Chromium {info?.chrome}
        </span>
      </Row>
      <Row label="刷新率" hint="动画跟随屏幕刷新率。">
        <span className="t-small t-soft">
          屏幕 {info?.displayHz ?? '…'} Hz · 实测 {fps ?? '…'} 帧/秒 · 缩放 {info ? Math.round(info.scaleFactor * 100) : '…'}%
        </span>
      </Row>
      <div className="caps sheet">
        <h4>能力清单</h4>
        <ul>
          {caps.map((c, i) => (
            <li key={i} className={c.ok === true ? 'ok' : c.ok === 'part' ? 'part' : 'no'}>
              <Icon name={c.ok === true ? 'check' : c.ok === 'part' ? 'info' : 'minimize'} />
              <span>{c.text}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="t-small t-faint">字体：霞鹜文楷、马善政毛笔楷书、思源宋体、Cinzel、IM Fell English、Silkscreen，均为 SIL 开源字体许可。</p>
      <div className="set-actions">
        <Button size="sm" variant="ghost" onClick={() => go({ name: 'home' })}>
          回到书斋
        </Button>
      </div>
    </div>
  )
}
