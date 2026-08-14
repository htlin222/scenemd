import { EditorView } from 'codemirror'
import type { LucideIcon } from 'lucide-react'

export interface Tool {
  label: string
  icon: LucideIcon
  action: (view: EditorView) => void
}

export function replaceSelection(view: EditorView, before: string, after: string, placeholder: string) {
  const { from, to } = view.state.selection.main
  const selected = view.state.sliceDoc(from, to) || placeholder
  view.dispatch({
    changes: { from, to, insert: `${before}${selected}${after}` },
    selection: { anchor: from + before.length, head: from + before.length + selected.length },
  })
  view.focus()
}

export function prefixLines(view: EditorView, prefix: string) {
  const selection = view.state.selection.main
  const startLine = view.state.doc.lineAt(selection.from)
  const endLine = view.state.doc.lineAt(selection.to)
  const changes = []
  for (let number = startLine.number; number <= endLine.number; number += 1) {
    changes.push({ from: view.state.doc.line(number).from, insert: prefix })
  }
  view.dispatch({ changes })
  view.focus()
}

export function insertLink(view: EditorView, image = false) {
  const { from, to } = view.state.selection.main
  const selected = view.state.sliceDoc(from, to) || (image ? 'alt text' : 'link text')
  const prefix = image ? '![' : '['
  const insert = `${prefix}${selected}](https://)`
  const urlStart = from + prefix.length + selected.length + 2
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: urlStart, head: urlStart + 8 } })
  view.focus()
}

export function insertBlock(view: EditorView, content: string) {
  const { from, to } = view.state.selection.main
  const lineStart = view.state.doc.lineAt(from).from
  const insert = `${lineStart === 0 ? '' : '\n'}${content}\n`
  view.dispatch({ changes: { from: lineStart, to, insert }, selection: { anchor: lineStart + insert.length } })
  view.focus()
}

export function selectionPoints(value: string): string[] {
  const linePoints = value.split(/\r?\n/).map((line) => line.trim().replace(/^[-+*]\s+/, '')).filter(Boolean)
  if (linePoints.length > 1) return linePoints
  const sentences = value.replace(/\s+/g, ' ').trim().match(/[^.!?。！？；;]+[.!?。！？；;]?/g)
  return sentences?.map((sentence) => sentence.trim()).filter(Boolean) ?? []
}

export function columnsMarkdown(value: string): string {
  const points = selectionPoints(value)
  const midpoint = Math.max(1, Math.ceil(points.length / 2))
  const left = points.slice(0, midpoint)
  const right = points.slice(midpoint)
  const bullets = (items: string[], fallback: string) => (items.length ? items : [fallback]).map((item) => `- ${item}`).join('\n')
  return `<!-- present: columns -->\n### Key points\n\n${bullets(left, 'Add a key point')}\n\n### Details\n\n${bullets(right, 'Add supporting detail')}\n<!-- present: end-columns -->`
}

export function insertColumns(view: EditorView) {
  const { from, to } = view.state.selection.main
  const selected = view.state.sliceDoc(from, to)
  const content = columnsMarkdown(selected)
  const lineStart = view.state.doc.lineAt(from).from
  const prefix = lineStart === 0 ? '' : '\n'
  const insert = `${prefix}${content}\n`
  view.dispatch({ changes: { from: lineStart, to, insert }, selection: { anchor: lineStart + insert.length } })
  view.focus()
}
