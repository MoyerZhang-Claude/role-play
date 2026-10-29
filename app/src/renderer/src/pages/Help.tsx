import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { searchHelp, MAX_HITS, type HelpEntry, type HelpHit } from './helpSearch'
import { Icon } from '../icons/Icon'
import type { IconName } from '../icons/pixel'
import { MagicCircle } from '../components/ui'

/**
 * 设置 → 帮助：「药汤手札」。
 * 给第一次用的人：药汤能做什么、不能做什么，以及从 SillyTavern 带来的那些名词。
 * 说法尽量通俗，但不含糊；每个概念都配一句「打个比方」和一段「细说」。
 */

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX']

const CHAPTERS: { id: string; title: string; deco: string; brief: string }[] = [
  { id: 'start', title: '初来乍到', deco: 'Initium', brief: '三步开始第一卷故事' },
  { id: 'terms', title: '名词小词典', deco: 'Lexicon', brief: '角色卡、世界书、预设、正则……' },
  { id: 'prompt', title: '一碗汤的配方', deco: 'Compositio', brief: '每次到底发给了 AI 什么' },
  { id: 'lore', title: '世界书', deco: 'Liber Mundi', brief: '按关键词出现的资料卡' },
  { id: 'preset', title: '预设与正则', deco: 'Formula & Regula', brief: '配方，与自动的查找替换' },
  { id: 'display', title: '两种显示方式', deco: 'Species', brief: '药汤风格与卡片原样式' },
  { id: 'memory', title: '记忆与长对话', deco: 'Memoria', brief: 'AI 为什么会忘事，怎么办' },
  { id: 'scope', title: '能做与不能做', deco: 'Fines', brief: '药汤的边界' },
  { id: 'faq', title: '常见问题', deco: 'Quaestiones', brief: '遇到问题先翻这里' }
]

/**
 * 只滚动页面自己的滚动区域。浏览器自带的 scrollIntoView 会连整个窗口一起推上去，
 * 把标题栏顶出视野。
 */
function scrollToEl(el: HTMLElement | null, mode: 'start' | 'center') {
  if (!el) return
  let p = el.parentElement
  while (p && !(p.scrollHeight > p.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(p).overflowY))) p = p.parentElement
  if (!p) return
  const r = el.getBoundingClientRect()
  const pr = p.getBoundingClientRect()
  const offset = mode === 'start' ? r.top - pr.top - 76 : r.top - pr.top - Math.max(76, (pr.height - r.height) / 2)
  p.scrollTo({ top: p.scrollTop + offset, behavior: 'smooth' })
}

/** 搜索结果点下去以后，对应的词条 / 问答 / 要点打开并闪一下 */
const FocusCtx = createContext<{ sid: string | null; n: number }>({ sid: null, n: 0 })

function useFocusable<T extends HTMLElement>(sid: string, onHit?: () => void) {
  const f = useContext(FocusCtx)
  const ref = useRef<T>(null)
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (f.sid !== sid || !f.n) return
    onHit?.()
    // 等展开后的高度生效再滚动
    let raf = requestAnimationFrame(() => (raf = requestAnimationFrame(() => scrollToEl(ref.current, 'center'))))
    setFlash(true)
    const t = window.setTimeout(() => setFlash(false), 1800)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(t)
    }
  }, [f.n])
  return { ref, flash: flash ? 'help-flash' : '' }
}

