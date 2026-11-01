/**
 * 今日工作台：问候 + 今日任务 + 习惯打卡 + 心情速记 + 本周概览
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { draftValue, useSafeDraft } from '../useSafeDraft'
import { api, prettyDate, today } from '../api'
import { Empty, Modal, useToast } from '../components/ui'
import Mascot from '../components/Mascot'

interface Task { id: number; title: string; done: number; priority: number; task_date: string; goal_id: number | null; project_id: number | null; summary?: string; recurrence_id?: number | null; category?: string; estimate_min?: number | null; knowledge_ids?: number[] }
interface KnowledgeCard { id: number; title: string; category: string }

// 任务分类分组（显示顺序即此顺序；未分类的归入最后的"✨ 其他"）
const CATEGORIES = ['☀️ 晨间', '💪 运动', '📖 学习', '💻 开发', '🌙 晚间', '🛒 生活', '✨ 其他']
interface Habit { id: number; name: string; icon: string; checked_today: boolean }
interface Overview { date: string; tasks_total: number; tasks_done: number; habits_total: number; habits_checked: number; today_mood: number | null; streak: number }
interface Goal { id: number; title: string; type: string }
interface Project { id: number; title: string }
interface Journal { id: number; journal_date: string; mood: number | null }

const MOODS = ['😭', '😕', '😊', '🥳', '🤩'] // 下标 0-4 → 心情 1-5

export default function Today() {
  const qc = useQueryClient()
  const toast = useToast()
  const [newTitle, setNewTitle] = useState('')
  const [newPriority, setNewPriority] = useState(false)
  const [newRepeat, setNewRepeat] = useState('none') // none/daily/weekdays/weekly-0~6
  const [newCategory, setNewCategory] = useState('')
  const [showMore, setShowMore] = useState(false) // 添加任务时展开更多选项
  const [goalId, setGoalId] = useState(0)
  const [projectId, setProjectId] = useState(0)
  const [quickNote, setQuickNote] = useState(() => draftValue('life-today-note-draft',''))
  // 任务卡日期切换：默认今天，可回看昨天/前天的任务记录
  const [viewDate, setViewDate] = useState(today())
  const [summaryFor, setSummaryFor] = useState<Task | null>(null) // 正在写总结的任务
  const [summaryText, setSummaryText] = useState('')
  // 任务编辑（✏️ 按钮）：标题写错了、日期放错了都能改
  const [editFor, setEditFor] = useState<Task | null>(null)
  const [editForm, setEditForm] = useState({ title: '', task_date: '', category: '', priority: 0, estimate_min: '' })
  const [editKnowledgeIds, setEditKnowledgeIds] = useState<number[]>([]) // 关联的知识卡片
  const summaryKey=summaryFor?'life-summary-draft-'+summaryFor.id:null
  const summaryStatus=useSafeDraft(summaryKey,summaryText,async()=>{await api.put(`/api/tasks/${summaryFor!.id}`,{summary:summaryText});qc.invalidateQueries({queryKey:['tasks']})})

  const { data: overview } = useQuery({ queryKey: ['overview'], queryFn: () => api.get<Overview>('/api/stats/overview') })
  const { data: tasks } = useQuery({ queryKey: ['tasks', viewDate], queryFn: () => api.get<Task[]>(`/api/tasks?date=${viewDate}`) })
  const { data: habits } = useQuery({ queryKey: ['habits'], queryFn: () => api.get<Habit[]>('/api/habits') })
  const { data: goals } = useQuery({ queryKey: ['goals'], queryFn: () => api.get<Goal[]>('/api/goals') })
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/api/projects') })
  const { data: journals } = useQuery({ queryKey: ['journals'], queryFn: () => api.get<Journal[]>(`/api/journals?date=${today()}`) })
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Record<string, string>>('/api/data/settings') })
  const { data: knowledgeCards } = useQuery({ queryKey: ['knowledge'], queryFn: () => api.get<KnowledgeCard[]>('/api/knowledge?limit=500') })
  const { data: weekLogs } = useQuery({
    queryKey: ['week-logs'],
    queryFn: () => api.get<{ habit_id: number; log_date: string }[]>(`/api/habits/logs?from_=${weekStart()}&to=${today()}`),
  })
  // 本周已完成的任务（周概览 = 打卡 + 完成任务一起算）
  const { data: weekTasks } = useQuery({
    queryKey: ['week-tasks'],
    queryFn: () => api.get<Task[]>(`/api/tasks?from_=${weekStart()}&to=${today()}`),
  })

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['tasks'] })
    qc.invalidateQueries({ queryKey: ['overview'] })
    qc.invalidateQueries({ queryKey: ['week-logs'] })
  }

  const addTask = useMutation({
    mutationFn: (title: string) => {
      // 选了重复 → 建规则（今日实例由查询时自动生成）；否则建普通任务
      // （回看过去日期时，新任务加到正在查看的那天）
      if (newRepeat !== 'none') {
        const isWeekly = newRepeat.startsWith('weekly-')
        return api.post('/api/recurrences', {
          title, priority: newPriority ? 1 : 0,
          goal_id: goalId || null, project_id: projectId || null,
          repeat_type: isWeekly ? 'weekly' : newRepeat,
          weekdays: isWeekly ? [Number(newRepeat.split('-')[1])] : [],
        })
      }
      return api.post('/api/tasks', {
        title, task_date: viewDate, priority: newPriority ? 1 : 0,
        goal_id: goalId || null, project_id: projectId || null,
        category: newCategory || '',
      })
    },
    onSuccess: () => {
      setNewTitle(''); setShowMore(false); setNewRepeat('none'); setNewCategory('')
      setGoalId(0); setProjectId(0); refreshAll()
      toast(newRepeat !== 'none' ? '重复任务已创建，以后每天自动出现 🔁' : '')
    },
    onError: (e: Error) => toast(e.message),
  })

  // 保存"今日总结"
  const saveSummary = useMutation({
    mutationFn: () => api.put(`/api/tasks/${summaryFor!.id}`, { summary: summaryText }),
    onSuccess: () => {
      if(summaryKey)localStorage.removeItem(summaryKey)
      setSummaryFor(null)
      toast('总结已记下 📝')
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })

  // 保存任务编辑
  const saveEdit = useMutation({
    mutationFn: () => api.put(`/api/tasks/${editFor!.id}`, {
      title: editForm.title,
      task_date: editForm.task_date,
      category: editForm.category,
      priority: editForm.priority,
      estimate_min: editForm.estimate_min === '' ? null : Number(editForm.estimate_min),
      knowledge_ids: editKnowledgeIds,
    }),
    onSuccess: () => {
      setEditFor(null)
      toast('已修改 ✏️')
      refreshAll()
    },
    onError: (e: Error) => toast(e.message),
  })

  const toggle = useMutation({
    mutationFn: (id: number) => api.post(`/api/tasks/${id}/toggle`),
    onSuccess: refreshAll,
  })
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/tasks/${id}`),
    onSuccess: () => { toast('已移入回收站 🗑️'); refreshAll() },
  })

  const checkin = useMutation({
    mutationFn: (habitId: number) => api.post(`/api/habits/${habitId}/checkin`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['habits'] }); qc.invalidateQueries({ queryKey: ['week-logs'] }); qc.invalidateQueries({ queryKey: ['overview'] }) },
  })

  // 选心情：今天已有日记就更新，没有就顺手建一篇
  const setMood = useMutation({
    mutationFn: async (mood: number) => {
      const exist = (journals || []).find(j => j.journal_date === today())
      if (exist) return api.put(`/api/journals/${exist.id}`, { mood })
      return api.post('/api/journals', { journal_date: today(), mood })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['journals'] }); toast('心情已记下 💛') },
  })

  const saveQuickNote = useMutation({
    mutationFn: (content: string) => api.post('/api/notes', { content }),
    onSuccess: () => { setQuickNote('');localStorage.removeItem('life-today-note-draft'); toast('已存入随手记 📌') },
  })

  const done = tasks?.filter(t => t.done).length ?? 0
  const hour = new Date().getHours()
  const greet = hour < 6 ? '夜深了' : hour < 11 ? '早上好呀' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'
  const moodNow = overview?.today_mood ?? null
  const weekLabels = ['一', '二', '三', '四', '五', '六', '日']

  return (
    <div>
      {/* 问候卡（右侧站着专属 IP 吉祥物） */}
      <div className="card" style={{
        background: 'linear-gradient(120deg,#FFC2CD,#F87B93 90%)', border: 'none',
        color: '#fff', padding: '26px 30px', marginBottom: 22, position: 'relative', overflow: 'hidden',
        minHeight: 130,
      }}>
        <h2 style={{ fontSize: 22, marginBottom: 6, position: 'relative', zIndex: 1 }}>{greet}，{settings?.nickname || 'Lynn'} ☀️</h2>
        <p style={{ fontSize: 13, opacity: .92, zIndex: 1, position: 'relative' }}>
          今天是 {prettyDate(today())} {done >= (tasks?.length ?? 0) && (tasks?.length ?? 0) > 0 ? '· 今日任务全部完成，太棒啦！🎉' : ''}
        </p>
        <div style={{
          position: 'absolute', right: 160, top: '50%', transform: 'translateY(-50%)',
          background: 'rgba(255,255,255,.22)', border: '1px solid rgba(255,255,255,.45)',
          padding: '10px 18px', borderRadius: 16, textAlign: 'center', zIndex: 1,
        }}>
          <b style={{ fontSize: 24, display: 'block' }}>{overview?.streak ?? 0}</b>
          <span style={{ fontSize: 11, opacity: .9 }}>🔥 连续打卡天数</span>
        </div>
        <Mascot
          style={{
            position: 'absolute', right: 18, bottom: -2, height: 118, zIndex: 1,
            filter: 'drop-shadow(0 6px 14px rgba(150, 40, 60, 0.25))',
          }} />
      </div>

      <div className="today-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 330px', gap: 20 }}>
        {/* 左列 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card">
            <div className="card-title">
              {viewDate === today() ? '🌸 今日任务' : `🗓️ ${prettyDate(viewDate)} 的任务`}
              <span className="hint">已完成 {done} / {tasks?.length ?? 0}</span>
              {/* 日期切换：回看过去某天的任务记录 */}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                <button className="btn btn-sm" title="前一天"
                  onClick={() => setViewDate(shiftDate(viewDate, -1))}>←</button>
                <input type="date" className="input" style={{ width: 140, padding: '4px 8px', fontSize: 12 }}
                  value={viewDate} max={today()} onChange={e => e.target.value && setViewDate(e.target.value)} />
                <button className="btn btn-sm" title="后一天" disabled={viewDate >= today()}
                  onClick={() => setViewDate(shiftDate(viewDate, 1))}>→</button>
                {viewDate !== today() && (
                  <button className="btn btn-sm btn-ghost" onClick={() => setViewDate(today())}>回今天</button>
                )}
              </span>
            </div>
            {tasks?.length === 0 && <Empty emoji="🌱" text="今天还没有任务，写下第一件想做的事吧" />}
            {/* 按分类分组显示；自定义分类排在最后 */}
            {(() => {
              const customCats = [...new Set((tasks || [])
                .map(t => t.category || '').filter(c => c && !CATEGORIES.includes(c)))]
              const orderedCats = [...CATEGORIES.filter(c => (tasks || []).some(t => (t.category || '') === c)),
                ...customCats.filter(c => (tasks || []).some(t => (t.category || '') === c))]
              return orderedCats.map(cat => {
                const group = (tasks || []).filter(t => (t.category || '') === cat)
                const gDone = group.filter(t => t.done).length
                return (
                  <div key={cat} style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 4px 2px' }}>
                      <span style={{ fontSize: 13, fontWeight: 'bold', color: 'var(--peach-deep)' }}>{cat}</span>
                      <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{gDone}/{group.length}</span>
                      <span style={{ flex: 1, borderBottom: '2px dashed var(--line)' }} />
                    </div>
                    {group.map(t => {
                      const goal = goals?.find(g => g.id === t.goal_id)
                      const proj = projects?.find(p => p.id === t.project_id)
                      const tag = proj?.title || goal?.title
                      return (
                        <div key={t.id} className={`task${t.done ? ' done' : ''}`}>
                          <button className="check" onClick={() => toggle.mutate(t.id)}>{t.done ? '✓' : ''}</button>
                  <div className="t-title">
                    {t.title}
                    {t.summary ? <span title={t.summary} style={{ marginLeft: 6 }}>📝</span> : null}
                    {(t.knowledge_ids || []).length > 0 && (
                      <span className="t-tag green" style={{ marginLeft: 6 }} title={'关联知识：' + (t.knowledge_ids || []).map(kid => knowledgeCards?.find(k => k.id === kid)?.title || '#' + kid).join('、')}>📚 {(t.knowledge_ids || []).length}</span>
                    )}
                  </div>
                          {!!t.priority && <span className="t-flag">🚩</span>}
                          {t.recurrence_id ? <span className="t-flag" title="重复任务">🔁</span> : null}
                          {tag && <span className={`t-tag${proj ? ' blue' : ''}`}>{tag}</span>}
                          <button className="t-del" title="写今日总结"
                            onClick={() => { setSummaryFor(t); setSummaryText(draftValue('life-summary-draft-'+t.id,t.summary || '')) }}>📝</button>
                          <button className="t-del" title="修改任务"
                            onClick={() => {
                              setEditFor(t)
                              setEditForm({
                                title: t.title, task_date: t.task_date,
                                category: t.category || '',
                                priority: t.priority || 0,
                                estimate_min: t.estimate_min == null ? '' : String(t.estimate_min),
                              })
                              setEditKnowledgeIds(t.knowledge_ids || [])
                            }}>✏️</button>
                          <button className="t-del" title="删除" onClick={() => remove.mutate(t.id)}>✕</button>
                        </div>
                      )
                    })}
                  </div>
                )
              })
            })()}
            <div className="add-task" style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <input
                className="input" style={{ borderStyle: 'dashed' }} placeholder="想到什么就写下来… ✍️"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && newTitle.trim()) addTask.mutate(newTitle.trim()) }}
                onFocus={() => setShowMore(true)}
              />
              <button className="btn btn-primary" disabled={!newTitle.trim()} onClick={() => addTask.mutate(newTitle.trim())}>添加</button>
            </div>
            {showMore && (
              <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-soft)' }}>
                  <input type="checkbox" checked={newPriority} onChange={e => setNewPriority(e.target.checked)} /> 🚩 重要任务
                </label>
                <select className="select" style={{ width: 'auto' }} value={newRepeat} onChange={e => setNewRepeat(e.target.value)}>
                  <option value="none">🔁 不重复</option>
                  <option value="daily">🔁 每天</option>
                  <option value="weekdays">🔁 工作日（周一~五）</option>
                  {[1, 2, 3, 4, 5, 6, 0].map(w =>
                    <option key={w} value={`weekly-${w}`}>🔁 每周{'一二三四五六日'[w]}</option>)}
                </select>
                <select className="select" style={{ width: 'auto' }} value={newCategory} onChange={e => setNewCategory(e.target.value)}>
                  <option value="">🏷️ 不分组</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className="select" style={{ width: 'auto', flex: 1, minWidth: 120 }} value={goalId} onChange={e => setGoalId(+e.target.value)}>
                  <option value={0}>不关联目标</option>
                  {goals?.map(g => <option key={g.id} value={g.id}>🎯 {g.title}</option>)}
                </select>
                <select className="select" style={{ width: 'auto', flex: 1, minWidth: 120 }} value={projectId} onChange={e => setProjectId(+e.target.value)}>
                  <option value={0}>不关联项目</option>
                  {projects?.map(p => <option key={p.id} value={p.id}>📦 {p.title}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* 本周概览 */}
          <div className="card">
            <div className="card-title">📅 本周概览 <span className="hint">数字 = 当天完成任务 + 打卡次数</span></div>
            <div style={{ display: 'flex', gap: 8 }}>
              {weekLabels.map((w, i) => {
                const dateStr = addDays(weekStart(), i)
                // 统计口径：当天完成的任务 + 习惯打卡，一起算活跃度
                const habits = weekLogs?.filter(l => l.log_date === dateStr).length ?? 0
                const doneTasks = weekTasks?.filter(t => t.task_date === dateStr && t.done === 1).length ?? 0
                const n = habits + doneTasks
                const isToday = dateStr === today()
                const isFuture = dateStr > today()
                const cls = isFuture ? '' : n >= 3 ? 'on2' : n > 0 ? 'on' : ''
                return (
                  <div key={w} className={`w-cell ${cls}`} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: 'var(--ink-soft)' }}>
                    <div className="cube" style={{
                      height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: n >= 3 ? 'var(--peach)' : n > 0 ? 'var(--peach-light)' : 'var(--cream-deep)',
                      marginBottom: 5, fontSize: 13, outline: isToday ? '2px solid var(--peach)' : 'none', outlineOffset: 2,
                    }} title={isFuture ? undefined : `任务 ${doneTasks} · 打卡 ${habits}`}>
                      {isFuture ? '·' : n > 0 ? n : ''}
                    </div>
                    周{w}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* 右列 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card">
            <div className="card-title">✅ 习惯打卡 <span className="hint">{overview?.habits_checked ?? 0}/{overview?.habits_total ?? 0}</span></div>
            {habits?.length === 0 && <Empty emoji="🌸" text="还没有习惯，去数据中心想想养成什么好习惯吧" />}
            <div className="habits">
              {habits?.map(h => (
                <button key={h.id} className={`habit${h.checked_today ? ' done' : ''}`} onClick={() => checkin.mutate(h.id)}>
                  <div className="h-icon">{h.icon}</div>
                  <span>{h.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-title">💛 今天心情怎么样</div>
            <div className="mood-row">
              {MOODS.map((m, i) => (
                <button key={m} className={`mood${moodNow === i + 1 ? ' sel' : ''}`}
                  onClick={() => setMood.mutate(i + 1)}>{m}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <textarea
                className="textarea quick-note" style={{ minHeight: 60 }} rows={2}
                placeholder="今日一句速记：突然冒出来的小想法…"
                value={quickNote} onChange={e => {setQuickNote(e.target.value);localStorage.setItem('life-today-note-draft',JSON.stringify(e.target.value))}}
              />
              <button className="btn btn-ghost" style={{ alignSelf: 'flex-end' }}
                disabled={!quickNote.trim()} onClick={() => saveQuickNote.mutate(quickNote.trim())}>存📌</button>
            </div>
          </div>
        </div>
      </div>
      {/* 写"今日总结" */}
      {summaryFor && (
        <Modal title={`📝 今日总结 · ${summaryFor.title}`} onClose={() => setSummaryFor(null)}>
          <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 10 }}>
            今天做成了什么？遇到了什么问题？写给自己看，会出现在 CSV 导出和月度记录里。
          </p>
          <textarea
            className="textarea" style={{ minHeight: 140 }} autoFocus
            placeholder={'例如：\n· 背完了 List 1-3，错的 6 个词加入了复习\n· 发现早上效率最高，明天把单词挪到 9 点'}
            value={summaryText} onChange={e => setSummaryText(e.target.value)}
          />
          <div className="form-actions">
            <button className="btn" onClick={() => setSummaryFor(null)}>取消</button>
            <span role="status">{summaryStatus}</span><button className="btn btn-primary" onClick={() => saveSummary.mutate()}>保存总结</button>
          </div>
        </Modal>
      )}
      {/* 修改任务 */}
      {editFor && (
        <Modal title="✏️ 修改任务" onClose={() => setEditFor(null)}>
          <div className="form-row"><label>标题</label>
            <input className="input" value={editForm.title} autoFocus
              onChange={e => setEditForm({ ...editForm, title: e.target.value })} />
          </div>
          <div className="form-row"><label>日期（写错时间就改这里）</label>
            <input className="input" type="date" value={editForm.task_date}
              onChange={e => setEditForm({ ...editForm, task_date: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="form-row" style={{ flex: 1 }}><label>分类</label>
              <select className="select" value={editForm.category}
                onChange={e => setEditForm({ ...editForm, category: e.target.value })}>
                <option value="">✨ 其他</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-row" style={{ flex: 1 }}><label>预计时长（分钟，可空）</label>
              <input className="input" type="number" min="0" value={editForm.estimate_min}
                onChange={e => setEditForm({ ...editForm, estimate_min: e.target.value })} />
            </div>
          </div>
          <div className="form-row"><label>优先级</label>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-soft)' }}>
              <input type="checkbox" checked={editForm.priority === 1}
                onChange={e => setEditForm({ ...editForm, priority: e.target.checked ? 1 : 0 })} /> 🚩 重要任务
            </label>
          </div>
          <div className="form-row"><label>🔗 关联知识（把知识库里的学习笔记挂到这个任务上）</label>
            {editKnowledgeIds.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {editKnowledgeIds.map(kid => {
                  const card = knowledgeCards?.find(k => k.id === kid)
                  return (
                    <span key={kid} className="t-tag green" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px' }}>
                      📚 {card ? card.title : `知识 #${kid}`}
                      <span style={{ cursor: 'pointer', fontWeight: 'bold' }}
                        onClick={() => setEditKnowledgeIds(ids => ids.filter(x => x !== kid))}>×</span>
                    </span>
                  )
                })}
              </div>
            )}
            <select className="select" value=""
              onChange={e => { if (e.target.value) setEditKnowledgeIds(ids => [...ids, +e.target.value]) }}>
              <option value="">＋ 添加关联知识…</option>
              {(knowledgeCards || []).filter(k => !editKnowledgeIds.includes(k.id)).map(k => (
                <option key={k.id} value={k.id}>#{k.id} {k.title}</option>
              ))}
            </select>
          </div>
          <div className="form-actions">
            <button className="btn" onClick={() => setEditFor(null)}>取消</button>
            <button className="btn btn-primary" disabled={!editForm.title.trim() || !editForm.task_date}
              onClick={() => saveEdit.mutate()}>保存修改</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* 工具：日期 ±n 天（YYYY-MM-DD） */
function shiftDate(dateStr: string, n: number): string {
  return addDays(dateStr, n)
}

/* 工具：本周一的日期串 */
function weekStart(): string {
  const d = new Date()
  const monday = new Date(d)
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
