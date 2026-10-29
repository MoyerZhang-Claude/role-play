/**
 * 自定义角色的「印章头像」：羊皮纸底、墨线框、名字首字的毛笔字、淡淡的法阵和一枚朱砂像素印。
 */
function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export async function makeSigilAvatar(name: string): Promise<Uint8Array> {
  const W = 600
  const H = 800
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const x = c.getContext('2d')!
  let seed = hash(name || '无名')
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  // 纸
  const g = x.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H / 2, W * 0.8)
  g.addColorStop(0, '#f6ecd4')
  g.addColorStop(0.7, '#ead9b4')
  g.addColorStop(1, '#c9a978')
  x.fillStyle = g
  x.fillRect(0, 0, W, H)
  const img = x.getImageData(0, 0, W, H)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14
    img.data[i] += n
    img.data[i + 1] += n
    img.data[i + 2] += n * 0.8
  }
  x.putImageData(img, 0, 0)

  // 法阵
  x.save()
  x.translate(W / 2, H * 0.44)
  x.strokeStyle = 'rgba(43,33,24,0.22)'
  x.lineWidth = 2
  for (const r of [230, 212, 150]) {
    x.beginPath()
    x.arc(0, 0, r, 0, Math.PI * 2)
    x.stroke()
  }
  const k = 5 + Math.floor(rnd() * 4)
  x.beginPath()
  for (let i = 0; i <= k; i++) {
    const a = (i * 2 * Math.PI * Math.floor(k / 2)) / k - Math.PI / 2
    const px = Math.cos(a) * 212
    const py = Math.sin(a) * 212
    if (i === 0) x.moveTo(px, py)
    else x.lineTo(px, py)
  }
  x.stroke()
  x.lineWidth = 1.5
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    x.save()
    x.rotate(a)
    x.translate(0, -221)
    x.beginPath()
    const t = Math.floor(rnd() * 4)
    if (t === 0) {
      x.moveTo(-4, -4)
      x.lineTo(4, 4)
      x.moveTo(4, -4)
      x.lineTo(-4, 4)
    } else if (t === 1) x.arc(0, 0, 4, 0, Math.PI * 2)
    else if (t === 2) {
      x.moveTo(0, -5)
      x.lineTo(0, 5)
      x.moveTo(-4, 0)
      x.lineTo(4, 0)
    } else {
      x.moveTo(-4, 4)
      x.lineTo(0, -5)
      x.lineTo(4, 4)
    }
    x.stroke()
    x.restore()
  }
  x.restore()

  // 名字首字
  const ch = Array.from(name.trim() || '无')[0]
  await document.fonts.load("300px 'Ma Shan Zheng'", ch)
  x.fillStyle = '#2b2118'
  x.textAlign = 'center'
  x.textBaseline = 'middle'
  x.font = "290px 'Ma Shan Zheng', 'KaiTi', serif"
  x.shadowColor = 'rgba(43,33,24,0.35)'
  x.shadowBlur = 6
  x.fillText(ch, W / 2, H * 0.45)
  x.shadowBlur = 0

  // 名字
  x.font = "44px 'LXGW WenKai Screen', 'KaiTi', serif"
  x.fillStyle = '#4d3d2d'
  x.fillText(name.trim().slice(0, 12) || '无名', W / 2, H * 0.82)

  // 边框
  x.strokeStyle = 'rgba(43,33,24,0.75)'
  x.lineWidth = 3
  x.strokeRect(22, 22, W - 44, H - 44)
  x.lineWidth = 1
  x.strokeRect(34, 34, W - 68, H - 68)

  // 朱砂像素印
  const seal = 9
  const px = 8
  const sx = W - 34 - seal * px - 26
  const sy = H - 34 - seal * px - 26
  x.fillStyle = '#a3322a'
  for (let yy = 0; yy < seal; yy++)
    for (let xx = 0; xx < seal; xx++) {
      const edge = yy === 0 || xx === 0 || yy === seal - 1 || xx === seal - 1
      const inner = !edge && rnd() < 0.42
      if (edge || inner) {
        x.globalAlpha = 0.75 + rnd() * 0.25
        x.fillRect(sx + xx * px, sy + yy * px, px, px)
      }
    }
  x.globalAlpha = 1

  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}
