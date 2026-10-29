/**
 * 粗略的 token 估算（不依赖具体分词器）。
 * 中日韩字符按 0.8 计，其它字符约 3.6 个算 1 个。偏保守，用于上下文预算裁剪。
 * 实际用量以接口返回的 usage 为准。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    if ((c >= 0x3000 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xffef) || (c >= 0x20000 && c <= 0x2fa1f)) cjk++
    else other++
  }
  return Math.ceil(cjk * 0.8 + other / 3.6)
}

export function estimateMessages(msgs: { content: string }[]): number {
  let t = 0
  for (const m of msgs) t += estimateTokens(m.content) + 4
  return t + 3
}
