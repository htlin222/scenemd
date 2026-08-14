import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { basicSetup, EditorView } from 'codemirror'
import { Decoration, WidgetType, type DecorationSet } from '@codemirror/view'
import { StateField, type EditorState, type Range } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { tags } from '@lezer/highlight'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import {
  Bold,
  BookPlus,
  Check,
  CircleEuro,
  Code2,
  Columns2,
  Eye,
  GitBranch,
  Heading2,
  Hash,
  Image,
  Italic,
  Link,
  List,
  ListChecks,
  ListTree,
  ListOrdered,
  Minus,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelsTopLeft,
  Pencil,
  Quote,
  RotateCcw,
  Sheet,
  Sparkles,
  Strikethrough,
  Table2,
  Upload,
  X,
} from 'lucide-react'
import type { ThemeMode } from '../engine/types'
import {
  existingCitationReferenceNumber,
  insertCitationReference,
  normalizeCitationIdentifier,
  remarkBracketCitations,
  type CitationIdentifier,
} from '../citations'
import { formatMarpitImageAlt, imageFilterCss, parseMarpitImageAlt, type MarpitImageOptions } from '../imageSyntax'
import { OpenEvidenceImportDialog } from './OpenEvidenceImportDialog'
import { aggregateMarkdownReferences, normalizeMarkdownUrls } from '../lib/openevidence'
import { minimalDocChange } from '../lib/minimalChange'
import { imageParagraphReplacement, readImageLegend } from '../lib/legendText'

export type EditorMode = 'write' | 'split' | 'preview'

class MarkdownImagePreviewWidget extends WidgetType {
  constructor(readonly url: string, readonly alt: string) { super() }
  eq(other: MarkdownImagePreviewWidget) { return other.url === this.url && other.alt === this.alt }
  toDOM() {
    const wrapper = document.createElement('div')
    wrapper.className = 'cm-image-preview-block'
    const figure = document.createElement('figure')
    figure.className = 'cm-image-preview'
    const image = document.createElement('img')
    image.src = this.url
    image.alt = this.alt
    image.loading = 'lazy'
    figure.appendChild(image)
    if (this.alt) {
      const caption = document.createElement('figcaption')
      caption.textContent = this.alt
      figure.appendChild(caption)
    }
    wrapper.appendChild(figure)
    return wrapper
  }
  ignoreEvent() { return false }
}

function imagePreviewDecorations(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = []
  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber)
    const match = line.text.match(/!\[([^\]]*)]\((https?:\/\/[^\s)]+)\)/)
    if (!match) continue
    decorations.push(Decoration.widget({ widget: new MarkdownImagePreviewWidget(match[2], match[1]), block: true, side: 1 }).range(line.to))
  }
  return Decoration.set(decorations, true)
}

const markdownImagePreviews = StateField.define<DecorationSet>({
  create: imagePreviewDecorations,
  update(value, transaction) { return transaction.docChanged ? imagePreviewDecorations(transaction.state) : value.map(transaction.changes) },
  provide: (field) => EditorView.decorations.from(field),
})

export function documentVisibleMarkdown(value: string): string {
  const lines = value.split('\n')
  const visible: string[] = []
  let hiddenMode: 'await' | 'list' | 'paragraph' | 'fence' | null = null

  for (const line of lines) {
    if (/^\s*<!--\s*present:\s*(?:step|only)\s*-->\s*$/i.test(line)) {
      hiddenMode = 'await'
      continue
    }
    if (hiddenMode === 'await') {
      if (!line.trim()) continue
      if (/^\s*(?:[-+*]|\d+[.)])\s+/.test(line)) {
        hiddenMode = 'list'
        continue
      }
      if (/^\s*```/.test(line)) {
        hiddenMode = 'fence'
        continue
      }
      if (/^\s*(?:#{1,6}\s|!\[|>|\$\$|---\s*$)/.test(line)) {
        hiddenMode = null
        continue
      }
      hiddenMode = 'paragraph'
      continue
    }
    if (hiddenMode === 'list') {
      if (/^\s*(?:[-+*]|\d+[.)])\s+/.test(line) || /^\s{2,}\S/.test(line) || !line.trim()) continue
      hiddenMode = null
    } else if (hiddenMode === 'paragraph') {
      if (!line.trim()) hiddenMode = null
      continue
    } else if (hiddenMode === 'fence') {
      if (/^\s*```/.test(line)) hiddenMode = null
      continue
    }
    visible.push(line)
  }
  return visible.join('\n')
}

