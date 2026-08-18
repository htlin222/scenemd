import { Copy, RefreshCw } from 'lucide-react'
import { downloadBlob, exportFileName } from '../export'
import { conflictExcerpts, type SaveConflictState } from './shared'
import { useModalFocus } from './useModalFocus'

export function ConflictDialog({ conflict, onUseCloud, onKeepLocal }: {
  conflict: SaveConflictState
  onUseCloud: () => void
  onKeepLocal: () => void
}) {
  const dialogRef = useModalFocus<HTMLElement>()
  const excerpts = conflictExcerpts(conflict.localMarkdown, conflict.remote.markdown)
  return <div className="save-conflict-backdrop" role="presentation"><aside ref={dialogRef} className="save-conflict-dialog" role="alertdialog" aria-modal="true" aria-labelledby="save-conflict-title">
    <div className="save-conflict-icon"><RefreshCw size={21} /></div>
    <h2 id="save-conflict-title">Two sessions edited this document</h2>
    <p>SceneMD could not safely merge changes made to the same content. Your local Markdown is still in this editor, and a backup copy is kept on this device until the conflict is resolved.</p>
    <div className="save-conflict-meta"><span>Your copy</span><strong>{conflict.localMarkdown.split('\n').length} lines</strong><span>Cloud copy</span><strong>revision {conflict.remote.revision}</strong></div>
    <div className="save-conflict-diff">
      <div><span>Your version</span><pre>{excerpts.local || '(empty)'}</pre></div>
      <div><span>Cloud version</span><pre>{excerpts.remote || '(empty)'}</pre></div>
    </div>
    <div className="save-conflict-actions">
      <button onClick={() => void navigator.clipboard.writeText(conflict.localMarkdown)}><Copy size={15} /> Copy my Markdown</button>
      <button onClick={() => downloadBlob(new Blob([conflict.localMarkdown], { type: 'text/markdown;charset=utf-8' }), exportFileName(`${conflict.localTitle} (my version)`, 'md'))}>Download .md</button>
      <button onClick={onUseCloud}>Use cloud version</button>
      <button className="is-primary" onClick={onKeepLocal}>Keep my version</button>
    </div>
  </aside></div>
}