export function HelpSection() {
  const [focus, setFocus] = useState<{ sid: string | null; n: number }>({ sid: null, n: 0 })
  const refs = useRef<Record<string, HTMLElement | null>>({})
  const jump = (id: string) => scrollToEl(refs.current[id] ?? null, 'start')
  const toc = () => scrollToEl(refs.current.top ?? null, 'start')
  const reg = (id: string) => (el: HTMLElement | null) => void (refs.current[id] = el)
  const ch = (id: string) => {
    const i = CHAPTERS.findIndex((c) => c.id === id)
    return { no: ROMAN[i], ...CHAPTERS[i], refEl: reg(id), onTop: toc }
  }

  const pick = (e: HelpEntry) => {
    if (e.sid.startsWith('ch:')) jump(e.sid.slice(3))
    else setFocus((f) => ({ sid: e.sid, n: f.n + 1 }))
  }

  return (
    <FocusCtx.Provider value={focus}>
    <div className="help">
      <header className="help-hero" ref={reg('top')}>
        <div className="help-hero-circle" aria-hidden>
          <MagicCircle size={260} strokeWidth={0.6} runes={28} />
        </div>
        <div className="t-deco">Enchiridion · 帮助</div>
        <h2 className="help-hero-title t-display">药汤手札</h2>
        <p className="help-hero-lead">
          药汤是一间安静的书斋：你在这里和 AI 扮演的角色一起写故事。这本手札讲清楚它能做什么、不能做什么，以及那些从 SillyTavern（「酒馆」）带过来的名词到底是什么意思。不必一口气读完，遇到不明白的地方再回来翻就好。
        </p>
      </header>

      <HelpSearch onPick={pick} />

      <nav className="help-index" aria-label="手札目录">
        {CHAPTERS.map((c, i) => (
          <button key={c.id} className="help-index-item" data-sfx="soft" onClick={() => jump(c.id)}>
            <span className="help-seal">{ROMAN[i]}</span>
            <span className="help-index-text">
              <b>{c.title}</b>
              <span>{c.brief}</span>
            </span>
          </button>
        ))}
      </nav>

      {/* ───────── I 初来乍到 ───────── */}
      <Chapter {...ch('start')}>
        <p>药汤本身不含 AI。它负责把角色、设定和聊天记录整理好，交给你选的 AI 服务去写，再把回复漂漂亮亮地呈现出来。所以第一步，是给它接上一位「写手」。</p>
        <ol className="help-steps">
          <Step n={1} icon="key" title="接上 AI">
            「设置 → 接口」选择接口格式，填好密钥（填完离开输入框就会自动保存），点「测试连接」。DeepSeek 已经预先填好地址；用 Gemini 时地址可以不填。
          </Step>
          <Step n={2} icon="user" title="请来一位角色">
            把角色卡（PNG 或 JSON）拖进窗口，或点左侧的「导入」。导入前会给你一份报告，写明哪些内容能用、哪些和原卡效果不同。也可以点「新建」亲手写一位。
          </Step>
          <Step n={3} icon="quill" title="开始一卷故事">
            在角色页点「开始新的一卷」。输入框里按 Enter 发送，Ctrl+Enter 换行。每一卷就是一段独立的对话，自动保存。
          </Step>
        </ol>
        <Figure caption="一句话发出去之后">
          <FlowDiagram />
        </Figure>
        <Tip>
          左侧书脊从上到下是：书斋（所有角色）、续读（正在进行的故事）、世界书、预设、导入、新建，最下面是设置。鼠标侧键可以后退和前进。
        </Tip>
      </Chapter>

      {/* ───────── II 名词小词典 ───────── */}
      <Chapter {...ch('terms')}>
        <p>点开任意一张卡片，可以看到「打个比方」和更专业一点的「细说」。</p>
        <div className="help-terms">
          {TERMS.map((t) => (
            <Term key={t.term} {...t} />
          ))}
        </div>
      </Chapter>

      {/* ───────── III 一碗汤的配方 ───────── */}
      <Chapter {...ch('prompt')}>
        <p>
          AI 没有记忆，也看不到你的屏幕。每次你发出一句话，药汤都会把需要的东西按顺序拼成一份完整的「提示词」一起发过去——就像每次都从头熬一碗汤。AI 读完这碗汤，写出下一段。
        </p>
        <div className="help-split">
          <Figure caption="从上到下，就是发送的顺序">
            <PotionDiagram />
          </Figure>
          <div className="help-split-text">
            <Point title="越靠后，分量越重">
              离聊天记录末尾越近的内容，AI 越容易照着做。所以「历史后指令」和作者备注常被用来放最要紧的要求。
            </Point>
            <Point title="顺序可以换">
              不用预设时，药汤按 SillyTavern 的默认顺序组装；用了预设，就按预设的顺序和开关来。
            </Point>
            <Point title="放不下时，先省略最早的对话">
              设定、世界书和预设始终完整发送；聊天记录从最新的往前装，装不下的最早几条不再发送，由「前情提要」接替。如果连设定本身都放不下，药汤会停下来告诉你是哪几段最大，而不是硬发出去。
            </Point>
            <Point title="自己看一眼">
              对话页右上角的「眼睛」能看到上一次发送的全部内容；输入框旁的小圆环显示用了多少上下文。
            </Point>
          </div>
        </div>
      </Chapter>

      {/* ───────── IV 世界书 ───────── */}
      <Chapter {...ch('lore')}>
        <p>
          世界书是一叠「资料卡」：地点、人物、组织、规则、咒语……每一张写着几个关键词和一段内容。平时它们安安静静地放着，只有聊天里出现了关键词，那一张才会被翻开、一起发给 AI。这样既不浪费字数，又能让 AI 在需要时想起该想起的设定。
        </p>
        <Figure caption="聊到「月光王座」时，那一张资料卡被翻开">
          <LoreDiagram />
        </Figure>
        <div className="help-grid3">
          <MiniCard icon="key" title="关键词">
            最近几条消息（「扫描深度」）里出现关键词，条目就会触发。可以有好几个关键词，也可以用正则写法。
          </MiniCard>
          <MiniCard icon="flame" title="常驻">
            不看关键词，每次都发送。适合世界观总纲、文风要求这类「一直要记得」的内容，但会一直占用字数。
          </MiniCard>
          <MiniCard icon="list" title="优先级与预算">
            同时触发很多条时，按「插入顺序」从高到低放入，直到用完世界书预算（默认占上下文的四分之一），其余的这次不发送。
          </MiniCard>
        </div>
        <div className="help-table">
          <div className="help-table-row head">
            <span>放在哪</span>
            <span>对谁生效</span>
            <span>在哪管理</span>
          </div>
          <div className="help-table-row">
            <span>卡内世界书</span>
            <span>只对这位角色</span>
            <span>角色页 → 世界书</span>
          </div>
          <div className="help-table-row">
            <span>独立世界书 · 绑定</span>
            <span>绑定了它的几位角色</span>
            <span>左侧「世界书」</span>
          </div>
          <div className="help-table-row">
            <span>独立世界书 · 全局</span>
            <span>所有角色、所有对话</span>
            <span>左侧「世界书」打开「全局」</span>
          </div>
        </div>
        <Question q="把一个角色的世界书，用在一个毫不相干的角色身上，会发生什么？">
          <p>
            世界书不会改变角色本身——角色的性格、说话方式、背景仍然来自他自己的角色卡。会变的是：当聊天里出现那本世界书的关键词时，那些设定会被当作「这个世界的事实」发给 AI。
          </p>
          <ul>
            <li>
              <b>关键词撞上了</b>：比如给一位现代都市里的上班族绑定了奇幻世界的世界书，你随口提到「学院」，AI 就可能收到「魔法学院的入学规矩」，于是故事里突然冒出魔法。这叫「串戏」。
            </li>
            <li>
              <b>常驻条目影响最大</b>：常驻条目每次都会发送，不管聊什么。它们会持续把 AI 往那个世界观拉，甚至和角色卡里的设定互相矛盾，AI 只能二选一，表现就会飘忽。
            </li>
            <li>
              <b>白白占用字数</b>：用不上的设定也要算进上下文，挤掉的是你们的聊天记录，长对话里会更早「忘事」。
            </li>
          </ul>
          <p>
            反过来，这也能被善加利用：同一个世界观下的几位角色共用一本世界书，或者把一本「通用文风」「你自己的补充人设」设为全局。原则是——<b>只给角色绑定和他处在同一个世界的书</b>；拿不准时，先在提示词透镜（右上角的眼睛）里看看到底发了什么。
          </p>
        </Question>
        <Tip>
          导入世界书时，药汤会提示「没有关键词也不是常驻的条目永远不会触发」「常驻条目太长可能超出预算」之类的问题。纯文本（.txt）设定也能导入，会变成一条常驻条目。
        </Tip>
      </Chapter>

      {/* ───────── V 预设与正则 ───────── */}
      <Chapter {...ch('preset')}>
        <h4 className="help-h4">
          <Icon name="flask" /> 预设：一份菜谱
        </h4>
        <p>
          同样的食材（角色、世界书、聊天记录），换一份菜谱，做出来的味道就不同。预设规定的是：先放什么、后放什么、要不要加一段「文风要求」或「字数要求」、温度这些参数设多少。它不属于某一位角色，启用后对所有角色生效。
        </p>
        <div className="help-grid3">
          <MiniCard icon="flask" title="在哪">
            左侧书脊「预设」：导入、切换、改名、调整顺序、开关某一段、改写内容。输入框旁会显示当前用的预设。
          </MiniCard>
          <MiniCard icon="user" title="和角色卡的关系">
            角色卡自带的「系统提示词」「历史后指令」默认会替换预设里的同名段落（和酒馆一致），除非预设标了「禁止覆盖」。
          </MiniCard>
          <MiniCard icon="warn" title="不会执行的部分">
            预设里的 EJS 模板（&lt;% %&gt;）和酒馆助手脚本不会运行；导入报告和预设页会把它们标出来。
          </MiniCard>
        </div>
        <h4 className="help-h4">
          <Icon name="rune" /> 正则：自动的查找与替换
        </h4>
        <p>
          正则是一种描述「文字长什么样」的写法。一条正则脚本就是一句规则：「看到这种格式的文字，就把它换成那样」。卡片作者用它做很多事：把回复里的状态栏标签变成精致的面板、把 AI 写的思考过程藏起来、不把旧的状态栏再发给 AI 以节省字数……
        </p>
        <Figure caption="一条「仅显示」的正则：原文不变，只是换个样子给你看">
          <RegexDiagram />
        </Figure>
        <div className="help-grid3">
          <MiniCard icon="eye" title="仅显示">
            只改变你看到的样子，存下来的原文和发给 AI 的内容都不变。界面美化大多是这一种。
          </MiniCard>
          <MiniCard icon="send" title="仅发送">
            只改变发给 AI 的内容，你看到的不变。常用来不发送旧的状态栏、思维链，省字数。
          </MiniCard>
          <MiniCard icon="edit" title="改写原文">
            回复一写完就直接改掉原文，比如统一标点、删掉某些口头禅。改了就是改了，要谨慎。
          </MiniCard>
        </div>
        <Tip>角色卡、预设都可能自带正则：角色的在角色页「正则与显示」，预设的在「预设」页。每一条都可以单独开关。需要运行脚本才能显示的「前端界面」药汤不使用，被它替换的内容会按原文显示。</Tip>
      </Chapter>

      {/* ───────── VI 两种显示方式 ───────── */}
      <Chapter {...ch('display')}>
        <p>很多卡片作者会为自己的角色设计一套界面：深色的状态栏、彩色的面板、特别的字体。药汤给每位角色两种看法，在角色页「正则与显示」里切换。</p>
        <Figure caption="左：药汤风格　右：卡片原样式">
          <DisplayDiagram />
        </Figure>
        <div className="help-grid2">
          <MiniCard icon="book" title="药汤风格（默认）">
            所有内容都按纸墨排版：卡片自带的颜色会被调和到纸上看得清，布局与样式被过滤，状态栏变成药汤风格的方框。读起来统一、安静。
          </MiniCard>
          <MiniCard icon="eye" title="卡片原样式">
            带样式的消息放进一块独立的深色底板，按作者的设计显示；样式只作用于这块底板，碰不到药汤的其它界面。脚本不运行，外部图片和字体不加载。
          </MiniCard>
        </div>
      </Chapter>

      {/* ───────── VII 记忆与长对话 ───────── */}
      <Chapter {...ch('memory')}>
        <p>
          AI 一次能读的字数是有限的，这个上限叫「上下文」，单位是 token（大致是字数，中文一个字约等于 0.6～1 个 token，不同模型不一样）。对话越来越长，总有一天装不下全部聊天记录——这时最早的那些就不再发送，AI 自然也就「不记得」了。
        </p>
        <Figure caption="长对话里，发给 AI 的内容是怎么安排的">
          <MemoryDiagram />
        </Figure>
        <div className="help-grid2">
          <MiniCard icon="book" title="前情提要（自动）">
            在较早的对话快要放不下时，药汤会在后台把它们整理成一段概要，代替原文发送：谁是谁、发生过什么、许下过什么约定、伏笔与悬念。放不下的旧对话全部并入，不会漏掉一段；提要写多长（900–4000 字）在「设置 → 对话与人设」里选。侧记（对话页右上角）里可以查看、修改或重新整理。
          </MiniCard>
          <MiniCard icon="check" title="设定不会被裁掉">
            角色设定、世界书、预设始终完整发送。真正可能被省略的只有很早的聊天原文，而它们有前情提要接替。
          </MiniCard>
        </div>
        <h4 className="help-h4">
          <Icon name="sparkle" /> 让 AI 记得更牢的几个办法
        </h4>
        <ul className="help-list">
          <li>
            <b>重要的设定写进世界书</b>：一直要记得的写成常驻条目；只在特定话题出现的，写成关键词条目。比写在聊天里可靠得多。
          </li>
          <li>
            <b>当前状态写进作者备注</b>：「现在是深夜」「她的左手受了伤」——作者备注每次都会插在最近几条消息附近。
          </li>
          <li>
            <b>上下文开大一点</b>：「设置 → 接口」里的「上下文预算」，获取模型列表后可以一键设为模型上限。越大越连贯，也越费。
          </li>
          <li>
            <b>别让太长的预设挤占位置</b>：有的预设一开就是几万字；在「预设」页关掉用不到的段落，留给故事本身。
          </li>
          <li>
            <b>看一眼小圆环</b>：输入框旁的小圆环显示上次发送用了多少上下文，接近满了就该注意了。
          </li>
        </ul>
      </Chapter>

      {/* ───────── VIII 能做与不能做 ───────── */}
      <Chapter {...ch('scope')}>
        <div className="help-ledger">
          <div className="help-ledger-col can">
            <div className="help-ledger-head">
              <span className="help-ledger-seal">
                <Icon name="check" />
              </span>
              药汤能做的
            </div>
            <ul>
              {CAN.map(([a, b]) => (
                <LedgerItem key={a} sid={`can:${a}`} title={a} text={b} />
              ))}
            </ul>
          </div>
          <div className="help-ledger-col cannot">
            <div className="help-ledger-head">
              <span className="help-ledger-seal">
                <Icon name="close" />
              </span>
              药汤不做的
            </div>
            <ul>
              {CANNOT.map(([a, b]) => (
                <LedgerItem key={a} sid={`cannot:${a}`} title={a} text={b} />
              ))}
            </ul>
          </div>
        </div>
      </Chapter>

      {/* ───────── IX 常见问题 ───────── */}
      <Chapter {...ch('faq')}>
        <div className="help-faq">
          {FAQ.map(([q, a]) => (
            <Question key={q} q={q}>
              {a}
            </Question>
          ))}
        </div>
        <div className="help-end">
          <MagicCircle size={90} strokeWidth={0.8} runes={14} />
          <p className="t-faint t-small">手札到此为止。祝你在书斋里写出喜欢的故事。</p>
        </div>
      </Chapter>
    </div>
    </FocusCtx.Provider>
  )
}

