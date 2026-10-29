import { useEffect, useRef } from 'react'
import { useUI } from '../state/ui'
import { MagicCircle } from '../components/ui'
import { importFiles } from '../lib/importer'
import { audio } from '../audio/engine'

/** 拖文件进窗口时出现的召唤阵 */
export function DropOverlay() {
  const active = useUI((s) => s.dropActive)
  const setDrop = useUI((s) => s.setDrop)
  const depth = useRef(0)
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current++
      if (depth.current === 1) audio.hover()
      setDrop(true)
    }
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDrop(false)
    }
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setDrop(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (!files.length) return
      audio.drop()
      const loaded = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })))
      await importFiles(loaded)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [])
  return (
    <div className={`drop-overlay ${active ? 'on' : ''}`} aria-hidden={!active}>
      <div className="drop-inner">
        <MagicCircle size={260} strokeWidth={0.8} runes={32} />
        <div className="drop-text t-display">松手，收入书斋</div>
        <div className="drop-hint">角色卡 PNG / JSON · 世界书 · 正则 · 存档</div>
      </div>
    </div>
  )
}
