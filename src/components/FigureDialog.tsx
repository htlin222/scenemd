import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, Image, LoaderCircle, Upload, X } from 'lucide-react'
import { type MarpitImageOptions } from '../imageSyntax'
import { SceneView } from './SceneView'
import { chooseLayout } from '../engine/planner'
import { defaultPresentationConfig } from '../presentationConfig'
import type { PresentationBlock, Scene } from '../engine/types'

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

const DIALOG_CONFIG = defaultPresentationConfig('Figure preview')

const DIALOG_SCORES = {
  semanticCoherence: 0, density: 0, breakpoint: 0, visualBalance: 0, hierarchy: 0,
  stability: 0, fragmentationPenalty: 0, orphanPenalty: 0, crowdingPenalty: 0, whitespacePenalty: 0,
}

// The canvas is not a mock: the draft is rendered through the real SceneView
// with the real scene CSS, so what the drag shows IS the size the scene gets.
function draftScene(state: FigureDialogState): Scene {
  const figure: PresentationBlock = {
    id: 'figure-dialog-preview',
    type: 'figure',
    semanticRole: 'figure',
    importance: 0.8,
    keepTogether: true,
    keepWithNext: false,
    keepWithPrevious: false,
    breakBefore: 'auto',
    breakAfter: 'auto',
    visibility: 'normal',
    layoutHint: state.options.layout === 'hero' ? 'hero' : state.options.layout === 'auto' ? 'auto' : 'legend',
    sourceRange: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
    url: state.url,
    alt: state.options.alt,
    imageOptions: state.options,
    caption: state.legend.trim() ? [{ type: 'text', value: state.legend.trim() }] : undefined,
  }
  return {
    id: 'figure-dialog-scene',
    role: 'content',
    regionId: 'figure-dialog',
    startBlockId: figure.id,
    endBlockId: figure.id,
    blocks: [figure],
    layout: chooseLayout([figure]),
    sourceRange: figure.sourceRange,
    fillRatio: 0,
    score: 0,
    scores: DIALOG_SCORES,
  }
}

export function FigureDialog({ state, documentId, onChange, onCancel, onSave }: FigureDialogProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [handlePosition, setHandlePosition] = useState<{ left: number; top: number } | null>(null)
  const size = sizePercent(state.options)
  const scene = useMemo(() => draftScene(state), [state])

  useLayoutEffect(() => {
    const reposition = () => {
      const canvas = canvasRef.current
      const frame = canvas?.querySelector('.figure-frame')
      if (!canvas || !frame) {
        setHandlePosition(null)
        return
      }
      const canvasRect = canvas.getBoundingClientRect()
      const frameRect = frame.getBoundingClientRect()
      setHandlePosition({ left: frameRect.right - canvasRect.left - 14, top: frameRect.bottom - canvasRect.top - 14 })
    }
    reposition()
    const raf = window.requestAnimationFrame(reposition)
    const image = canvasRef.current?.querySelector('.figure-frame img')
    image?.addEventListener('load', reposition)
    window.addEventListener('resize', reposition)
    return () => {
      window.cancelAnimationFrame(raf)
      image?.removeEventListener('load', reposition)
      window.removeEventListener('resize', reposition)
    }
  }, [scene])

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

  return createPortal(
    <div className="figure-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <section className="figure-dialog" role="dialog" aria-modal="true" aria-label="Figure editor">
        <header>
          <div><Image size={17} /><strong>Figure</strong><span>true-scale 16:9 scene preview · drag the handle to size the figure</span></div>
          <button onClick={onCancel} aria-label="Close figure editor"><X size={16} /></button>
        </header>
        <div className="figure-dialog-canvas" ref={canvasRef}>
          <div className="stage-shell figure-dialog-stage">
            <SceneView scene={scene} sceneNumber={1} sceneCount={1} presentationConfig={DIALOG_CONFIG} />
          </div>
          {handlePosition && (
            <button
              className="figure-size-handle"
              style={{ left: handlePosition.left, top: handlePosition.top }}
              onPointerDown={beginResize}
              title="Drag vertically to resize"
              aria-label={`Figure size ${Math.round(size)} percent of the scene, drag to change`}
            >{Math.round(size)}%</button>
          )}
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
              <label><span>Width</span><input value={state.options.width} onChange={(event) => onChange({ width: event.target.value })} placeholder="e.g. 480px" /></label>
              <label><span>Height</span><input value={state.options.height} onChange={(event) => onChange({ height: event.target.value })} placeholder="e.g. 280px" /></label>
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