/* ───────── 版式组件 ───────── */

function Chapter({ no, title, deco, brief, refEl, onTop, children }: { no: string; title: string; deco: string; brief: string; refEl: (el: HTMLElement | null) => void; onTop: () => void; children: ReactNode }) {
  return (
    <section className="help-chapter" ref={refEl}>
      <header className="help-chapter-head">
        <span className="help-chapter-no">{no}</span>
        <div className="help-chapter-title">
          <div className="t-deco">{deco}</div>
          <h3 className="t-display">{title}</h3>
          <span className="t-faint t-small">{brief}</span>
        </div>
        <button className="help-top t-small" data-sfx="soft" onClick={onTop}>
          <Icon name="chevL" className="rot90" /> 目录
        </button>
      </header>
      <div className="help-chapter-body">{children}</div>
    </section>
  )
}

function Step({ n, icon, title, children }: { n: number; icon: IconName; title: string; children: ReactNode }) {
  const { ref, flash } = useFocusable<HTMLLIElement>(`step:${title}`)
  return (
    <li ref={ref} className={`help-step ${flash}`}>
      <span className="help-step-seal">
        <span className="help-step-n t-display">{n}</span>
        <Icon name={icon} />
      </span>
      <div>
        <b>{title}</b>
        <p>{children}</p>
      </div>
    </li>
  )
}

function Figure({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="help-figure">
      {children}
      <figcaption className="t-small">{caption}</figcaption>
    </figure>
  )
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <aside className="help-tip">
      <span className="help-tip-mark">
        <Icon name="sparkle" />
      </span>
      <div>
        <b>小贴士</b>
        <p>{children}</p>
      </div>
    </aside>
  )
}

function Point({ title, children }: { title: string; children: ReactNode }) {
  const { ref, flash } = useFocusable<HTMLDivElement>(`point:${title}`)
  return (
    <div ref={ref} className={`help-point ${flash}`}>
      <b>
        <i aria-hidden>◆</i>
        {title}
      </b>
      <p>{children}</p>
    </div>
  )
}

function MiniCard({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  const { ref, flash } = useFocusable<HTMLDivElement>(`mini:${title}`)
  return (
    <div ref={ref} className={`help-mini ${flash}`}>
      <div className="help-mini-head">
        <Icon name={icon} />
        <b>{title}</b>
      </div>
      <p>{children}</p>
    </div>
  )
}

function Question({ q, children }: { q: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const { ref, flash } = useFocusable<HTMLDivElement>(`q:${q}`, () => setOpen(true))
  return (
    <div ref={ref} className={`help-q ${open ? 'open' : ''} ${flash}`}>
      <button className="help-q-head" data-sfx="soft" onClick={() => setOpen(!open)}>
        <span className="help-q-seal t-display">问</span>
        <span className="help-q-text">{q}</span>
        <Icon name="chevD" className="help-q-chev" />
      </button>
      {open && <div className="help-q-body">{children}</div>}
    </div>
  )
}

function LedgerItem({ sid, title, text }: { sid: string; title: string; text: string }) {
  const { ref, flash } = useFocusable<HTMLLIElement>(sid)
  return (
    <li ref={ref} className={flash}>
      <b>{title}</b>
      <span>{text}</span>
    </li>
  )
}

/** 搜索框：吸附在手札顶部，结果最多 6 条 */
function HelpSearch({ onPick }: { onPick: (e: HelpEntry) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const res = useMemo(() => searchHelp(HELP_INDEX, q), [q])
  useEffect(() => setSel(0), [q])
  useEffect(() => {
    // Ctrl+F：直接聚焦搜索框
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        input.current?.focus()
        input.current?.select()
      }
    }
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [])
  const choose = (h: HelpHit) => {
    onPick(h.entry)
    setOpen(false)
    input.current?.blur()
  }
  const show = open && q.trim().length > 0
  return (
    <div className="help-search" ref={box}>
      <label className={`help-search-field ${show ? 'active' : ''}`}>
        <Icon name="search" />
        <input
          ref={input}
          value={q}
          placeholder="在手札里找一个词，比如「世界书」「上下文」「密钥」"
          spellCheck={false}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSel((i) => Math.min(res.hits.length - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter' && res.hits[sel]) {
              e.preventDefault()
              choose(res.hits[sel])
            } else if (e.key === 'Escape') {
              if (q) setQ('')
              else input.current?.blur()
              setOpen(false)
            }
          }}
        />
        {q ? (
          <button className="help-search-clear" data-sfx="soft" aria-label="清除" onClick={() => (setQ(''), input.current?.focus())}>
            <Icon name="close" />
          </button>
        ) : (
          <span className="help-search-kbd t-pixel">CTRL F</span>
        )}
      </label>
      {show && (
        <div className="help-search-panel" role="listbox">
          {res.tooShort && !res.hits.length && <p className="help-search-note">一个字范围太大，再多输入一个字试试。</p>}
          {res.fallback && res.hits.length > 0 && <p className="help-search-note">名字里没有找到「{q.trim()}」，下面是正文里提到它的地方：</p>}
          {res.hits.map((h, i) => (
            <button key={h.entry.sid} className={`help-search-hit ${i === sel ? 'on' : ''}`} role="option" aria-selected={i === sel} data-sfx="soft" onMouseEnter={() => setSel(i)} onClick={() => choose(h)}>
              <span className={`help-search-kind k-${h.kind}`}>{h.kind}</span>
              <span className="help-search-main">
                <span className="help-search-title">
                  <Mark text={h.entry.title} q={q} />
                </span>
                <span className="help-search-snippet">{h.excerpt ? <Mark text={h.excerpt} q={q} /> : h.entry.snippet}</span>
              </span>
              <span className="help-search-where t-small">{h.entry.chapter}</span>
            </button>
          ))}
          {!res.hits.length && !res.tooShort && (
            <div className="help-search-empty">
              <p>手札里没有找到「{q.trim()}」。换个说法试试：</p>
              <div className="help-search-chips">
                {['世界书', '预设', '正则', '上下文', '前情提要', '密钥', '群聊'].map((w) => (
                  <button key={w} className="chip" data-sfx="soft" onClick={() => setQ(w)}>
                    {w}
                  </button>
                ))}
              </div>
            </div>
          )}
          {res.total > res.hits.length && !res.fallback && <p className="help-search-note foot">还有 {res.total - res.hits.length} 处相关的，只列出最贴近的 {MAX_HITS} 处；输入得具体一点会更准。</p>}
        </div>
      )}
    </div>
  )
}

/** 把搜索词在文字里标出来 */
function Mark({ text, q }: { text: string; q: string }) {
  const t = q.trim()
  if (!t) return <>{text}</>
  const i = text.toLowerCase().indexOf(t.toLowerCase())
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + t.length)}</mark>
      {text.slice(i + t.length)}
    </>
  )
}

