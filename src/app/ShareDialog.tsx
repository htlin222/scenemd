import { Copy, Link2 } from 'lucide-react'
import { useModalFocus } from './useModalFocus'

export function ShareDialog({ shareLink, onClose }: { shareLink: string; onClose: () => void }) {
  const dialogRef = useModalFocus<HTMLDialogElement>()
  return <div className="cheatsheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <dialog open ref={dialogRef} className="share-dialog" aria-modal="true" aria-labelledby="share-title">
      <div className="share-icon"><Link2 size={22} /></div>
      <h2 id="share-title">Read-only link ready</h2>
      <p>Anyone with this unguessable link can read and present this document. They cannot edit it.</p>
      <div className="share-link-field"><input value={shareLink} readOnly aria-label="Read-only share link" /><button onClick={() => void navigator.clipboard.writeText(shareLink)}><Copy size={15} /> Copy</button></div>
      <button className="share-done" onClick={onClose}>Done</button>
    </dialog>
  </div>
}
