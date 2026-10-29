/**
 * AI 接口层（在主进程运行，密钥不进入页面）。
 * - openai：OpenAI 兼容格式 —— 已实现并用 DeepSeek 实测
 * - anthropic / gemini：已按官方格式实现，尚未实测（界面上标注「未验证」）
 */
import { net } from 'electron'
import type { ApiProfile, LLMEvent, LLMMessage, TokenUsage } from '@shared/types'

export type Emit = (e: LLMEvent) => void

const IDLE_TIMEOUT_MS = 120_000

function trimBase(u: string) {
  return u.trim().replace(/\/+$/, '')
}

export function openaiUrl(base: string, suffix: '/chat/completions' | '/models'): string {
  const b = trimBase(base)
  if (suffix === '/chat/completions' && /\/chat\/completions$/.test(b)) return b
  if (suffix === '/models' && /\/chat\/completions$/.test(b)) return b.replace(/\/chat\/completions$/, '/models')
  return b + suffix
}

function parseExtra(extra: string): Record<string, unknown> {
  if (!extra.trim()) return {}
  try {
    const o = JSON.parse(extra)
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {}
  } catch {
    throw new Error('「附加请求参数」不是合法的 JSON')
  }
}

/** 逐行读取 SSE 的 data 字段 */
async function* sseLines(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<{ event?: string; data: string }> {
  const reader = body.getReader()
  const dec = new TextDecoder('utf-8')
  let buf = ''
  let event: string | undefined
  let dataLines: string[] = []
  let idle: NodeJS.Timeout | null = null
  let idleHit = false
  const arm = () => {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => {
      idleHit = true
      reader.cancel().catch(() => undefined)
    }, IDLE_TIMEOUT_MS)
  }
  arm()
  try {
    while (true) {
      if (signal.aborted) break
      const { value, done } = await reader.read()
      if (idleHit) throw new Error('接口长时间没有返回数据，已断开')
      if (done) break
      arm()
      buf += dec.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.search(/\r?\n/)) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(buf[nl] === '\r' ? nl + 2 : nl + 1)
        if (line === '') {
          if (dataLines.length) yield { event, data: dataLines.join('\n') }
          dataLines = []
          event = undefined
          continue
        }
        if (line.startsWith(':')) continue
        const idx = line.indexOf(':')
        const field = idx < 0 ? line : line.slice(0, idx)
        let val = idx < 0 ? '' : line.slice(idx + 1)
        if (val.startsWith(' ')) val = val.slice(1)
        if (field === 'data') dataLines.push(val)
        else if (field === 'event') event = val
      }
    }
    if (dataLines.length) yield { event, data: dataLines.join('\n') }
    else if (buf.trim().startsWith('data:')) yield { event, data: buf.trim().slice(5).trim() }
  } finally {
    if (idle) clearTimeout(idle)
  }
}

async function readError(res: Response): Promise<string> {
  let text = ''
  try {
    text = await res.text()
  } catch {
    /* 忽略 */
  }
  let msg = text
  try {
    const j = JSON.parse(text)
    msg = j?.error?.message || j?.message || j?.error || text
    if (typeof msg !== 'string') msg = JSON.stringify(msg)
  } catch {
    /* 非 JSON */
  }
  const hint: Record<number, string> = {
    400: '请求格式有误',
    401: '密钥无效或未填写',
    402: '账户余额不足',
    403: '没有权限访问该模型',
    404: '接口地址或模型名不存在',
    413: '内容过长',
    422: '参数不被接受',
    429: '请求太频繁或额度用尽，请稍后再试',
    500: '服务器内部错误',
    502: '网关错误',
    503: '服务暂时不可用（可能过载）'
  }
  const h = hint[res.status] ? `${hint[res.status]}：` : ''
  return `${h}${String(msg).slice(0, 600) || res.statusText}（HTTP ${res.status}）`
}

function friendlyNetError(e: any): string {
  const s = String(e?.message || e)
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND/i.test(s)) return '找不到服务器，请检查接口地址或网络'
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(s)) return '连接被拒绝，请检查接口地址'
  if (/ERR_INTERNET_DISCONNECTED/i.test(s)) return '网络已断开'
  if (/ERR_CONNECTION_TIMED_OUT|ETIMEDOUT|ERR_TIMED_OUT/i.test(s)) return '连接超时，请检查网络或代理'
  if (/ERR_PROXY/i.test(s)) return '代理连接失败'
  if (/ERR_CERT/i.test(s)) return '证书校验失败'
  return s
}

