import { unzlibSync, zlibSync } from 'fflate'

/** 读取 PNG 中的文本块（tEXt / zTXt / iTXt）。键名统一转小写。 */
export function readPngText(buf: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {}
  if (!isPng(buf)) return out
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const latin1 = new TextDecoder('latin1')
  const utf8 = new TextDecoder('utf-8')
  let i = 8
  while (i + 8 <= buf.length) {
    const len = view.getUint32(i)
    const type = latin1.decode(buf.subarray(i + 4, i + 8))
    const body = buf.subarray(i + 8, i + 8 + len)
    if (type === 'tEXt') {
      const z = body.indexOf(0)
      if (z > 0) out[latin1.decode(body.subarray(0, z)).toLowerCase()] = latin1.decode(body.subarray(z + 1))
    } else if (type === 'zTXt') {
      const z = body.indexOf(0)
      if (z > 0) {
        try {
          out[latin1.decode(body.subarray(0, z)).toLowerCase()] = latin1.decode(unzlibSync(body.subarray(z + 2)))
        } catch {
          /* 损坏的压缩块直接跳过 */
        }
      }
    } else if (type === 'iTXt') {
      const z = body.indexOf(0)
      if (z > 0) {
        const key = latin1.decode(body.subarray(0, z)).toLowerCase()
        const compressed = body[z + 1] === 1
        let p = z + 3
        const langEnd = body.indexOf(0, p)
        p = langEnd + 1
        const tkEnd = body.indexOf(0, p)
        p = tkEnd + 1
        try {
          const data = body.subarray(p)
          out[key] = utf8.decode(compressed ? unzlibSync(data) : data)
        } catch {
          /* 跳过 */
        }
      }
    } else if (type === 'IEND') break
    i += 12 + len
  }
  return out
}

export function isPng(buf: Uint8Array): boolean {
  return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
}

/** base64（latin1 文本）→ UTF-8 字符串 */
export function decodeBase64Utf8(b64: string): string {
  const bin = atobSafe(b64.trim())
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

function atobSafe(s: string): string {
  if (typeof atob === 'function') return atob(s)
  // Node 环境
  return Buffer.from(s, 'base64').toString('latin1')
}

/* ───── 写入（导出角色卡用） ───── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array, start = 0xffffffff): number {
  let c = start
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function makeChunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(body, 8)
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)))
  return out
}

/** 由 RGBA 像素生成 PNG（用于生成头像等） */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
  }
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, width)
  v.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = 6
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', zlibSync(raw, { level: 9 })),
    makeChunk('IEND', new Uint8Array(0))
  ]
  const total = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
