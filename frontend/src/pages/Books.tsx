/**
 * 📖 读书：书架（在读/读完/想读）+ 进度条 + 读书笔记 + 年度书单
 */
import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { renderMd } from '../md'
import { api, today } from '../api'
import { Empty, Modal, useToast, useConfirm } from '../components/ui'

interface Book {
  id: number; title: string; author: string
  status: 'reading' | 'finished' | 'wishlist' | string
  progress: number; rating: number | null
  started_date: string; finished_date: string
  notes: string; cover_path?: string
}

const STATUS: Record<string, { label: string; emoji: string; cls: string }> = {
  reading: { label: '在读', emoji: '📖', cls: '' },
  finished: { label: '读完', emoji: '✅', cls: 'blue' },
  wishlist: { label: '想读', emoji: '🌱', cls: 'green' },
}
// 书封配色（按 id 轮换，模拟不同封面的书脊感）
const COVERS = [
  { bg: '#FFE4EA', spine: '#F5A8B8', emoji: '📕' },
  { bg: '#E3F0FD', spine: '#9CC3EE', emoji: '📘' },
  { bg: '#E3F6EC', spine: '#8FD8B8', emoji: '📗' },
  { bg: '#FFF3D6', spine: '#F0CE7A', emoji: '📙' },
  { bg: '#EFE9FF', spine: '#C3B2F0', emoji: '📓' },
  { bg: '#FFEFE0', spine: '#F0B48A', emoji: '📒' },
]

