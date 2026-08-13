import { useEffect, useRef, useState } from 'react'
import { Check, ExternalLink, LoaderCircle, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import {
  isOpenEvidenceConversationUrl,
  parseOpenEvidenceConversation,
  type OpenEvidenceConversation,
} from '../lib/openevidence'

interface OpenEvidenceImportDialogProps {
  onClose: () => void
  onInsert: (markdown: string) => void
}

export function OpenEvidenceImportDialog({ onClose, onInsert }: OpenEvidenceImportDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [conversation, setConversation] = useState<OpenEvidenceConversation | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const loadConversation = async () => {
    const sourceUrl = url.trim()
    if (!isOpenEvidenceConversationUrl(sourceUrl)) {
      setError('Paste a public OpenEvidence conversation URL: https://www.openevidence.com/ask/…')
      return
    }
    setLoading(true)
    setError(null)
    setConversation(null)
    try {
      const response = await fetch(`/api/oe/fetch?url=${encodeURIComponent(sourceUrl)}`)
      const result = await response.json() as { html?: string; error?: string }
      if (response.status === 403) throw new Error('This conversation is not public. In OpenEvidence, choose Share → Make public, then try again.')
      if (!response.ok || !result.html) throw new Error(result.error || 'Could not fetch this conversation.')
      const parsed = parseOpenEvidenceConversation(result.html)
      if (!parsed.turns.length) throw new Error('No answers were found. Confirm that the shared conversation is public.')
      setConversation(parsed)
      setSelected(new Set(parsed.turns.map((_, index) => index)))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not import this conversation.')
    } finally {
      setLoading(false)
    }
  }

  const toggleTurn = (index: number) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const insertSelected = () => {
    if (!conversation || !selected.size) return
    const markdown = conversation.turns
      .filter((_, index) => selected.has(index))
      .map((turn) => `## ${turn.question}\n\n${turn.answerMarkdown}`)
      .join('\n\n---\n\n')
    onInsert(markdown)
    onClose()
  }

  return createPortal(
    <div className="oe-import-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="oe-import-dialog" role="dialog" aria-modal="true" aria-labelledby="oe-import-title">
        <header>
          <div>
            <span className="oe-mark" aria-hidden="true">O</span>
            <div><small>Import</small><h2 id="oe-import-title">OpenEvidence</h2></div>
          </div>
          <button onClick={onClose} aria-label="Close OpenEvidence importer"><X size={18} /></button>
        </header>
        <div className="oe-import-content">
          <p>Paste a public conversation link. Answers, citations, lists, tables, and figures are converted to Markdown.</p>
          <div className="oe-url-row">
            <input
              ref={inputRef}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void loadConversation()}
              placeholder="https://www.openevidence.com/ask/…"
              aria-label="Public OpenEvidence conversation URL"
            />
            <button onClick={() => void loadConversation()} disabled={loading || !url.trim()}>
              {loading ? <LoaderCircle className="is-spinning" size={16} /> : <ExternalLink size={16} />}
              {loading ? 'Reading…' : 'Read'}
            </button>
          </div>
          {error && <div className="oe-import-error" role="alert">{error}</div>}
          {conversation && <div className="oe-turns">
            <div className="oe-turns-heading"><strong>{conversation.title || 'OpenEvidence conversation'}</strong><span>{conversation.turns.length} {conversation.turns.length === 1 ? 'answer' : 'answers'}</span></div>
            {conversation.turns.map((turn, index) => <label key={`${turn.question}-${index}`} className={selected.has(index) ? 'is-selected' : ''}>
              <input type="checkbox" checked={selected.has(index)} onChange={() => toggleTurn(index)} />
              <span className="oe-check"><Check size={13} /></span>
              <span><strong>{turn.question}</strong><small>{turn.answerMarkdown.replace(/[#*_`\[\]()]/g, '').slice(0, 180)}</small></span>
            </label>)}
          </div>}
        </div>
        <footer>
          <span>{conversation ? `${selected.size} selected` : 'Only public links can be read'}</span>
          <button className="oe-insert-button" disabled={!conversation || !selected.size} onClick={insertSelected}>Insert into document</button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