/* ───────────────── OpenAI 兼容 ───────────────── */

function openaiBody(p: ApiProfile, messages: LLMMessage[], stream: boolean) {
  const body: Record<string, unknown> = {
    model: p.model,
    messages,
    stream,
    temperature: p.temperature,
    top_p: p.topP,
    max_tokens: p.maxTokens
  }
  if (stream) body.stream_options = { include_usage: true }
  if (p.presencePenalty) body.presence_penalty = p.presencePenalty
  if (p.frequencyPenalty) body.frequency_penalty = p.frequencyPenalty
  if (p.thinking === 'off') body.thinking = { type: 'disabled' }
  else if (p.thinking === 'low' || p.thinking === 'high' || p.thinking === 'max') {
    body.thinking = { type: 'enabled' }
    body.reasoning_effort = p.thinking
  }
  return { ...body, ...parseExtra(p.extraBody) }
}

async function streamOpenAI(p: ApiProfile, key: string | null, requestId: string, messages: LLMMessage[], signal: AbortSignal, emit: Emit) {
  const res = await net.fetch(openaiUrl(p.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(openaiBody(p, messages, true)),
    signal
  })
  if (!res.ok) throw Object.assign(new Error(await readError(res)), { status: res.status })
  const ctype = res.headers.get('content-type') || ''
  let finish: string | undefined
  let usage: TokenUsage | undefined
  let model: string | undefined
  if (ctype.includes('application/json')) {
    // 服务端不支持流式时的兜底
    const j: any = await res.json()
    const c = j?.choices?.[0]
    emit({ type: 'delta', requestId, content: c?.message?.content ?? '', reasoning: c?.message?.reasoning_content ?? undefined })
    emit({ type: 'done', requestId, finish: c?.finish_reason, usage: mapOpenAIUsage(j?.usage), model: j?.model })
    return
  }
  if (!res.body) throw new Error('接口没有返回内容')
  let inThink = false
  for await (const { data } of sseLines(res.body, signal)) {
    if (data === '[DONE]') break
    let j: any
    try {
      j = JSON.parse(data)
    } catch {
      continue
    }
    if (j.error) throw new Error(typeof j.error === 'string' ? j.error : j.error.message || JSON.stringify(j.error))
    model = j.model ?? model
    const ch = j.choices?.[0]
    if (ch) {
      const d = ch.delta ?? {}
      let content: string | undefined = typeof d.content === 'string' ? d.content : undefined
      let reasoning: string | undefined = typeof d.reasoning_content === 'string' ? d.reasoning_content : typeof d.reasoning === 'string' ? d.reasoning : undefined
      // 部分模型把思考放在 <think> 标签里
      if (content) {
        const r = splitThink(content, inThink)
        inThink = r.inThink
        content = r.content
        if (r.reasoning) reasoning = (reasoning ?? '') + r.reasoning
      }
      if (content || reasoning) emit({ type: 'delta', requestId, content, reasoning })
      if (ch.finish_reason) finish = ch.finish_reason
    }
    if (j.usage) usage = mapOpenAIUsage(j.usage)
  }
  emit({ type: 'done', requestId, finish, usage, model })
}

function splitThink(chunk: string, inThink: boolean): { content: string; reasoning: string; inThink: boolean } {
  let content = ''
  let reasoning = ''
  let rest = chunk
  while (rest) {
    if (inThink) {
      const end = rest.indexOf('</think>')
      if (end < 0) {
        reasoning += rest
        rest = ''
      } else {
        reasoning += rest.slice(0, end)
        rest = rest.slice(end + 8)
        inThink = false
      }
    } else {
      const start = rest.indexOf('<think>')
      if (start < 0) {
        content += rest
        rest = ''
      } else {
        content += rest.slice(0, start)
        rest = rest.slice(start + 7)
        inThink = true
      }
    }
  }
  return { content, reasoning, inThink }
}

function mapOpenAIUsage(u: any): TokenUsage | undefined {
  if (!u) return undefined
  return {
    prompt: u.prompt_tokens,
    completion: u.completion_tokens,
    reasoning: u.completion_tokens_details?.reasoning_tokens,
    cached: u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens
  }
}

/* ───────────────── Anthropic（未验证） ───────────────── */