interface TermDef {
  term: string
  icon: IconName
  short: string
  like: string
  more: ReactNode
}

function Term({ term, icon, short, like, more }: TermDef) {
  const [open, setOpen] = useState(false)
  const { ref, flash } = useFocusable<HTMLButtonElement>(`term:${term}`, () => setOpen(true))
  return (
    <button ref={ref} className={`help-term ${open ? 'open' : ''} ${flash}`} data-sfx="soft" onClick={() => setOpen(!open)}>
      <span className="help-term-icon">
        <Icon name={icon} scale={1.25} />
      </span>
      <span className="help-term-name t-display">{term}</span>
      <span className="help-term-short">{short}</span>
      {open && (
        <span className="help-term-more">
          <span className="help-term-like">
            <i>打个比方</i>
            {like}
          </span>
          <span className="help-term-detail">
            <i>细说</i>
            {more}
          </span>
        </span>
      )}
    </button>
  )
}

/* ───────── 内容 ───────── */

const TERMS: TermDef[] = [
  {
    term: '角色卡',
    icon: 'folder',
    short: '一位角色的档案：设定、开场白，常常还附带世界书和正则。',
    like: '剧本里的人物小传，外加几页附录。',
    more: '通常是一张 PNG 图片，数据就藏在图片里，所以「图片本身就是卡」；也有 JSON 格式。规格分 V1、V2、V3，药汤都能读，导入时会出一份报告。也能把角色导出成 PNG 卡，带回 SillyTavern。'
  },
  {
    term: '开场白',
    icon: 'quill',
    short: '一卷故事的第一段，由角色先开口。',
    like: '戏开场时，第一个走上台的人说的第一句话。',
    more: '有的卡带好几条备选开场白，在第一条消息上可以左右切换，选一个你喜欢的开头。'
  },
  {
    term: '世界书',
    icon: 'globe',
    short: '按关键词出现的资料卡，聊到才发给 AI。',
    like: '放在 AI 手边的一本百科词典：聊到哪个词，就翻到哪一页给它看。',
    more: '每个条目有关键词和内容；「常驻」条目每次都发送。可以跟着角色卡，也可以独立存在、绑定给几位角色或设为全局。详见第四章。'
  },
  {
    term: '预设',
    icon: 'flask',
    short: '决定发送内容的顺序和额外要求的「配方」。',
    like: '同样的食材，换一份菜谱，味道就不同。',
    more: '来自 SillyTavern 的「对话补全预设」：主提示词、文风要求、各段的顺序与开关、温度等参数，有的还自带正则。不用预设时药汤按内置顺序组装。详见第五章。'
  },
  {
    term: '正则',
    icon: 'rune',
    short: '自动的「查找并替换」规则。',
    like: '一位勤快的校对员：看到特定格式，就按规定改写。',
    more: '可以只改显示（把状态栏变成面板）、只改发给 AI 的内容（不发旧的思维链）、或直接改写原文。卡片作者常用它做界面美化。详见第五章。'
  },
  {
    term: '提示词',
    icon: 'scroll',
    short: '每次真正发给 AI 的全部文字。',
    like: '每回合重新熬的一整碗汤。',
    more: '由主提示词、角色设定、世界书、聊天记录、各种要求按顺序拼成。对话页右上角的「眼睛」（提示词透镜）可以看到完整内容。'
  },
  {
    term: '历史后指令',
    icon: 'sparkle',
    short: '放在聊天记录之后的要求，离 AI 最近、分量最重。',
    like: '出门前塞进口袋的最后一张便条。',
    more: '在 SillyTavern 里也叫「Post-History Instructions」，有的卡或预设用它强调文风、字数或格式。可在「设置 → 对话与人设」修改，角色卡也可以自带。'
  },
  {
    term: 'token 与上下文',
    icon: 'list',
    short: 'token 是 AI 数字的单位；上下文是它一次能读的上限。',
    like: '一张固定大小的桌子：东西太多，最早放上去的就得收起来。',
    more: '中文一个字约等于 0.6～1 个 token，不同模型的算法不同，药汤会按接口报告的实际用量自动校准。接口按 token 计费，发得越多越费。'
  },
  {
    term: '宏',
    icon: 'key',
    short: '占位符，发送时自动换成实际内容。',
    like: '信封上的「收件人」一栏，寄出前才填上名字。',
    more: '{{user}} 是你的名字，{{char}} 是角色名，{{random::甲::乙}} 随机挑一个，{{getvar::好感}} 读出一个变量……药汤支持 SillyTavern 的大部分常用宏，不认识的会原样保留。'
  },
  {
    term: '人设',
    icon: 'user',
    short: '你在故事里的身份：名字与简介。',
    like: '你自己的那份人物小传。',
    more: '在「设置 → 对话与人设」填写。卡片里的 {{user}} 会换成这里的名字；简介会作为「用户人设」发给 AI，让角色知道在和谁说话。'
  },
  {
    term: '作者备注',
    icon: 'edit',
    short: '只对这一卷生效的提醒，插在最近几条消息附近。',
    like: '贴在稿纸边上的一张小纸条。',
    more: '适合写当前的状态与气氛：「现在是深夜，下着雨」「她还在生气，但不会直说」。在对话页右上角的「侧记」里编辑，可以调整插入的深度。'
  },
  {
    term: '前情提要',
    icon: 'book',
    short: '对话太长时，较早部分的概要，代替原文发送。',
    like: '连续剧每集开头的「前情回顾」。',
    more: '较早的聊天记录快要放不下时，药汤会在后台整理，保留人物关系、关键事件、约定与伏笔。概括多少条不是固定的：放不下的旧对话全部并入（聊得越久，概括的条数越多），最近几条始终原样发送。篇幅在设置里选，默认 1500 字；可在侧记里查看、修改或重新整理，也可以关闭自动整理。'
  },
  {
    term: '重写与版本',
    icon: 'refresh',
    short: '不满意就重写，旧版本保留，左右切换。',
    like: '同一页草稿纸，换个写法再写一遍。',
    more: '最后一条回复下方的 ‹ › 用来切换版本；向右翻到底会再写一版。每个版本都会保存。'
  },
  {
    term: '续写与代写',
    icon: 'send',
    short: '续写：让 AI 接着上一段写；代写：让 AI 替你写一句。',
    like: '续写是「接着说」，代写是「帮我起个头」。',
    more: '两个按钮在输入框左下角。代写的内容会填进输入框，你可以改完再发送。'
  },
  {
    term: '分支',
    icon: 'branch',
    short: '从任意一条消息分出新的一卷，原卷不受影响。',
    like: '故事的岔路口：「如果当时选了另一条路……」',
    more: '每条消息上方悬停时有一个分叉图标。分出来的新卷会复制到那一条为止的全部内容。'
  },
  {
    term: '卷与续读',
    icon: 'copy',
    short: '一卷就是一段独立的对话；续读里是正在进行的故事。',
    like: '书架上一本本写到一半的书。',
    more: '同一位角色可以有很多卷。书斋顶部只显示一行续读卡片，全部都在左侧的「续读」页；长按卡片可以拖动排序，拖到上方的焚化阵可以移出续读（对话本身不删除）。'
  },
  {
    term: '群聊',
    icon: 'user',
    short: '几位角色和你在同一卷对话里，轮流开口。',
    like: '一桌人围着说话：你开口之后，被点到名的人先接话。',
    more: '群聊不复制角色，只是把书斋里已有的几位请到一起。每次只有一位角色在写：AI 拿到的是这一位的设定、其他成员的简介和全部聊天记录，再加一句「现在轮到谁」。谁来接话有三种方式——「自然」（点名优先，其次看活跃度）、「轮流」（每人一段）、「点名」（你说了算）。所有成员的世界书都会参与。'
  }
]

