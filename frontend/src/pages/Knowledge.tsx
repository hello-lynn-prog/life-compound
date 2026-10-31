/**
 * 知识库：知识卡片（分类/标签/搜索/复习）+ 批量导入 + 知识图谱
 */
import { useMemo, useRef, useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { renderMd } from '../md'
import { api } from '../api'
import { Empty, Modal, useToast, useConfirm } from '../components/ui'

interface Card {
  id: number; title: string; content: string; category: string
  tags: string[]; source: string; review_count: number; last_review_at: string | null
  image_path?: string
}

// 预设分类（大方向）；色板用于图谱节点着色
const PRESET_CATEGORIES = ['💼 工作', '📚 读书', '🌱 生活', '🤖 Agent 研究', '🎨 AI 创作', '🧠 方法论', '💻 技术开发']
const CAT_COLORS: [RegExp, string][] = [
  [/工作/, '#9CCBF0'], [/读书/, '#F2C94C'], [/生活/, '#8FD8B8'],
  [/Agent/, '#CBBBF0'], [/创作/, '#FFB4C0'], [/方法/, '#FFC894'],
  [/技术|开发|全栈/, '#FF9BAC'], [/.*/, '#A8938A'],
]
const catColor = (c: string) => (CAT_COLORS.find(([re]) => re.test(c || '/')) || [, '#A8938A'])[1]

/** 解析批量导入文本：`# 标题` 开头分卡；无 # 时按空行分段，首行作标题 */
function parseImport(text: string): { title: string; content: string }[] {
  const out: { title: string; content: string }[] = []
  const hashBlocks = text.split(/^#\s+/m).filter(s => s.trim())
  for (const block of hashBlocks) {
    const nl = block.indexOf('\n')
    const title = (nl < 0 ? block : block.slice(0, nl)).trim()
    const content = nl < 0 ? '' : block.slice(nl + 1).trim()
    if (title) out.push({ title: title.replace(/^#+\s*/, ''), content })
  }
  if (out.length === 0) {
    // 没用 # 标题：按空行分段，每段首行当标题
    for (const para of text.split(/\n\s*\n/)) {
      const lines = para.trim().split('\n').filter(Boolean)
      if (!lines.length) continue
      out.push({ title: lines[0].slice(0, 50), content: lines.slice(1).join('\n') })
    }
  }
  return out
}

/** 简易力导向布局：卡片节点 + 标签节点，共享标签连线（静态迭代，无外部依赖） */
function forceLayout(cards: Card[], W: number, H: number) {
  type Node = { id: string; kind: 'card' | 'tag'; label: string; x: number; y: number; vx: number; vy: number; color: string; r: number; card?: Card }
  const nodes: Node[] = []
  const tagIndex = new Map<string, Node>()
  const edges: [Node, Node][] = []
  const allTags = new Map<string, number>()
  cards.forEach(c => (c.tags || []).forEach(t => allTags.set(t, (allTags.get(t) || 0) + 1)))
  // 标签节点
  for (const [t, n] of allTags) {
    const node: Node = { id: 'tag:' + t, kind: 'tag', label: `#${t}`, x: W / 2 + (Math.random() - .5) * 300, y: H / 2 + (Math.random() - .5) * 200, vx: 0, vy: 0, color: '#F87B93', r: 5 + Math.min(n, 6) }
    nodes.push(node); tagIndex.set(t, node)
  }
  // 卡片节点
  cards.forEach((c, i) => {
    const ang = (i / Math.max(cards.length, 1)) * Math.PI * 2
    const node: Node = { id: 'card:' + c.id, kind: 'card', label: c.title, x: W / 2 + Math.cos(ang) * 240, y: H / 2 + Math.sin(ang) * 170, vx: 0, vy: 0, color: catColor(c.category), r: 6 + Math.min(((c.content || '').length / 60) | 0, 8), card: c }
    nodes.push(node)
    ;(c.tags || []).forEach(t => { const tn = tagIndex.get(t); if (tn) edges.push([node, tn]) })
  })
  // 迭代：斥力 + 弹簧 + 向心
  for (let it = 0; it < 260; it++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j]
        let dx = b.x - a.x, dy = b.y - a.y
        let d2 = dx * dx + dy * dy
        if (d2 < 1) { d2 = 1; dx = Math.random(); dy = Math.random() }
        const d = Math.sqrt(d2)
        const rep = 2600 / d2
        const fx = (dx / d) * rep, fy = (dy / d) * rep
        a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy
      }
    }
    for (const [a, b] of edges) {
      const dx = b.x - a.x, dy = b.y - a.y
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
      const f = (d - 80) * 0.06
      const fx = (dx / d) * f, fy = (dy / d) * f
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy
    }
    for (const n of nodes) {
      n.vx += (W / 2 - n.x) * 0.004; n.vy += (H / 2 - n.y) * 0.004
      n.x += Math.max(-8, Math.min(8, n.vx)); n.y += Math.max(-8, Math.min(8, n.vy))
      n.vx *= 0.82; n.vy *= 0.82
      n.x = Math.max(30, Math.min(W - 30, n.x)); n.y = Math.max(24, Math.min(H - 24, n.y))
    }
  }
  return { nodes, edges }
}

export default function Knowledge() {
  const qc = useQueryClient()
  const toast = useToast()
  const { confirm, confirmNode } = useConfirm()
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [view, setView] = useState<Card | null>(null)
  const [edit, setEdit] = useState<Card | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ title: '', content: '', category: '', tags: '', source: '', image_path: '' })
  const [uploading, setUploading] = useState(false)
  // 知识库视图切换 + 批量导入
  const [viewMode, setViewMode] = useState<'cards' | 'graph'>('cards')
  const [importOpen, setImportOpen] = useState(false)
  const [newCatOpen, setNewCatOpen] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [importText, setImportText] = useState('')
  const [importCat, setImportCat] = useState('')
  const [importTags, setImportTags] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: cards } = useQuery({
    queryKey: ['knowledge', q, category],
    queryFn: () => api.get<Card[]>(`/api/knowledge?q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}`),
  })

  const categories = useMemo(() => [...new Set((cards || []).map(c => c.category).filter(Boolean))], [cards])

  const openEditor = (c: Card | null, presetCategory = '') => {
    if (c) { setEdit(c); setCreating(false); setForm({ title: c.title, content: c.content, category: c.category, tags: (c.tags || []).join(', '), source: c.source, image_path: (c as any).image_path || '' }) }
    else { setEdit(null); setCreating(true); setForm({ title: '', content: '', category: presetCategory, tags: '', source: '', image_path: '' }) }
  }

  // 上传配图（截图/随手拍），成功后记录到表单
  const uploadImage = async (file: File | undefined | null) => {
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch('/api/uploads/image', { method: 'POST', body: fd })
      if (!r.ok) throw new Error('上传失败')
      const j = await r.json()
      setForm(f => ({ ...f, image_path: j.data.url }))
      toast('配图已就位 🖼️')
    } catch { toast('图片上传失败，请重试') }
    finally { setUploading(false) }
  }

  const save = useMutation({
    mutationFn: () => {
      const tags = form.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean)
      const payload = { ...form, tags }
      if (creating) return api.post('/api/knowledge', payload)
      return api.put(`/api/knowledge/${(edit as Card).id}`, payload)
    },
    onSuccess: () => { openEditor(null); setCreating(false); toast('卡片已保存 💡'); qc.invalidateQueries({ queryKey: ['knowledge'] }) },
    onError: (e: Error) => toast(e.message),
  })

  const review = useMutation({
    mutationFn: (id: number) => api.post(`/api/knowledge/${id}/review`),
    onSuccess: () => { toast('又复习了一遍，记得更牢啦 💪'); qc.invalidateQueries({ queryKey: ['knowledge'] }) },
  })
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/api/knowledge/${id}`),
    onSuccess: () => { toast('已移入回收站 🗑️'); qc.invalidateQueries({ queryKey: ['knowledge'] }) },
  })

  // 批量导入：把粘贴的文本/上传的 md、txt 解析成多张卡片
  const parsedCount = useMemo(() => (importText.trim() ? parseImport(importText).length : 0), [importText])
  const doImport = useMutation({
    mutationFn: async () => {
      const items = parseImport(importText)
      const tags = importTags.split(/[,，]/).map(t => t.trim()).filter(Boolean)
      let okN = 0
      for (const it of items) {
        try { await api.post('/api/knowledge', { ...it, category: importCat, tags }); okN++ } catch { /* 单张失败继续 */ }
      }
      return okN
    },
    onSuccess: (okN) => {
      setImportOpen(false); setImportText(''); setImportTags('')
      toast(`成功导入 ${okN} 张知识卡片 📥`)
      qc.invalidateQueries({ queryKey: ['knowledge'] })
    },
    onError: (e: Error) => toast(e.message),
  })

  // 读取上传的 .md / .txt 文件到导入框
  const onPickFile = (files: FileList | null) => {
    if (!files || !files.length) return
    const reader = new FileReader()
    reader.onload = () => setImportText(prev => (prev ? prev + '\n\n' : '') + String(reader.result || ''))
    for (const f of Array.from(files)) reader.readAsText(f, 'utf-8')
  }

  return (
    <div>
      <div className="page-title-row">
        <div className="page-title">📚 知识库</div>
        <div className="page-sub">工作 · 读书 · 生活，学到的都存进来 · 共 {cards?.length ?? 0} 张</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={() => setViewMode(viewMode === 'cards' ? 'graph' : 'cards')}>
            {viewMode === 'cards' ? '🕸️ 看知识图谱' : '🗂️ 看卡片列表'}
          </button>
          <button className="btn" onClick={() => setImportOpen(true)}>📥 批量导入</button>
          <button className="btn" onClick={() => setNewCatOpen(true)}>🏷️ 新分类</button>
          <button className="btn btn-primary" onClick={() => openEditor(null)}>＋ 新知识卡片</button>
        </div>
      </div>

      {viewMode === 'cards' && (
        <>
          <div className="card" style={{ marginBottom: 20, padding: '16px 20px' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="input" style={{ width: 240 }} placeholder="🔍 搜标题 / 内容 / 出处…" value={q} onChange={e => setQ(e.target.value)} />
              <button className={`chip${category === '' ? ' on' : ''}`} onClick={() => setCategory('')}>全部分类</button>
              {categories.map(c => (
                <button key={c} className={`chip${category === c ? ' on' : ''}`} onClick={() => setCategory(category === c ? '' : c)}>{c}</button>
              ))}
            </div>
          </div>

          {cards?.length === 0 && <div className="card"><Empty emoji="💡" text="还没有知识卡片。点右上「批量导入」把笔记一次性搬进来吧" /></div>}

          {/* 按大方向分区显示（预设顺序在前，自定义分类在后） */}
          {(() => {
            const presetOrder = PRESET_CATEGORIES.filter(cat => (cards || []).some(c => c.category === cat))
            const customs = [...new Set((cards || []).map(c => c.category).filter(c => c && !PRESET_CATEGORIES.includes(c)))]
              .filter(cat => (cards || []).some(c => c.category === cat))
            return [...presetOrder, ...customs].map(cat => {
              const group = (cards || []).filter(c => c.category === cat)
              return (
                <div key={cat} style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 4px 12px' }}>
                    <span style={{ fontSize: 15, fontWeight: 'bold', color: 'var(--peach-deep)' }}>{cat}</span>
                    <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{group.length} 张</span>
                    <button className="btn btn-sm btn-ghost" title={`在「${cat}」下添加知识`}
                      onClick={() => openEditor(null, cat)}>＋ 在此添加</button>
                    <span style={{ flex: 1, borderBottom: '2px dashed var(--line)' }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
                    {group.map(c => (
                      <div key={c.id} className="card" style={{ padding: '16px 18px', cursor: 'pointer' }} onClick={() => setView(c)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <span style={{ fontSize: 14, fontWeight: 'bold', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                          {c.review_count > 0 && <span className="t-tag">🔁 {c.review_count}</span>}
                        </div>
                        <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.7, maxHeight: 66, overflow: 'hidden' }}>
                          {(c.content || '').replace(/[#*\-`>]/g, '').slice(0, 90)}…
                        </p>
                        {c.image_path && (
                          <img src={c.image_path} alt="" style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 10, marginTop: 10 }} />
                        )}
                        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                          {(c.tags || []).slice(0, 4).map(t => <span key={t} className="t-tag green">#{t}</span>)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          })()}
        </>
      )}

      {viewMode === 'graph' && <KnowledgeGraph cards={cards || []} onOpen={c => setView(c)} />}

      {/* 查看卡片 */}
      {view && (
        <Modal title={`💡 ${view.title}`} onClose={() => setView(null)}>
          {view.image_path && (
            <img src={view.image_path} alt="配图"
              style={{ width: '100%', maxHeight: 340, objectFit: 'contain', borderRadius: 12, marginBottom: 12, background: 'var(--cream)' }} />
          )}
          <div className="textarea md-preview" style={{ background: 'var(--cream)', border: 'none', minHeight: 160 }}
            dangerouslySetInnerHTML={{ __html: renderMd(view.content || '*（无内容）*') }} />
          <div style={{ display: 'flex', gap: 6, margin: '14px 0', flexWrap: 'wrap' }}>
            {view.category && <span className="t-tag blue">{view.category}</span>}
            {(view.tags || []).map(t => <span key={t} className="t-tag green">#{t}</span>)}
            {view.source && <span className="t-tag">📖 {view.source}</span>}
            {view.review_count > 0 && <span className="t-tag">🔁 复习 {view.review_count} 次</span>}
          </div>
          <div className="form-actions">
            <button className="btn" onClick={e => { e.stopPropagation(); review.mutate(view.id); setView(null) }}>🔁 再复习一遍</button>
            <button className="btn btn-ghost" onClick={() => { openEditor(view); setView(null) }}>✏️ 编辑</button>
            <button className="btn btn-danger" onClick={() => { const id = view.id; setView(null); confirm('确定删除这张卡片吗？', () => del.mutate(id)) }}>🗑️ 删除</button>
          </div>
        </Modal>
      )}

      {/* 编辑 / 新建 */}
      {(creating || edit) && (
        <Modal title={creating ? '💡 新知识卡片' : '✏️ 编辑卡片'} onClose={() => { openEditor(null); setCreating(false) }}>
          <div className="form-row"><label>标题 *</label>
            <input className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="一句话说清这是什么知识" autoFocus />
          </div>
          <div className="form-row"><label>内容（Markdown）</label>
            <textarea className="textarea" style={{ minHeight: 160 }} value={form.content}
              onChange={e => setForm({ ...form, content: e.target.value })}
              placeholder={'用自己的话重述一遍，比抄原文记得牢\n\n例如：WAL 模式让 SQLite 写入时…'} />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="form-row" style={{ flex: 1 }}><label>分类（可选现有，也可输入新分类如：面试）</label>
              <input className="input" list="kb-cats" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} />
              <datalist id="kb-cats">
                {PRESET_CATEGORIES.map(c => <option key={c} value={c} />)}
                {categories.filter(c => !PRESET_CATEGORIES.includes(c)).map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div className="form-row" style={{ flex: 1 }}><label>标签（逗号分隔）</label>
              <input className="input" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} />
            </div>
          </div>
          <div className="form-row"><label>配图（截图、随手拍，可选）</label>
            {form.image_path ? (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <img src={form.image_path} alt="配图预览"
                  style={{ width: 160, height: 110, objectFit: 'cover', borderRadius: 10 }} />
                <button className="btn btn-sm btn-danger" onClick={() => setForm({ ...form, image_path: '' })}>移除图片</button>
              </div>
            ) : (
              <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                {uploading ? '上传中…' : '🖼️ 选择图片上传'}
                <input type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => { uploadImage(e.target.files?.[0]); e.target.value = '' }} />
              </label>
            )}
          </div>
          <div className="form-row"><label>出处（书名 / 链接 / 课程，可选）</label>
            <input className="input" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} />
          </div>
          <div className="form-actions">
            <button className="btn" onClick={() => { openEditor(null); setCreating(false) }}>取消</button>
            <button className="btn btn-primary" disabled={!form.title.trim()} onClick={() => save.mutate()}>保存</button>
          </div>
        </Modal>
      )}
      {/* 批量导入 */}
      {/* 新建分类 */}
      {newCatOpen && (
        <Modal title="🏷️ 新建分类" onClose={() => { setNewCatOpen(false); setNewCatName('') }}>
          <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 10 }}>
            起个大方向的名字（可带 emoji 更好认），比如：🎤 面试、👗 穿搭、📈 副业。保存第一张卡片后它就会出现在页面上。
          </p>
          <input className="input" autoFocus placeholder="分类名，如：🎤 面试"
            value={newCatName} onChange={e => setNewCatName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newCatName.trim()) {
                const name = newCatName.trim(); setNewCatOpen(false); setNewCatName(''); openEditor(null, name)
              }
            }} />
          <div className="form-actions">
            <button className="btn" onClick={() => { setNewCatOpen(false); setNewCatName('') }}>取消</button>
            <button className="btn btn-primary" disabled={!newCatName.trim()}
              onClick={() => { const name = newCatName.trim(); setNewCatOpen(false); setNewCatName(''); openEditor(null, name) }}>
              下一步：写第一张卡
            </button>
          </div>
        </Modal>
      )}
      {importOpen && (
        <Modal title="📥 批量导入知识" onClose={() => setImportOpen(false)} wide>
          <p style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.8, marginBottom: 10 }}>
            粘贴多段笔记，或选择 .md / .txt 文件。用 <b># 标题</b> 分隔多张卡片（标题下一行是正文）；
            没有标题的话，每个空行分隔的段落会成为一张卡，首行当标题。
          </p>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>📄 选择文件（.md / .txt）</button>
            <input ref={fileRef} type="file" accept=".md,.txt" multiple style={{ display: 'none' }}
              onChange={e => { onPickFile(e.target.files); e.target.value = '' }} />
            <select className="select" style={{ width: 'auto' }} value={importCat} onChange={e => setImportCat(e.target.value)}>
              <option value="">分类：暂不设置</option>
              {PRESET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              {categories.filter(c => !PRESET_CATEGORIES.includes(c)).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input className="input" style={{ width: 220 }} placeholder="统一加标签（逗号分隔，可空）"
              value={importTags} onChange={e => setImportTags(e.target.value)} />
          </div>
          <textarea className="textarea" style={{ minHeight: 260, fontFamily: 'inherit' }} autoFocus
            placeholder={'# 第一张卡的标题\n正文内容…\n\n# 第二张卡的标题\n正文内容…'}
            value={importText} onChange={e => setImportText(e.target.value)} />
          <div className="form-actions">
            <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--ink-soft)' }}>
              {parsedCount > 0 ? `识别到 ${parsedCount} 张卡片` : '等待输入…'}
            </span>
            <button className="btn" onClick={() => setImportOpen(false)}>取消</button>
            <button className="btn btn-primary" disabled={!parsedCount || doImport.isPending}
              onClick={() => doImport.mutate()}>{doImport.isPending ? '导入中…' : `导入 ${parsedCount} 张`}</button>
          </div>
        </Modal>
      )}
      {confirmNode}
    </div>
  )
}

