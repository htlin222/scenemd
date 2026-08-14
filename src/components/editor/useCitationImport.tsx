import { useEffect, useState, type MutableRefObject, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { BookPlus, Check, LoaderCircle, X } from 'lucide-react'
import { EditorView } from 'codemirror'
import {
  existingCitationReferenceNumber,
  insertCitationReference,
  normalizeCitationIdentifier,
  type CitationIdentifier,
} from '../../citations'
import { useModalFocus } from '../../app/useModalFocus'

/**
 * DOI / PubMed citation lookup and insertion with AMA formatting.
 * Extracted from MarkdownEditor (#13).
 *
 * The lookup effect depends on the identifier text alone — deliberately not
 * the whole import state, whose from/to change with the selection without
 * affecting what should be looked up. Extracting the string before the
 * effect makes that dependency honest instead of a lint suppression.
 */

export interface CitationImportState {
  identifier: string
  from: number
  to: number
}

export interface CitationLookupState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  citation: string
  error: string
  existingNumber?: number
  identifier?: CitationIdentifier
}

export function useCitationImport(viewRef: RefObject<EditorView | null>, valueRef: MutableRefObject<string>) {
  const [citationImport, setCitationImport] = useState<CitationImportState | null>(null)
  const [citationLookup, setCitationLookup] = useState<CitationLookupState>({ status: 'idle', citation: '', error: '' })

  const active = citationImport !== null
  const identifier = citationImport?.identifier ?? ''

  useEffect(() => {
    if (!active) return
    const normalized = normalizeCitationIdentifier(identifier)
    if (!identifier.trim()) {
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
  }, [active, identifier, valueRef])

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

  return { citationImport, setCitationImport, citationLookup, openCitationImport, insertCitation }
}

export function CitationImportDialog({ state, lookup, onChange, onClose, onInsert }: {
  state: CitationImportState
  lookup: CitationLookupState
  onChange: (updater: (current: CitationImportState | null) => CitationImportState | null) => void
  onClose: () => void
  onInsert: () => void
}) {
  const dialogRef = useModalFocus<HTMLDialogElement>()
  return createPortal(<div className="citation-import-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <dialog open ref={dialogRef} className="citation-import-dialog" aria-modal="true" aria-labelledby="citation-import-title">
      <header><div><BookPlus size={18} /><div><small>AMA CSL</small><h2 id="citation-import-title">Insert citation</h2></div></div><button onClick={onClose} aria-label="Close citation import"><X size={18} /></button></header>
      <div className="citation-import-body">
        <label><span>DOI or PubMed ID</span><input data-autofocus value={state.identifier} onChange={(event) => onChange((current) => current ? { ...current, identifier: event.target.value } : current)} placeholder="10.1016/j.chest.2024.09.016 or PMID: 28012456" /></label>
        <div className={`citation-lookup-status is-${lookup.status}`}>
          {lookup.status === 'idle' && <span>Paste a DOI, PMID, or PubMed article URL.</span>}
          {lookup.status === 'loading' && <span><LoaderCircle className="is-spinning" size={14} /> Formatting with AMA CSL…</span>}
          {lookup.status === 'error' && <span>{lookup.error}</span>}
          {lookup.status === 'ready' && lookup.existingNumber !== undefined && <span><Check size={14} /> Already listed as [{lookup.existingNumber}]. The existing reference will be reused.</span>}
          {lookup.status === 'ready' && lookup.existingNumber === undefined && <blockquote>{lookup.citation.replace(/^\s*\d+\.\s*/, '')}</blockquote>}
        </div>
      </div>
      <footer><span>New references are appended without renumbering existing citations.</span><div><button onClick={onClose}>Cancel</button><button className="citation-import-primary" onClick={onInsert} disabled={lookup.status !== 'ready'}>Insert [{lookup.existingNumber ?? 'n'}]</button></div></footer>
    </dialog>
  </div>, document.body)
}