const CAN: [string, string][] = [
  ['读懂 SillyTavern 的内容', '角色卡（V1 / V2 / V3，PNG 与 JSON）、世界书、正则、对话补全预设；每次导入都有说明'],
  ['亲手写角色', '只有名字是必填的，会自动生成一枚印章头像'],
  ['流畅地写故事', '流式输出、停止、重写多版本、续写、代写、分支、编辑与删除、自动保存'],
  ['完整的世界书', '关键词与正则关键词、常驻、递归、概率、分组、粘滞与冷却、多种插入位置、预算'],
  ['照顾长对话', '自动整理前情提要；超出上下文时先省略最早的对话，设定始终完整发送'],
  ['群聊', '把几位角色请进同一卷对话：自然接话、轮流或点名，可调活跃度、可让某人暂时静默；「群聊卡」一个文件带来整桌人'],
  ['两种显示方式', '药汤风格，或在隔离的底板里按卡片作者的设计显示'],
  ['备份与迁移', '导出 / 导入存档（不含密钥），导出 PNG 角色卡'],
  ['接上多种 AI', 'OpenAI 兼容接口（DeepSeek 已实测）与 Gemini（已实测）；Claude 格式已实现但未实测'],
  ['保护你的数据', '所有内容都存在程序目录下的 data 文件夹里；密钥用 Windows 加密保存']
]

const CANNOT: [string, string][] = [
  ['自带 AI', '药汤只是书斋，需要你自己的接口和密钥；AI 写出什么、写得好不好，取决于你选的模型'],
  ['运行卡片里的脚本', 'JavaScript、STscript、EJS 模板、酒馆助手、快速回复（QR）都不会运行——这是为了安全，也为了界面不被改动'],
  ['加载网上的图片和字体', '卡片里的外部图片、网络字体不会加载（隐私与离线的考虑），内嵌在卡里的图片可以显示'],
  ['直接导入酒馆的群聊', 'SillyTavern 的群聊记录依赖它自己的文件结构，不能单独搬过来；把成员的角色卡导入后，在药汤里重新组一个群就行'],
  ['生成图片、语音、联网搜索', '只做文字对话'],
  ['过滤内容', '药汤不替你过滤内容；但接口服务商可能在它们那一端拒绝某些请求'],
  ['同步到云端', '数据只在这台电脑上；换电脑请用存档导出导入（密钥需要重新填写）'],
  ['在其它系统上运行', '目前只支持 Windows 11（64 位）']
]

const FAQ: [string, ReactNode][] = [
  [
    '提示「密钥无效」「没有保存密钥」怎么办？',
    <>
      <p>到「设置 → 接口」检查：接口格式选对了吗（DeepSeek 选 OpenAI 兼容，Google 的选 Gemini）？密钥填好后离开输入框（或点「保存」）才会加密保存，提示里会显示「已加密保存」。最后点「测试连接」确认。</p>
    </>
  ],
  [
    '回复写到一半就断了？',
    <p>多半是到了「单次回复上限」。在「设置 → 接口」调大它；断掉的那条可以点「续写」让 AI 接着写完。注意：开了思考模式时，思考内容也算在上限里。</p>
  ],
  [
    'AI 好像忘了前面发生的事。',
    <p>对话长到上下文放不下时，最早的部分不再发送。药汤会自动整理「前情提要」接替；也可以把重要设定写进世界书、把当前状态写进作者备注，或调大上下文。第七章有详细办法。</p>
  ],
  [
    '提示「提示词超出了上下文」，没有发送？',
    <p>说明预设、角色、世界书这些固定内容本身就放不下了。提示里会列出最大的几段：可以在「预设」页关掉用不到的段落、在「设置 → 对话与人设」调低世界书预算，或调大上下文。点提示里的「查看提示词」能看到完整内容。</p>
  ],
  [
    '同一张卡，在药汤里和在酒馆里看起来不一样？',
    <p>药汤默认用自己的纸墨风格显示，卡片自带的布局和样式会被过滤。想看作者设计的界面，到角色页「正则与显示」改成「卡片原样式」。依赖脚本的界面（比如可点击的按钮）在药汤里不会动起来。</p>
  ],
  [
    '导入报告里的「有差异」「未使用」是什么意思？',
    <p>「已启用」是能正常用的部分；「有差异」是能用、但效果可能和在酒馆里不完全一样的部分（会写明原因）；「未使用」是药汤不支持或用不上的设置，不影响其它内容。报告随时可以在角色页的「导入说明」里重看。</p>
  ],
  [
    '角色卡里的 {{user}} 是谁？我的名字在哪改？',
    <p>{'{{user}}'} 就是你。在「设置 → 对话与人设」填写你的名字和简介，所有卡片里的 {'{{user}}'} 都会换成这个名字。没填时叫「旅人」。</p>
  ],
  [
    '世界书条目没有生效？',
    <p>检查三件事：关键词是不是在最近几条消息里出现了（扫描深度默认 2 条）；条目是不是被关掉了；是不是因为同时触发太多、超出了世界书预算。对话页的「侧记」会列出上一轮触发了哪些条目。</p>
  ],
  [
    '用 AI 要花多少钱？',
    <p>药汤不收费，费用来自你使用的接口服务商，一般按 token 计算：发送的内容（提示词）和收到的回复都算。预设越长、世界书越多、上下文越大，每一轮就越费。输入框旁的小圆环能帮你估计每次发送的大小。</p>
  ],
  [
    '我的数据存在哪？怎么备份、换电脑？',
    <p>都在安装目录下的 data 文件夹里。「设置 → 数据」可以导出 .yaotang 存档（全部或部分角色，不含密钥），在另一台电脑上导入即可；导入前药汤会自动备份当前数据。直接拷走整个安装文件夹也行，但密钥需要重新填写。</p>
  ],
  [
    '开场动画、音效和音乐怎么关？',
    <p>开场动画在「设置 → 开场动画」里关闭（启动时双击或按 Esc 也能跳过）；音效和音乐在标题栏右侧的铃铛和音符一键开关，音量在「设置 → 声音」。</p>
  ],
  [
    '群聊里谁来说话？怎么让某个人开口？',
    <>
      <p>默认是「自然」：你的话里点到谁的名字，谁就先接（「柳先生」「沈掌柜」这样的姓加称呼也算）；没点名时，各人按「活跃度」决定接不接，一次最多三位。</p>
      <p>想让某人开口，点输入框上方他的头像；想让他们自己往下聊，点「让他们接着聊」。不想让谁插话，就在群聊页把他设为「静默」。</p>
    </>
  ],
  [
    '群聊要注意什么？',
    <>
      <p>人别太多，两到四位最好：每位角色开口都是一次单独的请求，人越多越慢、花费也越多；设定也会互相挤占上下文。</p>
      <p>写一段「群聊场景」交代大家此刻在哪、在做什么，比各自卡里的场景更不容易打架。AI 偶尔会顺手替别人说话，药汤会在换人的那一行截住；如果还是串了，点「重写」就好。专为一对一写的大型预设，在群聊里效果可能打折扣。</p>
    </>
  ],
  [
    '能在手机上用吗？',
    <p>目前只支持 Windows 11 电脑。</p>
  ]
]

/* ───────── 图示（墨线手绘风格，颜色跟随主题） ───────── */

