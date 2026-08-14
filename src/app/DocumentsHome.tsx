import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, Clock3, FileText, Files, Link2, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { defaultPresentationConfig } from '../presentationConfig'
import { formatUpdated, type DocumentPayload, type DocumentSummary } from './shared'

/**
 * The document library: list, search, create, rename, delete.
 *
 * Split from App.tsx (#13). The hook owns the data and mutations because the
 * shared header needs the document count and the create action while the list
 * itself renders inside the home route; the component owns presentation-only
 * state (search, inline rename, delete confirmation).
 */

export interface DocumentLibrary {
  documents: DocumentSummary[]
  loading: boolean
  error: string | null
  creating: boolean
  create: () => Promise<void>
  rename: (documentId: string, title: string) => Promise<void>
  remove: (documentId: string) => Promise<void>
  busyId: string | null
}

export function useDocumentLibrary(active: boolean, navigate: (path: string) => void): DocumentLibrary {
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const response = await fetch('/api/documents', { signal: controller.signal })
        const result = await response.json() as { documents?: DocumentSummary[]; error?: string }
        if (!response.ok) throw new Error(result.error || 'Could not load documents')
        setDocuments(result.documents ?? [])
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Something went wrong')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [active])

  const create = async () => {
    setCreating(true)
    setError(null)
    try {
      const response = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled document', markdown: '# Introduction\n\nStart writing here.\n', presentationConfig: defaultPresentationConfig('Untitled presentation') }),
      })
      const result = await response.json() as DocumentPayload & { error?: string }
      if (!response.ok) throw new Error(result.error || 'Could not create document')
      navigate(`/document/${result.id}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create document')
    } finally {
      setCreating(false)
    }
  }

  const rename = async (documentId: string, title: string) => {
    const previous = documents.find((entry) => entry.id === documentId)
    if (!title || title === previous?.title) return
    setBusyId(documentId)
    setError(null)
    try {
      // rename: true also rewrites the document's leading H1, because the
      // title follows the H1 and would otherwise revert on the next autosave.
      const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, rename: true }),
      })
      const result = await response.json() as DocumentPayload & { error?: string }
      if (!response.ok) throw new Error(result.error || 'Could not rename document')
      setDocuments((current) => current.map((entry) => entry.id === documentId ? { ...entry, title: result.title, revision: result.revision, updatedAt: result.updatedAt ?? entry.updatedAt } : entry))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not rename document')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (documentId: string) => {
    setBusyId(documentId)
    setError(null)
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' })
      if (!response.ok && response.status !== 404) {
        const result = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(result.error || 'Could not delete document')
      }
      setDocuments((current) => current.filter((entry) => entry.id !== documentId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete document')
    } finally {
      setBusyId(null)
    }
  }

  return { documents, loading, error, creating, create, rename, remove, busyId }
}

export function DocumentsHome({ library, navigate }: { library: DocumentLibrary; navigate: (path: string) => void }) {
  const { documents, loading, error, creating, busyId } = library
  const [searchQuery, setSearchQuery] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)

  const filteredDocuments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return documents
    return documents.filter((entry) => entry.title.toLowerCase().includes(query))
  }, [documents, searchQuery])

  const submitRename = (documentId: string) => {
    setRenamingId(null)
    void library.rename(documentId, renameDraft.trim())
  }

  return <main className="documents-home">
    <section className="documents-hero">
      <span>Document-first presentations</span>
      <h1>Your documents</h1>
      <p>Write once in Markdown. SceneMD composes the presentation when you need it.</p>
      <button onClick={() => void library.create()} disabled={creating}><Plus size={18} /> {creating ? 'Creating document…' : 'New document'}</button>
    </section>
    <section className="documents-library" aria-labelledby="documents-title">
      <div className="library-heading"><div><h2 id="documents-title">Files</h2><span>{filteredDocuments.length} documents</span></div><label className="document-search"><Search size={16} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search documents" aria-label="Search documents" /></label></div>
      {error && <div className="api-message is-error">{error}</div>}
      {loading ? <div className="document-empty">Loading your documents…</div> : filteredDocuments.length ? <div className="document-list">
        {filteredDocuments.map((document) => <div key={document.id} className={`document-row-wrap${busyId === document.id ? ' is-busy' : ''}`}>
          {renamingId === document.id ? <form className="document-row document-rename" onSubmit={(event) => { event.preventDefault(); submitRename(document.id) }}>
            <span className="document-icon"><FileText size={19} /></span>
            <input value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} onKeyDown={(event) => event.key === 'Escape' && setRenamingId(null)} aria-label={`Rename ${document.title}`} ref={(node) => node?.focus()} />
            <button type="submit" className="row-action" aria-label="Save name"><Check size={15} /></button>
            <button type="button" className="row-action" onClick={() => setRenamingId(null)} aria-label="Cancel rename"><X size={15} /></button>
          </form> : <>
            <button className="document-row" onClick={() => navigate(`/document/${document.id}`)} disabled={busyId === document.id}>
              <span className="document-icon"><FileText size={19} /></span>
              <span className="document-name"><strong>{document.title}</strong><small><Clock3 size={12} /> Updated {formatUpdated(document.updatedAt)}</small></span>
              {document.shared && <span className="shared-badge"><Link2 size={12} /> Shared</span>}
              <span className="document-revision">v{document.revision}</span>
              <ArrowRight size={17} />
            </button>
            <span className="document-row-actions">
              <button className="row-action" onClick={() => { setRenamingId(document.id); setRenameDraft(document.title); setConfirmingDeleteId(null) }} aria-label={`Rename ${document.title}`} disabled={busyId === document.id}><Pencil size={15} /></button>
              {confirmingDeleteId === document.id
                ? <button className="row-action is-danger is-confirming" onClick={() => void library.remove(document.id)} onBlur={() => setConfirmingDeleteId(null)} aria-label={`Confirm deleting ${document.title}`} disabled={busyId === document.id}>Delete?</button>
                : <button className="row-action is-danger" onClick={() => setConfirmingDeleteId(document.id)} aria-label={`Delete ${document.title}`} disabled={busyId === document.id}><Trash2 size={15} /></button>}
            </span>
          </>}
        </div>)}
      </div> : <div className="document-empty"><Files size={28} /><strong>No documents yet</strong><span>Create your first Markdown document to begin.</span><button onClick={() => void library.create()}><Plus size={15} /> New document</button></div>}
    </section>
  </main>
}
