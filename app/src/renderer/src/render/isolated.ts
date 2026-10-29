/**
 * 「卡片原样式」显示：保留卡片作者写的 CSS 与 HTML 结构，
 * 但放在独立的 Shadow DOM 里——样式只作用于这一块，碰不到药汤的界面。
 *
 * - 脚本、内嵌网页、表单提交、外部媒体一律移除；
 * - 外部图片、字体、@import 会被应用的内容安全策略拦下（不联网）；
 * - position: fixed 之类被容器 contain 住，不能盖到界面上；
 * - html / body / :root 选择器改写成这一块的根节点。
 */
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import type { RegexScript } from '@shared/types'
import { applyRegexScripts } from '@shared/regex'
import { prepareFrontend } from './frontend'

const md = new MarkdownIt({ html: true, breaks: true, linkify: false, typographer: false })
md.disable(['lheading'])

const purify = DOMPurify(window)
purify.addHook('afterSanitizeAttributes', (node) => {
  const el = node as Element
  if (!el.tagName) return
  const tag = el.tagName.toLowerCase()
  if (tag === 'a') {
    const href = el.getAttribute('href') ?? ''
    if (!/^https?:\/\//i.test(href)) el.removeAttribute('href')
    el.removeAttribute('target')
  } else if (tag === 'img' || tag === 'image') {
    const src = el.getAttribute('src') ?? el.getAttribute('href') ?? ''
    if (src && !/^(data:image\/|yt-data:)/i.test(src)) {
      el.setAttribute('data-yt-blocked', src.slice(0, 200))
      el.removeAttribute('src')
      el.removeAttribute('href')
    }
  } else if (tag === 'input') {
    const t = (el.getAttribute('type') ?? 'text').toLowerCase()
    // 只留下纯 CSS 交互常用的单选 / 复选（比如作者用 :checked 做的标签页）
    if (t !== 'checkbox' && t !== 'radio') el.setAttribute('disabled', '')
  }
})

const CFG = {
  FORCE_BODY: true,
  ADD_TAGS: ['style'],
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'frame', 'frameset', 'noscript', 'audio', 'video', 'source', 'track', 'portal', 'template', 'title'],
  FORBID_ATTR: ['srcset', 'formaction', 'action', 'ping', 'background', 'poster', 'autofocus'],
  ALLOW_DATA_ATTR: true,
  KEEP_CONTENT: true
}

