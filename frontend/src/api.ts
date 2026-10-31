/**
 * 后端 API 封装：所有请求走这里，统一处理响应格式 { ok, data, message }
 */
export interface ApiResp<T = any> {
  ok: boolean
  data: T
  message: string
}

async function request<T = any>(method: string, path: string, body?: any): Promise<T> {
  const resp = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!resp.ok) {
    let detail = `请求失败 (${resp.status})`
    try {
      const j = await resp.json()
      detail = j.detail || j.message || detail
    } catch { /* 非 JSON 错误体，用默认文案 */ }
    throw new Error(detail)
  }
  const ct = resp.headers.get('content-type') || ''
  if (!ct.includes('application/json')) return resp as unknown as T
  const json: ApiResp<T> = await resp.json()
  if (!json.ok) throw new Error(json.message || '操作失败')
  return json.data
}

export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body?: any) => request<T>('POST', path, body ?? {}),
  put: <T = any>(path: string, body?: any) => request<T>('PUT', path, body ?? {}),
  del: <T = any>(path: string) => request<T>('DELETE', path),
}

/** 今天的日期字符串 YYYY-MM-DD（本地时区） */
export function today(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "2026-10-31" → "10月31日 周六" */
export function prettyDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${d.getMonth() + 1}月${d.getDate()}日 周${week}`
}
