/**
 * 个人 IP 档案：专属形象 + 作品墙 + 里程碑时间线 + 技能雷达 + 自我介绍卡片导出
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from 'recharts'
import { api, today } from '../api'
import { Empty, Modal, useToast, useConfirm } from '../components/ui'
import Mascot from '../components/Mascot'

interface Achievement {
  id: number; ach_type: string; title: string; description: string
  ach_date: string; link: string; image_path: string; tags: string[]
  gallery?: string[]; category?: string
}
interface Skill { id: number; name: string; level: number; icon: string }

const TYPE_LABEL: Record<string, string> = { work: '作品', milestone: '里程碑', certificate: '证书' }

export default function Profile() {
  const qc = useQueryClient()
  const toast = useToast()
  const { confirm, confirmNode } = useConfirm()
  const [edit, setEdit] = useState<Achievement | 'new' | null>(null)
  const [form, setForm] = useState({ ach_type: 'work', title: '', description: '', ach_date: '', link: '', category: '' })
  const [workFilter, setWorkFilter] = useState('全部') // 作品墙分类筛选
  const [introOpen, setIntroOpen] = useState(false)
  const [skillEdit, setSkillEdit] = useState<Skill | null>(null) // 点击技能 chip 修改等级
  const [lightbox, setLightbox] = useState<{ urls: string[]; idx: number } | null>(null) // 相册放大（可翻页）
  const [expandedWorks, setExpandedWorks] = useState<Set<number>>(new Set()) // 展开全部贴纸的作品

  const { data: achs } = useQuery({ queryKey: ['achievements'], queryFn: () => api.get<Achievement[]>('/api/achievements') })
  const { data: skills } = useQuery({ queryKey: ['skills'], queryFn: () => api.get<Skill[]>('/api/skills') })
  const { data: summary } = useQuery({ queryKey: ['summary'], queryFn: () => api.get<{ streak: number; tasks_done_month: number }>('/api/stats/summary') })
  const { data: reviews } = useQuery({ queryKey: ['reviews'], queryFn: () => api.get<{ period_type: string }[]>('/api/reviews') })

  const openEditor = (a: Achievement | 'new') => {
    if (a === 'new') setForm({ ach_type: 'work', title: '', description: '', ach_date: today(), link: '', category: '' })
    else setForm({ ach_type: a.ach_type, title: a.title, description: a.description, ach_date: a.ach_date, link: a.link, category: a.category || '' })
    setEdit(a)
  }

  const save = useMutation({
    mutationFn: () => edit === 'new' ? api.post('/api/achievements', form) : api.put(`/api/achievements/${(edit as Achievement).id}`, form),
    onSuccess: () => { setEdit(null); toast('已保存 🏆'); qc.invalidateQueries({ queryKey: ['achievements'] }) },
    onError: (e: Error) => toast(e.message),
  })
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/api/achievements/${id}`),
    onSuccess: () => { toast('已移入回收站 🗑️'); qc.invalidateQueries({ queryKey: ['achievements'] }) },
  })
  const saveSkill = useMutation({
    mutationFn: (s: { name: string; level: number }) => api.post('/api/skills', s),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['skills'] }); toast('技能已添加 ⭐') },
  })
  const updateSkill = useMutation({
    mutationFn: (s: { id: number; name: string; level: number; icon: string }) =>
      api.put(`/api/skills/${s.id}`, { name: s.name, level: s.level, icon: s.icon }),
    onSuccess: () => { setSkillEdit(null); toast('技能已更新 ⭐'); qc.invalidateQueries({ queryKey: ['skills'] }) },
    onError: (e: Error) => toast(e.message),
  })
  const delSkill = useMutation({
    mutationFn: (id: number) => api.del(`/api/skills/${id}`),
    onSuccess: () => { setSkillEdit(null); toast('技能已移入回收站 🗑️'); qc.invalidateQueries({ queryKey: ['skills'] }) },
  })

  const radarData = (skills || []).map(s => ({ skill: s.name, level: s.level }))
  const works = (achs || []).filter(a => a.ach_type === 'work')
  const milestones = (achs || []).filter(a => a.ach_type === 'milestone' || a.ach_type === 'certificate')
  const workCategories = Array.from(new Set(works.map(w => (w.category || '').trim()).filter(Boolean)))
  const filteredWorks = workFilter === '全部' ? works : works.filter(w => (w.category || '').trim() === workFilter)

  // 自我介绍卡片文案（一键复制用）
  const introText = [
    `🌸 关于我`,
    `· 连续自律 ${summary?.streak ?? 0} 天，本月完成 ${summary?.tasks_done_month ?? 0} 件任务`,
    works.length ? `· 代表作：${works.slice(0, 3).map(w => w.title).join('、')}` : '',
    `· 掌握技能：${(skills || []).map(s => `${s.name} ${s.level}/10`).join('、') || '持续学习中'}`,
    `· 复盘习惯：已坚持写 ${reviews?.length ?? 0} 篇复盘`,
  ].filter(Boolean).join('\n')

  return (
    <div>
      <div className="page-title-row">
        <div className="page-title">👤 个人 IP 档案</div>
        <div className="page-sub">你的作品、里程碑和技能，都是复利的证明</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={() => setIntroOpen(true)}>📇 生成自我介绍</button>
          <button className="btn btn-primary" onClick={() => openEditor('new')}>＋ 记录成果</button>
        </div>
      </div>

      {/* 专属 IP 形象 */}
      <div className="card" style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 28, overflow: 'hidden' }}>
        <Mascot style={{ height: 220, filter: 'drop-shadow(0 8px 18px rgba(248,123,147,.28))' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>🎀 我的专属 IP 形象</div>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 2 }}>
            米白毛衣 + 粉色蝴蝶结的 IP 小姐姐，正在慢慢转身给你看 ✨
            从原视频绿幕抠像 + 清晰度增强而来，她也站在「今日」页面右下角陪你打卡。
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <a className="btn btn-ghost" href="mascot/mascot.png" download="我的IP形象.png">⬇️ 下载静态形象图</a>
            <a className="btn btn-ghost" href="mascot/idle.webm" download="我的IP形象动画.webm">🎬 下载透明动画</a>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 20 }}>
        {/* 作品墙 */}
        <div className="card">
          <div className="card-title">🖼️ 作品墙 <span className="hint">{works.length} 件作品</span></div>
          {workCategories.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {['全部', ...workCategories].map(c => (
                <button key={c} className={`chip${workFilter === c ? ' on' : ''}`} style={{ cursor: 'pointer' }}
                  onClick={() => setWorkFilter(c)}>{c === '全部' ? `🌈 ${c}` : c}</button>
              ))}
            </div>
          )}
          {works.length === 0 && <Empty emoji="🖼️" text="做完一个项目、写了一篇爆文，都值得挂上墙" />}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
            {filteredWorks.map(w => {
              const album = (w.gallery && w.gallery.length ? w.gallery : w.image_path ? [w.image_path] : [])
              const COLLAPSED_N = 6
              const expanded = expandedWorks.has(w.id)
              const shown = expanded ? album : album.slice(0, COLLAPSED_N)
              return (
              <div key={w.id} style={{ background: 'var(--cream)', borderRadius: 16, padding: '14px 16px' }}>
                {album.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 10 }}>
                    {shown.map((url, i) => (
                      <img key={url + i} src={url} alt={`${w.title} ${i + 1}`}
                        style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 10, cursor: 'zoom-in', display: 'block' }}
                        onClick={() => setLightbox({ urls: album, idx: i })} />
                    ))}
                  </div>
                )}
                {album.length > COLLAPSED_N && (
                  <button className="btn btn-sm btn-ghost" style={{ width: '100%', justifyContent: 'center', marginBottom: 10 }}
                    onClick={() => setExpandedWorks(prev => {
                      const next = new Set(prev)
                      next.has(w.id) ? next.delete(w.id) : next.add(w.id)
                      return next
                    })}>
                    {expanded ? '收起 ▲' : `展开全部 ${album.length} 张 ▼`}
                  </button>
                )}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 14, fontWeight: 'bold', flex: 1 }}>{w.title}</span>
                  <button className="t-del" style={{ opacity: 1 }} onClick={() => confirm(`确定删除「${w.title}」吗？`, () => del.mutate(w.id))}>✕</button>
                </div>
                {w.description && <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '6px 0', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{w.description.slice(0, 120)}{w.description.length > 120 ? '…' : ''}</p>}
                <div style={{ fontSize: 11, color: 'var(--ink-soft)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {w.category && <span className="t-tag">🏷️ {w.category}</span>}
                  {w.ach_date && <span>📅 {w.ach_date} </span>}
                  {w.link && <a href={w.link} target="_blank" rel="noreferrer" style={{ color: 'var(--peach-deep)' }}>🔗 打开</a>}
                </div>
              </div>
              )
            })}
          </div>
        </div>

        {/* 技能雷达 */}
        <div className="card">
          <div className="card-title">🕸️ 技能雷达 <span className="hint">1-10 级</span></div>
          {radarData.length < 3 ? (
            <Empty emoji="🕸️" text="至少添加 3 个技能才能画出雷达图" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="#F0D5CC" />
                <PolarAngleAxis dataKey="skill" tick={{ fontSize: 12, fill: '#5C4A44' }} />
                <Radar dataKey="level" stroke="#F87B93" strokeWidth={2} fill="#FF9BAC" fillOpacity={0.45} />
              </RadarChart>
            </ResponsiveContainer>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {(skills || []).map(s => (
              <span key={s.id} className="chip" style={{ cursor: 'pointer' }} title="点击修改等级"
                onClick={() => setSkillEdit(s)}>{s.icon || '⭐'} {s.name} · {s.level}</span>
            ))}
          </div>
          <SkillInput onSave={s => saveSkill.mutate(s)} />
        </div>
      </div>

      {/* 里程碑时间线 */}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-title">⛰️ 里程碑 · 证书</div>
        {milestones.length === 0 && <Empty emoji="⛰️" text="第一个里程碑：坚持用这个系统 30 天！" />}
        <div style={{ position: 'relative', paddingLeft: 22, borderLeft: '3px dashed var(--peach-light)' }}>
          {milestones.map(m => (
            <div key={m.id} style={{ position: 'relative', padding: '10px 0 16px' }}>
              <span style={{ position: 'absolute', left: -33, top: 14, fontSize: 16 }}>
                {m.ach_type === 'certificate' ? '📜' : '🌸'}
              </span>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <b style={{ fontSize: 14 }}>{m.title}</b>
                {m.ach_date && <span className="t-tag">{m.ach_date}</span>}
                <button className="t-del" style={{ opacity: 1 }} onClick={() => confirm(`确定删除「${m.title}」吗？`, () => del.mutate(m.id))}>✕</button>
              </div>
              {m.description && <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 4, lineHeight: 1.7 }}>{m.description}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* 成果编辑器 */}
      {edit && (
        <Modal title={edit === 'new' ? '🏆 记录成果' : '✏️ 编辑成果'} onClose={() => setEdit(null)}>
          <div className="form-row"><label>类型</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {Object.entries(TYPE_LABEL).map(([v, label]) => (
                <button key={v} className={`chip${form.ach_type === v ? ' on' : ''}`} onClick={() => setForm({ ...form, ach_type: v })}>{label}</button>
              ))}
            </div>
          </div>
          <div className="form-row"><label>分类（作品用）</label>
            <input className="input" list="ach-category-suggestions" value={form.category}
              onChange={e => setForm({ ...form, category: e.target.value })}
              placeholder="如：PPT / 原型图 / 提示词 / 报告模板…" />
            <datalist id="ach-category-suggestions">
              {['代码项目', 'PPT', '原型图', '提示词', '报告模板', 'PRD', '设计', '文章', '视频'].map(c =>
                <option key={c} value={c} />)}
            </datalist>
          </div>
          <div className="form-row"><label>标题 *</label>
            <input className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} autoFocus placeholder="比如：人生复利系统 v1.0 上线" />
          </div>
          <div className="form-row"><label>描述</label>
            <textarea className="textarea" style={{ minHeight: 70 }} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="它解决了什么问题？你的角色是？" />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="form-row" style={{ flex: 1 }}><label>日期</label>
              <input className="input" type="date" value={form.ach_date} onChange={e => setForm({ ...form, ach_date: e.target.value })} />
            </div>
            <div className="form-row" style={{ flex: 1.5 }}><label>链接（可选）</label>
              <input className="input" value={form.link} onChange={e => setForm({ ...form, link: e.target.value })} placeholder="https://…" />
            </div>
          </div>
          <div className="form-actions">
            <button className="btn" onClick={() => setEdit(null)}>取消</button>
            <button className="btn btn-primary" disabled={!form.title.trim()} onClick={() => save.mutate()}>保存</button>
          </div>
        </Modal>
      )}

      {/* 技能编辑（点击 chip 修改等级/名称/图标） */}
      {skillEdit && (
        <Modal title={`✏️ 修改技能 · ${skillEdit.name}`} onClose={() => setSkillEdit(null)}>
          <div className="form-row"><label>名称</label>
            <input className="input" value={skillEdit.name} autoFocus
              onChange={e => setSkillEdit({ ...skillEdit, name: e.target.value })} />
          </div>
          <div className="form-row"><label>图标</label>
            <input className="input" value={skillEdit.icon || ''} maxLength={4} placeholder="⭐"
              onChange={e => setSkillEdit({ ...skillEdit, icon: e.target.value })} />
          </div>
          <div className="form-row"><label>等级（1-10）</label>
            <select className="select" value={skillEdit.level}
              onChange={e => setSkillEdit({ ...skillEdit, level: +e.target.value })}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n} 级</option>)}
            </select>
          </div>
          <div className="form-actions" style={{ justifyContent: 'space-between' }}>
            <button className="btn btn-ghost"
              onClick={() => confirm(`删除技能「${skillEdit.name}」？`, () => delSkill.mutate(skillEdit.id))}>🗑 删除</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => setSkillEdit(null)}>取消</button>
              <button className="btn btn-primary" disabled={!skillEdit.name.trim()}
                onClick={() => updateSkill.mutate(skillEdit)}>保存</button>
            </div>
          </div>
        </Modal>
      )}

      {/* 自我介绍 */}
      {introOpen && (
        <Modal title="📇 一键生成自我介绍" onClose={() => setIntroOpen(false)}>
          <textarea className="textarea" style={{ minHeight: 160 }} readOnly value={introText} />
          <div className="form-actions">
            <button className="btn" onClick={() => { navigator.clipboard.writeText(introText); toast('已复制到剪贴板 💗') }}>📋 复制</button>
            <button className="btn btn-primary" onClick={() => setIntroOpen(false)}>关闭</button>
          </div>
        </Modal>
      )}
      {/* 图片放大相册（左右翻页） */}
      {lightbox && (
        <div className="modal-mask" style={{ zIndex: 300 }} onClick={() => setLightbox(null)}>
          <div style={{ textAlign: 'center', position: 'relative' }} onClick={e => e.stopPropagation()}>
            <img src={lightbox.urls[lightbox.idx]} alt="预览"
              style={{ maxHeight: '78vh', maxWidth: '88vw', borderRadius: 16, boxShadow: '0 20px 60px rgba(92,74,68,.4)' }} />
            <div style={{ display: 'flex', gap: 18, justifyContent: 'center', alignItems: 'center', marginTop: 14 }}>
              <button className="btn" disabled={lightbox.idx === 0}
                onClick={() => setLightbox({ ...lightbox, idx: lightbox.idx - 1 })}>← 上一张</button>
              <span style={{ color: '#fff', fontSize: 13, textShadow: '0 1px 6px rgba(0,0,0,.4)' }}>
                {lightbox.idx + 1} / {lightbox.urls.length}
              </span>
              <button className="btn" disabled={lightbox.idx === lightbox.urls.length - 1}
                onClick={() => setLightbox({ ...lightbox, idx: lightbox.idx + 1 })}>下一张 →</button>
            </div>
            <p style={{ color: '#fff', fontSize: 12, marginTop: 8, opacity: .8 }}>点击空白处关闭</p>
          </div>
        </div>
      )}
      {confirmNode}
    </div>
  )
}

function SkillInput({ onSave }: { onSave: (s: { name: string; level: number }) => void }) {
  const [name, setName] = useState('')
  const [level, setLevel] = useState(5)
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
      <input className="input" style={{ borderStyle: 'dashed' }} placeholder="＋ 新技能，如：Python"
        value={name} onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && name.trim()) { onSave({ name: name.trim(), level }); setName('') } }} />
      <select className="select" style={{ width: 90 }} value={level} onChange={e => setLevel(+e.target.value)}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n} 级</option>)}
      </select>
      <button className="btn btn-ghost" disabled={!name.trim()} onClick={() => { onSave({ name: name.trim(), level }); setName('') }}>添加</button>
    </div>
  )
}