function toAnthropic(messages: LLMMessage[]) {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
  const conv: { role: 'user' | 'assistant'; content: string }[] = []
  for (const m of messages) {
    if (m.role === 'system') {
      // 中途的系统消息并入相邻的用户消息
      if (conv.length) {
        const last = conv[conv.length - 1]
        if (last.role === 'user') last.content += `\n\n[系统] ${m.content}`
        else conv.push({ role: 'user', content: `[系统] ${m.content}` })
      }
      continue
    }
    const last = conv[conv.length - 1]
    if (last && last.role === m.role) last.content += '\n\n' + m.content
    else conv.push({ role: m.role, content: m.content })
  }
  if (!conv.length || conv[0].role !== 'user') conv.unshift({ role: 'user', content: '（开始）' })
  return { system, conv }
}

async function streamAnthropic(p: ApiProfile, key: string | null, requestId: string, messages: LLMMessage[], signal: AbortSignal, emit: Emit) {
  const { system, conv } = toAnthropic(messages)
  const body: Record<string, unknown> = { model: p.model, max_tokens: p.maxTokens, messages: conv, stream: true, temperature: p.temperature }
  if (system) body.system = system
  if (p.thinking === 'low' || p.thinking === 'high' || p.thinking === 'max') {
    body.thinking = { type: 'enabled', budget_tokens: p.thinking === 'low' ? 1024 : p.thinking === 'high' ? 4096 : 16000 }
    delete body.temperature
  }
  Object.assign(body, parseExtra(p.extraBody))
  const base = trimBase(p.baseUrl) || 'https://api.anthropic.com'
  const url = /\/messages$/.test(base) ? base : /\/v1$/.test(base) ? base + '/messages' : base + '/v1/messages'
  const res = await net.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', ...(key ? { 'x-api-key': key } : {}) },
    body: JSON.stringify(body),
    signal
  })
  if (!res.ok) throw Object.assign(new Error(await readError(res)), { status: res.status })
  if (!res.body) throw new Error('接口没有返回内容')
  const usage: TokenUsage = {}
  let finish: string | undefined
  let model: string | undefined
  for await (const { data } of sseLines(res.body, signal)) {
    let j: any
    try {
      j = JSON.parse(data)
    } catch {
      continue
    }
    if (j.type === 'error') throw new Error(j.error?.message || '接口返回错误')
    if (j.type === 'message_start') {
      model = j.message?.model
      usage.prompt = j.message?.usage?.input_tokens
    } else if (j.type === 'content_block_delta') {
      if (j.delta?.type === 'text_delta') emit({ type: 'delta', requestId, content: j.delta.text })
      else if (j.delta?.type === 'thinking_delta') emit({ type: 'delta', requestId, reasoning: j.delta.thinking })
    } else if (j.type === 'message_delta') {
      finish = j.delta?.stop_reason ?? finish
      if (j.usage?.output_tokens != null) usage.completion = j.usage.output_tokens
    }
  }
  emit({ type: 'done', requestId, finish, usage, model })
}

/* ───────────────── Gemini（未验证） ───────────────── */

async function streamGemini(p: ApiProfile, key: string | null, requestId: string, messages: LLMMessage[], signal: AbortSignal, emit: Emit) {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
  const contents: { role: 'user' | 'model'; parts: { text: string }[] }[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    const role = m.role === 'assistant' ? 'model' : 'user'
    const last = contents[contents.length - 1]
    if (last && last.role === role) last.parts[0].text += '\n\n' + m.content
    else contents.push({ role, parts: [{ text: m.content }] })
  }
  const generationConfig: Record<string, unknown> = { temperature: p.temperature, topP: p.topP, maxOutputTokens: p.maxTokens }
  if (p.thinking === 'off') generationConfig.thinkingConfig = { thinkingBudget: 0 }
  else if (p.thinking !== 'default') generationConfig.thinkingConfig = { includeThoughts: true, thinkingBudget: p.thinking === 'low' ? 1024 : p.thinking === 'high' ? 8192 : 24576 }
  const body: Record<string, unknown> = { contents, generationConfig, ...parseExtra(p.extraBody) }
  if (system) body.systemInstruction = { parts: [{ text: system }] }
  const base = trimBase(p.baseUrl) || 'https://generativelanguage.googleapis.com'
  const root = /\/v1(beta)?$/.test(base) ? base : base + '/v1beta'
  const url = `${root}/models/${encodeURIComponent(p.model)}:streamGenerateContent?alt=sse`
  const res = await net.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'x-goog-api-key': key } : {}) },
    body: JSON.stringify(body),
    signal
  })
  if (!res.ok) throw Object.assign(new Error(await readError(res)), { status: res.status })
  if (!res.body) throw new Error('接口没有返回内容')
  let usage: TokenUsage | undefined
  let finish: string | undefined
  for await (const { data } of sseLines(res.body, signal)) {
    let j: any
    try {
      j = JSON.parse(data)
    } catch {
      continue
    }
    const cand = j.candidates?.[0]
    for (const part of cand?.content?.parts ?? []) {
      if (typeof part.text !== 'string') continue
      if (part.thought) emit({ type: 'delta', requestId, reasoning: part.text })
      else emit({ type: 'delta', requestId, content: part.text })
    }
    if (cand?.finishReason) finish = cand.finishReason
    if (j.usageMetadata) usage = { prompt: j.usageMetadata.promptTokenCount, completion: j.usageMetadata.candidatesTokenCount, reasoning: j.usageMetadata.thoughtsTokenCount }
  }
  emit({ type: 'done', requestId, finish, usage, model: p.model })
}

