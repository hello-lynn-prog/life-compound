/**
 * 全局搜索：Ctrl+K 唤起，一次搜任务/日记/随手记/知识/成果
 */
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

interface SearchResult {
  tasks: { id: number; title: string; task_date: string; done: number }[]
  journals: { id: number; title: string; journal_date: string; mood: number | null }[]
  notes: { id: number; content: string; created_at: string }[]
  knowledge: { id: number; title: string; category: string }[]
  achievements: { id: number; title: string; ach_type: string; ach_date: string }[]
}

export default function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [kw, setKw] = useState('')
  const [debounced, setDebounced] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  // 输入防抖：停 250ms 才发请求
  useEffect(() => {
    const t = setTimeout(() => setDebounced(kw.trim()), 250)
    return () => clearTimeout(t)
  }, [kw])

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50) }, [open])

  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get<SearchResult>(`/api/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.length > 0,
  })

  const jump = (path: string) => { onClose(); setKw(''); navigate(path) }

  if (!open) return null
  const groups: [string, string, { id: number; label: string; sub: string }[]][] = data ? [
    ['🌸', '任务', (data.tasks || []).map(t => ({ id: t.id, label: t.title, sub: t.task_date + (t.done ? ' · 已完成' : '') }))],
    ['📔', '日记', (data.journals || []).map(j => ({ id: j.id, label: j.title || '（无标题日记）', sub: j.journal_date }))],
    ['📌', '随手记', (data.notes || []).map(n => ({ id: n.id, label: n.content.slice(0, 40), sub: '' }))],
    ['💡', '知识', (data.knowledge || []).map(k => ({ id: k.id, label: k.title, sub: k.category }))],
    ['🏆', '成果', (data.achievements || []).map(a => ({ id: a.id, label: a.title, sub: a.ach_date }))],
  ] : []

  return (
    <div className="modal-mask" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 560, padding: '18px 20px' }}>
        <input
          ref={inputRef}
          className="input" placeholder="搜搜看：任务、日记、知识、成果…"
          value={kw} onChange={e => setKw(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') onClose() }}
        />
        <div style={{ maxHeight: '55vh', overflowY: 'auto', marginTop: 12 }}>
          {!debounced && <div className="empty"><span className="e-emoji">🔍</span>输入关键词开始搜索</div>}
          {debounced && isFetching && <div className="empty">搜索中…</div>}
          {debounced && !isFetching && data && groups.every(([, , items]) => items.length === 0) && (
            <div className="empty"><span className="e-emoji">🫧</span>没有找到「{debounced}」相关的内容</div>
          )}
          {groups.map(([emoji, name, items]) => items.length > 0 && (
            <div key={name} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '8px 4px 6px' }}>{emoji} {name}</div>
              {items.map(item => (
                <div
                  key={item.id} className="task" style={{ cursor: 'pointer' }}
                  onClick={() => jump(name === '任务' ? '/today' : name === '日记' ? '/diary' : name === '知识' ? '/knowledge' : '/profile')}
                >
                  <div className="t-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</div>
                  {item.sub && <span className="t-tag">{item.sub}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
