import { useEffect, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, ExternalLink, LoaderCircle, RefreshCw, Unlink, X } from 'lucide-react'
import type { PresentationConfig } from '../engine/types'

interface SyncedDocument {
  id: string
  title: string
  markdown: string
  presentationConfig: PresentationConfig
  revision: number
  createdAt: string
  updatedAt: string
  hackmdNoteId: string | null
  hackmdSyncedAt: number
}

interface HackMDResult {
  direction?: 'created' | 'pull' | 'push' | 'unlink'
  note?: { id: string; title: string; publishLink?: string | null }
  document?: SyncedDocument
  error?: string
  conflict?: boolean
}

export function HackMDSyncDialog({ documentId, onDocument, onBusyChange, onClose }: { documentId: string; onDocument: (document: SyncedDocument) => void; onBusyChange?: (busy: boolean) => void; onClose: () => void }) {
  const [noteId, setNoteId] = useState('')
  const [connected, setConnected] = useState(false)
  const [accountName, setAccountName] = useState('HackMD')
  const [busy, setBusy] = useState<'sync' | 'pull' | 'push' | 'unlink' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    onBusyChange?.(Boolean(busy))
  }, [busy, onBusyChange])

  useEffect(() => () => onBusyChange?.(false), [onBusyChange])

  useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/documents/${encodeURIComponent(documentId)}/hackmd`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { noteId?: string | null; accountName?: string; error?: string }
        if (!response.ok) throw new Error(result.error || 'Could not load HackMD status')
        if (result.accountName) setAccountName(result.accountName)
        if (result.noteId) { setNoteId(result.noteId); setConnected(true) }
      })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load HackMD status') })
    return () => controller.abort()
  }, [documentId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const synchronize = async (action: 'sync' | 'pull' | 'push') => {
    setBusy(action)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/hackmd`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, noteId }),
      })
      const result = await response.json() as HackMDResult
      if (!response.ok) throw new Error(result.error || 'HackMD sync failed')
      if (result.document) onDocument(result.document)
      if (result.note?.id) { setNoteId(result.note.id); setConnected(true) }
      setMessage(result.direction === 'created' ? 'Created a private HackMD note and linked it.' : result.direction === 'pull' ? 'Pulled the latest HackMD content.' : 'Pushed this document to HackMD.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'HackMD sync failed')
    } finally {
      setBusy(null)
    }
  }

  const unlink = async () => {
    setBusy('unlink')
    setMessage(null)
    setError(null)
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/hackmd`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlink' }),
      })
      const result = await response.json() as HackMDResult
      if (!response.ok) throw new Error(result.error || 'Could not unlink')
      if (result.document) onDocument(result.document)
      setNoteId('')
      setConnected(false)
      setMessage('Unlinked. The HackMD note itself was not deleted.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not unlink')
    } finally {
      setBusy(null)
    }
  }

  const openNoteId = noteId.trim().split('/').filter(Boolean).at(-1)

  return <div className="hackmd-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <dialog open className="hackmd-dialog" aria-modal="true" aria-labelledby="hackmd-title">
      <header><div><span className="hackmd-mark">H</span><div><small>Integration</small><h2 id="hackmd-title">Sync with HackMD</h2></div></div><button onClick={onClose} aria-label="Close HackMD sync"><X size={18} /></button></header>
      <div className="hackmd-body">
        <p>Keep this Markdown document linked to one HackMD note. Smart sync uses the last successful sync to choose a direction and stops if both copies changed.</p>
        <label><span>HackMD note URL or ID</span><div><input value={noteId} onChange={(event) => { setNoteId(event.target.value); setConnected(false) }} placeholder="https://hackmd.io/your-note-id" />{openNoteId && <a href={`https://hackmd.io/${openNoteId}`} target="_blank" rel="noreferrer" aria-label="Open HackMD note"><ExternalLink size={15} /></a>}</div></label>
        {!noteId.trim() && <small className="hackmd-help">Leave blank to create a private HackMD note from this document.</small>}
        {message && <div className="hackmd-message is-success">{message}</div>}
        {error && <div className="hackmd-message is-error">{error}</div>}
      </div>
      <footer>
        <div>{connected ? <><span className="sync-dot" /> Linked · {accountName}</> : `Connected as ${accountName}`}</div>
        <div>
          {connected && <button className="hackmd-unlink" onClick={() => void unlink()} disabled={Boolean(busy)} aria-label="Unlink this document from HackMD">{busy === 'unlink' ? <LoaderCircle className="is-spinning" size={15} /> : <Unlink size={15} />} Unlink</button>}
          {!!noteId.trim() && <button onClick={() => void synchronize('pull')} disabled={Boolean(busy)}>{busy === 'pull' ? <LoaderCircle className="is-spinning" size={15} /> : <ArrowDownToLine size={15} />} Pull</button>}
          {!!noteId.trim() && <button onClick={() => void synchronize('push')} disabled={Boolean(busy)}>{busy === 'push' ? <LoaderCircle className="is-spinning" size={15} /> : <ArrowUpFromLine size={15} />} Push</button>}
          <button className="hackmd-primary" onClick={() => void synchronize('sync')} disabled={Boolean(busy)} aria-busy={busy === 'sync'}><RefreshCw className={`sync-rotation-icon${busy === 'sync' ? ' is-spinning' : ''}`} size={15} /> {noteId.trim() ? 'Smart sync' : 'Create & sync'}</button>
        </div>
      </footer>
    </dialog>
  </div>
}
