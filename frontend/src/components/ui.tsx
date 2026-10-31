/**
 * 通用小组件：Toast 提示、模态框、空状态、确认框
 */
import React, { createContext, useCallback, useContext, useState } from 'react'

/* ---------------- Toast ---------------- */
const ToastCtx = createContext<(msg: string) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([])
  const push = useCallback((msg: string) => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, msg }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2400)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {toasts.map(t => <div key={t.id} className="toast">{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  )
}

/* ---------------- 模态框 ---------------- */
export function Modal({
  title, children, onClose, wide,
}: { title: React.ReactNode; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="modal-mask" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={wide ? { width: 860 } : undefined}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}

/* ---------------- 确认框（删除等危险操作用） ---------------- */
export function Confirm({
  text, onOk, onCancel, danger = true,
}: { text: string; onOk: () => void; onCancel: () => void; danger?: boolean }) {
  return (
    <Modal title="⚠️ 请确认" onClose={onCancel}>
      <p style={{ fontSize: 14, lineHeight: 1.8 }}>{text}</p>
      <div className="form-actions">
        <button className="btn" onClick={onCancel}>再想想</button>
        <button className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={onOk}>确定</button>
      </div>
    </Modal>
  )
}

/* ---------------- 空状态 ---------------- */
export function Empty({ emoji = '🫧', text }: { emoji?: string; text: string }) {
  return (
    <div className="empty">
      <span className="e-emoji">{emoji}</span>
      {text}
    </div>
  )
}

/* ---------------- 危险操作二次确认 Hook ---------------- */
export function useConfirm() {
  const [state, setState] = useState<{ text: string; onOk: () => void } | null>(null)
  const confirm = (text: string, onOk: () => void) => setState({ text, onOk })
  const node = state ? (
    <Confirm
      text={state.text}
      onOk={() => { state.onOk(); setState(null) }}
      onCancel={() => setState(null)}
    />
  ) : null
  return { confirm, confirmNode: node }
}
