import { useLibrary } from '../state/library'
import { useChats } from '../state/chats'
import { go } from '../state/router'
import { Button, MagicCircle } from '../components/ui'
import { RecentShelf, useRecentList } from './home/RecentShelf'

/** 「续读」页：所有续读卡片都在这里（书斋只显示一行） */
export function RecentPage() {
  const chars = useLibrary((s) => s.chars)
  const index = useChats((s) => s.index)
  const recent = useRecentList(index, chars)
  return (
    <div className="page recent-page">
      <header className="recent-page-head">
        <div>
          <div className="t-deco">Continua · 续读</div>
          <h1 className="t-display recent-page-title">续读</h1>
          <p className="t-soft">每一卷正在进行的故事都在这里。长按卡片拖动可以排序，拖到上方的焚化阵可以移出续读——对话本身仍保存在角色页的卷册里。</p>
        </div>
        <span className="recent-page-count t-pixel">{recent.length} 卷</span>
      </header>
      {recent.length ? (
        <RecentShelf items={recent} chars={chars} allIds={recent.map((s) => s.id)} grid />
      ) : (
        <div className="home-empty">
          <MagicCircle size={150} strokeWidth={0.8} />
          <div className="home-empty-text">
            <p className="t-display">还没有正在进行的故事</p>
            <p className="t-soft">在书斋里选一位角色，开始第一卷。</p>
            <Button icon="book" onClick={() => go({ name: 'home' })}>
              回到书斋
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
