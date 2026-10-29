/**
 * 「前端卡」常见写法的预处理（两种显示方式共用）：
 * SillyTavern 的酒馆助手扩展会把 ```html 代码块里的整页 HTML 当成界面渲染，
 * 不装扩展时则显示成代码。药汤不运行脚本，但把这类代码块拆开、按内容显示，
 * 比一大段源代码更接近作者的本意。
 */

const FENCE = /^(\s{0,3})(`{3,}|~{3,})(.*)$/

/**
 * 修正「结束的 ``` 后面直接接了正文」：Markdown 要求结束围栏独占一行，
 * 否则代码块一直延续到消息末尾，把后面的内容都变成代码。
 */
export function fixGluedFences(s: string): string {
  if (!s.includes('```') && !s.includes('~~~')) return s
  const lines = s.split('\n')
  let open: string | null = null
  const out: string[] = []
  for (const line of lines) {
    const m = line.match(FENCE)
    if (!m) {
      out.push(line)
      continue
    }
    const [, indent, mark, rest] = m
    if (open == null) {
      open = mark[0]
      out.push(line)
    } else if (mark[0] === open) {
      open = null
      if (rest.trim()) {
        // 结束围栏后面还有内容：拆成两行
        out.push(indent + mark)
        out.push(rest.replace(/^\s+/, ''))
      } else out.push(line)
    } else out.push(line)
  }
  return out.join('\n')
}

const PAGE_HTML = /<(!doctype|html|head|body|style|div|section|article|table|details|main|header|footer|span|p|br|ul|ol|h[1-6])\b/i

/** 把 ```html（或不标语言但内容是网页）的代码块拆开，按内容显示 */
export function unwrapHtmlFences(s: string): string {
  if (!s.includes('```') && !s.includes('~~~')) return s
  return s.replace(/^(\s{0,3})(`{3,}|~{3,})[ \t]*(html|htm|xhtml)?[ \t]*\n([\s\S]*?)\n\s{0,3}\2[ \t]*$/gim, (all, _i: string, _m: string, lang: string | undefined, body: string) => {
    if (!PAGE_HTML.test(body)) return all
    // 不标语言的代码块，只有明显是整页网页时才拆
    if (!lang && !/<(!doctype|html|body|style)\b/i.test(body)) return all
    return '\n' + body.replace(/^[ \t]+(?=<)/gm, '') + '\n'
  })
}

export function prepareFrontend(s: string): string {
  return unwrapHtmlFences(fixGluedFences(s))
}
