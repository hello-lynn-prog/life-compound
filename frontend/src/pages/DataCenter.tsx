/**
 * 数据中心：备份/恢复/导出/回收站/习惯管理/昵称设置
 * 这是整个系统"数据保命"的控制台。
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { Empty, useToast, useConfirm } from '../components/ui'

interface BackupItem { file: string; size_kb: number; created_at: string }
interface RecycleItem { table: string; table_label: string; id: number; title: string; deleted_at: string }
interface Habit { id: number; name: string; icon: string; archived: number }
interface Recurrence {
  id: number; title: string; repeat_type: string; weekdays: number[]
  priority: number; today_task_id: number | null; today_done: boolean
}

const HABIT_ICONS = ['📖', '🏃', '💧', '☀️', '🧘', '💊', '✍️', '🥗', '🎸', '🧠', '💰', '🌸']
const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function repeatLabel(r: Recurrence): string {
  if (r.repeat_type === 'daily') return '每天'
  if (r.repeat_type === 'weekdays') return '工作日（周一~五）'
  return (r.weekdays || []).map(w => WEEK_LABELS[w] || '').join('、') || '每周'
}

export default function DataCenter() {
  const qc = useQueryClient()
  const toast = useToast()
  const { confirm, confirmNode } = useConfirm()
  const [tab, setTab] = useState<'backup' | 'recycle' | 'habits' | 'recurrences' | 'settings'>('backup')
  const [newHabit, setNewHabit] = useState('')
  const [newIcon, setNewIcon] = useState('🌸')
  const [nickname, setNickname] = useState('')

  const { data: backups } = useQuery({ queryKey: ['backups'], queryFn: () => api.get<BackupItem[]>('/api/data/backups') })
  const { data: recycle } = useQuery({ queryKey: ['recycle'], queryFn: () => api.get<RecycleItem[]>('/api/data/recycle') })
  const { data: habits } = useQuery({ queryKey: ['habits'], queryFn: () => api.get<Habit[]>('/api/habits?include_archived=1') })
  const { data: recurrences } = useQuery({ queryKey: ['recurrences'], queryFn: () => api.get<Recurrence[]>('/api/recurrences') })
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Record<string, string>>('/api/data/settings') })

  const backup = useMutation({
    mutationFn: () => api.post('/api/data/backups'),
    onSuccess: () => { toast('备份完成 ✅'); qc.invalidateQueries({ queryKey: ['backups'] }) },
  })
  const restore = useMutation({
    mutationFn: (file: string) => api.post('/api/data/restore', { file }),
    onSuccess: () => toast('恢复完成！请关闭窗口并重新双击「启动」✅'),
    onError: (e: Error) => toast(e.message),
  })
  const recycleRestore = useMutation({
    mutationFn: (item: RecycleItem) => api.post('/api/data/recycle/restore', { table: item.table, id: item.id }),
    onSuccess: () => { toast('已恢复 ♻️'); qc.invalidateQueries({ queryKey: ['recycle'] }) },
  })
  const recyclePurge = useMutation({
    mutationFn: (item: RecycleItem) => api.post('/api/data/recycle/purge', { table: item.table, id: item.id }),
    onSuccess: () => { toast('已彻底删除'); qc.invalidateQueries({ queryKey: ['recycle'] }) },
  })
  const addHabit = useMutation({
    mutationFn: () => api.post('/api/habits', { name: newHabit.trim(), icon: newIcon }),
    onSuccess: () => { setNewHabit(''); toast('习惯已添加 🌱'); qc.invalidateQueries({ queryKey: ['habits'] }) },
  })
  const delHabit = useMutation({
    mutationFn: (id: number) => api.del(`/api/habits/${id}`),
    onSuccess: () => { toast('已移入回收站'); qc.invalidateQueries({ queryKey: ['habits'] }) },
  })
  const delRecurrence = useMutation({
    mutationFn: (id: number) => api.del(`/api/recurrences/${id}`),
    onSuccess: () => {
      toast('规则已删除，历史任务保留')
      qc.invalidateQueries({ queryKey: ['recurrences'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
  const saveSettings = useMutation({
    mutationFn: () => api.post('/api/data/settings', { nickname: nickname || settings?.nickname || '' }),
    onSuccess: () => toast('已保存 ⚙️'),
  })

  const download = (path: string, filename: string) => {
    const a = document.createElement('a')
    a.href = path; a.download = filename
    a.click()
    toast('开始下载 ⬇️')
  }

  return (
    <div>
      <div className="page-title-row">
        <div className="page-title">🗄️ 数据中心</div>
        <div className="page-sub">备份、恢复、回收站——你的数据你做主</div>
      </div>

      {/* Tab 切换 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {([['backup', '💾 备份与导出'], ['recycle', '♻️ 回收站'], ['habits', '🌱 习惯管理'], ['recurrences', '🔁 重复任务'], ['settings', '⚙️ 设置']] as const).map(([k, label]) => (
          <button key={k} className={`chip${tab === k ? ' on' : ''}`} style={{ fontSize: 13, padding: '7px 16px' }}
            onClick={() => setTab(k as typeof tab)}>{label}</button>
        ))}
      </div>

      {/* ============ 备份与导出 ============ */}
      {tab === 'backup' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
            <div className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>💾</div>
              <button className="btn btn-primary" onClick={() => backup.mutate()} disabled={backup.isPending}>
                {backup.isPending ? '备份中…' : '立即备份'}
              </button>
              <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 10, lineHeight: 1.6 }}>
                每次启动也会自动备份<br />自动保留最近 30 份
              </p>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>📊</div>
              <button className="btn btn-ghost" onClick={() => download('/api/stats/export-csv', '任务明细.csv')}>导出任务明细 CSV</button>
              <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 10, lineHeight: 1.6 }}>
                全部任务 + 完成状态 + 今日总结<br />Excel 双击直接打开
              </p>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>📦</div>
              <button className="btn btn-ghost" onClick={() => download('/api/data/export-zip', '人生复利系统_全量导出.zip')}>导出 ZIP</button>
              <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 10, lineHeight: 1.6 }}>
                数据库 + 图片附件打包<br />建议每月存一份到 U 盘/网盘
              </p>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>📄</div>
              <button className="btn btn-ghost" onClick={() => download('/api/data/export-json', '人生复利系统_全量导出.json')}>导出 JSON</button>
              <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 10, lineHeight: 1.6 }}>
                人类可读的纯文本格式<br />万一数据库损坏也能捞回数据
              </p>
            </div>
          </div>

          <div className="card">
            <div className="card-title">🕘 备份历史 <span className="hint">{backups?.length ?? 0} 份</span></div>
            {backups?.length === 0 && <Empty text="还没有备份" />}
            {(backups || []).map(b => (
              <div key={b.file} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 6px', borderBottom: '1px dashed var(--line)', fontSize: 13 }}>
                <span>{b.file.includes('startup') ? '🚀 启动备份' : b.file.includes('manual') ? '💾 手动备份' : '🛟 恢复前快照'}</span>
                <span style={{ color: 'var(--ink-soft)' }}>{b.created_at} · {b.size_kb} KB</span>
                <button className="btn btn-sm" style={{ marginLeft: 'auto' }}
                  onClick={() => confirm(
                    `确定用这份备份恢复吗？\n\n备份时间：${b.created_at}\n\n恢复后当前数据会被替换（恢复前会自动再做一次快照）`,
                    () => restore.mutate(b.file),
                  )}>恢复</button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ============ 回收站 ============ */}
      {tab === 'recycle' && (
        <div className="card">
          <div className="card-title">♻️ 回收站 <span className="hint">删除的内容都在这里，可恢复</span></div>
          {recycle?.length === 0 && <Empty emoji="🫧" text="回收站空空如也，很干净～" />}
          {(recycle || []).map(item => (
            <div key={`${item.table}-${item.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 6px', borderBottom: '1px dashed var(--line)', fontSize: 13 }}>
              <span className="t-tag">{item.table_label}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
              <span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>删除于 {(item.deleted_at || '').replace('T', ' ').slice(0, 16)}</span>
              <button className="btn btn-sm btn-ghost" onClick={() => recycleRestore.mutate(item)}>恢复</button>
              <button className="btn btn-sm btn-danger" onClick={() => confirm(`彻底删除「${item.title}」？此操作不可撤销！`, () => recyclePurge.mutate(item))}>彻底删除</button>
            </div>
          ))}
        </div>
      )}

      {/* ============ 习惯管理 ============ */}
      {tab === 'habits' && (
        <div className="card">
          <div className="card-title">🌱 习惯管理 <span className="hint">添加想养成的日常小习惯</span></div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {HABIT_ICONS.map(ic => (
                <button key={ic} className={`mood${newIcon === ic ? ' sel' : ''}`} style={{ width: 38, height: 38, fontSize: 17 }}
                  onClick={() => setNewIcon(ic)}>{ic}</button>
              ))}
            </div>
            <input className="input" style={{ flex: 1, minWidth: 160, borderStyle: 'dashed' }} placeholder="新习惯名，如：阅读 30 分钟"
              value={newHabit} onChange={e => setNewHabit(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newHabit.trim()) addHabit.mutate() }} />
            <button className="btn btn-primary" disabled={!newHabit.trim()} onClick={() => addHabit.mutate()}>添加</button>
          </div>
          {habits?.length === 0 && <Empty emoji="🌱" text="先添加第一个习惯吧，比如「阅读」" />}
          {(habits || []).map(h => (
            <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 6px', borderBottom: '1px dashed var(--line)' }}>
              <span style={{ fontSize: 20 }}>{h.icon}</span>
              <span style={{ fontSize: 14 }}>{h.name}</span>
              <button className="btn btn-sm btn-danger" style={{ marginLeft: 'auto' }}
                onClick={() => confirm(`删除习惯「${h.name}」？历史打卡记录会保留在回收站`, () => delHabit.mutate(h.id))}>删除</button>
            </div>
          ))}
        </div>
      )}

      {/* ============ 重复任务管理 ============ */}
      {tab === 'recurrences' && (
        <div className="card">
          <div className="card-title">🔁 重复任务规则
            <span className="hint">在「今日」页添加任务时选"重复"即可创建，到这里管理</span>
          </div>
          {recurrences?.length === 0 && <Empty emoji="🔁" text="还没有重复任务。去今日页添加任务时选择「每天 / 工作日 / 每周几」试试" />}
          {(recurrences || []).map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 6px', borderBottom: '1px dashed var(--line)' }}>
              <span style={{ fontSize: 20 }}>{r.today_done ? '✅' : r.today_task_id ? '⏳' : '💤'}</span>
              <span style={{ fontSize: 14, fontWeight: 'bold' }}>{r.title}</span>
              <span className="t-tag">{repeatLabel(r)}</span>
              {!!r.priority && <span className="t-flag">🚩</span>}
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-soft)' }}>
                {r.today_task_id ? (r.today_done ? '今天已完成' : '今天待完成') : '今天不出现'}
              </span>
              <button className="btn btn-sm btn-danger"
                onClick={() => confirm(`删除重复规则「${r.title}」？\n\n以后不再自动生成，已生成的历史任务全部保留。`, () => delRecurrence.mutate(r.id))}>删除规则</button>
            </div>
          ))}
        </div>
      )}

      {/* ============ 设置 ============ */}
      {tab === 'settings' && (
        <div className="card" style={{ maxWidth: 520 }}>
          <div className="card-title">⚙️ 设置</div>
          <div className="form-row">
            <label>昵称（显示在首页问候里）</label>
            <div style={{ display: 'flex', gap: 10 }}>
              <input className="input" placeholder={settings?.nickname || '小满'} value={nickname}
                onChange={e => setNickname(e.target.value)} />
              <button className="btn btn-primary" onClick={() => saveSettings.mutate()}>保存</button>
            </div>
          </div>
          <div style={{ background: 'var(--cream)', borderRadius: 14, padding: '14px 18px', fontSize: 12, color: 'var(--ink-soft)', lineHeight: 2 }}>
            🔒 所有数据只存在你这台电脑上（backend/data 文件夹）<br />
            🌐 程序只监听本机回环地址，局域网/互联网无法访问<br />
            🤖 所有智能功能（复盘草稿等）均为本地规则，不联网、不依赖 AI 服务
          </div>
        </div>
      )}
      {confirmNode}
    </div>
  )
}
