/**
 * 目标与项目：方向 → 阶段目标 → 项目 的树状结构，各层带进度
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { Empty, Modal, useToast, useConfirm } from '../components/ui'

interface Progress { total: number; done: number; percent: number }
interface Goal {
  id: number; parent_id: number | null; type: string; title: string; description: string
  color: string; status: string; start_date: string; due_date: string; progress: Progress
  children?: Goal[]; projects?: Project[]
}
interface Project {
  id: number; goal_id: number | null; title: string; status: string
  start_date: string; due_date: string; progress: Progress
}
interface Tree { directions: Goal[]; standalone_goals: Goal[] }

type Editor =
  | { kind: 'direction' }
  | { kind: 'goal'; parent: Goal | null }
  | { kind: 'project'; goal: Goal | null }
  | { kind: 'editDirection'; item: Goal }
  | { kind: 'editGoal'; item: Goal }
  | { kind: 'editProject'; item: Project }

export default function Goals() {
  const qc = useQueryClient()
  const toast = useToast()
  const { confirm, confirmNode } = useConfirm()
  const [editor, setEditor] = useState<Editor | null>(null)
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [due, setDue] = useState('')

  const { data: tree } = useQuery({ queryKey: ['goals-tree'], queryFn: () => api.get<Tree>('/api/goals/tree') })

  const refresh = () => { qc.invalidateQueries({ queryKey: ['goals-tree'] }); qc.invalidateQueries({ queryKey: ['goals'] }); qc.invalidateQueries({ queryKey: ['projects'] }) }

  const save = useMutation({
    mutationFn: async () => {
      const payload = { title, description: desc, due_date: due }
      if (!editor) return
      if (editor.kind === 'direction') return api.post('/api/goals', { ...payload, type: 'direction' })
      if (editor.kind === 'goal') return api.post('/api/goals', { ...payload, type: 'stage_goal', parent_id: editor.parent?.id ?? null })
      if (editor.kind === 'project') return api.post('/api/projects', { ...payload, goal_id: editor.goal?.id ?? null })
      if (editor.kind === 'editDirection' || editor.kind === 'editGoal') return api.put(`/api/goals/${editor.item.id}`, payload)
      return api.put(`/api/projects/${editor.item.id}`, payload)
    },
    onSuccess: () => { setEditor(null); setTitle(''); setDesc(''); setDue(''); toast('已保存 🌱'); refresh() },
    onError: (e: Error) => toast(e.message),
  })

  const del = useMutation({
    mutationFn: (t: { kind: 'goal' | 'project'; id: number }) =>
      t.kind === 'goal' ? api.del(`/api/goals/${t.id}`) : api.del(`/api/projects/${t.id}`),
    onSuccess: () => { toast('已移入回收站 🗑️'); refresh() },
  })

  const openEditor = (e: Editor, initTitle = '', initDesc = '', initDue = '') => {
    setEditor(e); setTitle(initTitle); setDesc(initDesc); setDue(initDue)
  }

  const editorTitles: Record<string, string> = {
    direction: '🧭 新建长期方向', goal: '🎯 新建阶段目标', project: '📦 新建项目',
    editDirection: '🧭 编辑方向', editGoal: '🎯 编辑目标', editProject: '📦 编辑项目',
  }

  const ProgressBar = ({ p }: { p: Progress }) => (
    <div className="track" style={{ marginTop: 8 }}>
      <div className={`fill ${p.percent >= 100 ? 'mint' : ''}`} style={{ width: `${p.percent}%` }} />
    </div>
  )

  const renderProject = (p: Project) => (
    <div key={p.id} style={{ background: 'var(--cream)', borderRadius: 14, padding: '12px 16px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
        <span>📦 {p.title}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--peach-deep)', fontWeight: 'bold' }}>{p.progress.percent}%</span>
        <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>({p.progress.done}/{p.progress.total})</span>
        <button className="t-del" style={{ opacity: 1 }} onClick={() => confirm(`确定删除项目「${p.title}」吗？（会进入回收站，任务不会丢）`, () => del.mutate({ kind: 'project', id: p.id }))}>✕</button>
      </div>
      <ProgressBar p={p.progress} />
    </div>
  )

  const renderGoal = (g: Goal) => (
    <div key={g.id} style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 16, padding: '14px 18px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 'bold' }}>
        🎯 {g.title}
        {g.due_date && <span className="chip">⏰ {g.due_date}</span>}
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--peach-deep)' }}>{g.progress.percent}%</span>
        <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>({g.progress.done}/{g.progress.total})</span>
        <button className="t-del" style={{ opacity: 1 }} onClick={() => confirm(`确定删除目标「${g.title}」吗？（会进入回收站）`, () => del.mutate({ kind: 'goal', id: g.id }))}>✕</button>
      </div>
      {g.description && <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '6px 0' }}>{g.description}</p>}
      <ProgressBar p={g.progress} />
      <div style={{ marginTop: 10 }}>
        {(g.projects || []).map(renderProject)}
        <button className="btn btn-sm btn-ghost" onClick={() => openEditor({ kind: 'project', goal: g })}>＋ 加项目</button>
      </div>
    </div>
  )

  const renderDirection = (d: Goal) => (
    <div key={d.id} className="card" style={{ marginBottom: 20 }}>
      <div className="card-title">
        🧭 {d.title}
        <span className="hint">{d.progress.percent}% · {d.progress.done}/{d.progress.total} 项任务</span>
        <button className="btn btn-sm btn-ghost" onClick={() => openEditor({ kind: 'goal', parent: d })}>＋ 阶段目标</button>
      </div>
      <ProgressBar p={d.progress} />
      <div style={{ marginTop: 14 }}>
        {(d.children || []).length === 0 && (d.projects || []).length === 0
          ? <Empty emoji="🌱" text="这个方向下还没有阶段目标" /> : null}
        {(d.children || []).map(renderGoal)}
        {(d.projects || []).map(renderProject)}
      </div>
    </div>
  )

  return (
    <div>
      <div className="page-title-row">
        <div className="page-title">🎯 目标与项目</div>
        <div className="page-sub">长期方向 → 阶段目标 → 项目 → 每日行动</div>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => openEditor({ kind: 'direction' })}>＋ 新建方向</button>
        <button className="btn btn-ghost" onClick={() => openEditor({ kind: 'goal', parent: null })}>＋ 独立目标</button>
      </div>

      {tree && tree.directions.length === 0 && tree.standalone_goals.length === 0 && (
        <div className="card"><Empty emoji="🧭" text="还没有任何目标。先写一个想去的方向吧，比如「成为 AI 开发者」" /></div>
      )}

      {(tree?.directions || []).map(renderDirection)}

      {(tree?.standalone_goals || []).length > 0 && (
        <div className="card">
          <div className="card-title">🎯 独立目标 <span className="hint">不挂在任何方向下</span>
            <button className="btn btn-sm btn-ghost" onClick={() => openEditor({ kind: 'project', goal: null })}>＋ 加项目</button>
          </div>
          {(tree?.standalone_goals || []).map(renderGoal)}
        </div>
      )}

      {editor && (
        <Modal title={editorTitles[editor.kind]} onClose={() => setEditor(null)}>
          <div className="form-row"><label>名称 *</label>
            <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="比如：半年内做出 Agent 产品" autoFocus />
          </div>
          <div className="form-row"><label>描述（可选）</label>
            <textarea className="textarea" style={{ minHeight: 60 }} value={desc} onChange={e => setDesc(e.target.value)} placeholder="为什么想做这件事？" />
          </div>
          <div className="form-row"><label>截止日期（可选）</label>
            <input className="input" type="date" value={due} onChange={e => setDue(e.target.value)} />
          </div>
          <div className="form-actions">
            <button className="btn" onClick={() => setEditor(null)}>取消</button>
            <button className="btn btn-primary" disabled={!title.trim()} onClick={() => save.mutate()}>保存</button>
          </div>
        </Modal>
      )}
      {confirmNode}
    </div>
  )
}
