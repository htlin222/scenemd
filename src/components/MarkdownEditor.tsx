import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { basicSetup, EditorView } from 'codemirror'
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
  Check,
  Code2,
  Columns2,
  Eye,
  Heading2,
  Image,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  LoaderCircle,
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
import { formatMarpitImageAlt, imageFilterCss, parseMarpitImageAlt, type MarpitImageOptions } from '../imageSyntax'
import { OpenEvidenceImportDialog } from './OpenEvidenceImportDialog'

export type EditorMode = 'write' | 'split' | 'preview'

function documentVisibleMarkdown(value: string): string {
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
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        skipHtml
        components={{
          img({ alt = '', src = '' }) {
            const options = parseMarpitImageAlt(alt)
            const style: CSSProperties = {
              width: options.width || undefined,
              height: options.height || undefined,
              objectFit: options.fit === 'auto' ? 'none' : options.fit,
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
  options: MarpitImageOptions
  left: number
  top: number
}

const PRESENTATION_HINTS = [
  { label: '<!-- present: break -->', detail: 'Force a scene break' },
  { label: '<!-- present: keep -->', detail: 'Keep the next block together' },
  { label: '<!-- present: hero -->', detail: 'Emphasize the next image' },
  { label: '<!-- present: hide -->', detail: 'Hide the next block in presentation' },
  { label: '<!-- present: only -->', detail: 'Show the next block only in presentation' },
  { label: '<!-- present: step -->', detail: 'Reveal the next list item by item' },
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

function convertPastedTable(view: EditorView) {
  const selection = view.state.selection.main
  let from = selection.from
  let to = selection.to

  if (selection.empty) {
    const cursorLine = view.state.doc.lineAt(selection.head)
    if (!cursorLine.text.includes('\t')) return
    let first = cursorLine.number
    let last = cursorLine.number
    while (first > 1 && view.state.doc.line(first - 1).text.includes('\t')) first -= 1
    while (last < view.state.doc.lines && view.state.doc.line(last + 1).text.includes('\t')) last += 1
    from = view.state.doc.line(first).from
    to = view.state.doc.line(last).to
  }

  const source = view.state.sliceDoc(from, to).trim()
  const rows = source.split(/\r?\n/).filter((line) => line.trim()).map((line) => line.split('\t'))
  const columnCount = Math.max(0, ...rows.map((row) => row.length))
  if (rows.length < 2 || columnCount < 2) return
  const cleanCell = (cell = '') => cell
    .trim()
    .replace(/<\/?strong>/gi, '**')
    .replace(/<br\s*\/?\s*>/gi, ' · ')
    .replace(/\|/g, '\\|')
  const normalized = rows.map((row) => Array.from({ length: columnCount }, (_, index) => cleanCell(row[index])))
  const markdownTable = [
    `| ${normalized[0].join(' | ')} |`,
    `| ${Array.from({ length: columnCount }, () => '---').join(' | ')} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
  view.dispatch({ changes: { from, to, insert: markdownTable }, selection: { anchor: from, head: from + markdownTable.length } })
  view.focus()
}

const tools: Tool[] = [
  { label: 'Add heading', icon: Heading2, action: (view) => prefixLines(view, '## ') },
  { label: 'Add bold text', icon: Bold, action: (view) => replaceSelection(view, '**', '**', 'bold text') },
  { label: 'Add italic text', icon: Italic, action: (view) => replaceSelection(view, '_', '_', 'italic text') },
  { label: 'Add strikethrough text', icon: Strikethrough, action: (view) => replaceSelection(view, '~~', '~~', 'strikethrough text') },
  { label: 'Add quote', icon: Quote, action: (view) => prefixLines(view, '> ') },
  { label: 'Add code', icon: Code2, action: (view) => replaceSelection(view, '`', '`', 'code') },
  { label: 'Add link', icon: Link, action: (view) => insertLink(view) },
  { label: 'Add image', icon: Image, action: (view) => insertLink(view, true) },
  { label: 'Add bulleted list', icon: List, action: (view) => prefixLines(view, '- ') },
  { label: 'Add numbered list', icon: ListOrdered, action: (view) => prefixLines(view, '1. ') },
  { label: 'Add task list', icon: ListChecks, action: (view) => prefixLines(view, '- [ ] ') },
  { label: 'Add table', icon: Table2, action: (view) => insertBlock(view, '| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |') },
  { label: 'Convert pasted tabular text to a Markdown table', icon: Sheet, action: convertPastedTable },
  { label: 'Add horizontal rule', icon: Minus, action: (view) => insertBlock(view, '---') },
]

export function MarkdownEditor({ value, onChange, theme, mode, onModeChange, onReset, documentId }: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const documentRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const onChangeRef = useRef(onChange)
  const valueRef = useRef(value)
  const imageHandlerRef = useRef<(files: File[], view: EditorView) => void>(() => undefined)
  const [status, setStatus] = useState<EditorStatus>({ line: 1, column: 1, selectedCharacters: 0, selectedLines: 0 })
  const [imageUploads, setImageUploads] = useState<ImageUploadState[]>([])
  const [showOpenEvidenceImport, setShowOpenEvidenceImport] = useState(false)
  const [selectionTool, setSelectionTool] = useState<SelectionToolState | null>(null)
  const [imageTool, setImageTool] = useState<ImageToolState | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  onChangeRef.current = onChange
  valueRef.current = value

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
          const alt = (file.name || 'Pasted image').replace(/\.[^.]+$/, '').replace(/[\[\]]/g, '')
          const markdownImage = `${insertAt > 0 ? '\n' : ''}![${alt}](${result.url})\n`
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

  const insertImportedMarkdown = (content: string) => {
    const view = viewRef.current
    if (!view) {
      onChangeRef.current(`${valueRef.current}${valueRef.current.endsWith('\n') ? '\n' : '\n\n'}${content}\n`)
      return
    }
    const { from, to } = view.state.selection.main
    const before = view.state.sliceDoc(0, from)
    const after = view.state.sliceDoc(to)
    const prefix = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
    const suffix = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
    const insert = `${prefix}${content}${suffix}`
    view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length - suffix.length } })
    view.focus()
  }

  const makeSelectionBullets = async () => {
    const selected = selectionTool
    const view = viewRef.current
    if (!selected || !view || aiBusy) return
    setAiBusy(true)
    setAiError(null)
    try {
      const response = await fetch('/api/ai/bullets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: selected.text, documentId }),
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
      setAiBusy(false)
    }
  }

  const updateImageSyntax = (patch: Partial<MarpitImageOptions> & { url?: string }) => {
    const current = imageTool
    const view = viewRef.current
    if (!current || !view) return
    const nextOptions = { ...current.options, ...patch }
    const nextUrl = patch.url ?? current.url
    const syntax = `![${formatMarpitImageAlt(nextOptions)}](${nextUrl})`
    view.dispatch({
      changes: { from: current.from, to: current.to, insert: syntax },
      selection: { anchor: current.from + 2 },
    })
    setImageTool({ ...current, to: current.from + syntax.length, url: nextUrl, options: nextOptions })
  }

  useEffect(() => {
    if (!hostRef.current || mode === 'preview') return

    const synchronizeContextTools = (editor: EditorView) => {
      const selection = editor.state.selection.main
      const text = selection.empty ? '' : editor.state.sliceDoc(selection.from, selection.to)
      const line = editor.state.doc.lineAt(selection.head)
      const imagePattern = /!\[([^\]\n]*)\]\(([^)\n]+)\)/g
      let match: RegExpExecArray | null
      let imageMatch: { from: number; to: number; alt: string; url: string } | null = null
      if (selection.empty) {
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
          return start && end ? {
            left: Math.max(150, Math.min(window.innerWidth - 150, (start.left + end.right) / 2)),
            selectionTop: Math.max(56, Math.min(start.top, end.top) - 48),
            imageTop: Math.max(56, Math.min(Math.max(56, window.innerHeight - 440), end.bottom + 12)),
          } : null
        },
        write(position, measureView) {
          const latest = measureView.state.selection.main
          if (!position || latest.from !== expectedFrom || latest.to !== expectedTo) return
          if (text.trim()) {
            setSelectionTool({ from: expectedFrom, to: expectedTo, text, left: position.left, top: position.selectionTop })
            setImageTool(null)
          } else if (imageMatch) {
            setSelectionTool(null)
            setAiError(null)
            setImageTool({ ...imageMatch, options: parseMarpitImageAlt(imageMatch.alt), left: position.left, top: position.imageTop })
          } else {
            setSelectionTool(null)
            setImageTool(null)
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
            synchronizeContextTools(update.view)
          }
        }),
        EditorView.theme({
          '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--ink)' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
          '.cm-content': { minHeight: '100%', padding: '72px 20px 130px', fontSize: '20px', lineHeight: '32px', caretColor: 'var(--accent)' },
          '.cm-line': { padding: '0' },
          '.cm-gutters': { display: 'none' },
          '.cm-activeLine': { backgroundColor: 'transparent' },
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
      setImageTool(null)
      view.destroy()
      viewRef.current = null
    }
  }, [mode, theme])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

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
        <div className="markdown-mode-tabs" role="tablist" aria-label="Markdown editor mode">
          <button role="tab" aria-selected={mode === 'write'} className={mode === 'write' ? 'is-active' : ''} onClick={() => onModeChange('write')}><Pencil size={14} /> Write</button>
          <button role="tab" aria-selected={mode === 'split'} className={mode === 'split' ? 'is-active' : ''} onClick={() => onModeChange('split')} aria-label="Split editor and rendered Markdown"><Columns2 size={14} /> Split</button>
          <button role="tab" aria-selected={mode === 'preview'} className={mode === 'preview' ? 'is-active' : ''} onClick={() => onModeChange('preview')} aria-label="Preview rendered Markdown"><Eye size={14} /> Preview</button>
        </div>
        {mode !== 'preview' && (
          <div className="markdown-toolbar" role="toolbar" aria-label="Markdown formatting">
            {tools.map(({ label, icon: Icon, action }) => (
              <button key={label} title={label} aria-label={label} onMouseDown={(event) => event.preventDefault()} onClick={() => viewRef.current && action(viewRef.current)}><Icon size={16} /></button>
            ))}
            <button className="openevidence-tool" title="Import OpenEvidence conversation" aria-label="Import OpenEvidence conversation" onMouseDown={(event) => event.preventDefault()} onClick={() => setShowOpenEvidenceImport(true)}><span aria-hidden="true">O</span></button>
            <button title="Upload image" aria-label="Upload image" onMouseDown={(event) => event.preventDefault()} onClick={() => fileInputRef.current?.click()}><Upload size={16} /></button>
            <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" multiple onChange={(event) => {
              if (event.target.files?.length && viewRef.current) imageHandlerRef.current([...event.target.files], viewRef.current)
              event.target.value = ''
            }} />
          </div>
        )}
      </div>
      <div className={`markdown-editor-body is-${mode}`}>
        {mode !== 'preview' && <div className="codemirror-host" ref={hostRef} />}
        {mode !== 'write' && (
          <div className="markdown-document-scroll" ref={documentRef}><MarkdownDocumentView value={value} /></div>
        )}
      </div>
      <div className="markdown-statusbar" aria-label="Editor status">
        <div><span>Ln {status.line}, Col {status.column}</span>{status.selectedCharacters > 0 && <span>{status.selectedCharacters} selected · {status.selectedLines} lines</span>}</div>
        <div><span>{documentMetrics.lines} lines</span><span>{documentMetrics.words} words</span><span>{documentMetrics.characters} characters</span><span className="save-status">Saved locally</span><button onClick={onReset}><RotateCcw size={12} /> Reset</button></div>
      </div>
      {selectionTool && <div className="selection-ai-tool" style={{ left: selectionTool.left, top: selectionTool.top }} onMouseDown={(event) => event.preventDefault()}>
        <button onClick={() => void makeSelectionBullets()} disabled={aiBusy || selectionTool.text.length > 12000} title={selectionTool.text.length > 12000 ? 'Select no more than 12,000 characters' : 'Rewrite selection as Markdown bullets with Workers AI'}>
          {aiBusy ? <LoaderCircle className="is-spinning" size={15} /> : <Sparkles size={15} />}
          {aiBusy ? 'Making bullets…' : 'Make bullets'}
        </button>
        <span>{selectionTool.text.length.toLocaleString()}</span>
        <button className="selection-tool-close" onClick={() => setSelectionTool(null)} aria-label="Close selection tool"><X size={14} /></button>
        {aiError && <small>{aiError}</small>}
      </div>}
      {imageTool && <aside className="image-syntax-popover" style={{ left: imageTool.left, top: imageTool.top }} onMouseDown={(event) => event.stopPropagation()} aria-label="Image options">
        <header><div><Image size={16} /><strong>Image</strong><span>Marpit syntax</span></div><button onClick={() => { setImageTool(null); viewRef.current?.focus() }} aria-label="Close image options"><X size={15} /></button></header>
        <div className="image-syntax-preview"><img src={imageTool.url} alt={imageTool.options.alt} style={{ width: imageTool.options.width || undefined, height: imageTool.options.height || undefined, objectFit: imageTool.options.fit === 'auto' ? 'none' : imageTool.options.fit, filter: imageFilterCss(imageTool.options.filters) }} /></div>
        <div className="image-syntax-fields">
          <label className="image-field-wide"><span>Image URL</span><input value={imageTool.url} onChange={(event) => updateImageSyntax({ url: event.target.value })} /></label>
          <label className="image-field-wide"><span>Alt text</span><input value={imageTool.options.alt} onChange={(event) => updateImageSyntax({ alt: event.target.value })} placeholder="Describe this image" /></label>
          <label><span>Width</span><input value={imageTool.options.width} onChange={(event) => updateImageSyntax({ width: event.target.value })} placeholder="e.g. 480px" /></label>
          <label><span>Height</span><input value={imageTool.options.height} onChange={(event) => updateImageSyntax({ height: event.target.value })} placeholder="e.g. 300px" /></label>
          <label><span>Fit</span><select value={imageTool.options.fit} onChange={(event) => updateImageSyntax({ fit: event.target.value as MarpitImageOptions['fit'] })}>{imageTool.options.background ? <><option value="cover">Cover</option><option value="contain">Contain</option><option value="auto">Original</option></> : <><option value="cover">Default</option><option value="auto">Original</option></>}</select></label>
          <label><span>Background side</span><select value={imageTool.options.side} disabled={!imageTool.options.background} onChange={(event) => updateImageSyntax({ side: event.target.value as MarpitImageOptions['side'] })}><option value="none">Full</option><option value="left">Left</option><option value="right">Right</option></select></label>
          <label className="image-field-check"><input type="checkbox" checked={imageTool.options.background} onChange={(event) => updateImageSyntax({ background: event.target.checked })} /><span>Scene background</span></label>
          <label><span>Split size</span><input disabled={!imageTool.options.background || imageTool.options.side === 'none'} value={imageTool.options.splitSize} onChange={(event) => updateImageSyntax({ splitSize: event.target.value })} placeholder="50%" /></label>
          <label className="image-field-wide"><span>Filters</span><input value={imageTool.options.filters} onChange={(event) => updateImageSyntax({ filters: event.target.value })} placeholder="brightness:.8 sepia:50%" /></label>
        </div>
      </aside>}
      {!!imageUploads.length && <div className="image-upload-stack" aria-live="polite">
        {imageUploads.map((upload) => <div key={upload.id} className={`image-upload-toast is-${upload.status}`}>
          <span className="upload-icon">{upload.status === 'uploading' ? <LoaderCircle size={16} /> : upload.status === 'complete' ? <Check size={16} /> : <X size={16} />}</span>
          <span><strong>{upload.status === 'uploading' ? 'Uploading image' : upload.status === 'complete' ? 'Image ready' : 'Upload failed'}</strong><small>{upload.message || upload.name}</small></span>
          {upload.status === 'error' && <button onClick={() => dismissUpload(upload.id)} aria-label="Dismiss upload error"><X size={14} /></button>}
        </div>)}
      </div>}
      {showOpenEvidenceImport && <OpenEvidenceImportDialog onClose={() => setShowOpenEvidenceImport(false)} onInsert={insertImportedMarkdown} />}
    </div>
  )
}