function FlowDiagram() {
  const nodes = [
    { x: 70, label: '你', sub: '写下一句' },
    { x: 250, label: '药汤', sub: '配好一碗汤' },
    { x: 430, label: 'AI', sub: '读完，写下一段' },
    { x: 610, label: '书页', sub: '呈现给你' }
  ]
  return (
    <svg className="help-svg" viewBox="0 0 680 150" role="img" aria-label="你写一句，药汤把设定与记录配成提示词，交给 AI，AI 写出回复，药汤再呈现给你">
      <defs>
        <marker id="hArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" className="hd-fill-ink" />
        </marker>
      </defs>
      {nodes.slice(0, -1).map((n, i) => (
        <path key={i} d={`M${n.x + 48} 62 C ${n.x + 90} 40, ${nodes[i + 1].x - 90} 40, ${nodes[i + 1].x - 48} 62`} className="hd-line" markerEnd="url(#hArrow)" />
      ))}
      <path d="M 610 100 C 560 140, 120 140, 70 100" className="hd-line dash" markerEnd="url(#hArrow)" />
      {nodes.map((n, i) => (
        <g key={n.label} transform={`translate(${n.x} 66)`}>
          <circle r="36" className={i === 1 ? 'hd-seal-rubric' : i === 2 ? 'hd-seal-gold' : 'hd-seal'} />
          <circle r="30" className="hd-ring" />
          <text y="7" textAnchor="middle" className="hd-big">
            {n.label}
          </text>
          <text y="54" textAnchor="middle" className="hd-small">
            {n.sub}
          </text>
        </g>
      ))}
      <text x="340" y="145" textAnchor="middle" className="hd-tiny">
        下一轮又从头开始：AI 本身不记得上一次，靠的是每次都把记录一起发过去
      </text>
    </svg>
  )
}

function PotionDiagram() {
  const layers: [string, string][] = [
    ['主提示词', 'ink'],
    ['世界书 · 角色定义前', 'gold'],
    ['你的人设', 'ink'],
    ['角色描述 · 性格 · 场景', 'rubric'],
    ['世界书 · 角色定义后', 'gold'],
    ['示例对话', 'ink'],
    ['前情提要', 'gold'],
    ['聊天记录', 'ink'],
    ['历史后指令', 'rubric']
  ]
  const top = 70
  const h = 30
  return (
    <svg className="help-svg potion" viewBox="0 0 400 446" role="img" aria-label="提示词按顺序分层：主提示词、世界书、人设、角色、示例、前情提要、聊天记录、历史后指令">
      {/* 瓶口与瓶身 */}
      <path d="M150 20 h60 v34 l70 30 v300 q0 22 -22 22 h-156 q-22 0 -22 -22 v-300 l70 -30 z" className="hd-glass" />
      <path d="M144 20 h72" className="hd-line" />
      {layers.map(([label, tone], i) => {
        const y = top + 22 + i * h
        return (
          <g key={label}>
            <rect x="82" y={y} width="196" height={h - 4} rx="3" className={`hd-layer ${tone}`} />
            <text x="180" y={y + 18} textAnchor="middle" className="hd-layer-text">
              {label}
            </text>
          </g>
        )
      })}
      {/* 插在聊天记录里的 */}
      <path d={`M300 ${top + 22 + 7 * h + 13} h22`} className="hd-line" />
      <text x="326" y={top + 22 + 7 * h + 8} className="hd-tiny">
        作者备注、
      </text>
      <text x="326" y={top + 22 + 7 * h + 22} className="hd-tiny">
        深度世界书
      </text>
      <text x="326" y={top + 22 + 7 * h + 36} className="hd-tiny">
        插在其中
      </text>
      {/* 气泡 */}
      <circle cx="120" cy="96" r="4" className="hd-bubble" />
      <circle cx="236" cy="84" r="3" className="hd-bubble" />
      <circle cx="200" cy="72" r="2.5" className="hd-bubble" />
      <text x="180" y="440" textAnchor="middle" className="hd-small">
        越靠近瓶底，离 AI 越近
      </text>
    </svg>
  )
}

function LoreDiagram() {
  return (
    <svg className="help-svg" viewBox="0 0 680 190" role="img" aria-label="聊天里出现关键词月光王座，对应的世界书条目被激活并加入提示词">
      <defs>
        <marker id="hArrow2" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" className="hd-fill-ink" />
        </marker>
      </defs>
      {/* 聊天 */}
      <rect x="10" y="40" width="230" height="86" rx="4" className="hd-card" />
      <text x="26" y="66" className="hd-small">
        旅人：
      </text>
      <text x="26" y="92" className="hd-text">
        我们去
        <tspan className="hd-key">月光王座</tspan>
        看看吧。
      </text>
      <path d="M78 98 h66" className="hd-underline" />
      <text x="26" y="116" className="hd-tiny">
        最近几条消息里出现了关键词
      </text>
      <path d="M248 83 H300" className="hd-line" markerEnd="url(#hArrow2)" />
      {/* 资料卡 */}
      <g transform="translate(312 22)">
        <rect x="14" y="14" width="200" height="120" rx="4" className="hd-card faded" />
        <rect x="7" y="7" width="200" height="120" rx="4" className="hd-card faded" />
        <rect x="0" y="0" width="200" height="120" rx="4" className="hd-card lit" />
        <text x="14" y="26" className="hd-small strong">
          月光王座
        </text>
        <text x="14" y="46" className="hd-tiny">
          关键词：月光王座、王座
        </text>
        <path d="M14 58 h170 M14 74 h150 M14 90 h162 M14 106 h120" className="hd-scribble" />
      </g>
      <path d="M534 83 H586" className="hd-line" markerEnd="url(#hArrow2)" />
      {/* 提示词 */}
      <g transform="translate(596 40)">
        <rect x="0" y="0" width="74" height="86" rx="4" className="hd-card" />
        <path d="M10 18 h54 M10 32 h54" className="hd-scribble" />
        <rect x="8" y="42" width="58" height="14" rx="2" className="hd-layer gold" />
        <path d="M10 68 h54" className="hd-scribble" />
        <text x="37" y="104" textAnchor="middle" className="hd-tiny">
          提示词
        </text>
      </g>
      <text x="340" y="182" textAnchor="middle" className="hd-tiny">
        没聊到的条目不发送；「常驻」条目不看关键词，每次都在
      </text>
    </svg>
  )
}

function RegexDiagram() {
  return (
    <svg className="help-svg" viewBox="0 0 680 170" role="img" aria-label="原文中的状态标签经正则替换后显示成面板">
      <defs>
        <marker id="hArrow3" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" className="hd-fill-ink" />
        </marker>
      </defs>
      <text x="20" y="22" className="hd-tiny">
        AI 写下的原文
      </text>
      <rect x="10" y="32" width="250" height="110" rx="4" className="hd-card" />
      <text x="24" y="60" className="hd-mono">
        &lt;状态&gt;
      </text>
      <text x="40" y="84" className="hd-mono">
        体力：80
      </text>
      <text x="40" y="106" className="hd-mono">
        心情：雀跃
      </text>
      <text x="24" y="130" className="hd-mono">
        &lt;/状态&gt;
      </text>
      <g transform="translate(290 64)">
        <rect x="0" y="0" width="100" height="46" rx="23" className="hd-seal-gold" />
        <text x="50" y="20" textAnchor="middle" className="hd-small strong">
          正则
        </text>
        <text x="50" y="36" textAnchor="middle" className="hd-tiny">
          查找 → 替换
        </text>
      </g>
      <path d="M262 87 H286" className="hd-line" markerEnd="url(#hArrow3)" />
      <path d="M392 87 H418" className="hd-line" markerEnd="url(#hArrow3)" />
      <text x="430" y="22" className="hd-tiny">
        你看到的
      </text>
      <rect x="420" y="32" width="250" height="110" rx="6" className="hd-panel" />
      <text x="440" y="62" className="hd-panel-title">
        ◆ 状态
      </text>
      <text x="440" y="90" className="hd-panel-text">
        体力
      </text>
      <rect x="490" y="80" width="150" height="12" rx="6" className="hd-bar-bg" />
      <rect x="490" y="80" width="120" height="12" rx="6" className="hd-bar" />
      <text x="440" y="122" className="hd-panel-text">
        心情　雀跃
      </text>
      <text x="340" y="164" textAnchor="middle" className="hd-tiny">
        存下来的原文和发给 AI 的内容都没变，只是换了个样子显示
      </text>
    </svg>
  )
}

