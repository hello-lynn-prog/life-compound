/**
 * IP 吉祥物（互动版，无自动挥手）
 * ===================
 * 素材从 public/mascot/ 运行时加载（不参与 Git——你的形象是隐私）：
 *   mascot/mascot.png  静态形象
 *   mascot/idle.webm   待机循环
 *   mascot/wave.webm   挥手打招呼（悬停触发）
 *   mascot/heart.webm  比心（点击触发）
 * - 文件不存在时自动降级为 🌸 占位头像——克隆仓库开箱即用
 * - 鼠标移入：挥手打招呼（播一遍回待机）——用户主动触发才挥
 * - 点击：比心 + 飘爱心小特效
 * - 系统开了"减少动态效果"时降级为静态
 * 打造自己的形象见 docs/打造你的IP吉祥物.md
 */
import { useEffect, useRef, useState } from 'react'

type Seq = 'idle' | 'wave' | 'heart'
const IDLE_SRC = 'mascot/idle.webm'
const STATIC_SRC = 'mascot/mascot.png'
const GESTURE_SRC: Record<'wave' | 'heart', string> = {
  wave: 'mascot/wave.webm',
  heart: 'mascot/heart.webm',
}
// 🌸 占位头像（SVG data URL）：没有放形象文件时显示这个
const FALLBACK_AVATAR =
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 260">` +
    `<rect width="200" height="260" rx="40" fill="#FFE4EA"/>` +
    `<text x="100" y="150" font-size="110" text-anchor="middle">🌸</text>` +
    `<text x="100" y="215" font-size="20" text-anchor="middle" fill="#F87B93" font-weight="bold">放置你的 IP 形象</text>` +
    `</svg>`)

// 预加载手势动画（转 blob URL，切换零延迟）；文件不存在返回 null
async function preload(src: string): Promise<string | null> {
  try {
    const r = await fetch(src)
    if (!r.ok) return null
    const ct = r.headers.get('content-type') || ''
    if (ct.includes('text/html')) return null // SPA 回退 = 文件不存在
    const b = await r.blob()
    if (!b.type.startsWith('video/')) return null
    return URL.createObjectURL(b)
  } catch { return null }
}

export default function Mascot({ style }: { style?: React.CSSProperties }) {
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )
  const videoRef = useRef<HTMLVideoElement>(null)
  const blobsRef = useRef<Partial<Record<Seq, string>>>({})
  const seqRef = useRef<Seq>('idle')
  const busyRef = useRef(false) // 手势播放中，避免打断
  const animOkRef = useRef(true) // 形象文件是否存在（不存在则降级占位）
  const [staticFallback, setStaticFallback] = useState(false)
  const [bubble, setBubble] = useState('') // 头顶气泡
  const [hearts, setHearts] = useState<{ id: number; x: number; emoji: string }[]>([])

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const onChange = () => setReducedMotion(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // 预加载手势动画；同时探测静态形象是否存在（不存在 → 降级占位）
  useEffect(() => {
    let alive = true
    Promise.all([preload(GESTURE_SRC.wave), preload(GESTURE_SRC.heart)]).then(([w, h]) => {
      if (!alive) return
      blobsRef.current.wave = w ?? undefined
      blobsRef.current.heart = h ?? undefined
    })
    fetch(STATIC_SRC).then(r => {
      const ct = r.headers.get('content-type') || ''
      if (r.ok && ct.startsWith('image/')) return
      animOkRef.current = false
      setStaticFallback(true)
    }).catch(() => { /* 探测失败保持现状 */ })
    return () => { alive = false }
  }, [])

  // 初始自动播放：等就绪再播（避免加载竞态停在第一帧）
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.loop = true
    const start = () => { v.play().catch(() => {}) }
    if (v.readyState >= 3) start()
    else v.addEventListener('canplay', start, { once: true })
  }, [])

  // 播一段手势，播完自动回待机；比心可以打断当前手势
  const playSeq = (seq: Exclude<Seq, 'idle'>) => {
    const v = videoRef.current
    const url = blobsRef.current[seq]
    if (!v || !url) return
    if (busyRef.current && seq !== 'heart') return
    busyRef.current = true
    seqRef.current = seq
    v.loop = false // 手势只播一遍，ended 后回待机
    v.src = url
    // 换源后等就绪再播（直接 play 会被加载中断导致卡住）
    const startPlay = () => { v.play().catch(() => {}) }
    if (v.readyState >= 3) startPlay()
    else v.addEventListener('canplay', startPlay, { once: true })
    v.onended = () => {
      busyRef.current = false
      seqRef.current = 'idle'
      v.loop = true // 待机无限循环
      v.src = IDLE_SRC
      const back = () => { v.play().catch(() => {}) }
      if (v.readyState >= 3) back()
      else v.addEventListener('canplay', back, { once: true })
    }
  }

  // 点击：比心 + 爱心特效
  const onClick = () => {
    if (reducedMotion || staticFallback) return
    playSeq('heart')
    const batch = Array.from({ length: 6 }, (_, i) => ({
      id: Date.now() + i,
      x: (Math.random() - .5) * 120,
      emoji: ['💗', '💖', '💕', '✨'][i % 4],
    }))
    setHearts(hs => [...hs, ...batch])
    setBubble('比心 💗')
    setTimeout(() => setHearts(hs => hs.filter(h => !batch.some(b => b.id === h.id))), 1100)
    setTimeout(() => setBubble(''), 1800)
  }

  // 鼠标移入：挥手打招呼
  const onEnter = () => {
    if (reducedMotion || staticFallback) return
    playSeq('wave')
    setBubble('Hi～')
    setTimeout(() => setBubble(''), 1500)
  }

  // 降级：减少动态 或 形象文件缺失 → 静态图 / 占位头像
  if (reducedMotion || staticFallback) {
    return (
      <img src={animOkRef.current ? STATIC_SRC : FALLBACK_AVATAR} alt="IP 形象"
        onError={e => { (e.currentTarget as HTMLImageElement).src = FALLBACK_AVATAR }}
        style={style} />
    )
  }
  return (
    <span
      style={{ position: 'relative', display: 'inline-block', ...style }}
      onMouseEnter={onEnter}
      onClick={onClick}
      title="移过去打招呼，点一下比心 💗"
    >
      <video
        ref={videoRef}
        src={IDLE_SRC} autoPlay muted playsInline
        onEnded={e => { if (seqRef.current === 'idle') { e.currentTarget.currentTime = 0; e.currentTarget.play().catch(() => {}) } }}
        onError={() => { animOkRef.current = false; setStaticFallback(true) }}
        aria-label="IP 形象"
        style={{ ...style, position: 'relative', zIndex: 1 }}
      />
      {/* 头顶气泡 */}
      {bubble && (
        <span style={{
          position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)',
          background: '#fff', color: 'var(--peach-deep, #F87B93)', fontSize: 13, fontWeight: 'bold',
          padding: '5px 12px', borderRadius: '12px 12px 12px 3px', whiteSpace: 'nowrap',
          boxShadow: '0 6px 16px rgba(92,74,68,.18)', zIndex: 3, pointerEvents: 'none',
        }}>{bubble}</span>
      )}
      {/* 点击爱心特效 */}
      {hearts.map(h => (
        <span key={h.id} style={{
          position: 'absolute', left: '50%', top: '30%', fontSize: 20, zIndex: 2,
          pointerEvents: 'none', animation: 'mascotHeartUp 1.1s ease-out forwards',
          ['--drift' as string]: `${h.x}px`,
        }}>{h.emoji}</span>
      ))}
    </span>
  )
}
