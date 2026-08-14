import { useState, type RefObject } from 'react'
import { Columns2, ListTree, LoaderCircle, Sparkles, X } from 'lucide-react'
import type { EditorView } from 'codemirror'
import { columnsMarkdown } from './commands'

/**
 * The floating selection toolbar: Workers AI bullet rewriting and the
 * two-column arrangement. Extracted from MarkdownEditor (#13).
 *
 * Both actions re-read the live selection and bail if it no longer matches
 * what the toolbar was opened for — the AI round-trip takes seconds, and
 * rewriting text the author has since edited would corrupt the document.
 */

export interface SelectionToolState {
  from: number
  to: number
  text: string
  left: number
  top: number
}

export function useSelectionAi(viewRef: RefObject<EditorView | null>, documentId: string) {
  const [selectionTool, setSelectionTool] = useState<SelectionToolState | null>(null)
  const [aiBusy, setAiBusy] = useState<'flat' | 'nested' | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)

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

  return { selectionTool, setSelectionTool, aiBusy, aiError, setAiError, makeSelectionBullets, makeSelectionColumns }
}

export function SelectionToolbar({ state, aiBusy, aiError, onBullets, onColumns, onClose }: {
  state: SelectionToolState
  aiBusy: 'flat' | 'nested' | null
  aiError: string | null
  onBullets: (mode: 'flat' | 'nested') => void
  onColumns: () => void
  onClose: () => void
}) {
  return <div className="selection-ai-tool" role="toolbar" aria-label="Selection tools" tabIndex={-1} style={{ left: state.left, top: state.top }} onMouseDown={(event) => event.preventDefault()}>
    <button onClick={() => onBullets('flat')} disabled={Boolean(aiBusy) || state.text.length > 12000} title={state.text.length > 12000 ? 'Select no more than 12,000 characters' : 'Rewrite selection as flat Markdown bullets with Workers AI'}>
      {aiBusy === 'flat' ? <LoaderCircle className="is-spinning" size={15} /> : <Sparkles size={15} />}
      {aiBusy === 'flat' ? 'Making bullets…' : 'Make bullets'}
    </button>
    <button onClick={() => onBullets('nested')} disabled={Boolean(aiBusy) || state.text.length > 12000} title="Rewrite selection as a two-level Markdown list">{aiBusy === 'nested' ? <LoaderCircle className="is-spinning" size={15} /> : <ListTree size={15} />}{aiBusy === 'nested' ? 'Nesting…' : 'Nested bullets'}</button>
    <button onClick={onColumns} title="Arrange the selection as two responsive columns"><Columns2 size={15} />Two columns</button>
    <span>{state.text.length.toLocaleString()}</span>
    <button className="selection-tool-close" onClick={onClose} aria-label="Close selection tool"><X size={14} /></button>
    {aiError && <small>{aiError}</small>}
  </div>
}
