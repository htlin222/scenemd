import { documentVisibleMarkdown } from './MarkdownDocumentView'

export interface OutlineItem {
  level: 1 | 2 | 3
  text: string
  offset: number
  line: number
  previewIndex: number
}

export function documentOutline(value: string): OutlineItem[] {
  const visible = documentVisibleMarkdown(value)
  const outline: OutlineItem[] = []
  let sourceCursor = 0
  visible.split('\n').forEach((line) => {
    const sourceOffset = value.indexOf(line, sourceCursor)
    if (sourceOffset >= 0) sourceCursor = sourceOffset + line.length
    const match = line.match(/^\s{0,3}(#{1,3})\s+(.+?)\s*#*\s*$/)
    if (!match || sourceOffset < 0) return
    const text = match[2]
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_~`]/g, '')
      .replace(/<[^>]+>/g, '')
      .trim()
    if (!text) return
    outline.push({
      level: match[1].length as OutlineItem['level'],
      text,
      offset: sourceOffset + line.indexOf('#'),
      line: value.slice(0, sourceOffset).split('\n').length,
      previewIndex: outline.length,
    })
  })
  return outline
}
