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

export function renderMd(src: string): string {
  return marked.parse(src || '', { async: false }) as string
}

/**
 * 行内 Markdown 渲染（预览行专用）：只解析加粗/斜体/行内代码/删除线，
 * 不产生块级标签——用于日记时间线的单行简介，保留加粗效果又不破坏布局。
 */
export function renderInlineMd(src: string): string {
  const escaped = (src || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}
