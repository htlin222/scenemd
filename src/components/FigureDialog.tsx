import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, Image, LoaderCircle, Upload, X } from 'lucide-react'
import { imageFilterCss, type MarpitImageOptions } from '../imageSyntax'

export interface FigureDialogState {
  url: string
  options: MarpitImageOptions
  legend: string
  legendEditable: boolean
}

interface FigureDialogProps {
  state: FigureDialogState
  documentId: string
  onChange: (patch: Partial<MarpitImageOptions> & { url?: string; legend?: string }) => void
  onCancel: () => void
  onSave: () => void
}

function sizePercent(options: MarpitImageOptions): number {
  const match = options.size.match(/^(\d+(?:\.\d+)?)%$/)
  return match ? Math.min(100, Math.max(15, Number(match[1]))) : 55
}

export function FigureDialog({ state, documentId, onChange, onCancel, onSave }: FigureDialogProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const size = sizePercent(state.options)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const canvasHeight = canvasRef.current?.getBoundingClientRect().height
    if (!canvasHeight) return
    const startY = event.clientY
    const startSize = size
    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.min(100, Math.max(15, startSize + ((moveEvent.clientY - startY) / canvasHeight) * 100))
      onChange({ size: `${Math.round(next)}%` })
    }
    const onEnd = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd, { once: true })
  }

  const replaceImage = (file: File) => {
    setUploading(true)
    setUploadError('')
    void (async () => {
      try {
        const response = await fetch(`/api/uploads/images?documentId=${encodeURIComponent(documentId)}`, {
          method: 'POST',
          headers: { 'Content-Type': file.type, 'X-File-Name': file.name },
          body: file,
        })
        const result = await response.json() as { url?: string; error?: string }
        if (!response.ok || !result.url) throw new Error(result.error || 'Image upload failed')
        onChange({ url: new URL(result.url, window.location.origin).toString() })
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : 'Image upload failed')
      } finally {
        setUploading(false)
      }
    })()
  }

  const imageStyle: CSSProperties = {
    filter: imageFilterCss(state.options.filters),
    objectFit: state.options.fit === 'auto' ? 'scale-down' : 'contain',
  }

  return createPortal(
    <div className="figure-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <section className="figure-dialog" role="dialog" aria-modal="true" aria-label="Figure editor">
        <header>
          <div><Image size={17} /><strong>Figure</strong><span>{state.legendEditable ? 'size on the 16:9 scene · legend beside it' : 'this image shares its paragraph, legend editing is off'}</span></div>
          <button onClick={onCancel} aria-label="Close figure editor"><X size={16} /></button>
        </header>
        <div className="figure-dialog-canvas" ref={canvasRef}>
          <div className="figure-dialog-media" style={{ height: `${size}%` }}>
            <img src={state.url} alt={state.options.alt} style={imageStyle} />
            <button className="figure-size-handle" onPointerDown={beginResize} title="Drag vertically to resize" aria-label={`Figure size ${Math.round(size)} percent of the scene, drag to change`}>{Math.round(size)}%</button>
          </div>
          <div className="figure-dialog-legend">
            <textarea
              aria-label="Legend text"
              value={state.legend}
              disabled={!state.legendEditable}
              onChange={(event) => onChange({ legend: event.target.value })}
              placeholder="Legend text shown beside the figure"
            />
          </div>
        </div>
        <div className="figure-dialog-fields">
          <label className="figure-field-wide"><span>Image URL</span><input value={state.url} onChange={(event) => onChange({ url: event.target.value })} /></label>
          <label className="figure-field-wide"><span>Alt text</span><input value={state.options.alt} onChange={(event) => onChange({ alt: event.target.value })} placeholder="Describe this image for screen readers" /></label>
          <div className="figure-dialog-upload">
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading}>{uploading ? <LoaderCircle className="is-spinning" size={14} /> : <Upload size={14} />} Replace image…</button>
            {uploadError && <small>{uploadError}</small>}
            <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) replaceImage(file)
              event.target.value = ''
            }} />
          </div>
          <details className="figure-dialog-advanced">
            <summary>Advanced</summary>
            <div className="figure-dialog-advanced-grid">
              <label><span>Size (scene %)</span><input value={state.options.size} onChange={(event) => onChange({ size: event.target.value })} placeholder="e.g. 45%" /></label>
              <label><span>Scaling</span><select value={state.options.fit} onChange={(event) => onChange({ fit: event.target.value as MarpitImageOptions['fit'] })}><option value="contain">Fit · no crop</option><option value="auto">Natural size</option></select></label>
              <label><span>Layout</span><select value={state.options.layout} onChange={(event) => onChange({ layout: event.target.value as MarpitImageOptions['layout'] })}><option value="legend">Image with legend</option><option value="auto">Automatic flow</option><option value="hero">Hero image</option></select></label>
              <label><span>Width</span><input value={state.options.width} onChange={(event) => onChange({ width: event.target.value })} placeholder="e.g. 480px" /></label>
              <label><span>Height</span><input value={state.options.height} onChange={(event) => onChange({ height: event.target.value })} placeholder="e.g. 280px" /></label>
              <label className="figure-field-check"><input type="checkbox" checked={state.options.background} onChange={(event) => onChange({ background: event.target.checked })} /><span>Scene background</span></label>
              <label><span>Background side</span><select value={state.options.side} disabled={!state.options.background} onChange={(event) => onChange({ side: event.target.value as MarpitImageOptions['side'] })}><option value="none">Full</option><option value="left">Left</option><option value="right">Right</option></select></label>
              <label><span>Split size</span><input disabled={!state.options.background || state.options.side === 'none'} value={state.options.splitSize} onChange={(event) => onChange({ splitSize: event.target.value })} placeholder="50%" /></label>
              <label className="figure-field-wide"><span>Filters</span><input value={state.options.filters} onChange={(event) => onChange({ filters: event.target.value })} placeholder="brightness:.8 sepia:50%" /></label>
            </div>
          </details>
        </div>
        <footer>
          <button onClick={onCancel}>Cancel</button>
          <button className="is-primary" onClick={onSave} disabled={!state.url.trim()}><Check size={15} /> Save</button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