export default function Books() {
  const qc = useQueryClient()
  const toast = useToast()
  const { confirm, confirmNode } = useConfirm()
  const [filter, setFilter] = useState('') // ''全部 / reading / finished / wishlist
  const [year, setYear] = useState(new Date().getFullYear())
  const [edit, setEdit] = useState<Book | 'new' | null>(null)
  const [view, setView] = useState<Book | null>(null)
  const [form, setForm] = useState({
    title: '', author: '', status: 'reading', progress: 0,
    rating: 0, started_date: '', finished_date: '', notes: '', cover_path: '',
  })
  // 封面：上传 / 网上搜索候选
  const [coverSearching, setCoverSearching] = useState(false)
  const [coverCandidates, setCoverCandidates] = useState<{ cover: string; title: string }[]>([])
  const coverFileRef = useRef<HTMLInputElement>(null)

  const uploadCover = (file: File | undefined | null) => {
    if (!file) return
    const fd = new FormData()
    fd.append('file', file)
    fetch('/api/uploads/image', { method: 'POST', body: fd })
      .then(r => r.json())
      .then(j => { setForm(f => ({ ...f, cover_path: j.data.url })); toast('封面已就位 🖼️') })
      .catch(() => toast('封面上传失败'))
  }
  const searchCover = async () => {
    if (!form.title.trim()) { toast('先填书名再搜封面哦'); return }
    setCoverSearching(true); setCoverCandidates([])
    try {
      const j = await api.get<{ candidates: { cover: string; title: string }[]; message?: string }>(
        `/api/books/search-cover?q=${encodeURIComponent(form.title + (form.author ? ' ' + form.author : ''))}`)
      setCoverCandidates(j.candidates || [])
      if (!(j.candidates || []).length) toast(j.message || '没找到候选封面，可以手动上传')
    } catch { toast('搜索失败，可手动上传封面') }
    finally { setCoverSearching(false) }
  }
  const pickCover = async (url: string) => {
    try {
      const j = await api.post<{ url: string }>('/api/books/save-cover', { url })
      setForm(f => ({ ...f, cover_path: j.url }))
      toast('封面已选定 🖼️')
    } catch { toast('封面下载失败，换一张试试') }
  }

  const { data: books } = useQuery({ queryKey: ['books'], queryFn: () => api.get<Book[]>('/api/books') })

  const openEditor = (b: Book | 'new') => {
    setCoverCandidates([])
    if (b === 'new') setForm({ title: '', author: '', status: 'reading', progress: 0, rating: 0, started_date: today(), finished_date: '', notes: '', cover_path: '' })
    else setForm({
      title: b.title, author: b.author, status: b.status, progress: b.progress,
      rating: b.rating ?? 0, started_date: b.started_date, finished_date: b.finished_date, notes: b.notes || '',
      cover_path: b.cover_path || '',
    })
    setEdit(b)
  }

  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, rating: form.rating || null }
      return edit === 'new' ? api.post('/api/books', payload) : api.put(`/api/books/${(edit as Book).id}`, payload)
    },
    onSuccess: () => { setEdit(null); toast('书架已更新 📖'); qc.invalidateQueries({ queryKey: ['books'] }) },
    onError: (e: Error) => toast(e.message),
  })
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/api/books/${id}`),
    onSuccess: () => { toast('已移入回收站 🗑️'); qc.invalidateQueries({ queryKey: ['books'] }) },
  })
  // 快捷进度更新（在读卡片上的 -10/+10）
  const bumpProgress = useMutation({
    mutationFn: (arg: { b: Book; delta: number }) =>
      api.put(`/api/books/${arg.b.id}`, { progress: Math.max(0, Math.min(100, arg.b.progress + arg.delta)) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['books'] }),
  })

  // 统计
  const stats = useMemo(() => {
    const all = books || []
    return {
      reading: all.filter(b => b.status === 'reading').length,
      wishlist: all.filter(b => b.status === 'wishlist').length,
      finishedThisYear: all.filter(b => b.status === 'finished' && (b.finished_date || '').startsWith(String(year))).length,
      finishedAll: all.filter(b => b.status === 'finished').length,
    }
  }, [books, year])

  const filtered = useMemo(() => {
    let list = books || []
    if (filter === 'reading' || filter === 'wishlist') list = list.filter(b => b.status === filter)
    if (filter === 'finished') list = list.filter(b => b.status === 'finished')
    return list
  }, [books, filter])

  const finishedThisYear = (books || []).filter(b => b.status === 'finished' && (b.finished_date || '').startsWith(String(year)))
  const years = useMemo(() =>
    [...new Set((books || []).filter(b => b.finished_date).map(b => b.finished_date.slice(0, 4)))].sort().reverse(),
    [books])

  const stars = (n: number | null) => '★'.repeat(n ?? 0) + '☆'.repeat(5 - (n ?? 0))

  const BookCard = ({ b }: { b: Book }) => {
    const cover = COVERS[b.id % COVERS.length]
    const st = STATUS[b.status]
    return (
      <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', cursor: 'pointer' }}
        onClick={() => setView(b)}>
        {/* 书封：有真实封面用图，否则彩色书脊设计 */}
        {b.cover_path ? (
          <img src={b.cover_path} alt={b.title}
            style={{ width: 96, flexShrink: 0, objectFit: 'cover', borderRight: '1px solid var(--line)' }} />
        ) : (
          <div style={{
            width: 86, flexShrink: 0, background: `linear-gradient(135deg, ${cover.bg}, ${cover.spine}55)`,
            borderRight: `4px solid ${cover.spine}`, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 4, padding: '14px 6px',
          }}>
            <span style={{ fontSize: 26 }}>{cover.emoji}</span>
            <span style={{ fontSize: 11, fontWeight: 'bold', color: 'var(--ink)', textAlign: 'center', lineHeight: 1.4 }}>
              {b.title.slice(0, 8)}
            </span>
          </div>
        )}
        {/* 信息 */}
        <div style={{ flex: 1, minWidth: 0, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={`t-tag ${st.cls}`} style={{ fontWeight: 'bold' }}>{st.emoji} {st.label}</span>
            {b.rating ? <span style={{ color: '#F0A500', fontSize: 13, letterSpacing: 1 }}>{stars(b.rating)}</span> : null}
          </div>
          <h4 style={{ fontSize: 15, margin: '8px 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title}</h4>
          <p style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{b.author || '佚名'}</p>
          {b.status === 'reading' && (
            <>
              <div className="track" style={{ marginTop: 10 }}><div className="fill" style={{ width: `${b.progress}%` }} /></div>
              <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>读到 {b.progress}%</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                  <button className="btn btn-sm" onClick={() => bumpProgress.mutate({ b, delta: -10 })}>−10%</button>
                  <button className="btn btn-sm" onClick={() => bumpProgress.mutate({ b, delta: 10 })}>+10%</button>
                </span>
              </div>
            </>
          )}
          {b.status === 'finished' && b.finished_date && (
            <p style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 8 }}>📅 {b.finished_date} 读完</p>
          )}
          {b.notes && <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 8, fontStyle: 'italic' }}>📝 有读书笔记</p>}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-title-row">
        <div className="page-title">📖 读书</div>
        <div className="page-sub">今年读完 {stats.finishedThisYear} 本 · 在读 {stats.reading} 本 · 想读 {stats.wishlist} 本（累计读完 {stats.finishedAll} 本）</div>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => openEditor('new')}>＋ 加一本书</button>
      </div>

      {/* 年度书单 */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">
          🏆 {year} 年度书单 <span className="hint">今年读完了 {finishedThisYear.length} 本</span>
          {years.length > 0 && (
            <select className="select" style={{ width: 'auto', marginLeft: 'auto' }} value={year} onChange={e => setYear(+e.target.value)}>
              {years.map(y => <option key={y} value={y}>{y} 年</option>)}
            </select>
          )}
        </div>
        {finishedThisYear.length === 0
          ? <Empty emoji="🌱" text={`${year} 年还没标记读完的书。读完一本，在编辑里把状态改成「读完」就好`} />
          : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {finishedThisYear.map(b => (
                <span key={b.id} className="t-tag blue" style={{ fontSize: 13, padding: '6px 14px', cursor: 'pointer' }}
                  onClick={() => setView(b)}>
                  📕 {b.title}{b.rating ? ` · ${stars(b.rating)}` : ''}
                </span>
              ))}
            </div>
          )}
      </div>

      {/* 筛选 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[['', '全部'], ['reading', '📖 在读'], ['finished', '✅ 读完'], ['wishlist', '🌱 想读']].map(([k, label]) => (
          <button key={k} className={`chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k as string)}>{label}</button>
        ))}
      </div>

      {filtered.length === 0 && <div className="card"><Empty emoji="📖" text="书架空空的。把你正在读 / 想读的书加进来吧" /></div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
        {filtered.map(b => (
          <div key={b.id} style={{ position: 'relative' }}>
            <BookCard b={b} />
            {/* 悬停操作 */}
            <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4, zIndex: 2 }}
              onClick={e => e.stopPropagation()}>
              <button className="t-del" style={{ opacity: 1, background: '#fff', borderRadius: 8, width: 26, height: 26 }}
                title="编辑" onClick={() => openEditor(b)}>✏️</button>
              <button className="t-del" style={{ opacity: 1, background: '#fff', borderRadius: 8, width: 26, height: 26 }}
                title="删除" onClick={() => confirm(`确定把《${b.title}》移出书架吗？（会进入回收站）`, () => del.mutate(b.id))}>✕</button>
            </div>
          </div>
        ))}
      </div>

      {/* 查看详情 + 读书笔记 */}
      {view && (
        <Modal title={`📖 ${view.title}`} onClose={() => setView(null)} wide>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 10 }}>
            {view.author || '佚名'} · {STATUS[view.status]?.label}
            {view.status === 'finished' && view.rating ? ` · ${stars(view.rating)}` : ''}
            {view.progress ? ` · 进度 ${view.progress}%` : ''}
          </p>
          <div className="card-title" style={{ marginBottom: 6 }}>📝 我的读书笔记</div>
          <div className="md-preview" style={{ fontSize: 14, lineHeight: 2, minHeight: 60 }}>
            {renderMd(view.notes || '*（还没写感悟。点右下角编辑补上吧～）*')}
          </div>
          <div className="form-actions">
            <button className="btn" onClick={() => setView(null)}>关闭</button>
            <button className="btn btn-primary" onClick={() => { openEditor(view); setView(null) }}>✏️ 编辑这本书</button>
          </div>
        </Modal>
      )}

      {/* 新建 / 编辑 */}
      {edit && (
        <Modal title={edit === 'new' ? '📖 加一本书' : '✏️ 编辑书籍'} onClose={() => setEdit(null)}>
          <div className="form-row"><label>书名 *</label>
            <input className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} autoFocus placeholder="比如：《认知觉醒》" />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="form-row" style={{ flex: 1 }}><label>作者</label>
              <input className="input" value={form.author} onChange={e => setForm({ ...form, author: e.target.value })} />
            </div>
            <div className="form-row" style={{ flex: 1 }}><label>状态</label>
              <select className="select" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                <option value="reading">📖 在读</option>
                <option value="finished">✅ 读完</option>
                <option value="wishlist">🌱 想读</option>
              </select>
            </div>
          </div>
          <div className="form-row"><label>阅读进度：{form.progress}%</label>
            <input type="range" min="0" max="100" step="5" value={form.progress} style={{ width: '100%' }}
              onChange={e => setForm({ ...form, progress: +e.target.value })} disabled={form.status !== 'reading'} />
          </div>
          {form.status === 'finished' && (
            <div style={{ display: 'flex', gap: 12 }}>
              <div className="form-row" style={{ flex: 1 }}><label>读完日期</label>
                <input className="input" type="date" value={form.finished_date} onChange={e => setForm({ ...form, finished_date: e.target.value })} />
              </div>
              <div className="form-row"><label>评分</label>
                <div style={{ display: 'flex', gap: 2, alignItems: 'center', height: 42 }}>
                  {[1, 2, 3, 4, 5].map(n => (
                    <button key={n} type="button" style={{ border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', color: n <= (form.rating || 0) ? '#F0A500' : '#E0D5CC' }}
                      onClick={() => setForm({ ...form, rating: form.rating === n ? 0 : n })}>★</button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="form-row"><label>封面（联网搜索或本地上传，可选）</label>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              {form.cover_path ? (
                <img src={form.cover_path} alt="封面"
                  style={{ width: 84, height: 116, objectFit: 'cover', borderRadius: 8, boxShadow: '0 4px 12px rgba(92,74,68,.15)' }} />
              ) : (
                <div style={{ width: 84, height: 116, borderRadius: 8, background: 'var(--cream-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>📕</div>
              )}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-sm btn-ghost" disabled={coverSearching || !form.title.trim()}
                    onClick={() => searchCover()}>{coverSearching ? '搜索中…' : '🔍 网上找封面'}</button>
                  <button type="button" className="btn btn-sm" onClick={() => coverFileRef.current?.click()}>🖼️ 上传图片</button>
                  {form.cover_path && (
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => setForm({ ...form, cover_path: '' })}>移除</button>
                  )}
                  <input ref={coverFileRef} type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={e => { uploadCover(e.target.files?.[0]); e.target.value = '' }} />
                </div>
                {coverCandidates.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {coverCandidates.map((c, i) => (
                      <img key={i} src={c.cover} title={c.title} alt={c.title}
                        style={{ width: 52, height: 74, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', border: '2px solid transparent' }}
                        onClick={() => pickCover(c.cover)}
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="form-row"><label>读书笔记 / 感悟（Markdown，随时可补）</label>
            <textarea className="textarea" style={{ minHeight: 130 }} value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              placeholder={'最打动你的一句话 / 一个观点\n你打算怎么用上它\n\n例：\n- 复利思维：每天进步 1%，一年 37 倍\n- 我的行动：把大目标拆成每日任务'} />
          </div>
          <div className="form-actions">
            <button className="btn" onClick={() => setEdit(null)}>取消</button>
            <button className="btn btn-primary" disabled={!form.title.trim()} onClick={() => save.mutate()}>保存</button>
          </div>
        </Modal>
      )}
      {confirmNode}
    </div>
  )
}
