/**
 * 应用骨架：欢迎页 + 左侧导航 + 路由出口 + 全局搜索快捷键
 */
import { useEffect, useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import { ToastProvider } from './components/ui'
import SearchDialog from './components/SearchDialog'
import Welcome from './components/Welcome'
import Today from './pages/Today'
import Goals from './pages/Goals'
import Diary from './pages/Diary'
import Knowledge from './pages/Knowledge'
import Books from './pages/Books'
import Charts from './pages/Charts'
import Profile from './pages/Profile'
import DataCenter from './pages/DataCenter'

const NAV = [
  { to: '/today', ico: '🏠', txt: '今日' },
  { to: '/goals', ico: '🎯', txt: '目标' },
  { to: '/diary', ico: '📔', txt: '日记' },
  { to: '/knowledge', ico: '📚', txt: '知识库' },
  { to: '/books', ico: '📖', txt: '读书' },
  { to: '/charts', ico: '📈', txt: '图谱' },
  { to: '/profile', ico: '👤', txt: '档案' },
  { to: '/data', ico: '🗄️', txt: '数据' },
]

export default function App() {
  const [searchOpen, setSearchOpen] = useState(false)
  // 欢迎页每个浏览器会话只出现一次（刷新页面不重复）
  const [welcomeDone, setWelcomeDone] = useState(
    () => sessionStorage.getItem('welcomed') === '1',
  )
  const finishWelcome = () => {
    sessionStorage.setItem('welcomed', '1')
    setWelcomeDone(true)
  }

  // Ctrl+K / 直接按 / 唤起全局搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setSearchOpen(true)
      } else if (e.key === '/' && !typing) {
        e.preventDefault(); setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <ToastProvider>
      <div className="layout">
        <aside className="side">
          <NavLink to="/today" className="logo">
            <div className="logo-icon">🌸</div>
            <div><b>Lynn的人生复利系统</b><small>COMPOUND LIFE</small></div>
          </NavLink>
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <span className="ico">{n.ico}</span><span className="txt">{n.txt}</span>
            </NavLink>
          ))}
          <div className="side-bottom">
            <button className="nav-item" onClick={() => setSearchOpen(true)}>
              <span className="ico">🔍</span><span className="txt">搜索 Ctrl+K</span>
            </button>
          </div>
        </aside>
        <main className="main">
          <Routes>
            <Route path="/" element={<Today />} />
            <Route path="/today" element={<Today />} />
            <Route path="/goals" element={<Goals />} />
            <Route path="/diary" element={<Diary />} />
            <Route path="/knowledge" element={<Knowledge />} />
            <Route path="/books" element={<Books />} />
            <Route path="/charts" element={<Charts />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/data" element={<DataCenter />} />
          </Routes>
        </main>
      </div>
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
      {!welcomeDone && <Welcome onDone={finishWelcome} />}
    </ToastProvider>
  )
}
