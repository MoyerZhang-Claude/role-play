import { memo } from 'react'
import { iconPaths, type IconName } from './pixel'

interface Props {
  name: IconName
  /** 每个像素的倍数（1 = 标准大小） */
  scale?: number
  className?: string
  title?: string
}

/** 像素印章图标：颜色取 currentColor，强调色取 --icon-accent */
export const Icon = memo(function Icon({ name, scale = 1, className, title }: Props) {
  const p = iconPaths(name)
  const size = `calc(var(--px) * ${16 * scale})`
  return (
    <svg className={'px-icon ' + (className ?? '')} width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title ? <title>{title}</title> : null}
      {p.half && <path d={p.half} fill="currentColor" opacity={0.5} />}
      {p.full && <path d={p.full} fill="currentColor" />}
      {p.accent && <path d={p.accent} fill="var(--icon-accent, currentColor)" />}
    </svg>
  )
})
