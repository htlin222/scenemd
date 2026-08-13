import { useEffect, useState } from 'react'
import { Settings2, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { PresentationConfig } from '../engine/types'

interface PresentationSettingsDialogProps {
  value: PresentationConfig
  onSave: (value: PresentationConfig) => void
  onClose: () => void
}

export function PresentationSettingsDialog({ value, onSave, onClose }: PresentationSettingsDialogProps) {
  const [draft, setDraft] = useState(value)
  const update = (key: keyof PresentationConfig, nextValue: string) => setDraft((current) => ({ ...current, [key]: nextValue }))

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return createPortal(
    <div className="presentation-settings-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="presentation-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="presentation-settings-title">
        <header>
          <div><Settings2 size={18} /><div><small>Presentation</small><h2 id="presentation-settings-title">Cover settings</h2></div></div>
          <button onClick={onClose} aria-label="Close presentation settings"><X size={18} /></button>
        </header>
        <div className="presentation-settings-body">
          <form onSubmit={(event) => { event.preventDefault(); onSave(draft); onClose() }}>
            <label className="settings-field settings-field-wide"><span>Title</span><input autoFocus value={draft.title} onChange={(event) => update('title', event.target.value)} required /></label>
            <label className="settings-field settings-field-wide"><span>Subtitle</span><textarea value={draft.subtitle} onChange={(event) => update('subtitle', event.target.value)} rows={2} placeholder="A concise description of this presentation" /></label>
            <label className="settings-field"><span>Series name</span><input value={draft.seriesName} onChange={(event) => update('seriesName', event.target.value)} placeholder="Grand rounds" /></label>
            <label className="settings-field"><span>Date</span><input type="date" value={draft.date} onChange={(event) => update('date', event.target.value)} /></label>
            <label className="settings-field"><span>Author</span><input value={draft.author} onChange={(event) => update('author', event.target.value)} placeholder="Name" /></label>
            <label className="settings-field"><span>Affiliation</span><input value={draft.affiliation} onChange={(event) => update('affiliation', event.target.value)} placeholder="Institution" /></label>
            <label className="settings-field"><span>Email</span><input type="email" value={draft.email} onChange={(event) => update('email', event.target.value)} placeholder="you@example.com" /></label>
            <label className="settings-field"><span>License</span><input value={draft.license} onChange={(event) => update('license', event.target.value)} placeholder="CC BY-NC" /></label>
            <div className="presentation-settings-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit">Save cover</button></div>
          </form>
          <aside className="cover-config-preview" aria-label="Cover preview">
            <div className="cover-config-preview-top"><span>{draft.seriesName || 'Series'}</span><time>{draft.date}</time></div>
            <div className="cover-config-preview-center"><h3>{draft.title || 'Untitled presentation'}</h3>{draft.subtitle && <p>{draft.subtitle}</p>}<hr />{draft.author && <strong>{draft.author}</strong>}{draft.affiliation && <span>{draft.affiliation}</span>}{draft.email && <span>{draft.email}</span>}</div>
            <small>{draft.license}</small>
          </aside>
        </div>
      </section>
    </div>,
    document.body,
  )
}