function DisplayDiagram() {
  return (
    <svg className="help-svg" viewBox="0 0 680 200" role="img" aria-label="左边是纸墨排版的药汤风格，右边是深色底板里的卡片原样式">
      <g>
        <rect x="10" y="10" width="310" height="180" rx="4" className="hd-paper" />
        <text x="30" y="40" className="hd-small strong">
          薇拉
        </text>
        <path d="M30 56 h260 M30 74 h240 M30 92 h255" className="hd-scribble" />
        <rect x="30" y="108" width="260" height="62" rx="3" className="hd-tagbox" />
        <text x="42" y="104" className="hd-tiny rubric">
          状态
        </text>
        <text x="44" y="132" className="hd-tiny">
          体力　80
        </text>
        <text x="44" y="152" className="hd-tiny">
          心情　雀跃
        </text>
      </g>
      <g>
        <rect x="360" y="10" width="310" height="180" rx="4" className="hd-plate" />
        <rect x="364" y="14" width="302" height="172" rx="3" className="hd-plate-ring" />
        <text x="382" y="40" className="hd-small plate">
          薇拉
        </text>
        <path d="M382 56 h250 M382 74 h230" className="hd-scribble plate" />
        <rect x="382" y="92" width="266" height="80" rx="8" className="hd-plate-panel" />
        <text x="398" y="116" className="hd-plate-title">
          ✦ STATUS
        </text>
        <rect x="398" y="128" width="200" height="9" rx="4.5" className="hd-plate-bar-bg" />
        <rect x="398" y="128" width="160" height="9" rx="4.5" className="hd-plate-bar" />
        <text x="398" y="160" className="hd-plate-text">
          心情 · 雀跃
        </text>
      </g>
    </svg>
  )
}

function MemoryDiagram() {
  const msgs = Array.from({ length: 14 })
  return (
    <svg className="help-svg" viewBox="0 0 680 170" role="img" aria-label="最早的聊天记录不再发送，由前情提要接替；设定始终完整发送">
      <rect x="10" y="40" width="150" height="70" rx="4" className="hd-layer rubric" />
      <text x="85" y="70" textAnchor="middle" className="hd-layer-text">
        设定 · 世界书
      </text>
      <text x="85" y="90" textAnchor="middle" className="hd-layer-text">
        预设（始终完整）
      </text>
      <rect x="172" y="40" width="96" height="70" rx="4" className="hd-layer gold" />
      <text x="220" y="80" textAnchor="middle" className="hd-layer-text">
        前情提要
      </text>
      {msgs.map((_, i) => {
        const x = 280 + i * 28
        const old = i < 5
        return <rect key={i} x={x} y="48" width="22" height="54" rx="3" className={old ? 'hd-msg old' : 'hd-msg'} />
      })}
      <path d="M278 122 h136" className="hd-brace" />
      <text x="346" y="140" textAnchor="middle" className="hd-tiny">
        最早的对话：不再发送原文
      </text>
      <path d="M418 122 h252" className="hd-brace ink" />
      <text x="544" y="140" textAnchor="middle" className="hd-tiny">
        最近的对话：原样发送
      </text>
      <path d="M346 30 C 320 10, 250 10, 228 34" className="hd-line dash" />
      <text x="290" y="18" textAnchor="middle" className="hd-tiny">
        整理进前情提要
      </text>
      <text x="340" y="166" textAnchor="middle" className="hd-tiny">
        上下文的大小是固定的：左边的设定越大，留给聊天记录的位置就越少
      </text>
    </svg>
  )
}

/* ───────── 搜索索引：只收名字与别名，正文只做后备 ───────── */

const CHAPTER_ALIASES: Record<string, string[]> = {
  start: ['开始', '入门', '新手', '第一次', '上手', '教程', '怎么用'],
  terms: ['词典', '名词', '术语', '概念', '是什么意思'],
  prompt: ['提示词', 'prompt', '顺序', '组装', '发给AI', '透镜'],
  lore: ['世界书', 'lorebook', 'world info', 'wi', '设定集', '资料卡'],
  preset: ['预设', 'preset', '正则', 'regex'],
  display: ['显示方式', '原样式', '美化', '样式', '界面', '药汤风格'],
  memory: ['记忆', '忘', '遗忘', '长对话', '上下文', '前情提要', '总结'],
  scope: ['能做', '不能做', '功能', '限制', '边界', '支持什么'],
  faq: ['问题', '常见问题', 'faq', '怎么办']
}

const TERM_ALIASES: Record<string, string[]> = {
  角色卡: ['card', 'character card', '人物卡', '卡片', 'png', 'json', 'v2', 'v3', '导出'],
  开场白: ['greeting', 'first message', 'first_mes', '第一条', '备选开场白'],
  世界书: ['lorebook', 'world info', 'wi', '设定集', '资料卡', '条目'],
  预设: ['preset', '配方', '对话补全预设'],
  正则: ['regex', '替换', '美化', '正则表达式', '查找替换'],
  提示词: ['prompt', '提示', '透镜'],
  历史后指令: ['post-history', 'post history instructions', 'jailbreak', '破限', 'phi'],
  'token 与上下文': ['token', 'context', '上下文', '字数', '长度', '上限'],
  宏: ['macro', '{{user}}', '{{char}}', '占位符', '变量', 'setvar', 'getvar', 'random'],
  人设: ['persona', '我的名字', '用户', '{{user}}', '旅人'],
  作者备注: ['author note', '备注', 'an', '作者注释'],
  前情提要: ['summary', '总结', '摘要', '记忆', '回顾', 'summarize'],
  重写与版本: ['swipe', 'regenerate', '重新生成', '版本', '左右切换'],
  续写与代写: ['continue', 'impersonate', '代写', '续写'],
  分支: ['branch', '岔路', '分叉'],
  卷与续读: ['卷', '对话', 'chat', '续读', '续读页'],
  群聊: ['group', 'group chat', '多人', '多角色', '群', '组群', '群聊卡', '轮流', '点名', '活跃度', 'talkativeness', '静默']
}

const FAQ_META: Record<string, { keywords: string[]; snippet: string }> = {
  '提示「密钥无效」「没有保存密钥」怎么办？': { keywords: ['api key', 'key', '密钥', '401', '403', '连接失败', '测试连接', '无效', 'gemini', 'deepseek'], snippet: '检查接口格式，填好密钥后离开输入框才会保存，再点「测试连接」。' },
  '回复写到一半就断了？': { keywords: ['截断', '断了', '写一半', '长度上限', 'max tokens', '回复上限', '不完整'], snippet: '多半是到了「单次回复上限」；调大它，或点「续写」接着写完。' },
  'AI 好像忘了前面发生的事。': { keywords: ['忘', '遗忘', '记忆', '记不住', '前情提要', '失忆'], snippet: '上下文放不下时最早的部分不再发送，前情提要会接替。' },
  '提示「提示词超出了上下文」，没有发送？': { keywords: ['超出', '没有发送', '太长', '上下文', '预算', '发不出去'], snippet: '固定内容本身放不下了；关掉部分预设段落、调低世界书预算或调大上下文。' },
  '同一张卡，在药汤里和在酒馆里看起来不一样？': { keywords: ['样式', '美化', '不一样', '酒馆', 'sillytavern', '状态栏', '原样式', '代码'], snippet: '药汤默认用自己的风格；想看作者的界面，改成「卡片原样式」。' },
  '导入报告里的「有差异」「未使用」是什么意思？': { keywords: ['报告', '有差异', '未使用', '导入', '已启用'], snippet: '「有差异」能用但效果可能不同；「未使用」是药汤不支持的设置。' },
  '角色卡里的 {{user}} 是谁？我的名字在哪改？': { keywords: ['user', '{{user}}', '名字', '改名', '人设', '旅人'], snippet: '{{user}} 就是你，在「设置 → 对话与人设」填写名字。' },
  '世界书条目没有生效？': { keywords: ['世界书', '不生效', '没触发', '没有触发', '关键词', '扫描深度'], snippet: '检查关键词是否出现在最近几条、条目是否开启、是否超出预算。' },
  '用 AI 要花多少钱？': { keywords: ['钱', '费用', '收费', '花钱', '价格', '计费', '贵', '免费'], snippet: '药汤不收费；接口按 token 计费，发送和回复都算。' },
  '我的数据存在哪？怎么备份、换电脑？': { keywords: ['数据', '备份', '存档', '换电脑', '迁移', 'data', '保存在哪'], snippet: '都在安装目录的 data 里；「设置 → 数据」可导出存档。' },
  '开场动画、音效和音乐怎么关？': { keywords: ['开场动画', '音效', '音乐', '声音', '关闭', '静音', '背景音乐'], snippet: '开场动画在设置里关；音效和音乐在标题栏右侧一键开关。' },
  '群聊里谁来说话？怎么让某个人开口？': { keywords: ['群聊', '谁说话', '点名', '接话', '轮流', '活跃度', '静默', '接着聊', '不说话'], snippet: '点到名的先说，其次看活跃度；点头像让某人开口。' },
  '群聊要注意什么？': { keywords: ['群聊', '注意', '人数', '串戏', '替别人说话', '多人', '花费'], snippet: '两到四位最好；写好群聊场景；串了就点「重写」。' },
  '能在手机上用吗？': { keywords: ['手机', '安卓', '苹果', 'mac', 'ios', 'android', '平板', 'linux'], snippet: '目前只支持 Windows 11 电脑。' }
}

