/**
 * 日记与随手记：时间线 + 便签墙 + 写日记编辑器（Markdown）
 */
import { useState, useRef } from 'react'
import { draftValue, useSafeDraft } from '../useSafeDraft'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { renderMd, renderInlineMd } from '../md'
import { api, prettyDate, today } from '../api'
import { Empty, Modal, useToast, useConfirm } from '../components/ui'

interface Journal {
  id: number; journal_date: string; mood: number | null; weather: string
  title: string; content: string; tags: string[]
}
interface Note { id: number; content: string; color: string; pinned: number; created_at: string }

const MOODS = ['😭', '😕', '😊', '🥳', '🤩']
const WEATHERS = ['☀️', '⛅', '🌧️', '❄️', '🌫️']

export default function Diary() {
  const qc = useQueryClient()
  const toast = useToast()
  const { confirm, confirmNode } = useConfirm()
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<Journal | 'new' | null>(null)
  const [reading, setReading] = useState<Journal | null>(null) // 阅读全文
  const [editingNote, setEditingNote] = useState<Note | null>(null) // 正在修改的随手记
  const [editNoteText, setEditNoteText] = useState('')
  // 编辑器状态
  const [form, setForm] = useState({ title: '', content: '', mood: 3, weather: '☀️', tags: '' })
  const [preview, setPreview] = useState(false)
  const contentRef = useRef<HTMLTextAreaElement>(null) // 正文输入框（格式按钮操作选区用）
  const journalId = useRef<number | null>(null)
  const draftKey = edit ? 'life-journal-draft-' + (edit === 'new' ? today() : edit.id) : null
  const saveStatus = useSafeDraft(draftKey, form, async () => {
    const payload={...form,tags:form.tags.split(/[,，]/).map(t=>t.trim()).filter(Boolean)}
    if(journalId.current) await api.put(`/api/journals/${journalId.current}`,payload)
    else { const saved=await api.post<Journal>('/api/journals',{...payload,journal_date:today()});journalId.current=saved.id }
    qc.invalidateQueries({queryKey:['journals']})
  })

  const { data: journals } = useQuery({
    queryKey: ['journals', q],
    queryFn: () => api.get<Journal[]>(`/api/journals${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  })
  const { data: notes } = useQuery({ queryKey: ['notes'], queryFn: () => api.get<Note[]>('/api/notes') })
  const { data: overview } = useQuery({ queryKey: ['overview'], queryFn: () => api.get<{ streak: number }>('/api/stats/overview') })

  const openEditor = (j: Journal | 'new') => {
    journalId.current=j==='new'?null:j.id
    if (j === 'new') {
      setForm({ title: '', content: '', mood: 3, weather: '☀️', tags: '' })
      setEdit('new')
    } else {
      setForm({ title: j.title || '', content: j.content || '', mood: j.mood || 3, weather: j.weather || '☀️', tags: (j.tags || []).join(', ') })
      setEdit(j)
    }
    const key='life-journal-draft-'+(j==='new'?today():j.id)
    const recovered=draftValue<typeof form | null>(key,null);if(recovered)setForm(recovered)
    setPreview(false)
  }

  const saveJournal = useMutation({
    mutationFn: () => {
      const tags = form.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean)
      const payload = { ...form, mood: form.mood, weather: form.weather, tags }
      if (!journalId.current) return api.post('/api/journals', { ...payload, journal_date: today() })
      return api.put(`/api/journals/${journalId.current}`, payload)
    },
    onSuccess: () => { if(draftKey)localStorage.removeItem(draftKey);setEdit(null); toast('日记已保存 📔'); qc.invalidateQueries({ queryKey: ['journals'] }); qc.invalidateQueries({ queryKey: ['overview'] }) },
    onError: (e: Error) => toast(e.message),
  })

  const delJournal = useMutation({
    mutationFn: (id: number) => api.del(`/api/journals/${id}`),
    onSuccess: () => { toast('已移入回收站 🗑️'); qc.invalidateQueries({ queryKey: ['journals'] }) },
  })

  const addNote = useMutation({
    mutationFn: (content: string) => api.post('/api/notes', { content }),
    onSuccess: () => { toast('已存入随手记 📌'); qc.invalidateQueries({ queryKey: ['notes'] }) },
  })
  const noteToJournal = useMutation({
    mutationFn: (id: number) => api.post(`/api/notes/${id}/to-journal`),
    onSuccess: () => { toast('已转成今天的日记 ✍️'); qc.invalidateQueries({ queryKey: ['notes'] }); qc.invalidateQueries({ queryKey: ['journals'] }) },
  })
  const delNote = useMutation({
    mutationFn: (id: number) => api.del(`/api/notes/${id}`),
    onSuccess: () => { toast('已移入回收站 🗑️'); qc.invalidateQueries({ queryKey: ['notes'] }) },
  })
  // 保存随手记修改（内容 + 颜色）
  const saveNoteEdit = useMutation({
    mutationFn: () => api.put(`/api/notes/${editingNote!.id}`, {
      content: editNoteText,
      color: editingNote!.color,
    }),
    onSuccess: () => {
      setEditingNote(null)
      toast('已修改 ✏️')
      qc.invalidateQueries({ queryKey: ['notes'] })
    },
    onError: (e: Error) => toast(e.message),
  })

  return (
    <div>
      <div className="page-title-row">
        <div className="page-title">📔 日记与随手记</div>
        <div className="page-sub">不用关联任何任务，想写就写 · 连续记录 {overview?.streak ?? 0} 天 🔥</div>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => openEditor('new')}>✍️ 写今天的日记</button>
      </div>

      <div className="diary-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 330px', gap: 20 }}>
        <div className="card">
          <div className="card-title">
            🌸 日记时间线
            <input className="input" style={{ width: 200, marginLeft: 'auto', padding: '6px 12px' }}
              placeholder="🔍 搜日记内容…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          {journals?.length === 0 && <Empty emoji="🌱" text="还没有日记。今天的心情值得被记下来～" />}
          {(journals || []).map(j => (
            <div key={j.id} className="diary-item" style={{ display: 'flex', gap: 16, padding: '18px 6px', borderBottom: '1px dashed var(--line)', cursor: 'pointer' }}
              onClick={() => setReading(j)}>
              <div style={{ width: 48, height: 48, borderRadius: 16, flexShrink: 0, fontSize: 23, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--cream-deep)' }}>
                {j.mood ? MOODS[j.mood - 1] : '📔'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h4 style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); setReading(j) }}>{j.title || '（无标题日记）'}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink-soft)', fontWeight: 'normal' }}>
                    {prettyDate(j.journal_date)} {j.weather}
                  </span>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                    <button className="btn btn-sm" onClick={() => setReading(j)}>查看</button>
                    <button className="btn btn-sm" onClick={() => openEditor(j)}>编辑</button>
                    <button className="btn btn-sm btn-danger" onClick={() => confirm('确定删除这篇日记吗？（会进入回收站，30 天内可找回）', () => delJournal.mutate(j.id))}>删除</button>
                  </span>
                </h4>
                <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.7, margin: '6px 0' }}>
                  <span dangerouslySetInnerHTML={{ __html: renderInlineMd(
                    (j.content || '').slice(0, 100) + ((j.content || '').length > 100 ? '…' : '')
                  ) }} />
                </p>
                {(j.tags || []).length > 0 && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {j.tags.map((t, i) => <span key={t} className={`t-tag${i === 0 ? '' : ' blue'}`}>#{t}</span>)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 随手记便签墙 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card">
            <div className="card-title">📌 随手记便签墙 <span className="hint">{notes?.length ?? 0} 条 · 悬停可转日记</span></div>
            <QuickNoteInput onSave={c => addNote.mutateAsync(c)} />
            <div className="notes-wall">
              {notes?.length === 0 && <Empty emoji="💡" text="灵感、金句、待整理的碎片，先钉在这里" />}
              {(notes || []).map((n, i) => {
                // 按条目轮换五种柔和便签色 + 轻微交替倾斜，营造手账感
                const palette = [
                  { bg: '#FFF6D9', edge: '#F0D98A', emoji: '🌻' },
                  { bg: '#FFE9EE', edge: '#F5B8C6', emoji: '🌸' },
                  { bg: '#E3F6EC', edge: '#A8DCC2', emoji: '🌿' },
                  { bg: '#EFE9FF', edge: '#CBBDF0', emoji: '🫧' },
                  { bg: '#E7F1FD', edge: '#AECFEF', emoji: '💧' },
                ]
                const p = palette[i % palette.length]
                const tilt = i % 2 === 0 ? '-0.5deg' : '0.5deg'
                const time = (n.created_at || '').replace('T', ' ').slice(5, 16) // 10-31 19:41
                return (
                  <div key={n.id} className="note-card" style={{
                    background: p.bg, borderLeft: `3px solid ${p.edge}`, transform: `rotate(${tilt})`,
                  }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'rotate(0deg) scale(1.02)' }}
                    onMouseLeave={e => { e.currentTarget.style.transform = `rotate(${tilt})` }}>
                    <div className="note-head">
                      <span className="note-dot" style={{ background: p.edge }}>{p.emoji}</span>
                      <span className="note-time">{time}</span>
                    </div>
                    <div className="note-body">{n.content}</div>
                    <div className="note-actions">
                      <button className="note-btn" title="修改"
                        onClick={e => { e.stopPropagation(); setEditingNote(n); setEditNoteText(n.content) }}>✏️</button>
                      <button className="note-btn" onClick={() => noteToJournal.mutate(n.id)}>✍️ 转日记</button>
                      <button className="note-btn note-btn-danger"
                        onClick={() => confirm('确定删除这条随手记吗？', () => delNote.mutate(n.id))}>🗑️</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 修改随手记 */}
      {editingNote && (
        <Modal title="✏️ 修改随手记" onClose={() => setEditingNote(null)}>
          <div className="form-row"><label>内容</label>
            <textarea className="textarea" style={{ minHeight: 120 }} autoFocus
              value={editNoteText} onChange={e => setEditNoteText(e.target.value)} />
          </div>
          <p style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 10 }}>
            💡 便签在墙上的颜色按位置自动轮换；写完想升级成日记，用便签上的"✍️ 转日记"。
          </p>
          <div className="form-actions">
            <button className="btn" onClick={() => setEditingNote(null)}>取消</button>
            <button className="btn btn-primary" disabled={!editNoteText.trim()}
              onClick={() => saveNoteEdit.mutate()}>保存修改</button>
          </div>
        </Modal>
      )}
      {/* 阅读全文 */}
      {reading && (
        <Modal title={`${MOODS[(reading.mood || 3) - 1] || '📔'} ${reading.title || '（无标题日记）'}`}
          onClose={() => setReading(null)} wide>
          <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 12 }}>
            {prettyDate(reading.journal_date)} {reading.weather}
            {(reading.tags || []).map(t => <span key={t} className="t-tag green" style={{ marginLeft: 6 }}>#{t}</span>)}
          </p>
          <div className="md-preview" style={{ fontSize: 14, lineHeight: 2 }}
            dangerouslySetInnerHTML={{ __html: renderMd(reading.content || '（这篇日记没有正文）') }} />
          <div className="form-actions">
            <button className="btn" onClick={() => setReading(null)}>关闭</button>
            <button className="btn btn-primary" onClick={() => { openEditor(reading); setReading(null) }}>✏️ 编辑这篇</button>
          </div>
        </Modal>
      )}
      {/* 写日记 / 编辑日记 */}
      {edit && (
        <Modal title={edit === 'new' ? '✍️ 写日记' : '✏️ 编辑日记'} onClose={() => setEdit(null)} wide>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
            <div style={{ flex: 2, minWidth: 220 }}>
              <label style={{ fontSize: 13, color: 'var(--ink-soft)' }}>标题</label>
              <input className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="今天的一句话主题（可留空）" />
            </div>
            <div>
              <label style={{ fontSize: 13, color: 'var(--ink-soft)' }}>心情</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {MOODS.map((m, i) => (
                  <button key={m} className={`mood${form.mood === i + 1 ? ' sel' : ''}`} style={{ width: 38, height: 38, fontSize: 18 }}
                    onClick={() => setForm({ ...form, mood: i + 1 })}>{m}</button>
                ))}
              </div>
            </div>
            <div>
              <label style={{ fontSize: 13, color: 'var(--ink-soft)' }}>天气</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {WEATHERS.map(w => (
                  <button key={w} className={`mood${form.weather === w ? ' sel' : ''}`} style={{ width: 38, height: 38, fontSize: 18 }}
                    onClick={() => setForm({ ...form, weather: w })}>{w}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="form-row">
            <label>正文（选中文字后点按钮加格式；也支持手写 Markdown）</label>
            {!preview && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                {([
                  ['B', '加粗', (sel: string) => `**${sel || '加粗文字'}**`, 'bold'],
                  ['I', '斜体', (sel: string) => `*${sel || '斜体文字'}*`, 'italic'],
                  ['H2', '标题', (sel: string) => `\n## ${sel || '小标题'}\n`, 'heading'],
                  ['•', '列表', (sel: string) => `\n- ${sel || '列表项'}`, 'list'],
                  ['引', '引用', (sel: string) => `\n> ${sel || '引用的话'}\n`, 'quote'],
                ] as const).map(([label, tip, wrap, cls]) => (
                  <button key={label} type="button" className={`md-btn ${cls}`} title={tip}
                    onClick={() => {
                      const ta = contentRef.current
                      if (!ta) return
                      const s = ta.selectionStart, e = ta.selectionEnd
                      const sel = form.content.slice(s, e)
                      const next = form.content.slice(0, s) + wrap(sel) + form.content.slice(e)
                      setForm({ ...form, content: next })
                      setTimeout(() => { ta.focus(); ta.setSelectionRange(s, s + next.length - (form.content.length - e)) }, 0)
                    }}>{label}</button>
                ))}
              </div>
            )}
            {preview ? (
              <div className="textarea md-preview" style={{ background: 'var(--cream)', minHeight: 220 }}
                dangerouslySetInnerHTML={{ __html: renderMd(form.content || '*（空空如也～）*') }} />
            ) : (
              <textarea ref={contentRef} className="textarea" style={{ minHeight: 220 }} value={form.content}
                onChange={e => setForm({ ...form, content: e.target.value })}
                placeholder={'今天发生了什么？心情如何？\n\n## 值得记下的\n- …'} />
            )}
          </div>
          <div className="form-row">
            <label>标签（逗号分隔，如：复盘, 小确幸）</label>
            <input className="input" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} />
          </div>
          <p role="status">{saveStatus}</p><div className="form-actions">
            <button className="btn" onClick={() => setPreview(!preview)}>{preview ? '📝 继续编辑' : '👁️ 预览'}</button>
            <button className="btn" onClick={() => setEdit(null)}>取消</button>
            <button className="btn btn-primary" onClick={() => saveJournal.mutate()}>保存日记</button>
          </div>
        </Modal>
      )}
      {confirmNode}
    </div>
  )
}

function QuickNoteInput({ onSave }: { onSave: (content: string) => Promise<unknown> }) {
  const [text, setText] = useState(() => draftValue('life-note-draft',''))
  const submit=async()=>{const submitted=text.trim();if(!submitted)return;try{await onSave(submitted);setText(current=>{if(current.trim()===submitted){localStorage.removeItem('life-note-draft');return ''}return current})}catch{ /* 请求失败保留输入及草稿 */ }}
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input className="input" style={{ borderStyle: 'dashed' }} placeholder="💡 快速记一条…"
        value={text} onChange={e => {setText(e.target.value);localStorage.setItem('life-note-draft',JSON.stringify(e.target.value))}}
        onKeyDown={e => { if (e.key === 'Enter' && text.trim()) { void submit() } }} />
      <button className="btn btn-ghost" disabled={!text.trim()} onClick={() => { void submit() }}>钉上</button>
    </div>
  )
}
