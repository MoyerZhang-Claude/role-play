import type { YtApi } from '../../../preload/api'

export const yt: YtApi = window.yt

export const dataUrl = (rel: string, v?: number | string) => `yt-data://local/${rel.split('/').map(encodeURIComponent).join('/')}${v != null ? `?v=${v}` : ''}`

export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number) {
  let t: number | undefined
  const d = (...a: Parameters<T>) => {
    window.clearTimeout(t)
    t = window.setTimeout(() => fn(...a), ms)
  }
  d.flush = (...a: Parameters<T>) => {
    window.clearTimeout(t)
    fn(...a)
  }
  return d as T & { flush: T }
}

export function relTime(ts: number): string {
  const d = Date.now() - ts
  const m = Math.floor(d / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const days = Math.floor(h / 24)
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  const dt = new Date(ts)
  return `${dt.getFullYear()}.${dt.getMonth() + 1}.${dt.getDate()}`
}

export function clock(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
