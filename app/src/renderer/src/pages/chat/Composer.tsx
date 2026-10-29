import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { useChats } from '../../state/chats'
import { useSettings } from '../../state/settings'
import { go } from '../../state/router'
import { Icon } from '../../icons/Icon'
import { MagicCircle } from '../../components/ui'
import { audio } from '../../audio/engine'

const drafts = new Map<string, string>()

export interface ComposerHandle {
  focus(): void
}

export const Composer = forwardRef<ComposerHandle, { chatId: string; userName: string; busy: boolean; canRetry: boolean; canContinue: boolean }>(function Composer({ chatId, userName, busy, canRetry, canContinue }, ref) {
  const [text, setText] = useState(() => drafts.get(chatId) ?? '')
  const ta = useRef<HTMLTextAreaElement>(null)
  const profile = useSettings((s) => s.s.api.profiles.find((p) => p.id === s.s.api.activeProfileId) ?? s.s.api.profiles[0])
  const [stamp, setStamp] = useState(0)
  const imp = useChats((st) => (st.imp?.chatId === chatId ? st.imp : null))

  // 代写：AI 写出的文字流进输入框，写完后留给你修改再发送
  useEffect(() => {
    if (!imp) return
    update(imp.text)
    if (!imp.busy) {
      useChats.getState().clearImp()
      requestAnimationFrame(() => {
        const el = ta.current
        if (el) {
          el.focus()
          el.setSelectionRange(el.value.length, el.value.length)
        }
      })
    }
  }, [imp?.text, imp?.busy])

  useImperativeHandle(ref, () => ({ focus: () => ta.current?.focus() }))

  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.38))}px`
  }, [text])

  const update = (v: string) => {
    setText(v)
    drafts.set(chatId, v)
  }

  const send = () => {
    if (busy) return
    const t = text
    if (!t.trim() && !canRetry) {
      audio.softClick()
      return
    }
    setStamp((x) => x + 1)
    update('')
    useChats.getState().send(t)
  }

  return (
    <div className="composer">
      <div className={`composer-inner ${busy ? 'busy' : ''}`}>
        <textarea
          ref={ta}
          className="composer-input selectable"
          value={text}
          rows={1}
          spellCheck={false}
          placeholder={`以「${userName}」之名落笔……`}
          readOnly={!!imp?.busy}
          onChange={(e) => update(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            // 输入法组词中：不处理
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault()
              document.execCommand('insertText', false, '\n')
              return
            }
            if (e.shiftKey) return
            e.preventDefault()
            send()
          }}
        />
        <div className="composer-bar">
          <span className="composer-tools">
            <button className="tool-btn" data-sfx="soft" data-tip="让 AI 接着上一条回复继续写" disabled={busy || !canContinue || !!imp?.busy} onClick={() => useChats.getState().continueLast()}>
              <Icon name="quill" /> 续写
            </button>
            <button
              className={`tool-btn ${imp?.busy ? 'on' : ''}`}
              data-sfx="soft"
              data-tip={imp?.busy ? '停止代写' : `让 AI 替「${userName}」写一句，写进输入框`}
              disabled={busy}
              onClick={() => (imp?.busy ? useChats.getState().stopImpersonate() : useChats.getState().impersonate())}
            >
              <Icon name={imp?.busy ? 'stop' : 'user'} /> {imp?.busy ? '停止' : '代写'}
            </button>
          </span>
          <span className="composer-hint t-small">
            <kbd className="kbd">Enter</kbd> 发送 · <kbd className="kbd">Ctrl</kbd>+<kbd className="kbd">Enter</kbd> 换行
          </span>
          <button className="composer-model t-small" data-sfx="soft" data-tip="接口设置" onClick={() => go({ name: 'settings', tab: 'api' })}>
            <Icon name="sparkle" /> {profile?.model || '未配置接口'}
          </button>
          {busy ? (
            <button className="seal-btn stop" data-sfx="back" data-fx="ink" data-tip="停止书写" aria-label="停止" onClick={() => useChats.getState().stop()}>
              <MagicCircle size={44} strokeWidth={2} runes={10} className="seal-ring" />
              <Icon name="stop" />
            </button>
          ) : (
            <button key={stamp} className={`seal-btn ${stamp ? 'stamped' : ''}`} data-sfx="none" data-tip="落印发送" aria-label="发送" onClick={send}>
              <span className="seal-wax" />
              <Icon name="send" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
})