export function MarkdownDocumentView({ value, className = '' }: { value: string; className?: string }) {
  return (
    <article className={`markdown-document ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkBracketCitations]}
        rehypePlugins={[rehypeKatex]}
        skipHtml
        components={{
          a({ href, children }) {
            if (href?.startsWith('#citation-')) return <sup className="citation-marker citation-key"><span title="Pandoc citation key">{children}</span></sup>
            return href?.startsWith('#reference-')
              ? <sup className="citation-marker"><a href={href}>{children}</a></sup>
              : <a href={href}>{children}</a>
          },
          img({ alt = '', src = '' }) {
            const options = parseMarpitImageAlt(alt)
            const style: CSSProperties = {
              width: options.width || undefined,
              height: options.height || undefined,
              objectFit: 'contain',
              filter: imageFilterCss(options.filters),
            }
            return <img src={src} alt={options.alt} style={style} />
          },
        }}
      >{documentVisibleMarkdown(value)}</ReactMarkdown>
    </article>
  )
}

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  theme: ThemeMode
  mode: EditorMode
  onModeChange: (mode: EditorMode) => void
  onReset: () => void
  documentId: string
  saveStatus: 'saved' | 'saving' | 'conflict' | 'offline'
  onCursorLineChange?: (line: number) => void
  scrollRequest?: { line: number; key: number } | null
}

interface EditorStatus {
  line: number
  column: number
  selectedCharacters: number
  selectedLines: number
}

interface ImageUploadState {
  id: string
  name: string
  status: 'uploading' | 'complete' | 'error'
  message?: string
}

interface SelectionToolState {
  from: number
  to: number
  text: string
  left: number
  top: number
}

interface ImageToolState {
  from: number
  to: number
  url: string
  originalUrl: string
  options: MarpitImageOptions
  legend: string
  legendEditable: boolean
  left: number
  top: number
}

interface CitationImportState {
  identifier: string
  from: number
  to: number
}

interface CitationLookupState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  citation: string
  error: string
  existingNumber?: number
  identifier?: CitationIdentifier
}

interface OutlineItem {
  level: 1 | 2 | 3
  text: string
  offset: number
  line: number
  previewIndex: number
}

function documentOutline(value: string): OutlineItem[] {
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

const PRESENTATION_HINTS = [
  { label: '<!-- present: break -->', detail: 'Force a scene break' },
  { label: '<!-- present: keep -->', detail: 'Keep the next block together' },
  { label: '<!-- present: hero -->', detail: 'Emphasize the next image' },
  { label: '<!-- present: hide -->', detail: 'Hide the next block in presentation' },
  { label: '<!-- present: only -->', detail: 'Show the next block only in presentation' },
  { label: '<!-- present: step -->', detail: 'Reveal the next list item by item' },
  { label: '<!-- present: columns -->', detail: 'Start responsive semantic columns' },
  { label: '<!-- present: column -->', detail: 'Start another column' },
  { label: '<!-- present: end-columns -->', detail: 'End semantic columns' },
]

function presentationHintCompletion(context: CompletionContext): CompletionResult | null {
  const token = context.matchBefore(/<!--\s*present:\s*[a-z-]*/i)
  if (!token || (!context.explicit && token.from === token.to)) return null
  return {
    from: token.from,
    options: PRESENTATION_HINTS.map((hint) => ({ ...hint, type: 'keyword' })),
    validFor: /<!--\s*present:\s*[a-z-]*\s*(?:-->)?/i,
  }
}

const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--accent)', fontWeight: '700' },
  { tag: [tags.meta, tags.processingInstruction], color: 'var(--markdown-syntax)' },
  { tag: [tags.link, tags.url], color: 'var(--markdown-link)', textDecoration: 'underline' },
  { tag: tags.strong, color: 'var(--ink)', fontWeight: '700' },
  { tag: tags.emphasis, color: 'var(--ink)', fontStyle: 'italic' },
  { tag: tags.quote, color: 'var(--markdown-quote)' },
  { tag: [tags.monospace, tags.string], color: 'var(--markdown-code)' },
  { tag: tags.comment, color: 'var(--markdown-quote)', fontStyle: 'italic' },
])

interface Tool {
  label: string
  icon: typeof Bold
  action: (view: EditorView) => void
}

function replaceSelection(view: EditorView, before: string, after: string, placeholder: string) {
  const { from, to } = view.state.selection.main
  const selected = view.state.sliceDoc(from, to) || placeholder
  view.dispatch({
    changes: { from, to, insert: `${before}${selected}${after}` },
    selection: { anchor: from + before.length, head: from + before.length + selected.length },
  })
  view.focus()
}

function prefixLines(view: EditorView, prefix: string) {
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

function insertLink(view: EditorView, image = false) {
  const { from, to } = view.state.selection.main
  const selected = view.state.sliceDoc(from, to) || (image ? 'alt text' : 'link text')
  const prefix = image ? '![' : '['
  const insert = `${prefix}${selected}](https://)`
  const urlStart = from + prefix.length + selected.length + 2
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: urlStart, head: urlStart + 8 } })
  view.focus()
}

function insertBlock(view: EditorView, content: string) {
  const { from, to } = view.state.selection.main
  const lineStart = view.state.doc.lineAt(from).from
  const insert = `${lineStart === 0 ? '' : '\n'}${content}\n`
  view.dispatch({ changes: { from: lineStart, to, insert }, selection: { anchor: lineStart + insert.length } })
  view.focus()
}

function selectionPoints(value: string): string[] {
  const linePoints = value.split(/\r?\n/).map((line) => line.trim().replace(/^[-+*]\s+/, '')).filter(Boolean)
  if (linePoints.length > 1) return linePoints
  const sentences = value.replace(/\s+/g, ' ').trim().match(/[^.!?。！？；;]+[.!?。！？；;]?/g)
  return sentences?.map((sentence) => sentence.trim()).filter(Boolean) ?? []
}

function columnsMarkdown(value: string): string {
  const points = selectionPoints(value)
  const midpoint = Math.max(1, Math.ceil(points.length / 2))
  const left = points.slice(0, midpoint)
  const right = points.slice(midpoint)
  const bullets = (items: string[], fallback: string) => (items.length ? items : [fallback]).map((item) => `- ${item}`).join('\n')
  return `<!-- present: columns -->\n### Key points\n\n${bullets(left, 'Add a key point')}\n\n### Details\n\n${bullets(right, 'Add supporting detail')}\n<!-- present: end-columns -->`
}

function insertColumns(view: EditorView) {
  const { from, to } = view.state.selection.main
  const selected = view.state.sliceDoc(from, to)
  const content = columnsMarkdown(selected)
  const lineStart = view.state.doc.lineAt(from).from
  const prefix = lineStart === 0 ? '' : '\n'
  const insert = `${prefix}${content}\n`
  view.dispatch({ changes: { from: lineStart, to, insert }, selection: { anchor: lineStart + insert.length } })
  view.focus()
}

function parseDelimitedTable(value: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '"') {
      if (quoted && value[index + 1] === '"') { cell += '"'; index += 1 } else quoted = !quoted
    } else if (character === delimiter && !quoted) {
      row.push(cell); cell = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && value[index + 1] === '\n') index += 1
      row.push(cell); cell = ''
      if (row.some((entry) => entry.trim())) rows.push(row)
      row = []
    } else {
      cell += character
    }
  }
  row.push(cell)
  if (row.some((entry) => entry.trim())) rows.push(row)
  return rows
}

function tableFromHtml(html: string): string[][] {
  if (!html.trim()) return []
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const table = parsed.querySelector('table')
  if (!table) return []
  return [...table.querySelectorAll('tr')].map((row) => [...row.querySelectorAll(':scope > th, :scope > td')].map((cell) => {
    const clone = cell.cloneNode(true) as HTMLElement
    clone.querySelectorAll('br').forEach((breakElement) => breakElement.replaceWith(' · '))
    return clone.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  })).filter((row) => row.length > 0)
}

function detectPastedTable(source: string, clipboardHtml = ''): { rows: string[][]; format: 'Word / HTML' | 'TSV' | 'CSV' | null } {
  const htmlRows = tableFromHtml(clipboardHtml || (/<table[\s>]/i.test(source) ? source : ''))
  if (htmlRows.length) return { rows: htmlRows, format: 'Word / HTML' }
  if (source.includes('\t')) return { rows: parseDelimitedTable(source, '\t'), format: 'TSV' }
  const csvRows = parseDelimitedTable(source, ',')
  if (csvRows.length && csvRows.some((row) => row.length > 1)) return { rows: csvRows, format: 'CSV' }
  return { rows: [], format: null }
}

