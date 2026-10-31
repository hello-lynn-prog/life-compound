/**
 * 成长图谱：统计卡 + 年度热力图 + 情绪曲线 + 目标进度 + 周/月复盘
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { renderMd } from '../md'
import { api } from '../api'
import { Empty, Modal, useToast, useConfirm } from '../components/ui'

interface Summary { streak: number; tasks_done_month: number; habit_rate: number; journals_month: number }
interface Goal { id: number; title: string; progress: { percent: number; total: number; done: number }; type: string }
interface Review { id: number; period_type: string; period_start: string; period_end: string; content: string }

function ReviewEditor({ onClose, periodType }: { onClose: () => void; periodType: 'weekly' | 'monthly' }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [content, setContent] = useState('')

  // 生成草稿（本地规则：后端汇总本周数据拼模板）
  const draft = useMutation({
    mutationFn: () => api.post<{ draft: string; period_start: string; period_end: string }>('/api/reviews/draft', { period_type: periodType }),
    onSuccess: d => setContent(d.draft),
    onError: (e: Error) => toast(e.message),
  })
  const save = useMutation({
    mutationFn: () => api.post('/api/reviews', {
      period_type: periodType,
      period_start: draft.data?.period_start || '',
      period_end: draft.data?.period_end || '',
      content,
    }),
    onSuccess: () => { onClose(); toast('复盘已保存 🎉'); qc.invalidateQueries({ queryKey: ['reviews'] }) },
    onError: (e: Error) => toast(e.message),
  })

  return (
    <Modal title={periodType === 'weekly' ? '🗓️ 写周复盘' : '🗓️ 写月复盘'} onClose={onClose} wide>
      <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 12 }}>
        先点「生成草稿」，系统会自动汇总 {periodType === 'weekly' ? '本周' : '本月'} 的任务/打卡/日记数据，你在模板上补写感想就好。
      </p>
      <div className="form-actions" style={{ justifyContent: 'flex-start', marginTop: 0, marginBottom: 12 }}>
        <button className="btn btn-ghost" onClick={() => draft.mutate()} disabled={draft.isPending}>
          {draft.isPending ? '生成中…' : '✨ 生成草稿'}
        </button>
      </div>
      <textarea className="textarea" style={{ minHeight: 300, fontFamily: 'inherit' }} value={content}
        onChange={e => setContent(e.target.value)} placeholder="（也可以直接自己写）" />
      <div className="form-actions">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn btn-primary" disabled={!content.trim()} onClick={() => save.mutate()}>保存复盘</button>
      </div>
    </Modal>
  )
}

export default function Charts() {
  const toast = useToast()
  const { confirm, confirmNode } = useConfirm()
  const year = new Date().getFullYear()
  const [editor, setEditor] = useState<'weekly' | 'monthly' | null>(null)
  const [viewReview, setViewReview] = useState<Review | null>(null)

  const { data: summary } = useQuery({ queryKey: ['summary'], queryFn: () => api.get<Summary>('/api/stats/summary') })
  const { data: heat } = useQuery({ queryKey: ['heatmap'], queryFn: () => api.get<{ levels: Record<string, number> }>(`/api/stats/heatmap?year=${year}`) })
  const { data: mood } = useQuery({ queryKey: ['mood'], queryFn: () => api.get<{ date: string; mood: number }[]>('/api/stats/mood?days=30') })
  const { data: goals } = useQuery({ queryKey: ['goals'], queryFn: () => api.get<Goal[]>('/api/goals') })
  const { data: reviews } = useQuery({ queryKey: ['reviews'], queryFn: () => api.get<Review[]>('/api/reviews') })

  // 热力图：按"周列 × 7 行"排列一年 365 天（GitHub 风格）
  const heatColumns = useMemo(() => {
    const cols: { date: string; level: number }[][] = []
    const jan1 = new Date(year, 0, 1)
    const start = new Date(jan1)
    start.setDate(jan1.getDate() - ((jan1.getDay() + 6) % 7)) // 对齐周一
    const cur = new Date(start)
    let col: { date: string; level: number }[] = []
    while (cur.getFullYear() <= year) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
      const inYear = cur.getFullYear() === year
      col.push({ date: key, level: inYear ? (heat?.levels?.[key] ?? 0) : -1 })
      if (col.length === 7) { cols.push(col); col = [] }
      cur.setDate(cur.getDate() + 1)
      if (cur.getFullYear() > year && col.length) break
    }
    return cols
  }, [heat, year])

  const moodData = (mood || []).map(m => ({ ...m, label: m.date.slice(5) }))
  const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

  return (
    <div>
      <div className="page-title-row">
        <div className="page-title">📈 成长图谱</div>
        <div className="page-sub">把一年的努力画成看得见的风景</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={() => setEditor('monthly')}>🗓️ 月复盘</button>
          <button className="btn btn-primary" onClick={() => setEditor('weekly')}>🗓️ 周复盘</button>
        </div>
      </div>

      {/* 统计卡 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
        <div className="card" style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FFE4EA' }}>🔥</div>
          <div><b style={{ fontSize: 22, display: 'block', lineHeight: 1.2 }}>{summary?.streak ?? 0} 天</b><span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>连续打卡</span></div>
        </div>
        <div className="card" style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#E4F6EC' }}>✅</div>
          <div><b style={{ fontSize: 22, display: 'block', lineHeight: 1.2 }}>{summary?.tasks_done_month ?? 0} 件</b><span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>本月完成任务</span></div>
        </div>
        <div className="card" style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FFF3D6' }}>📊</div>
          <div><b style={{ fontSize: 22, display: 'block', lineHeight: 1.2 }}>{summary?.habit_rate ?? 0}%</b><span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>本月打卡率</span></div>
        </div>
        <div className="card" style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#E4F1FC' }}>📔</div>
          <div><b style={{ fontSize: 22, display: 'block', lineHeight: 1.2 }}>{summary?.journals_month ?? 0} 篇</b><span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>本月日记</span></div>
        </div>
      </div>

      {/* 年度热力图 */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">🌸 {year} 年努力热力图 <span className="hint">颜色越深，当天完成的事越多</span></div>
        <div style={{ overflowX: 'auto', paddingBottom: 6 }}>
          <div style={{ display: 'flex', gap: 3, minWidth: 760 }}>
            {heatColumns.map((col, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {col.map(cell => (
                  <div key={cell.date} title={`${cell.date}：${cell.level > 0 ? cell.level + ' 件' : '无记录'}`}
                    style={{
                      width: 12, height: 12, borderRadius: 4,
                      background: cell.level < 0 ? 'transparent'
                        : cell.level === 0 ? 'var(--cream-deep)'
                        : cell.level === 1 ? '#FFD9E0' : cell.level === 2 ? '#FFB4C0'
                        : cell.level === 3 ? '#FF9BAC' : '#F87B93',
                    }} />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 11, color: 'var(--ink-soft)', justifyContent: 'flex-end' }}>
          少
          {['var(--cream-deep)', '#FFD9E0', '#FFB4C0', '#FF9BAC', '#F87B93'].map(c =>
            <div key={c} style={{ width: 11, height: 11, borderRadius: 4, background: c }} />)}
          多
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--ink-soft)', minWidth: 760 }}>
          {monthNames.map(m => <span key={m}>{m}</span>)}
        </div>
      </div>

      <div className="two-col" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20 }}>
        {/* 情绪曲线 */}
        <div className="card">
          <div className="card-title">💛 情绪曲线 <span className="hint">最近 30 天</span></div>
          {moodData.length === 0 ? <Empty emoji="💗" text="多写几篇带心情的日记，曲线就会长出来～" /> : (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={moodData} margin={{ top: 10, right: 10, bottom: 0, left: -22 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F6E7DF" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#A8938A' }} interval="preserveStartEnd" />
                <YAxis domain={[1, 5]} tick={{ fontSize: 11, fill: '#A8938A' }} tickCount={5} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #F6E7DF', fontSize: 12 }}
                  formatter={(v: number) => [['😭', '😕', '😊', '🥳', '🤩'][v - 1] + `（${v}/5）`, '心情']} />
                <Area type="monotone" dataKey="mood" stroke="#F87B93" strokeWidth={3} fill="#FFE4EA" fillOpacity={0.6} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 目标进度 */}
        <div className="card">
          <div className="card-title">🎯 目标进度</div>
          {goals?.length === 0 && <Empty emoji="🎯" text="去「目标」页建一个想实现的目标吧" />}
          {goals?.slice(0, 6).map(g => (
            <div key={g.id} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                <b style={{ fontSize: 13 }}>{g.type === 'direction' ? '🧭' : '🎯'} {g.title}</b>
                <span style={{ color: 'var(--peach-deep)', fontWeight: 'bold' }}>{g.progress.percent}%</span>
              </div>
              <div className="track"><div className="fill" style={{ width: `${g.progress.percent}%` }} /></div>
            </div>
          ))}
        </div>
      </div>

      {/* 复盘列表 */}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-title">🗓️ 历史复盘 <span className="hint">{reviews?.length ?? 0} 篇</span></div>
        {reviews?.length === 0 && <Empty emoji="🗓️" text="每周花 10 分钟复盘一次，成长会加速哦" />}
        {(reviews || []).map(r => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 6px', borderBottom: '1px dashed var(--line)' }}>
            <span className="t-tag">{r.period_type === 'weekly' ? '周复盘' : '月复盘'}</span>
            <span style={{ fontSize: 14 }}>{r.period_start} ~ {r.period_end}</span>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {(r.content || '').split('\n').find(l => l.trim() && !l.startsWith('#')) || ''}
            </span>
            <button className="btn btn-sm" onClick={() => setViewReview(r)}>查看</button>
          </div>
        ))}
      </div>

      {editor && <ReviewEditor periodType={editor} onClose={() => setEditor(null)} />}
      {viewReview && (
        <Modal title={`🗓️ ${viewReview.period_start} ~ ${viewReview.period_end}`} onClose={() => setViewReview(null)}>
          <div className="md-preview" style={{ fontSize: 14, lineHeight: 1.9 }}
            dangerouslySetInnerHTML={{ __html: renderMd(viewReview.content || '') }} />
          <div className="form-actions">
            <button className="btn" onClick={() => setViewReview(null)}>关闭</button>
          </div>
        </Modal>
      )}
      {confirmNode}
    </div>
  )
}
