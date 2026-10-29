/**
 * 消息富文本渲染：
 * 显示用正则 → 宏 → 自定义标签（状态栏等）→ Markdown → 安全过滤 → 药汤风格后处理
 * 外部内容不能带入样式、脚本或改动界面。
 */
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import type { RegexScript } from '@shared/types'
import { applyRegexScripts } from '@shared/regex'
import { adaptColor } from './color'
import { prepareFrontend } from './frontend'

const md = new MarkdownIt({ html: true, breaks: true, linkify: false, typographer: false })
md.disable(['lheading'])

const INLINE = new Set('font span b i u s em strong small big sup sub mark ruby rt rp q del ins kbd abbr br img a code wbr strike tt'.split(' '))
/** 角色卡里常见的大写格式标签（这些即使大写也按 HTML 处理） */
const CAPS_OK = new Set('b i u s br p hr font div span center details summary em strong img a ul ol li table tr td th blockquote pre code h1 h2 h3 h4'.split(' '))
const CONTAINERS = new Set('details summary div blockquote center section article aside header footer p ul ol li table thead tbody tfoot tr td th h1 h2 h3 h4 h5 h6 hr pre figure figcaption dl dt dd nav main caption colgroup col'.split(' '))
/** 需要药汤接管渲染（内部再按 Markdown 解析）的块级容器 */
const RECURSE_BLOCK = new Set(['details', 'div', 'center', 'section', 'article', 'aside', 'blockquote'])
const DANGEROUS = new Set(['style', 'script', 'iframe', 'object', 'embed', 'link', 'meta', 'form', 'input', 'button', 'textarea', 'select', 'video', 'audio', 'svg', 'math', 'canvas', 'frame', 'frameset', 'base', 'html', 'head', 'body', 'title', 'template', 'noscript'])

export interface RichOptions {
  scripts: RegexScript[]
  macros: (s: string) => string
  placement: 1 | 2
  depth: number
  quotes: boolean
}

interface Ctx {
  blocks: string[]
  codes: string[]
}

const P_BLOCK = (n: number) => `\uE000B${n}\uE000`
const P_INLINE = (n: number) => `\uE000I${n}\uE000`
const P_CODE = (n: number) => `\uE000C${n}\uE000`

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 宽松的 *斜体* / **加粗**：比 CommonMark 更适合中文（与 SillyTavern 习惯一致） */
function lenientEmphasis(s: string): string {
  return s
    .split('\n')
    .map((line) => {
      if (/^\s*([*+-]|\d+\.)\s/.test(line) && !/\*[^*\s][^*]*\*/.test(line.replace(/^\s*[*+-]\s/, ''))) return line
      const lead = line.match(/^(\s*[*+-]\s+)/)?.[0] ?? ''
      let body = line.slice(lead.length)
      body = body.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
      body = body.replace(/(^|[^*\\])\*([^*\s\n][^*\n]*?)\*(?!\*)/g, '$1<em>$2</em>')
      return lead + body
    })
    .join('\n')
}

