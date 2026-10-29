/**
 * 主题定义。组件只引用这里产出的 CSS 变量和装饰组件，
 * 以后新增主题只需新写一份 ThemeDefinition。
 */
export type RGB = [number, number, number]

export interface PaperParams {
  /** 纸张底色 / 亮部 / 暗部 / 焦边颜色 */
  base: RGB
  light: RGB
  dark: RGB
  burn: RGB
  /** 斑驳程度 0-1 */
  mottle: number
  /** 纤维强度 0-1 */
  fiber: number
  /** 颗粒 0-1 */
  grain: number
  /** 边缘焦黄范围 0-1 */
  edge: number
  /** 霉斑（foxing）数量 */
  foxing: number
  seed: number
}

export interface ThemeDefinition {
  id: string
  name: string
  description: string
  /** CSS 颜色令牌：键会变成 --c-<key> */
  colors: Record<string, string>
  fonts: {
    body: string
    ui: string
    display: string
    deco: string
    pixel: string
    mono: string
  }
  paper: PaperParams
  /** 画布特效（墨点、光效）使用的颜色 */
  fx: {
    ink: RGB
    inkSoft: RGB
    rubric: RGB
    gold: RGB
    glow: RGB
    userInk: RGB
  }
  /** 装饰元素风格 */
  ornaments: {
    divider: 'fleuron' | 'line'
    frame: 'manuscript' | 'plain'
  }
}
