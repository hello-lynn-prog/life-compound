/**
 * 全局 Markdown 渲染：三处（知识卡片 / 日记 / 复盘）共用同一份配置，
 * 链接统一样式并固定在新标签页打开，避免点出去把系统页面顶掉。
 */
import { marked, type Tokens } from 'marked'

marked.use({
  // marked 13 需要显式开启新版 token 签名，否则 link 会被按旧参数转换导致崩溃
  useNewRenderer: true,
  renderer: {
    link(this: { parser: { parseInline(tokens: Tokens.Generic[]): string } }, token: Tokens.Link) {
      const text = this.parser.parseInline(token.tokens)
      const title = token.title ? ` title="${token.title}"` : ''
      return `<a href="${token.href}"${title} target="_blank" rel="noopener noreferrer">${text}</a>`
    },
  },
})

/** 解码 HTML 实体（最多两轮，处理 AI 复制内容里的双重转义） */
function decodeEntities(src: string): string {
  let out = src
  for (let i = 0; i < 2; i++) {
    out = out
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
    out = out.replace(/&amp;/g, '&')
  }
  return out
}

/**
 * 清洗"从 AI 对话/网页复制来的"内容：
 * - 解码转义实体（&lt;p&gt; → <p>），不然满屏都是符号
 * - <p> 边界转成空行（Markdown 段落）、<br> 转换行
 * 解码后剩下的正常 HTML 标签交给 marked 原样渲染（浏览器当真标签处理，观感正确）
 */
function normalizePasted(src: string): string {
  const decoded = decodeEntities(src || '')
  return decoded
    .replace(/<p[^>]*>/gi, '\n\n')
    .replace(/<\/p>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
}

export function renderMd(src: string): string {
  return marked.parse(normalizePasted(src), { async: false }) as string
}

/**
 * 行内 Markdown 渲染（预览行专用）：只解析加粗/斜体/行内代码/删除线，
 * 不产生块级标签——用于日记时间线的单行简介，保留加粗效果又不破坏布局。
 * 同样先清洗粘贴实体、剥掉 HTML 标签，保证预览行干净。
 */
export function renderInlineMd(src: string): string {
  const cleaned = normalizePasted(src)
    .replace(/<[^>]+>/g, ' ') // 行内预览不放 HTML 标签
  const escaped = cleaned
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}
