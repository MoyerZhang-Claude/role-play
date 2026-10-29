// 生成应用图标：32×32 像素画（皮革底、金边烧瓶、朱砂药汤），放大为多尺寸 ICO
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const N = 32
const P = {
  K: [30, 18, 10, 255],
  L: [59, 39, 25, 255],
  l: [82, 58, 38, 255],
  G: [222, 178, 82, 255],
  g: [160, 116, 40, 255],
  W: [250, 240, 214, 255],
  R: [196, 71, 58, 255],
  r: [128, 34, 26, 255],
  o: [244, 150, 100, 255],
  y: [255, 222, 140, 255],
  d: [44, 30, 20, 255]
}

function grid() {
  const g = Array.from({ length: N }, () => Array(N).fill('.'))
  // 圆角方块（皮革）
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const inR = (cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r
      const rr = 5
      const inside = x >= 1 && x <= 30 && y >= 1 && y <= 30 && !(x < 1 + rr && y < 1 + rr && !inR(1 + rr, 1 + rr, rr)) && !(x > 30 - rr && y < 1 + rr && !inR(30 - rr, 1 + rr, rr)) && !(x < 1 + rr && y > 30 - rr && !inR(1 + rr, 30 - rr, rr)) && !(x > 30 - rr && y > 30 - rr && !inR(30 - rr, 30 - rr, rr))
      if (inside) g[y][x] = 'L'
    }
  // 描边
  const copy = g.map((r) => r.slice())
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (copy[y][x] !== 'L') continue
      const edge = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ].some(([dx, dy]) => copy[y + dy]?.[x + dx] !== 'L')
      if (edge) g[y][x] = 'K'
      else if (y < 10 && x > 3 && x < 28 && (x + y) % 7 === 0) g[y][x] = 'l'
    }
  // 烧瓶：瓶身圆心 (15.5, 20) 半径 8；瓶颈 x 13..18，y 5..12
  const cx = 15.5
  const cy = 20
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - cx, y - cy)
      const neck = x >= 13 && x <= 18 && y >= 6 && y <= 13
      const lip = x >= 12 && x <= 19 && y >= 4 && y <= 5
      if (d <= 8.6 && d > 7.4) g[y][x] = 'G'
      else if (d <= 7.4) {
        if (y >= 18) {
          const shade = x > cx + 3 || y > 25
          g[y][x] = shade ? 'r' : 'R'
          if ((x === 11 || x === 12) && y >= 20 && y <= 22) g[y][x] = 'o'
        } else g[y][x] = 'd'
        if (y === 18) g[y][x] = 'o'
      }
      if (neck) {
        const border = x === 13 || x === 18
        if (border && !(d <= 7.4)) g[y][x] = 'G'
        else if (!(d <= 8.6) || y < 13) g[y][x] = 'd'
      }
      if (lip) g[y][x] = y === 4 ? 'G' : 'g'
    }
  // 玻璃高光、气泡、星光
  ;[
    [10, 15],
    [10, 16],
    [11, 14]
  ].forEach(([x, y]) => (g[y][x] = 'W'))
  ;[
    [16, 15, 'y'],
    [15, 11, 'y'],
    [17, 8, 'y'],
    [19, 22, 'y'],
    [16, 24, 'o']
  ].forEach(([x, y, c]) => (g[y][x] = c))
  ;[
    [24, 6],
    [25, 7],
    [23, 7],
    [24, 8],
    [6, 9]
  ].forEach(([x, y]) => (g[y][x] = 'y'))
  // 底部阴影
  for (let x = 10; x <= 21; x++) if (g[29][x] === 'L') g[29][x] = 'K'
  return g
}

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return ~c >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

function render(g, size) {
  const buf = Buffer.alloc(size * size * 4)
  if (size >= N) {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const ch = g[Math.floor((y * N) / size)][Math.floor((x * N) / size)]
        const c = P[ch] ?? [0, 0, 0, 0]
        buf.set(c, (y * size + x) * 4)
      }
  } else {
    // 缩小：按面积平均（预乘）
    const f = N / size
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        let r = 0,
          gg = 0,
          b = 0,
          a = 0,
          n = 0
        for (let sy = Math.floor(y * f); sy < Math.floor((y + 1) * f); sy++)
          for (let sx = Math.floor(x * f); sx < Math.floor((x + 1) * f); sx++) {
            const c = P[g[sy][sx]] ?? [0, 0, 0, 0]
            r += c[0] * c[3]
            gg += c[1] * c[3]
            b += c[2] * c[3]
            a += c[3]
            n++
          }
        const o = (y * size + x) * 4
        buf[o] = a ? r / a : 0
        buf[o + 1] = a ? gg / a : 0
        buf[o + 2] = a ? b / a : 0
        buf[o + 3] = a / n
      }
  }
  return png(size, size, buf)
}

const g = grid()
const sizes = [256, 128, 64, 48, 32, 24, 16]
const pngs = sizes.map((s) => render(g, s))
// ICO 容器（条目内嵌 PNG）
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(sizes.length, 4)
const dir = Buffer.alloc(16 * sizes.length)
let offset = 6 + dir.length
sizes.forEach((s, i) => {
  const o = i * 16
  dir[o] = s >= 256 ? 0 : s
  dir[o + 1] = s >= 256 ? 0 : s
  dir[o + 2] = 0
  dir[o + 3] = 0
  dir.writeUInt16LE(1, o + 4)
  dir.writeUInt16LE(32, o + 6)
  dir.writeUInt32LE(pngs[i].length, o + 8)
  dir.writeUInt32LE(offset, o + 12)
  offset += pngs[i].length
})
fs.mkdirSync(path.join(root, 'build'), { recursive: true })
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), Buffer.concat([header, dir, ...pngs]))
fs.writeFileSync(path.join(root, 'build', 'icon.png'), pngs[0])
console.log('icon written', sizes.join(','))
