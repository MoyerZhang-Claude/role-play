/**
 * SillyTavern 常用宏的实现。未知的宏原样保留（与 ST 行为一致）。
 */
export interface MacroContext {
  user: string
  char: string
  persona?: string
  description?: string
  personality?: string
  scenario?: string
  mesExamples?: string
  charPrompt?: string
  charJailbreak?: string
  charVersion?: string
  creatorNotes?: string
  model?: string
  lastMessage?: string
  lastUserMessage?: string
  lastCharMessage?: string
  lastMessageId?: number
  input?: string
  firstMes?: string
  depthPrompt?: string
  /** 上下文预算（{{maxPrompt}}） */
  maxPrompt?: number
  /** 本次生成方式（{{lastGenerationType}}） */
  genType?: string
  /** 群聊成员名（{{group}}） */
  group?: string
  /** 群聊里没被设为静默的成员名（{{groupNotMuted}}） */
  groupNotMuted?: string
  /** 局部变量（随对话保存），会被 setvar 等修改 */
  vars?: Record<string, string>
  /** 全局变量 */
  globalVars?: Record<string, string>
  outlets?: Record<string, string>
  /** pick 宏的稳定随机种子（通常为对话 ID） */
  seed?: string
  now?: Date
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function splitList(body: string): string[] {
  // {{random::a::b}} 或 {{random:a,b}}
  if (body.startsWith('::')) return body.slice(2).split('::')
  if (body.startsWith(':')) {
    const raw = body.slice(1)
    return raw.includes('::') ? raw.split('::') : raw.replace(/\\,/g, '\u0001').split(',').map((s) => s.replace(/\u0001/g, ','))
  }
  return []
}

function roll(formula: string): string {
  const m = formula.trim().match(/^(\d*)d(\d+)([+-]\d+)?$/i)
  if (!m) {
    const n = parseInt(formula, 10)
    return Number.isFinite(n) && n > 0 ? String(1 + Math.floor(Math.random() * n)) : formula
  }
  const count = Math.min(100, parseInt(m[1] || '1', 10))
  const sides = parseInt(m[2], 10)
  let total = m[3] ? parseInt(m[3], 10) : 0
  for (let i = 0; i < count; i++) total += 1 + Math.floor(Math.random() * sides)
  return String(total)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** moment 风格的日期格式（只支持常用记号） */
function formatDate(d: Date, fmt: string): string {
  const h12 = d.getHours() % 12 || 12
  const tokens: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    YY: String(d.getFullYear()).slice(-2),
    MMMM: `${d.getMonth() + 1}月`,
    MM: pad(d.getMonth() + 1),
    M: String(d.getMonth() + 1),
    DD: pad(d.getDate()),
    D: String(d.getDate()),
    dddd: WEEKDAYS[d.getDay()],
    ddd: WEEKDAYS[d.getDay()].replace('星期', '周'),
    HH: pad(d.getHours()),
    H: String(d.getHours()),
    hh: pad(h12),
    h: String(h12),
    mm: pad(d.getMinutes()),
    m: String(d.getMinutes()),
    ss: pad(d.getSeconds()),
    s: String(d.getSeconds()),
    A: d.getHours() < 12 ? '上午' : '下午',
    a: d.getHours() < 12 ? '上午' : '下午'
  }
  return fmt.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|A|a/g, (t, lit?: string) => (lit !== undefined ? lit : tokens[t] ?? t))
}