/** 正文里的要点（只按标题与别名找） */
const INLINE_INDEX: (Omit<HelpEntry, 'chapter'> & { chapterId: string })[] = [
  { sid: 'step:接上 AI', kind: '要点', chapterId: 'start', title: '接上 AI', snippet: '「设置 → 接口」选接口格式、填密钥、测试连接。', keywords: ['接口', 'api', '密钥', 'deepseek', 'gemini', '连接', '配置'] },
  { sid: 'step:请来一位角色', kind: '要点', chapterId: 'start', title: '请来一位角色', snippet: '把角色卡拖进窗口，或点左侧「导入」；也可以「新建」。', keywords: ['导入', '角色卡', '拖进', '新建角色'] },
  { sid: 'step:开始一卷故事', kind: '要点', chapterId: 'start', title: '开始一卷故事', snippet: '角色页「开始新的一卷」；Enter 发送，Ctrl+Enter 换行。', keywords: ['发送', 'enter', '换行', '新的一卷', '开始聊天'] },
  { sid: 'point:越靠后，分量越重', kind: '要点', chapterId: 'prompt', title: '越靠后，分量越重', snippet: '离聊天记录末尾越近的内容，AI 越容易照着做。', keywords: ['顺序', '位置', '影响'] },
  { sid: 'point:顺序可以换', kind: '要点', chapterId: 'prompt', title: '提示词的顺序可以换', snippet: '不用预设按默认顺序；用了预设按预设的顺序与开关。', keywords: ['顺序', '预设'] },
  { sid: 'point:放不下时，先省略最早的对话', kind: '要点', chapterId: 'prompt', title: '放不下时，先省略最早的对话', snippet: '设定始终完整发送，旧聊天由前情提要接替。', keywords: ['上下文', '超出', '省略', '裁剪', '放不下'] },
  { sid: 'point:自己看一眼', kind: '要点', chapterId: 'prompt', title: '看看到底发了什么', snippet: '右上角的「眼睛」看完整内容，输入框旁的小圆环看用量。', keywords: ['透镜', '眼睛', '小圆环', '用量', '查看提示词'] },
  { sid: 'mini:关键词', kind: '要点', chapterId: 'lore', title: '世界书的关键词', snippet: '最近几条消息里出现关键词，条目就会触发。', keywords: ['关键词', 'keys', '触发', '扫描深度'] },
  { sid: 'mini:常驻', kind: '要点', chapterId: 'lore', title: '常驻条目', snippet: '不看关键词，每次都发送，但会一直占用字数。', keywords: ['常驻', 'constant', '一直发送'] },
  { sid: 'mini:优先级与预算', kind: '要点', chapterId: 'lore', title: '世界书的优先级与预算', snippet: '同时触发太多时按插入顺序放入，用完预算为止。', keywords: ['预算', '优先级', 'order', '插入顺序', 'budget'] },
  { sid: 'q:把一个角色的世界书，用在一个毫不相干的角色身上，会发生什么？', kind: '问答', chapterId: 'lore', title: '把一个角色的世界书用在不相干的角色上，会怎样？', snippet: '不改变角色本身，但可能串戏、设定冲突、白占字数。', keywords: ['不相干', '别的角色', '串戏', '共用', '全局', '绑定', '另一个角色'] },
  { sid: 'mini:在哪', kind: '要点', chapterId: 'preset', title: '预设在哪里管理', snippet: '左侧书脊「预设」：导入、切换、调整顺序与内容。', keywords: ['预设', '预设页', '切换预设', '导入预设'] },
  { sid: 'mini:和角色卡的关系', kind: '要点', chapterId: 'preset', title: '预设和角色卡的关系', snippet: '卡自带的系统提示词默认会替换预设的同名段落。', keywords: ['系统提示词', '覆盖', '冲突', '禁止覆盖'] },
  { sid: 'mini:不会执行的部分', kind: '要点', chapterId: 'preset', title: '预设里不会执行的部分', snippet: 'EJS 模板与酒馆助手脚本不会运行。', keywords: ['ejs', '脚本', '酒馆助手', 'tavern helper'] },
  { sid: 'mini:仅显示', kind: '要点', chapterId: 'preset', title: '正则：仅显示', snippet: '只改变看到的样子，原文和发给 AI 的都不变。', keywords: ['仅显示', 'markdownonly'] },
  { sid: 'mini:仅发送', kind: '要点', chapterId: 'preset', title: '正则：仅发送', snippet: '只改变发给 AI 的内容，常用来省字数。', keywords: ['仅发送', 'promptonly'] },
  { sid: 'mini:改写原文', kind: '要点', chapterId: 'preset', title: '正则：改写原文', snippet: '回复写完就直接改掉原文，要谨慎。', keywords: ['改写', '原文'] },
  { sid: 'mini:药汤风格（默认）', kind: '要点', chapterId: 'display', title: '药汤风格', snippet: '所有内容按纸墨排版，样式被过滤。', keywords: ['显示方式', '纸墨', '默认显示'] },
  { sid: 'mini:卡片原样式', kind: '要点', chapterId: 'display', title: '卡片原样式', snippet: '在独立的深色底板里按作者的设计显示。', keywords: ['原样式', '美化', '隔离', '底板', '作者界面'] },
  { sid: 'mini:前情提要（自动）', kind: '要点', chapterId: 'memory', title: '前情提要怎么起作用', snippet: '旧对话快放不下时，后台整理成概要代替原文。', keywords: ['前情提要', '总结', 'summary', '自动整理'] },
  { sid: 'mini:设定不会被裁掉', kind: '要点', chapterId: 'memory', title: '设定不会被裁掉', snippet: '角色设定、世界书、预设始终完整发送。', keywords: ['裁剪', '设定', '遗忘设定'] }
]

const chapterTitle = (id: string) => CHAPTERS.find((c) => c.id === id)?.title ?? ''

const HELP_INDEX: HelpEntry[] = [
  ...CHAPTERS.map((c) => ({ sid: `ch:${c.id}`, kind: '章节' as const, title: c.title, chapter: '目录', snippet: c.brief, keywords: CHAPTER_ALIASES[c.id] ?? [] })),
  ...TERMS.map((t) => ({
    sid: `term:${t.term}`,
    kind: '词条' as const,
    title: t.term,
    chapter: chapterTitle('terms'),
    snippet: t.short,
    keywords: TERM_ALIASES[t.term] ?? [],
    body: [t.short, t.like, typeof t.more === 'string' ? t.more : ''].join(' ')
  })),
  ...FAQ.map(([q]) => ({ sid: `q:${q}`, kind: '问答' as const, title: q, chapter: chapterTitle('faq'), snippet: FAQ_META[q]?.snippet ?? '', keywords: FAQ_META[q]?.keywords ?? [], body: FAQ_META[q]?.snippet })),
  ...INLINE_INDEX.map(({ chapterId, ...e }) => ({ ...e, chapter: chapterTitle(chapterId), body: e.snippet })),
  ...CAN.map(([a, b]) => ({ sid: `can:${a}`, kind: '边界' as const, title: `能做：${a}`, chapter: chapterTitle('scope'), snippet: b, keywords: [], body: b })),
  ...CANNOT.map(([a, b]) => ({ sid: `cannot:${a}`, kind: '边界' as const, title: `不做：${a}`, chapter: chapterTitle('scope'), snippet: b, keywords: [], body: b }))
]
