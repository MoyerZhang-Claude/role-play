/** 短而有序的 ID：时间戳 + 随机数（base36） */
export function newId(prefix = ''): string {
  const t = Date.now().toString(36)
  let r = ''
  for (let i = 0; i < 6; i++) r += Math.floor(Math.random() * 36).toString(36)
  return prefix + t + r
}
