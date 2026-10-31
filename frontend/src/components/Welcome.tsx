/**
 * 欢迎页：打开应用时的第一眼
 * ============================
 * 全屏蜜桃粉渐变 + IP 小姐姐动画打招呼（按时段问好），
 * 3 秒后自动进入工作台，点击可立即进入。
 * 每个浏览器会话只显示一次（刷新不重复打扰）。
 */
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Mascot from './Mascot'
import { api, prettyDate, today } from '../api'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return '夜深了'
  if (h < 11) return '上午好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

export default function Welcome({ onDone }: { onDone: () => void }) {
  const [fading, setFading] = useState(false)
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<Record<string, string>>('/api/data/settings'),
  })

  // 关闭：先淡出再真正进入
  const close = () => {
    if (fading) return
    setFading(true)
    setTimeout(onDone, 450)
  }

  // 3.2 秒后自动进入
  useEffect(() => {
    const t = setTimeout(close, 3200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="welcome-mask" style={{ opacity: fading ? 0 : 1 }} onClick={close}>
      <div className="welcome-blob wb1" />
      <div className="welcome-blob wb2" />
      <div className="welcome-blob wb3" />
      <div className="welcome-body">
        <Mascot style={{
          height: 360,
          filter: 'drop-shadow(0 16px 32px rgba(248,123,147,.35))',
          animation: 'welcomeBob 2.4s ease-in-out infinite',
        }} />
        <h1 className="welcome-title">
          {greeting()}，{settings?.nickname || 'Lynn'} <span className="welcome-emoji">🌸</span>
        </h1>
        <p className="welcome-date">今天是 {prettyDate(today())}</p>
        <p className="welcome-hint">点我开始今天 ✨</p>
      </div>
    </div>
  )
}