export function substituteMacros(input: string, ctx: MacroContext): string {
  if (!input || (input.indexOf('{{') < 0 && input.indexOf('<') < 0)) return input
  let s = input
  const vars = ctx.vars ?? {}
  const gvars = ctx.globalVars ?? {}
  const now = ctx.now ?? new Date()

  // 注释
  s = s.replace(/\{\{\/\/[\s\S]*?\}\}/g, '')
  // 变量（先处理，允许后续宏读取刚设置的值）
  s = s.replace(/\{\{(setvar|setglobalvar)::([^:}]*)::([\s\S]*?)\}\}/gi, (_m, kind: string, k: string, v: string) => {
    ;(kind.toLowerCase() === 'setvar' ? vars : gvars)[k.trim()] = v
    return ''
  })
  s = s.replace(/\{\{(addvar|addglobalvar)::([^:}]*)::([\s\S]*?)\}\}/gi, (_m, kind: string, k: string, v: string) => {
    const store = kind.toLowerCase() === 'addvar' ? vars : gvars
    const key = k.trim()
    const cur = store[key] ?? ''
    const a = Number(cur)
    const b = Number(v)
    store[key] = cur !== '' && Number.isFinite(a) && Number.isFinite(b) ? String(a + b) : cur + v
    return ''
  })
  s = s.replace(/\{\{(incvar|decvar|incglobalvar|decglobalvar)::([^}]*)\}\}/gi, (_m, kind: string, k: string) => {
    const lower = kind.toLowerCase()
    const store = lower.includes('global') ? gvars : vars
    const key = k.trim()
    const v = (Number(store[key]) || 0) + (lower.startsWith('inc') ? 1 : -1)
    store[key] = String(v)
    return String(v)
  })
  s = s.replace(/\{\{(getvar|getglobalvar)::([^}]*)\}\}/gi, (_m, kind: string, k: string) => {
    const store = kind.toLowerCase() === 'getvar' ? vars : gvars
    return store[k.trim()] ?? ''
  })
  s = s.replace(/\{\{(hasvar|varexists|hasglobalvar|globalvarexists)::([^}]*)\}\}/gi, (_m, kind: string, k: string) => {
    const store = kind.toLowerCase().includes('global') ? gvars : vars
    return k.trim() in store ? 'true' : 'false'
  })
  // {{time_UTC+8}}：指定时区的时间
  s = s.replace(/\{\{time_UTC([+-]\d{1,2})\}\}/gi, (_m, off: string) => {
    const t = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + Number(off) * 3600000)
    return `${pad(t.getHours())}:${pad(t.getMinutes())}`
  })
  // {{datetimeformat YYYY-MM-DD HH:mm}}（常用的 moment 格式）
  s = s.replace(/\{\{datetimeformat +([^}]+)\}\}/gi, (_m, fmt: string) => formatDate(now, fmt.trim()))

  const map: Record<string, string | undefined> = {
    user: ctx.user,
    char: ctx.char,
    persona: ctx.persona,
    description: ctx.description,
    personality: ctx.personality,
    scenario: ctx.scenario,
    mesexamples: ctx.mesExamples,
    mesexamplesraw: ctx.mesExamples,
    charprompt: ctx.charPrompt,
    charjailbreak: ctx.charJailbreak,
    charinstruction: ctx.charJailbreak,
    charversion: ctx.charVersion,
    char_version: ctx.charVersion,
    charcreatornotes: ctx.creatorNotes,
    model: ctx.model,
    lastmessage: ctx.lastMessage,
    lastusermessage: ctx.lastUserMessage,
    lastcharmessage: ctx.lastCharMessage,
    lastmessageid: ctx.lastMessageId != null ? String(ctx.lastMessageId) : undefined,
    input: ctx.input,
    charfirstmessage: ctx.firstMes,
    chardepthprompt: ctx.depthPrompt,
    maxprompt: ctx.maxPrompt != null ? String(ctx.maxPrompt) : undefined,
    lastgenerationtype: ctx.genType ?? 'normal',
    ismobile: 'false',
    // 药汤没有群聊：群聊相关的宏都按当前角色处理
    group: ctx.group ?? ctx.char,
    groupnotmuted: ctx.groupNotMuted ?? ctx.group ?? ctx.char,
    charifnotgroup: ctx.group ?? ctx.char,
    notchar: ctx.user,
    newline: '\n',
    noop: '',
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    date: `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`,
    weekday: WEEKDAYS[now.getDay()],
    isotime: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    isodate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    idle_duration: '片刻'
  }

  let pickIndex = 0
  s = s.replace(/\{\{([a-zA-Z_]+)((?:::?|\s)[\s\S]*?)?\}\}/g, (all, nameRaw: string, rest?: string) => {
    const name = nameRaw.toLowerCase()
    if (name === 'random' && rest) {
      const items = splitList(rest)
      return items.length ? items[Math.floor(Math.random() * items.length)] : all
    }
    if (name === 'pick' && rest) {
      const items = splitList(rest)
      if (!items.length) return all
      const h = hash(`${ctx.seed ?? ''}|${input.length}|${pickIndex++}|${rest}`)
      return items[h % items.length]
    }
    if (name === 'roll' && rest) return roll(rest.replace(/^:+/, ''))
    if (name === 'outlet' && rest) return ctx.outlets?.[rest.replace(/^:+/, '').trim()] ?? ''
    if (name === 'reverse' && rest) return Array.from(rest.replace(/^:+/, '')).reverse().join('')
    if (name === 'banned') return ''
    if (rest === undefined || rest === '') {
      const v = map[name]
      if (v !== undefined) return v
    }
    return all
  })

  // <USER> <BOT> <CHAR>（大小写不敏感，与 ST 一致）
  s = s.replace(/<USER>/gi, ctx.user).replace(/<BOT>/gi, ctx.char).replace(/<CHAR>/gi, ctx.char)

  // {{trim}}：去掉其两侧的换行
  if (s.includes('{{trim}}')) s = s.replace(/(?:\r?\n)*\{\{trim\}\}(?:\r?\n)*/g, '')
  return s
}