/* ───────────────── 对外接口 ───────────────── */

const running = new Map<string, AbortController>()

export async function startStream(p: ApiProfile, key: string | null, requestId: string, messages: LLMMessage[], emit: Emit): Promise<void> {
  const ac = new AbortController()
  running.set(requestId, ac)
  try {
    if (p.provider === 'anthropic') await streamAnthropic(p, key, requestId, messages, ac.signal, emit)
    else if (p.provider === 'gemini') await streamGemini(p, key, requestId, messages, ac.signal, emit)
    else await streamOpenAI(p, key, requestId, messages, ac.signal, emit)
  } catch (e: any) {
    if (ac.signal.aborted) emit({ type: 'done', requestId, finish: 'aborted' })
    else emit({ type: 'error', requestId, message: e?.status ? String(e.message) : friendlyNetError(e), status: e?.status })
  } finally {
    running.delete(requestId)
  }
}

export function abortStream(requestId: string): void {
  running.get(requestId)?.abort()
}

export async function listModels(p: ApiProfile, key: string | null): Promise<string[]> {
  try {
    if (p.provider === 'anthropic') {
      const base = trimBase(p.baseUrl) || 'https://api.anthropic.com'
      const res = await net.fetch((/\/v1$/.test(base) ? base : base + '/v1') + '/models', { headers: { 'anthropic-version': '2023-06-01', ...(key ? { 'x-api-key': key } : {}) } })
      if (!res.ok) throw new Error(await readError(res))
      const j: any = await res.json()
      return (j.data ?? []).map((m: any) => m.id).filter(Boolean)
    }
    if (p.provider === 'gemini') {
      const base = trimBase(p.baseUrl) || 'https://generativelanguage.googleapis.com'
      const root = /\/v1(beta)?$/.test(base) ? base : base + '/v1beta'
      const res = await net.fetch(`${root}/models`, { headers: key ? { 'x-goog-api-key': key } : {} })
      if (!res.ok) throw new Error(await readError(res))
      const j: any = await res.json()
      return (j.models ?? []).map((m: any) => String(m.name).replace(/^models\//, '')).filter(Boolean)
    }
    const res = await net.fetch(openaiUrl(p.baseUrl, '/models'), { headers: key ? { Authorization: `Bearer ${key}` } : {} })
    if (!res.ok) throw new Error(await readError(res))
    const j: any = await res.json()
    const arr = Array.isArray(j) ? j : (j.data ?? j.models ?? [])
    return arr.map((m: any) => (typeof m === 'string' ? m : m.id ?? m.name)).filter(Boolean)
  } catch (e: any) {
    throw new Error(e?.message?.includes('HTTP') ? e.message : friendlyNetError(e))
  }
}

/** 连接测试：发一句很短的话，返回首字延迟 */
export async function testConnection(p: ApiProfile, key: string | null): Promise<{ ok: boolean; ms?: number; text?: string; error?: string }> {
  const t0 = Date.now()
  let first = 0
  let text = ''
  let error: string | undefined
  const probe: ApiProfile = { ...p, maxTokens: 256 }
  await startStream(probe, key, 'test-' + t0, [{ role: 'user', content: '只回复两个字：你好' }], (e) => {
    if (e.type === 'delta') {
      if (!first) first = Date.now()
      if (e.content) text += e.content
    } else if (e.type === 'error') error = e.message
  })
  if (error) return { ok: false, error }
  return { ok: true, ms: (first || Date.now()) - t0, text: text.slice(0, 40) }
}