function markdownTableFromRows(rows: string[][]): string {
  const columnCount = Math.max(0, ...rows.map((row) => row.length))
  if (!rows.length || columnCount < 2) return ''
  const cleanCell = (cell = '') => cell.trim().replace(/\|/g, '\\|').replace(/\r?\n/g, ' · ')
  const normalized = rows.map((row) => Array.from({ length: columnCount }, (_, index) => cleanCell(row[index])))
  return [
    `| ${normalized[0].join(' | ')} |`,
    `| ${Array.from({ length: columnCount }, () => '---').join(' | ')} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

const tools: Tool[] = [
  { label: 'Add heading', icon: Heading2, action: (view) => prefixLines(view, '## ') },
  { label: 'Add bold text', icon: Bold, action: (view) => replaceSelection(view, '**', '**', 'bold text') },
  { label: 'Add italic text', icon: Italic, action: (view) => replaceSelection(view, '_', '_', 'italic text') },
  { label: 'Add strikethrough text', icon: Strikethrough, action: (view) => replaceSelection(view, '~~', '~~', 'strikethrough text') },
  { label: 'Add quote', icon: Quote, action: (view) => prefixLines(view, '> ') },
  { label: 'Add code', icon: Code2, action: (view) => replaceSelection(view, '`', '`', 'code') },
  { label: 'Add Mermaid diagram', icon: GitBranch, action: (view) => insertBlock(view, '```mermaid\ngraph TD\n  A[Start] --> B[Result]\n```') },
  { label: 'Add code group', icon: PanelsTopLeft, action: (view) => insertBlock(view, '::code-group\n\n```sh [npm]\nnpm install package\n```\n\n```sh [pnpm]\npnpm add package\n```\n\n::') },
  { label: 'Add link', icon: Link, action: (view) => insertLink(view) },
  { label: 'Add image', icon: Image, action: (view) => insertLink(view, true) },
  { label: 'Add bulleted list', icon: List, action: (view) => prefixLines(view, '- ') },
  { label: 'Add numbered list', icon: ListOrdered, action: (view) => prefixLines(view, '1. ') },
  { label: 'Add task list', icon: ListChecks, action: (view) => prefixLines(view, '- [ ] ') },
  { label: 'Arrange selection in semantic columns', icon: Columns2, action: insertColumns },
  { label: 'Add table', icon: Table2, action: (view) => insertBlock(view, '| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |') },
  { label: 'Add horizontal rule', icon: Minus, action: (view) => insertBlock(view, '---') },
]

export function MarkdownEditor({ value, onChange, theme, mode, onModeChange, onReset, documentId, saveStatus, onCursorLineChange, scrollRequest }: MarkdownEditorProps) {
  const editorVisible = mode !== 'preview'
  const hostRef = useRef<HTMLDivElement>(null)
  const documentRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const onChangeRef = useRef(onChange)
  const onCursorLineChangeRef = useRef(onCursorLineChange)
  const valueRef = useRef(value)
  const imageHandlerRef = useRef<(files: File[], view: EditorView) => void>(() => undefined)
  const [status, setStatus] = useState<EditorStatus>({ line: 1, column: 1, selectedCharacters: 0, selectedLines: 0 })
  const [imageUploads, setImageUploads] = useState<ImageUploadState[]>([])
  const [showOpenEvidenceImport, setShowOpenEvidenceImport] = useState(false)
  const [tableImport, setTableImport] = useState<{ source: string; html: string; from: number; to: number } | null>(null)
  const [citationImport, setCitationImport] = useState<CitationImportState | null>(null)
  const [citationLookup, setCitationLookup] = useState<CitationLookupState>({ status: 'idle', citation: '', error: '' })
  const [selectionTool, setSelectionTool] = useState<SelectionToolState | null>(null)
  const [imageTool, setImageTool] = useState<ImageToolState | null>(null)
  const imageToolRef = useRef<ImageToolState | null>(null)
  const [aiBusy, setAiBusy] = useState<'flat' | 'nested' | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [showLineNumbers, setShowLineNumbers] = useState(() => localStorage.getItem('scenemd-editor-line-numbers') === 'true')
  const [showOutline, setShowOutline] = useState(() => localStorage.getItem('scenemd-editor-outline') !== 'false')
  const [outlineWidth, setOutlineWidth] = useState(() => {
    const saved = Number(localStorage.getItem('scenemd-editor-outline-width'))
    return Number.isFinite(saved) && saved >= 150 && saved <= 420 ? saved : 190
  })
  onChangeRef.current = onChange
  onCursorLineChangeRef.current = onCursorLineChange
  valueRef.current = value
  imageToolRef.current = imageTool

  useEffect(() => {
    localStorage.setItem('scenemd-editor-line-numbers', String(showLineNumbers))
  }, [showLineNumbers])

  useEffect(() => {
    localStorage.setItem('scenemd-editor-outline', String(showOutline))
  }, [showOutline])

  useLayoutEffect(() => {
    const view = viewRef.current
    if (!view || !editorVisible) return
    const scrollTop = view.scrollDOM.scrollTop
    view.requestMeasure()
    const frame = window.requestAnimationFrame(() => {
      view.requestMeasure()
      view.scrollDOM.scrollTop = scrollTop
    })
    return () => window.cancelAnimationFrame(frame)
  }, [showOutline, outlineWidth, mode, editorVisible])

  const beginOutlineResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = outlineWidth
    document.body.classList.add('is-resizing-outline')
    const onMove = (moveEvent: PointerEvent) => setOutlineWidth(Math.min(420, Math.max(150, startWidth + moveEvent.clientX - startX)))
    const onEnd = (endEvent: PointerEvent) => {
      const width = Math.min(420, Math.max(150, startWidth + endEvent.clientX - startX))
      setOutlineWidth(width)
      localStorage.setItem('scenemd-editor-outline-width', String(Math.round(width)))
      document.body.classList.remove('is-resizing-outline')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd, { once: true })
  }

  useEffect(() => {
    if (!tableImport) return
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setTableImport(null)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [tableImport])

  useEffect(() => {
    if (!citationImport) return
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setCitationImport(null)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [citationImport])

  useEffect(() => {
    if (!citationImport) return
    const normalized = normalizeCitationIdentifier(citationImport.identifier)
    if (!citationImport.identifier.trim()) {
      setCitationLookup({ status: 'idle', citation: '', error: '' })
      return
    }
    if (!normalized) {
      setCitationLookup({ status: 'error', citation: '', error: 'Paste a DOI or PubMed ID, for example 10.1016/j.chest.2024.09.016 or PMID: 28012456' })
      return
    }
    const existingNumber = existingCitationReferenceNumber(valueRef.current, normalized)
    if (existingNumber !== null) {
      setCitationLookup({ status: 'ready', citation: '', error: '', existingNumber, identifier: normalized })
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setCitationLookup({ status: 'loading', citation: '', error: '' })
      const endpoint = new URL('/api/citations', window.location.origin)
      endpoint.searchParams.set(normalized.type, normalized.value)
      endpoint.searchParams.set('format', 'ama')
      endpoint.searchParams.set('v', '2')
      void fetch(endpoint, { signal: controller.signal })
        .then(async (response) => {
          const result = await response.json() as { citation?: string; doi?: string | null; pmid?: string; error?: string }
          if (!response.ok || !result.citation) throw new Error(result.error || 'Citation lookup failed')
          const resolved = normalizeCitationIdentifier(result.doi ? result.doi : result.pmid ? `PMID: ${result.pmid}` : normalized.value) ?? normalized
          const resolvedExisting = existingCitationReferenceNumber(valueRef.current, resolved)
          setCitationLookup({
            status: 'ready',
            citation: result.citation,
            error: '',
            existingNumber: resolvedExisting ?? undefined,
            identifier: resolved,
          })
        })
        .catch((error) => {
          if (controller.signal.aborted) return
          setCitationLookup({ status: 'error', citation: '', error: error instanceof Error ? error.message : 'Citation lookup failed' })
        })
    }, 320)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [citationImport?.identifier])

  const dismissUpload = (id: string) => setImageUploads((uploads) => uploads.filter((upload) => upload.id !== id))

  imageHandlerRef.current = (files, view) => {
    let insertAt = view.state.selection.main.from
    void (async () => {
      for (const file of files) {
        const uploadId = crypto.randomUUID()
        setImageUploads((uploads) => [...uploads, { id: uploadId, name: file.name || 'Pasted image', status: 'uploading' }])
        try {
          const response = await fetch(`/api/uploads/images?documentId=${encodeURIComponent(documentId)}`, {
            method: 'POST',
            headers: { 'Content-Type': file.type, 'X-File-Name': file.name },
            body: file,
          })
          const result = await response.json() as { url?: string; error?: string }
          if (!response.ok || !result.url) throw new Error(result.error || 'Image upload failed')
          const imageUrl = new URL(result.url, window.location.origin).toString()
          const alt = (file.name || 'Pasted image').replace(/\.[^.]+$/, '').replace(/[[\]]/g, '')
          const markdownImage = `${insertAt > 0 ? '\n' : ''}![${alt}](${imageUrl})\n`
          const activeView = viewRef.current
          if (activeView === view) {
            const position = Math.min(insertAt, activeView.state.doc.length)
            activeView.dispatch({ changes: { from: position, insert: markdownImage }, selection: { anchor: position + markdownImage.length } })
            insertAt = position + markdownImage.length
            activeView.focus()
          } else {
            onChangeRef.current(`${valueRef.current}${valueRef.current.endsWith('\n') ? '' : '\n'}${markdownImage}`)
          }
          setImageUploads((uploads) => uploads.map((upload) => upload.id === uploadId ? { ...upload, status: 'complete', message: 'Inserted into Markdown' } : upload))
          window.setTimeout(() => dismissUpload(uploadId), 1800)
        } catch (error) {
          setImageUploads((uploads) => uploads.map((upload) => upload.id === uploadId ? { ...upload, status: 'error', message: error instanceof Error ? error.message : 'Upload failed' } : upload))
        }
      }
    })()
  }

  const documentMetrics = useMemo(() => ({
    words: value.split(/\s+/).filter(Boolean).length,
    lines: value.split('\n').length,
    characters: value.length,
  }), [value])
  const outline = useMemo(() => documentOutline(value), [value])
  const detectedTable = useMemo(() => detectPastedTable(tableImport?.source ?? '', tableImport?.html ?? ''), [tableImport?.source, tableImport?.html])

  const openTableImport = () => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    setTableImport({ source: view.state.sliceDoc(from, to), html: '', from, to })
  }

  const openCitationImport = () => {
    const view = viewRef.current
    if (!view) return
    const selection = view.state.selection.main
    const selected = view.state.sliceDoc(selection.from, selection.to).trim()
    const selectedIdentifier = normalizeCitationIdentifier(selected)
    setCitationImport({
      identifier: selectedIdentifier ? selected : '',
      from: selectedIdentifier ? selection.from : selection.head,
      to: selectedIdentifier ? selection.to : selection.head,
    })
  }

  const insertCitation = () => {
    const view = viewRef.current
    const normalized = citationLookup.identifier ?? normalizeCitationIdentifier(citationImport?.identifier ?? '')
    if (!view || !citationImport || !normalized || citationLookup.status !== 'ready') return
    const result = insertCitationReference(
      view.state.doc.toString(),
      citationImport.from,
      citationImport.to,
      normalized,
      citationLookup.citation,
    )
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: result.markdown },
      selection: { anchor: result.cursor },
      effects: EditorView.scrollIntoView(result.cursor, { y: 'center' }),
    })
    setCitationImport(null)
    view.focus()
  }

  const insertImportedTable = () => {
    const view = viewRef.current
    if (!view || !tableImport) return
    const markdownTable = markdownTableFromRows(detectedTable.rows)
    if (!markdownTable) return
    const prefix = tableImport.from > 0 && view.state.sliceDoc(tableImport.from - 1, tableImport.from) !== '\n' ? '\n\n' : ''
    const suffix = tableImport.to < view.state.doc.length && view.state.sliceDoc(tableImport.to, tableImport.to + 1) !== '\n' ? '\n\n' : '\n'
    const insert = `${prefix}${markdownTable}${suffix}`
    view.dispatch({ changes: { from: tableImport.from, to: tableImport.to, insert }, selection: { anchor: tableImport.from + insert.length } })
    setTableImport(null)
    view.focus()
  }

  const navigateToOutlineItem = (item: OutlineItem) => {
    if (mode === 'preview') {
      const heading = documentRef.current?.querySelectorAll<HTMLElement>('h1, h2, h3')[item.previewIndex]
      if (heading && documentRef.current) {
        documentRef.current.scrollTo({
          top: Math.max(0, heading.offsetTop - 34),
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        })
      }
      return
    }
    const view = viewRef.current
    if (!view) return
    const offset = Math.min(item.offset, view.state.doc.length)
    view.dispatch({
      selection: { anchor: offset },
      effects: EditorView.scrollIntoView(offset, { y: 'start', yMargin: 72 }),
    })
    view.focus()
  }

  const insertImportedMarkdown = (content: string) => {
    content = normalizeMarkdownUrls(content)
    const view = viewRef.current
    if (!view) {
      onChangeRef.current(aggregateMarkdownReferences(`${valueRef.current}${valueRef.current.endsWith('\n') ? '\n' : '\n\n'}${content}\n`))
      return
    }
    const { from, to } = view.state.selection.main
    const before = view.state.sliceDoc(0, from)
    const after = view.state.sliceDoc(to)
    const prefix = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
    const suffix = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
    const insert = `${prefix}${content}${suffix}`
    const combined = `${before}${insert}${after}`
    const aggregated = aggregateMarkdownReferences(combined)
    const insertedHeading = content.match(/^##\s+.+$/m)?.[0]
    const insertedStart = insertedHeading ? aggregated.indexOf(insertedHeading) : Math.min(from, aggregated.length)
    const cursor = insertedStart >= 0 ? Math.min(aggregated.length, insertedStart + content.length) : Math.min(from + insert.length, aggregated.length)
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: aggregated }, selection: { anchor: cursor } })
    view.focus()
  }

  const makeSelectionBullets = async (mode: 'flat' | 'nested' = 'flat') => {
    const selected = selectionTool
    const view = viewRef.current
    if (!selected || !view || aiBusy) return
    setAiBusy(mode)
    setAiError(null)
    try {
      const response = await fetch('/api/ai/bullets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: selected.text, mode, documentId }),
      })
      const result = await response.json() as { markdown?: string; error?: string }
      if (!response.ok || !result.markdown) throw new Error(result.error || 'Could not make bullets')
      const current = view.state.sliceDoc(selected.from, selected.to)
      if (current !== selected.text) throw new Error('The selection changed before the result was ready')
      const before = selected.from > 0 ? view.state.sliceDoc(selected.from - 1, selected.from) : '\n'
      const after = selected.to < view.state.doc.length ? view.state.sliceDoc(selected.to, selected.to + 1) : '\n'
      const insert = `${before === '\n' ? '' : '\n'}${result.markdown}${after === '\n' ? '' : '\n'}`
      view.dispatch({ changes: { from: selected.from, to: selected.to, insert }, selection: { anchor: selected.from + insert.length } })
      view.focus()
      setSelectionTool(null)
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Could not make bullets')
    } finally {
      setAiBusy(null)
    }
  }

  const makeSelectionColumns = () => {
    const selected = selectionTool
    const view = viewRef.current
    if (!selected || !view) return
    const current = view.state.sliceDoc(selected.from, selected.to)
    if (current !== selected.text) return
    const insert = columnsMarkdown(current)
    view.dispatch({ changes: { from: selected.from, to: selected.to, insert }, selection: { anchor: selected.from + insert.length } })
    view.focus()
    setSelectionTool(null)
  }

  const updateImageDraft = (patch: Partial<MarpitImageOptions> & { url?: string; legend?: string }) => {
    setImageTool((current) => {
      if (!current) return current
      const { url: _patchUrl, legend: _patchLegend, ...optionPatch } = patch
      const nextOptions = { ...current.options, ...optionPatch }
      if (nextOptions.fit === 'cover') nextOptions.fit = 'contain'
      if (patch.layout === 'legend') {
        nextOptions.background = false
        nextOptions.side = 'none'
      }
      if (patch.background === true) nextOptions.layout = 'auto'
      const next = { ...current, url: patch.url ?? current.url, legend: patch.legend ?? current.legend, options: nextOptions }
      imageToolRef.current = next
      return next
    })
  }

  const closeImageTool = () => {
    imageToolRef.current = null
    setImageTool(null)
  }

  const saveImageSyntax = () => {
    const current = imageToolRef.current
    const view = viewRef.current
    if (!current || !view) return
    const source = view.state.doc.toString()
    let from = current.from
    let to = current.to
    const currentSlice = source.slice(from, to)
    if (!currentSlice.startsWith('![') || !currentSlice.includes(`](${current.originalUrl})`)) {
      const marker = `](${current.originalUrl})`
      const candidates: Array<{ from: number; to: number }> = []
      let markerIndex = source.indexOf(marker)
      while (markerIndex >= 0) {
        const imageStart = source.lastIndexOf('![', markerIndex)
        if (imageStart >= 0 && !source.slice(imageStart, markerIndex).includes('\n')) {
          candidates.push({ from: imageStart, to: markerIndex + marker.length })
        }
        markerIndex = source.indexOf(marker, markerIndex + marker.length)
      }
      const nearest = candidates.sort((left, right) => Math.abs(left.from - current.from) - Math.abs(right.from - current.from))[0]
      if (!nearest) return
      from = nearest.from
      to = nearest.to
    }
    const syntax = `![${formatMarpitImageAlt(current.options)}](${current.url.trim()})`
    const change = current.legendEditable
      ? imageParagraphReplacement(source, from, to, syntax, current.legend)
      : { from, to, insert: syntax }
    view.dispatch({
      changes: change,
      selection: { anchor: change.from + change.insert.length },
    })
    closeImageTool()
    view.focus()
  }

  useEffect(() => {
    if (!imageTool) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeImageTool()
      viewRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [imageTool])

  useEffect(() => {
    if (!hostRef.current || !editorVisible) return

    const synchronizeContextTools = (editor: EditorView, pointerSelect: boolean) => {
      // Once opened, the image popover owns its draft lifecycle. Focus moving
      // into a form field, remote autosave reconciliation, or a mapped editor
      // selection must not dismiss it or replace its unsaved values.
      if (imageToolRef.current) {
        setSelectionTool(null)
        return
      }
      const selection = editor.state.selection.main
      const text = selection.empty ? '' : editor.state.sliceDoc(selection.from, selection.to)
      const line = editor.state.doc.lineAt(selection.head)
      const imagePattern = /!\[([^\]\n]*)\]\(([^)\n]+)\)/g
      let match: RegExpExecArray | null
      let imageMatch: { from: number; to: number; alt: string; url: string } | null = null
      // The popover only opens on a deliberate mouse click; keyboard cursor
      // motion and typing may pass through the image syntax without it.
      if (selection.empty && pointerSelect) {
        while ((match = imagePattern.exec(line.text))) {
          const from = line.from + match.index
          const to = from + match[0].length
          if (selection.head >= from && selection.head <= to) {
            imageMatch = { from, to, alt: match[1], url: match[2].trim() }
            break
          }
        }
      }
      const expectedFrom = selection.from
      const expectedTo = selection.to
      editor.requestMeasure({
        read(measureView) {
          const start = measureView.coordsAtPos(expectedFrom)
          const end = measureView.coordsAtPos(expectedTo)
          const imagePopoverHeight = Math.min(620, window.innerHeight - 72)
          return start && end ? {
            left: Math.max(260, Math.min(window.innerWidth - 260, (start.left + end.right) / 2)),
            selectionTop: Math.max(56, Math.min(start.top, end.top) - 48),
            imageTop: Math.max(56, Math.min(window.innerHeight - imagePopoverHeight - 12, end.bottom + 12)),
          } : null
        },
        write(position, measureView) {
          const latest = measureView.state.selection.main
          if (!position || latest.from !== expectedFrom || latest.to !== expectedTo) return
          if (text.trim()) {
            setSelectionTool({ from: expectedFrom, to: expectedTo, text, left: position.left, top: position.selectionTop })
            closeImageTool()
          } else if (imageMatch) {
            setSelectionTool(null)
            setAiError(null)
            const legendContext = readImageLegend(measureView.state.doc.toString(), imageMatch.from, imageMatch.to)
            const nextImageTool = { ...imageMatch, originalUrl: imageMatch.url, options: parseMarpitImageAlt(imageMatch.alt), legend: legendContext.legend, legendEditable: legendContext.editable, left: position.left, top: position.imageTop }
            imageToolRef.current = nextImageTool
            setImageTool(nextImageTool)
          } else {
            setSelectionTool(null)
            closeImageTool()
            setAiError(null)
          }
        },
      })
    }

    const view = new EditorView({
      doc: value,
      parent: hostRef.current,
      extensions: [
        basicSetup,
        markdown({ codeLanguages: languages }),
        syntaxHighlighting(markdownHighlightStyle),
        autocompletion({ override: [presentationHintCompletion], activateOnTyping: true }),
        markdownImagePreviews,
        EditorView.lineWrapping,
        EditorView.domEventHandlers({
          paste(event, view) {
            const files = [...(event.clipboardData?.items ?? [])]
              .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
              .map((item) => item.getAsFile())
              .filter((file): file is File => Boolean(file))
            if (!files.length) return false
            event.preventDefault()
            imageHandlerRef.current(files, view)
            return true
          },
          drop(event, view) {
            const files = [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith('image/'))
            if (!files.length) return false
            event.preventDefault()
            imageHandlerRef.current(files, view)
            return true
          },
        }),
        EditorView.contentAttributes.of({ 'aria-label': 'Markdown source', spellcheck: 'true' }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          if (update.docChanged || update.selectionSet) {
            const selection = update.state.selection.main
            const cursorLine = update.state.doc.lineAt(selection.head)
            const firstLine = update.state.doc.lineAt(selection.from).number
            const lastLine = update.state.doc.lineAt(selection.to).number
            setStatus({
              line: cursorLine.number,
              column: selection.head - cursorLine.from + 1,
              selectedCharacters: selection.to - selection.from,
              selectedLines: selection.empty ? 0 : lastLine - firstLine + 1,
            })
            onCursorLineChangeRef.current?.(cursorLine.number)
            synchronizeContextTools(update.view, update.transactions.some((transaction) => transaction.isUserEvent('select.pointer')))
          }
        }),
        EditorView.theme({
          '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--ink)' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
          '.cm-content': { minHeight: '100%', padding: '28px 20px 130px', fontSize: '20px', lineHeight: '32px', caretColor: 'var(--accent)' },
          '.cm-line': { padding: '0' },
          '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--muted)', borderRight: '1px solid var(--line)' },
          '.cm-lineNumbers .cm-gutterElement': { minWidth: '44px', padding: '0 10px 0 6px', fontSize: '12px', lineHeight: '32px' },
          '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 6%, transparent)' },
          '.cm-activeLineGutter': { color: 'var(--accent-ink)', backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)' },
          '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent) !important' },
          '.cm-cursor': { borderLeftColor: 'var(--accent)' },
          '.cm-tooltip-autocomplete': { border: '1px solid var(--line)', borderRadius: '6px', backgroundColor: 'var(--surface-raised)' },
          '.cm-tooltip-autocomplete > ul': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '13px' },
          '.cm-tooltip-autocomplete > ul > li[aria-selected]': { color: 'var(--ink)', backgroundColor: 'var(--surface-muted)' },
        }, { dark: theme === 'dark' }),
      ],
    })
    viewRef.current = view
    return () => {
      setSelectionTool(null)
      imageToolRef.current = null
      setImageTool(null)
      view.destroy()
      viewRef.current = null
    }
  }, [editorVisible, theme])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    // Replace only the differing span. A whole-document replacement maps the
    // cursor to offset 0, which scrolls the editor to the top and rebuilds
    // every image preview widget.
    const change = minimalDocChange(view.state.doc.toString(), value)
    if (change) view.dispatch({ changes: change })
  }, [value])

  useEffect(() => {
    if (!scrollRequest) return
    const view = viewRef.current
    if (view && mode !== 'preview') {
      const line = view.state.doc.line(Math.min(scrollRequest.line, view.state.doc.lines))
      view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
      return
    }
    const renderedDocument = documentRef.current
    if (!renderedDocument) return
    const lineCount = Math.max(1, value.split('\n').length - 1)
    const scrollRange = Math.max(0, renderedDocument.scrollHeight - renderedDocument.clientHeight)
    renderedDocument.scrollTo({
      top: ((Math.max(1, scrollRequest.line) - 1) / lineCount) * scrollRange,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }, [scrollRequest, mode, value])

  useEffect(() => {
    if (mode !== 'split') return
    const editorScroller = viewRef.current?.scrollDOM
    const renderedDocument = documentRef.current
    if (!editorScroller || !renderedDocument) return

    let source: 'editor' | 'preview' | null = null
    let releaseFrame = 0
    const synchronize = (from: HTMLElement, to: HTMLElement, nextSource: 'editor' | 'preview') => {
      if (source && source !== nextSource) return
      source = nextSource
      const fromRange = from.scrollHeight - from.clientHeight
      const toRange = to.scrollHeight - to.clientHeight
      if (fromRange > 0 && toRange > 0) to.scrollTop = (from.scrollTop / fromRange) * toRange
      window.cancelAnimationFrame(releaseFrame)
      releaseFrame = window.requestAnimationFrame(() => { source = null })
    }
    const onEditorScroll = () => synchronize(editorScroller, renderedDocument, 'editor')
    const onPreviewScroll = () => synchronize(renderedDocument, editorScroller, 'preview')
    editorScroller.addEventListener('scroll', onEditorScroll, { passive: true })
    renderedDocument.addEventListener('scroll', onPreviewScroll, { passive: true })
    return () => {
      window.cancelAnimationFrame(releaseFrame)
      editorScroller.removeEventListener('scroll', onEditorScroll)
      renderedDocument.removeEventListener('scroll', onPreviewScroll)
    }
  }, [mode, theme])

  return (
    <div className="markdown-composer">
      <div className="markdown-editor-topbar">
        <div className="markdown-toolbar" role="toolbar" aria-label="Editor modes and Markdown formatting">
          <button className={showOutline ? 'is-active' : ''} title={showOutline ? 'Hide document contents' : 'Show document contents'} aria-label="Toggle document contents" aria-pressed={showOutline} onClick={() => setShowOutline((visible) => !visible)}>{showOutline ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}</button>
          <button className={`markdown-mode-button ${mode === 'write' ? 'is-active' : ''}`} aria-pressed={mode === 'write'} onClick={() => onModeChange('write')}><Pencil size={14} /><span>Write</span></button>
          <button className={`markdown-mode-button ${mode === 'split' ? 'is-active' : ''}`} aria-pressed={mode === 'split'} onClick={() => onModeChange('split')} aria-label="Split editor and rendered Markdown"><Columns2 size={14} /><span>Split</span></button>
          <button className={`markdown-mode-button ${mode === 'preview' ? 'is-active' : ''}`} aria-pressed={mode === 'preview'} onClick={() => onModeChange('preview')} aria-label="Preview rendered Markdown"><Eye size={14} /><span>Preview</span></button>
          {mode !== 'preview' && (
            <>
            <button className={showLineNumbers ? 'is-active' : ''} title={showLineNumbers ? 'Hide line numbers' : 'Show line numbers'} aria-label="Toggle line numbers" aria-pressed={showLineNumbers} onClick={() => setShowLineNumbers((visible) => !visible)}><Hash size={16} /></button>
            {tools.map(({ label, icon: Icon, action }) => (
              <button key={label} title={label} aria-label={label} onMouseDown={(event) => event.preventDefault()} onClick={() => viewRef.current && action(viewRef.current)}><Icon size={16} /></button>
            ))}
            <button title="Paste Word, CSV, or TSV table" aria-label="Convert pasted table to Markdown" onMouseDown={(event) => event.preventDefault()} onClick={openTableImport}><Sheet size={16} /></button>
            <button title="Insert citation from DOI or PubMed ID" aria-label="Insert AMA citation from DOI or PubMed ID" onMouseDown={(event) => event.preventDefault()} onClick={openCitationImport}><BookPlus size={16} /></button>
            <button className="openevidence-tool" title="Import OpenEvidence conversation" aria-label="Import OpenEvidence conversation" onMouseDown={(event) => event.preventDefault()} onClick={() => setShowOpenEvidenceImport(true)}><CircleEuro size={16} /></button>
            <button title="Upload image" aria-label="Upload image" onMouseDown={(event) => event.preventDefault()} onClick={() => fileInputRef.current?.click()}><Upload size={16} /></button>
            <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" multiple onChange={(event) => {
              if (event.target.files?.length && viewRef.current) imageHandlerRef.current([...event.target.files], viewRef.current)
              event.target.value = ''
            }} />
            </>
          )}
        </div>
      </div>
      <div className={`markdown-editor-body${showOutline ? '' : ' is-outline-collapsed'}`} style={{ '--outline-width': `${outlineWidth}px` } as CSSProperties}>
        <aside className="markdown-outline" aria-label="Document table of contents">
          <header>
            <span className="markdown-outline-title"><ListTree size={14} /><span>Contents</span></span>
          </header>
          {showOutline && (outline.length ? <nav>
            {outline.map((item) => <button
              key={`${item.offset}-${item.text}`}
              className={`outline-level-${item.level}${status.line >= item.line && !outline.some((next) => next.line > item.line && next.line <= status.line) ? ' is-active' : ''}`}
              onClick={() => navigateToOutlineItem(item)}
              title={`Line ${item.line}: ${item.text}`}
            ><span>{item.text}</span></button>)}
          </nav> : <p>Add H1–H3 headings to build the document outline.</p>)}
        </aside>
        {showOutline && <button className="outline-resize-handle" onPointerDown={beginOutlineResize} aria-label="Resize document contents pane" title="Drag to resize Contents"><span /></button>}
        <div className={`markdown-editor-content is-${mode}`}>
          {mode !== 'preview' && <div className={`codemirror-host${showLineNumbers ? ' show-line-numbers' : ''}`} ref={hostRef} />}
          {mode !== 'write' && (
            <div className="markdown-document-scroll" ref={documentRef}><MarkdownDocumentView value={value} /></div>
          )}
        </div>
      </div>
      <div className="markdown-statusbar" aria-label="Editor status">
        <div><span>Ln {status.line}, Col {status.column}</span>{status.selectedCharacters > 0 && <span>{status.selectedCharacters} selected · {status.selectedLines} lines</span>}</div>
        <div><span>{documentMetrics.lines} lines</span><span>{documentMetrics.words} words</span><span>{documentMetrics.characters} characters</span><span className={`save-status is-${saveStatus}`} role="status" aria-live="polite">{saveStatus === 'saving' ? <><LoaderCircle className="is-spinning" size={12} /> Saving…</> : saveStatus === 'conflict' ? 'Save conflict' : saveStatus === 'offline' ? 'Offline — changes pending' : <><Check size={12} /> Saved to cloud</>}</span><button onClick={onReset}><RotateCcw size={12} /> Reset</button></div>
      </div>
      {selectionTool && <div className="selection-ai-tool" style={{ left: selectionTool.left, top: selectionTool.top }} onMouseDown={(event) => event.preventDefault()}>
        <button onClick={() => void makeSelectionBullets('flat')} disabled={Boolean(aiBusy) || selectionTool.text.length > 12000} title={selectionTool.text.length > 12000 ? 'Select no more than 12,000 characters' : 'Rewrite selection as flat Markdown bullets with Workers AI'}>
          {aiBusy === 'flat' ? <LoaderCircle className="is-spinning" size={15} /> : <Sparkles size={15} />}
          {aiBusy === 'flat' ? 'Making bullets…' : 'Make bullets'}
        </button>
        <button onClick={() => void makeSelectionBullets('nested')} disabled={Boolean(aiBusy) || selectionTool.text.length > 12000} title="Rewrite selection as a two-level Markdown list">{aiBusy === 'nested' ? <LoaderCircle className="is-spinning" size={15} /> : <ListTree size={15} />}{aiBusy === 'nested' ? 'Nesting…' : 'Nested bullets'}</button>
        <button onClick={makeSelectionColumns} title="Arrange the selection as two responsive columns"><Columns2 size={15} />Two columns</button>
        <span>{selectionTool.text.length.toLocaleString()}</span>
        <button className="selection-tool-close" onClick={() => setSelectionTool(null)} aria-label="Close selection tool"><X size={14} /></button>
        {aiError && <small>{aiError}</small>}
      </div>}
      {imageTool && <aside className="image-syntax-popover" style={{ left: imageTool.left, top: imageTool.top }} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} aria-label="Image options">
        <header><div><Image size={16} /><strong>Image</strong><span>Marpit syntax</span></div><button onClick={() => { closeImageTool(); viewRef.current?.focus() }} aria-label="Close image options"><X size={15} /></button></header>
        <div className="image-syntax-preview"><img src={imageTool.url} alt={imageTool.options.alt} style={{ width: imageTool.options.width || undefined, height: imageTool.options.height || undefined, objectFit: imageTool.options.fit === 'auto' ? 'scale-down' : 'contain', filter: imageFilterCss(imageTool.options.filters) }} /></div>
        <div className="image-syntax-fields">
          <label className="image-field-wide"><span>Image URL</span><input value={imageTool.url} onChange={(event) => updateImageDraft({ url: event.target.value })} /></label>
          <label className="image-field-wide"><span>Alt text</span><input value={imageTool.options.alt} onChange={(event) => updateImageDraft({ alt: event.target.value })} placeholder="Describe this image" /></label>
          <label className="image-field-wide"><span>Legend text</span><textarea rows={2} value={imageTool.legend} disabled={!imageTool.legendEditable} onChange={(event) => updateImageDraft({ legend: event.target.value })} placeholder="Text shown beside the figure" title={imageTool.legendEditable ? 'Saved into the same paragraph as the image' : 'This image shares its paragraph with other content, so the legend cannot be edited here'} /></label>
          <label><span>Width</span><input value={imageTool.options.width} onChange={(event) => updateImageDraft({ width: event.target.value })} placeholder="e.g. 480px" /></label>
          <label><span>Height</span><input value={imageTool.options.height} onChange={(event) => updateImageDraft({ height: event.target.value })} placeholder="e.g. 280px" /></label>
          <label><span>Scaling</span><select value={imageTool.options.fit} onChange={(event) => updateImageDraft({ fit: event.target.value as MarpitImageOptions['fit'] })}><option value="contain">Fit · no crop</option><option value="auto">Natural size</option></select></label>
          <label><span>Layout</span><select value={imageTool.options.layout} onChange={(event) => updateImageDraft({ layout: event.target.value as MarpitImageOptions['layout'] })}><option value="legend">Image left · legend right</option><option value="auto">Automatic flow</option><option value="hero">Hero image</option></select></label>
          <label><span>Background side</span><select value={imageTool.options.side} disabled={!imageTool.options.background} onChange={(event) => updateImageDraft({ side: event.target.value as MarpitImageOptions['side'] })}><option value="none">Full</option><option value="left">Left</option><option value="right">Right</option></select></label>
          <label className="image-field-check"><input type="checkbox" checked={imageTool.options.background} onChange={(event) => updateImageDraft({ background: event.target.checked })} /><span>Scene background</span></label>
          <label><span>Split size</span><input disabled={!imageTool.options.background || imageTool.options.side === 'none'} value={imageTool.options.splitSize} onChange={(event) => updateImageDraft({ splitSize: event.target.value })} placeholder="50%" /></label>
          <label className="image-field-wide"><span>Filters</span><input value={imageTool.options.filters} onChange={(event) => updateImageDraft({ filters: event.target.value })} placeholder="brightness:.8 sepia:50%" /></label>
        </div>
        <footer className="image-syntax-actions"><button onClick={() => { closeImageTool(); viewRef.current?.focus() }}>Cancel</button><button className="is-primary" onClick={saveImageSyntax} disabled={!imageTool.url.trim()}><Check size={15} /> Save</button></footer>
      </aside>}
      {!!imageUploads.length && <div className="image-upload-stack" aria-live="polite">
        {imageUploads.map((upload) => <div key={upload.id} className={`image-upload-toast is-${upload.status}`}>
          <span className="upload-icon">{upload.status === 'uploading' ? <LoaderCircle size={16} /> : upload.status === 'complete' ? <Check size={16} /> : <X size={16} />}</span>
          <span><strong>{upload.status === 'uploading' ? 'Uploading image' : upload.status === 'complete' ? 'Image ready' : 'Upload failed'}</strong><small>{upload.message || upload.name}</small></span>
          {upload.status === 'error' && <button onClick={() => dismissUpload(upload.id)} aria-label="Dismiss upload error"><X size={14} /></button>}
        </div>)}
      </div>}
      {showOpenEvidenceImport && <OpenEvidenceImportDialog onClose={() => setShowOpenEvidenceImport(false)} onInsert={insertImportedMarkdown} />}
      {tableImport && createPortal(<div className="table-import-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setTableImport(null)}>
        <section className="table-import-dialog" role="dialog" aria-modal="true" aria-labelledby="table-import-title">
          <header><div><Sheet size={18} /><div><small>Smart paste</small><h2 id="table-import-title">Import table</h2></div></div><button onClick={() => setTableImport(null)} aria-label="Close table import"><X size={18} /></button></header>
          <div className="table-import-body">
            <label><span>Paste from Word, Excel, CSV, or TSV</span><textarea autoFocus value={tableImport.source} onChange={(event) => setTableImport((current) => current ? { ...current, source: event.target.value, html: '' } : current)} onPaste={(event) => {
              const html = event.clipboardData.getData('text/html')
              const plain = event.clipboardData.getData('text/plain')
              if (!html && !plain) return
              event.preventDefault()
              setTableImport((current) => current ? { ...current, source: plain, html } : current)
            }} placeholder={'Name,Value\nAlpha,42\nBeta,18'} /></label>
            <div className="table-import-detection"><span className={detectedTable.format ? 'is-detected' : ''}>{detectedTable.format ? `${detectedTable.format} detected` : 'Waiting for tabular data'}</span>{detectedTable.rows.length > 0 && <small>{detectedTable.rows.length} rows · {Math.max(...detectedTable.rows.map((row) => row.length))} columns</small>}</div>
            <div className="table-import-preview">{detectedTable.rows.length ? <table><tbody>{detectedTable.rows.slice(0, 8).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => rowIndex === 0 ? <th key={cellIndex}>{cell}</th> : <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table> : <div><Sheet size={22} /><span>Your table preview appears here.</span></div>}</div>
          </div>
          <footer><span>Format is detected automatically.</span><div><button onClick={() => setTableImport(null)}>Cancel</button><button className="table-import-primary" onClick={insertImportedTable} disabled={!markdownTableFromRows(detectedTable.rows)}>Insert Markdown table</button></div></footer>
        </section>
      </div>, document.body)}
      {citationImport && createPortal(<div className="citation-import-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCitationImport(null)}>
        <section className="citation-import-dialog" role="dialog" aria-modal="true" aria-labelledby="citation-import-title">
          <header><div><BookPlus size={18} /><div><small>AMA CSL</small><h2 id="citation-import-title">Insert citation</h2></div></div><button onClick={() => setCitationImport(null)} aria-label="Close citation import"><X size={18} /></button></header>
          <div className="citation-import-body">
            <label><span>DOI or PubMed ID</span><input autoFocus value={citationImport.identifier} onChange={(event) => setCitationImport((current) => current ? { ...current, identifier: event.target.value } : current)} placeholder="10.1016/j.chest.2024.09.016 or PMID: 28012456" /></label>
            <div className={`citation-lookup-status is-${citationLookup.status}`}>
              {citationLookup.status === 'idle' && <span>Paste a DOI, PMID, or PubMed article URL.</span>}
              {citationLookup.status === 'loading' && <span><LoaderCircle className="is-spinning" size={14} /> Formatting with AMA CSL…</span>}
              {citationLookup.status === 'error' && <span>{citationLookup.error}</span>}
              {citationLookup.status === 'ready' && citationLookup.existingNumber !== undefined && <span><Check size={14} /> Already listed as [{citationLookup.existingNumber}]. The existing reference will be reused.</span>}
              {citationLookup.status === 'ready' && citationLookup.existingNumber === undefined && <blockquote>{citationLookup.citation.replace(/^\s*\d+\.\s*/, '')}</blockquote>}
            </div>
          </div>
          <footer><span>New references are appended without renumbering existing citations.</span><div><button onClick={() => setCitationImport(null)}>Cancel</button><button className="citation-import-primary" onClick={insertCitation} disabled={citationLookup.status !== 'ready'}>Insert [{citationLookup.existingNumber ?? 'n'}]</button></div></footer>
        </section>
      </div>, document.body)}
    </div>
  )
}