/** 只改写选择器里的 html / body / :root */
export function scopeCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/([^{};]+)\{/g, (m, sel: string) => {
      if (/^\s*@/.test(sel) || /^\s*(from|to|\d+%)\s*$/i.test(sel)) return m
      const out = sel.replace(/(^|[\s,>+~(])(html|body|:root)(?=$|[\s,.:#>[+~)])/gi, '$1.yt-iso')
      return `${out}{`
    })
}

const STYLED_RE = /<style[\s>]|\sstyle\s*=|\sclass\s*=/i

const HTML_TAGS = new Set(
  'a abbr address article aside b bdi bdo blockquote br caption center cite code col colgroup dd del details dfn div dl dt em figcaption figure font footer h1 h2 h3 h4 h5 h6 header hr i img input ins kbd label legend li main mark nav ol p pre q rp rt ruby s samp section small span strike strong sub summary sup table tbody td tfoot th thead tr tt u ul var wbr style'.split(' ')
)

export interface IsoOptions {
  scripts: RegexScript[]
  macros: (s: string) => string
  placement: 1 | 2
  depth: number
}

export interface IsoResult {
  /** 处理后是否带有作者样式；没有的话用药汤风格显示即可 */
  styled: boolean
  html: string
  /**
   * 这条消息里的样式表（已改写选择器）。与 SillyTavern 一样，消息里的 <style> 对整卷对话都生效：
   * 有的卡只在开场白或某一条里写样式，后面的消息只用 class。
   */
  css: string[]
}

const cache = new Map<string, IsoResult>()

export function renderIsolated(raw: string, opts: IsoOptions): IsoResult {
  let s = applyRegexScripts(raw ?? '', opts.scripts, { placement: opts.placement, isMarkdown: true, depth: opts.depth, macros: opts.macros })
  s = opts.macros(s)
  const key = s
  const hit = cache.get(key)
  if (hit) return hit
  s = s.replace(/<!--[\s\S]*?-->/g, '').replace(/<!--[\s\S]*$/, '')
  s = s.replace(/\r\n?/g, '\n')
  s = prepareFrontend(s)
  if (!STYLED_RE.test(s)) {
    const r = { styled: false, html: '', css: [] }
    cache.set(key, r)
    return r
  }
  // 样式表原样取出，免得被 Markdown 拆开
  const styles: string[] = []
  s = s.replace(/<style\b[^>]*>([\s\S]*?)(<\/style>|$)/gi, (_m, css: string) => {
    styles.push(css)
    return `\n\nS${styles.length - 1}\n\n`
  })
  // 没被正则处理掉的自定义标签（如 <Options>）里的纯文字：保留换行，免得几行挤成一段
  s = s.replace(/<([A-Za-z][\w-]*)(\s[^>]*)?>([^<]*)<\/\1\s*>/g, (m, tag: string, attrs: string | undefined, inner: string) =>
    HTML_TAGS.has(tag.toLowerCase()) || !inner.trim().includes('\n') ? m : `<${tag}${attrs ?? ''}>${inner.trim().replace(/\n+/g, '<br>')}</${tag}>`
  )
  // 缩进的 HTML 行不要被当成代码块
  s = s.replace(/^[ \t]+(?=<)/gm, '')
  let html = md.render(s)
  html = html.replace(/<p>\s*S(\d+)\s*<\/p>/g, (_m, n: string) => `<style>${styles[Number(n)] ?? ''}</style>`)
  html = html.replace(/S(\d+)/g, (_m, n: string) => `<style>${styles[Number(n)] ?? ''}</style>`)
  const frag = purify.sanitize(html, { ...CFG, RETURN_DOM_FRAGMENT: true }) as unknown as DocumentFragment
  const css: string[] = []
  frag.querySelectorAll('style').forEach((st) => {
    const t = scopeCss(st.textContent ?? '').trim()
    if (t) css.push(t)
    st.remove()
  })
  frag.querySelectorAll('[data-yt-blocked]').forEach((el) => {
    const span = document.createElement('span')
    span.className = 'yt-img-blocked'
    span.title = el.getAttribute('data-yt-blocked') ?? ''
    span.textContent = el.getAttribute('alt') ? `［图片：${el.getAttribute('alt')}］` : '［外部图片未加载］'
    el.replaceWith(span)
  })
  const box = document.createElement('div')
  box.appendChild(frag)
  const r = { styled: true, html: box.innerHTML, css }
  if (cache.size > 200) cache.delete(cache.keys().next().value!)
  cache.set(key, r)
  return r
}

/** Shadow DOM 里的基础样式：给作者样式一个中性的深色底（多数美化是按深色界面设计的） */
export const ISO_BASE_CSS = `
:host { all: initial; display: block; position: relative; contain: content; overflow: hidden; }
.yt-iso {
  color: var(--c-iso-fg, #dcd6c8);
  font-family: var(--f-chat, serif);
  font-size: var(--chat-fs, 16px);
  line-height: var(--chat-lh, 1.8);
  word-break: break-word;
  overflow-wrap: anywhere;
}
.yt-iso p { margin: 0 0 0.62em; }
.mes_text > :last-child { margin-bottom: 0; }
.yt-iso em, .yt-iso i { color: var(--c-iso-em, #b8ae9c); }
.yt-iso a { color: var(--c-iso-link, #e3b56a); }
.yt-iso img { max-width: 100%; height: auto; }
.yt-iso pre { white-space: pre-wrap; padding: 0.6em 0.8em; background: rgba(255,255,255,0.05); border-radius: 3px; font-family: var(--f-mono, monospace); font-size: 0.88em; }
.yt-iso code { font-family: var(--f-mono, monospace); }
.yt-iso hr { border: none; border-top: 1px solid rgba(255,255,255,0.16); }
.yt-iso blockquote { margin: 0.4em 0; padding-left: 0.9em; border-left: 2px solid rgba(255,255,255,0.2); }
.yt-iso table { border-collapse: collapse; }
.yt-iso .yt-img-blocked { opacity: 0.6; font-size: 0.9em; }
::selection { background: rgba(227, 181, 106, 0.35); }
`
