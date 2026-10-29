// 全部为开源字体（SIL OFL），随程序分发
import 'lxgw-wenkai-screen-webfont/lxgwwenkaigbscreen.css'
import '@fontsource/ma-shan-zheng/400.css'
import '@fontsource/cinzel/400.css'
import '@fontsource/cinzel/600.css'
import '@fontsource/cinzel/700.css'
import '@fontsource/im-fell-english/400.css'
import '@fontsource/im-fell-english/400-italic.css'
import '@fontsource/silkscreen/400.css'
import '@fontsource/noto-serif-sc/400.css'
import '@fontsource/noto-serif-sc/600.css'

/** 预先加载开场与首页要用到的字形 */
export async function preloadFonts(): Promise<void> {
  const tasks = [
    "64px 'Ma Shan Zheng'",
    "16px 'LXGW WenKai Screen'",
    "600 16px 'Cinzel'",
    "16px 'IM Fell English'",
    "16px 'Silkscreen'"
  ]
  const sample = '药汤书斋对话设置卷宗导入新建角色 YAOTANG Apothecary 0123'
  try {
    await Promise.all(tasks.map((f) => document.fonts.load(f, sample)))
  } catch {
    /* 字体加载失败时用后备字体 */
  }
}
