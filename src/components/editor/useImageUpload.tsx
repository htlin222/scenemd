import { useState, type MutableRefObject, type RefObject } from 'react'
import { Check, LoaderCircle, X } from 'lucide-react'
import type { EditorView } from 'codemirror'

/**
 * Clipboard / file-picker image upload to R2, with toast feedback and
 * immediate Markdown insertion. Extracted from MarkdownEditor (#13).
 *
 * The insertion path is deliberately view-aware: while the upload was in
 * flight the author may have kept typing, so the insert lands at the tracked
 * offset in the live view — and if the view was torn down (mode switch), the
 * Markdown is appended through onChange instead of being dropped.
 */

export interface ImageUploadState {
  id: string
  name: string
  status: 'uploading' | 'complete' | 'error'
  message?: string
}

export function useImageUpload(
  documentId: string,
  viewRef: RefObject<EditorView | null>,
  valueRef: MutableRefObject<string>,
  onChangeRef: MutableRefObject<(value: string) => void>,
) {
  const [imageUploads, setImageUploads] = useState<ImageUploadState[]>([])

  const dismissUpload = (id: string) => setImageUploads((uploads) => uploads.filter((upload) => upload.id !== id))

  const handleFiles = (files: File[], view: EditorView) => {
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

  return { imageUploads, dismissUpload, handleFiles }
}

export function ImageUploadToasts({ uploads, onDismiss }: { uploads: ImageUploadState[]; onDismiss: (id: string) => void }) {
  if (!uploads.length) return null
  return <div className="image-upload-stack" aria-live="polite">
    {uploads.map((upload) => <div key={upload.id} className={`image-upload-toast is-${upload.status}`}>
      <span className="upload-icon">{upload.status === 'uploading' ? <LoaderCircle size={16} /> : upload.status === 'complete' ? <Check size={16} /> : <X size={16} />}</span>
      <span><strong>{upload.status === 'uploading' ? 'Uploading image' : upload.status === 'complete' ? 'Image ready' : 'Upload failed'}</strong><small>{upload.message || upload.name}</small></span>
      {upload.status === 'error' && <button onClick={() => onDismiss(upload.id)} aria-label="Dismiss upload error"><X size={14} /></button>}
    </div>)}
  </div>
}