/** 把 ``` 代码块先取出来，避免里面的尖括号被当成标签 */
function protectCode(s: string, ctx: Ctx): string {
  return s.replace(/(^|\n)([ \t]*)(```|~~~)([^\n]*)\n([\s\S]*?)\n[ \t]*\3[ \t]*(?=\n|$)/g, (_m, pre: string, _ind: string, _f: string, lang: string, body: string) => {
    const n = ctx.codes.length
    ctx.codes.push(`<pre class="yt-code"${lang.trim() ? ` data-lang="${escapeHtml(lang.trim())}"` : ''}><code>${escapeHtml(body)}</code></pre>`)
    return `${pre}\n\n${P_BLOCK(-1 - n)}\n\n`
  })
}

interface TagHit {
  name: string
  start: number
  openEnd: number
  closeStart: number
  end: number
  attrs: string
}

/** 找出最外层的「未知标签对」或需要接管的块级容器 */
function findTags(s: string): TagHit[] {
  const out: TagHit[] = []
  const re = /<([A-Za-z][\w:-]*)(\s[^<>]*?)?(\/)?>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    const name = m[1]
    const lower = name.toLowerCase()
    if (m[3]) continue // 自闭合
    // 首字母大写的标签（如 <Time>、<Status>）视为卡片自定义标签
    const custom = /[A-Z]/.test(name) && !CAPS_OK.has(lower) && !DANGEROUS.has(lower)
    const known = !custom && (INLINE.has(lower) || CONTAINERS.has(lower) || DANGEROUS.has(lower))
    if (known && !RECURSE_BLOCK.has(lower)) continue
    // 寻找对应的闭合标签（处理同名嵌套）
    const openRe = new RegExp(`<${name}(\\s[^<>]*?)?>`, 'gi')
    const closeRe = new RegExp(`</${name}\\s*>`, 'gi')
    let depth = 1
    let pos = re.lastIndex
    let closeStart = -1
    let end = -1
    while (depth > 0) {
      openRe.lastIndex = pos
      closeRe.lastIndex = pos
      const o = openRe.exec(s)
      const c = closeRe.exec(s)
      if (!c) break
      if (o && o.index < c.index) {
        depth++
        pos = o.index + o[0].length
      } else {
        depth--
        pos = c.index + c[0].length
        if (depth === 0) {
          closeStart = c.index
          end = pos
        }
      }
    }
    if (end < 0) continue
    out.push({ name, start: m.index, openEnd: re.lastIndex, closeStart, end, attrs: m[2] ?? '' })
    re.lastIndex = end
  }
  return out
}

function isInlinePosition(s: string, h: TagHit): boolean {
  const lineStart = s.lastIndexOf('\n', h.start - 1) + 1
  let lineEnd = s.indexOf('\n', h.end)
  if (lineEnd < 0) lineEnd = s.length
  const before = s.slice(lineStart, h.start).trim()
  const after = s.slice(h.end, lineEnd).trim()
  const inner = s.slice(h.openEnd, h.closeStart)
  return (before !== '' || after !== '') && !inner.includes('\n')
}

function renderTags(s: string, ctx: Ctx, opts: RichOptions): string {
  const hits = findTags(s)
  if (!hits.length) return s
  let out = ''
  let last = 0
  for (const h of hits) {
    out += s.slice(last, h.start)
    const inner = s.slice(h.openEnd, h.closeStart)
    const lower = h.name.toLowerCase()
    const isCustom = /[A-Z]/.test(h.name) && !CAPS_OK.has(lower)
    if (isInlinePosition(s, h) && (isCustom || !RECURSE_BLOCK.has(lower))) {
      const n = ctx.blocks.length
      ctx.blocks.push(`<span class="yt-itag" data-tag="${escapeHtml(h.name)}">${md.renderInline(lenientEmphasis(renderTags(inner, ctx, opts)))}</span>`)
      out += P_INLINE(n)
    } else {
      const n = ctx.blocks.length
      ctx.blocks.push('')
      ctx.blocks[n] = renderContainer(h, inner, ctx, opts)
      out += `\n\n${P_BLOCK(n)}\n\n`
    }
    last = h.end
  }
  out += s.slice(last)
  return out
}

function renderContainer(h: TagHit, inner: string, ctx: Ctx, opts: RichOptions): string {
  const lower = /[A-Z]/.test(h.name) && !CAPS_OK.has(h.name.toLowerCase()) ? '\u0001custom' : h.name.toLowerCase()
  if (lower === 'details') {
    let summary = ''
    const body = inner.replace(/<summary(\s[^>]*)?>([\s\S]*?)<\/summary\s*>/i, (_m, _a, t: string) => {
      summary = t
      return ''
    })
    const open = /\bopen\b/i.test(h.attrs)
    return `<details class="yt-details"${open ? ' open' : ''}><summary>${summary.trim() ? md.renderInline(lenientEmphasis(summary.trim())) : '展开'}</summary><div class="yt-details-body">${renderBody(body, ctx, opts)}</div></details>`
  }
  if (lower === 'blockquote') return `<blockquote>${renderBody(inner, ctx, opts)}</blockquote>`
  if (RECURSE_BLOCK.has(lower)) {
    const center = lower === 'center' || /align\s*=\s*["']?center/i.test(h.attrs) || /text-align\s*:\s*center/i.test(h.attrs)
    return `<div class="yt-box${center ? ' yt-center' : ''}">${renderBody(inner, ctx, opts)}</div>`
  }
  if (lower === 'think' || lower === 'thinking' || lower === 'reasoning') {
    return `<details class="yt-details yt-think"><summary>思绪</summary><div class="yt-details-body">${renderBody(inner, ctx, opts)}</div></details>`
  }
  const text = inner.trim()
  const plain = text.replace(/\uE000[BIC]-?\d+\uE000/g, '')
  if (!text.includes('\n') && plain.length <= 48 && !/\uE000B/.test(text)) {
    return `<div class="yt-field" data-tag="${escapeHtml(h.name)}"><span class="yt-field-k">${escapeHtml(h.name)}</span><span class="yt-field-v">${md.renderInline(lenientEmphasis(renderTags(text, ctx, opts)))}</span></div>`
  }
  return `<div class="yt-tag" data-tag="${escapeHtml(h.name)}"><div class="yt-tag-label">${escapeHtml(h.name)}</div><div class="yt-tag-body">${renderBody(inner, ctx, opts)}</div></div>`
}

function renderBody(s: string, ctx: Ctx, opts: RichOptions): string {
  let t = renderTags(s, ctx, opts)
  t = lenientEmphasis(t)
  let html = md.render(t)
  // 还原占位符（块级的会被包在 <p> 里）
  for (let pass = 0; pass < 6 && /\uE000[BI]-?\d+\uE000/.test(html); pass++) {
    html = html.replace(/<p>\s*\uE000B(-?\d+)\uE000\s*<\/p>/g, (_m, n: string) => blockAt(ctx, Number(n)))
    html = html.replace(/\uE000B(-?\d+)\uE000/g, (_m, n: string) => blockAt(ctx, Number(n)))
    html = html.replace(/\uE000I(\d+)\uE000/g, (_m, n: string) => ctx.blocks[Number(n)] ?? '')
  }
  return html
}

const blockAt = (ctx: Ctx, n: number) => (n < 0 ? ctx.codes[-1 - n] ?? '' : ctx.blocks[n] ?? '')

/* ───────── 安全过滤与后处理 ───────── */

const ALLOWED_TAGS = [...INLINE, ...CONTAINERS, 'details', 'summary'].filter((t) => !DANGEROUS.has(t))
DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if (data.attrName === 'style') {
    const m = data.attrValue.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)
    if (m) (node as Element).setAttribute('data-color', m[1].trim())
    data.keepAttr = false
  }
  if (data.attrName === 'class' && !/^yt-[\w-]+(\s+yt-[\w-]+)*$/.test(data.attrValue)) data.keepAttr = false
})

const PURIFY_CFG = {
  ALLOWED_TAGS,
  ALLOWED_ATTR: ['color', 'href', 'title', 'open', 'colspan', 'rowspan', 'data-tag', 'data-color', 'data-lang', 'class', 'alt', 'src', 'align'],
  ALLOW_DATA_ATTR: false,
  KEEP_CONTENT: true,
  FORBID_TAGS: [...DANGEROUS]
}

const QUOTE_RE = /(“[^“”\n]{1,400}”|「[^「」\n]{1,400}」|『[^『』\n]{1,400}』|"[^"\n]{1,400}")/g

function postProcess(html: string, opts: RichOptions): string {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const root = tpl.content
  // 颜色适配
  root.querySelectorAll('font[color], [data-color]').forEach((el) => {
    const c = el.getAttribute('color') ?? el.getAttribute('data-color') ?? ''
    const adapted = adaptColor(c)
    el.removeAttribute('color')
    el.removeAttribute('data-color')
    if (adapted) (el as HTMLElement).style.color = adapted
  })
  root.querySelectorAll('font').forEach((el) => {
    const span = document.createElement('span')
    span.className = 'yt-font'
    if ((el as HTMLElement).style.color) span.style.color = (el as HTMLElement).style.color
    while (el.firstChild) span.appendChild(el.firstChild)
    el.replaceWith(span)
  })
  // 外部图片：不自动加载（隐私与界面一致性）
  root.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') ?? ''
    if (!/^(data:image\/|yt-data:)/i.test(src)) {
      const s = document.createElement('span')
      s.className = 'yt-img-blocked'
      s.title = src
      s.textContent = img.getAttribute('alt') ? `［图片：${img.getAttribute('alt')}］` : '［外部图片未加载］'
      img.replaceWith(s)
    }
  })
  // 链接：只保留 http(s)
  root.querySelectorAll('a').forEach((a) => {
    const href = a.getAttribute('href') ?? ''
    if (!/^https?:\/\//i.test(href)) a.removeAttribute('href')
  })
  // 连续的短字段合并成网格
  const groupFields = (parent: ParentNode) => {
    const kids = Array.from(parent.children)
    let run: Element[] = []
    const flushRun = () => {
      if (run.length >= 2) {
        const grid = document.createElement('div')
        grid.className = 'yt-fields'
        run[0].before(grid)
        run.forEach((r) => grid.appendChild(r))
      }
      run = []
    }
    for (const k of kids) {
      if (k.classList.contains('yt-field')) run.push(k)
      else {
        flushRun()
        if (k.children.length) groupFields(k)
      }
    }
    flushRun()
  }
  groupFields(root)
  // 对白高亮
  if (opts.quotes) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const targets: Text[] = []
    let n: Node | null
    while ((n = walker.nextNode())) {
      const p = (n as Text).parentElement
      if (p && p.closest('pre, code, .yt-field-k, .yt-tag-label, summary')) continue
      QUOTE_RE.lastIndex = 0
      if (QUOTE_RE.test((n as Text).data)) targets.push(n as Text)
    }
    for (const t of targets) {
      const frag = document.createDocumentFragment()
      let last = 0
      const s = t.data
      QUOTE_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = QUOTE_RE.exec(s))) {
        if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)))
        const span = document.createElement('span')
        span.className = 'yt-dlg'
        span.textContent = m[0]
        frag.appendChild(span)
        last = m.index + m[0].length
      }
      if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)))
      t.replaceWith(frag)
    }
  }
  const div = document.createElement('div')
  div.appendChild(root)
  return div.innerHTML
}

const cache = new Map<string, string>()

export function renderRich(raw: string, opts: RichOptions): string {
  let s = applyRegexScripts(raw ?? '', opts.scripts, { placement: opts.placement, isMarkdown: true, depth: opts.depth, macros: opts.macros })
  s = opts.macros(s)
  const key = `${opts.quotes ? 1 : 0}|${s}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  s = s.replace(/<!--[\s\S]*?-->/g, '').replace(/<!--[\s\S]*$/, '')
  s = s.replace(/\r\n?/g, '\n')
  s = prepareFrontend(s)
  const ctx: Ctx = { blocks: [], codes: [] }
  s = protectCode(s, ctx)
  let html = renderBody(s, ctx, opts)
  html = DOMPurify.sanitize(html, PURIFY_CFG) as unknown as string
  html = postProcess(html, opts)
  if (cache.size > 400) cache.delete(cache.keys().next().value!)
  cache.set(key, html)
  return html
}

export function plainText(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*?([^*]+)\*\*?/g, '$1')
    .trim()
}