/* ================= 知识图谱视图 ================= */
function KnowledgeGraph({ cards, onOpen }: { cards: Card[]; onOpen: (c: Card) => void }) {
  const [hover, setHover] = useState<string | null>(null)
  const W = 980, H = 560
  const layout = useMemo(() => forceLayout(cards, W, H), [cards])
  // 拖拽状态
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const didDragRef = useRef(false) // 拖过标记：防止松手时的 click 误触"打开卡片"
  // 用户拖过的节点位置（实时）；拖完持久化到数据库 settings
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const positionsRef = useRef(positions)
  positionsRef.current = positions
  const dbPosRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const [, bumpRender] = useState(0) // 数据库存档加载完成后强制重绘一次
  const loadSaved = useMutation({
    mutationFn: () => api.get<Record<string, string>>('/api/data/settings'),
    onSuccess: (s) => {
      try {
        const saved = JSON.parse(s['graph_positions'] || '{}') as Record<string, { x: number; y: number }>
        dbPosRef.current = new Map(Object.entries(saved))
        bumpRender(x => x + 1) // ref 变化不会触发渲染，手动刷
      } catch { /* 无存档 */ }
    },
  })
  useEffect(() => { loadSaved.mutate() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const posOf = (id: string, fallback: { x: number; y: number }) =>
    positions[id] ?? dbPosRef.current.get(id) ?? fallback

  // 拖拽实现（SVG 坐标换算，鼠标 + 触屏通用）
  const toSvgXY = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect()
    const scaleX = W / rect.width, scaleY = H / rect.height
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY }
  }
  useEffect(() => {
    if (!dragId) return
    let moved = false
    const onMove = (e: PointerEvent) => {
      moved = true
      const p = toSvgXY(e.clientX, e.clientY)
      setPositions(prev => ({ ...prev, [dragId]: { x: p.x, y: p.y } }))
    }
    const onUp = () => {
      setDragId(null)
      // click 事件在 pointerup 之后才触发，标记"刚拖过"让 onClick 跳过本次
      if (moved) { didDragRef.current = true; setTimeout(() => { didDragRef.current = false }, 120) }
      // 拖完持久化：把当前全部已知位置写入数据库 settings（用 ref 取最新值）
      setTimeout(() => {
        const cur = positionsRef.current
        const payload: Record<string, { x: number; y: number }> = {}
        // 先继承数据库里已有的存档，再覆盖本次拖过的
        dbPosRef.current.forEach((v, k) => { payload[k] = v })
        Object.entries(cur).forEach(([k, v]) => { payload[k] = { x: Math.round(v.x), y: Math.round(v.y) } })
        if (Object.keys(payload).length) {
          fetch('/api/data/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ graph_positions: JSON.stringify(payload) }),
          }).catch(() => { /* 存失败也不影响使用，只是刷新后回原位 */ })
        }
      }, 60)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [dragId, layout])

  const related = useMemo(() => {
    if (!hover) return null
    const set = new Set<string>([hover])
    layout.edges.forEach(([a, b]) => {
      if (a.id === hover) set.add(b.id)
      if (b.id === hover) set.add(a.id)
    })
    return set
  }, [hover, layout])

  if (cards.length === 0) return <div className="card"><Empty emoji="🕸️" text="先添加几张卡片，图谱就会长出来～" /></div>

  const posById = new Map<string, { x: number; y: number }>()
  layout.nodes.forEach(n => posById.set(n.id, posOf(n.id, n)))

  return (
    <div className="card">
      <div className="card-title">🕸️ 知识图谱
        <span className="hint">拖动圆点整理布局（自动保存）· 悬停高亮 · 点击卡片打开</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`}
          style={{ minWidth: 760, background: 'var(--cream)', borderRadius: 14, touchAction: 'none' }}>
          {layout.edges.map(([a, b], i) => {
            const pa = posById.get(a.id)!, pb = posById.get(b.id)!
            return (
              <line key={i} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                stroke={related && (a.id === hover || b.id === hover) ? '#F87B93' : '#EBD4CB'}
                strokeWidth={related && (a.id === hover || b.id === hover) ? 2.5 : 1.2}
                opacity={!related || related.has(a.id) || related.has(b.id) ? 0.9 : 0.15} />
            )
          })}
          {layout.nodes.map(n => {
            const p = posById.get(n.id)!
            const dim = related && !related.has(n.id)
            return (
              <g key={n.id}
                onPointerDown={e => {
                  e.currentTarget.setPointerCapture?.(e.pointerId)
                  setDragId(n.id); setHover(n.id)
                }}
                onMouseEnter={() => setHover(n.id)} onMouseLeave={() => !dragId && setHover(null)}
                onClick={() => { if (!n.card || didDragRef.current) return; onOpen(n.card) }}
                style={{ cursor: dragId === n.id ? 'grabbing' : n.card ? 'grab' : 'default', opacity: dim ? 0.15 : 1 }}>
                <circle cx={p.x} cy={p.y} r={hover === n.id ? n.r + 3 : n.r}
                  fill={n.kind === 'tag' ? 'rgba(248,123,147,.28)' : n.color}
                  stroke={n.kind === 'tag' ? '#F87B93' : '#fff'} strokeWidth={1.5} />
                <text x={p.x} y={p.y - n.r - 5} textAnchor="middle"
                  fontSize={n.kind === 'tag' ? 11 : 10.5}
                  fill={n.kind === 'tag' ? '#F87B93' : 'var(--ink)'}
                  fontWeight={n.kind === 'tag' ? 700 : 400}>
                  {n.label.length > 12 ? n.label.slice(0, 11) + '…' : n.label}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
