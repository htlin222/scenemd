import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, Image, LoaderCircle, Upload, X } from 'lucide-react'
import { type MarpitImageOptions } from '../imageSyntax'
import { SceneView } from './SceneView'
import { chooseLayout, figureGridColumns } from '../engine/planner'
import { buildSemanticRegions, parsePresentationDocument } from '../engine/semantics'
import { defaultPresentationConfig } from '../presentationConfig'
import type { PresentationBlock, Scene } from '../engine/types'
import { useModalFocus } from '../app/useModalFocus'

export interface FigureDialogState {
  url: string
  options: MarpitImageOptions
  legend: string
  legendEditable: boolean
  from: number
  documentSource: string
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

// The canvas is not a mock: the figure's whole page — heading, body text,
// legend, neighbors — is parsed from the live document and rendered through
// the real SceneView with the draft substituted in, so dragging shows every
// relative change exactly as the scene will get it.
function contextScene(state: FigureDialogState): { scene: Scene; targetId: string | null } {
  const line = state.documentSource.slice(0, state.from).split('\n').length
  const blocks = parsePresentationDocument(state.documentSource)
  const regions = buildSemanticRegions(blocks)
  const region = regions.find((candidate) => candidate.blocks.some((block) =>
    block.type === 'figure' && block.sourceRange.startLine <= line && line <= block.sourceRange.endLine))
  const target = region?.blocks.find((block) =>
    block.type === 'figure' && block.sourceRange.startLine <= line && line <= block.sourceRange.endLine)

  const draftFigure = (base: PresentationBlock): PresentationBlock => ({
    ...base,
    url: state.url,
    alt: state.options.alt || base.alt,
    imageOptions: { ...state.options },
    caption: state.legend.trim() ? [{ type: 'text', value: state.legend.trim() }] : base.caption,
  })

  const sceneBlocks = region && target
    ? region.blocks.map((block) => (block === target ? draftFigure(block) : block))
    : [draftFigure({
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
        layoutHint: 'auto',
        sourceRange: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
        url: state.url,
        alt: state.options.alt,
      })]

  return {
    scene: {
      id: 'figure-dialog-scene',
      role: 'content',
      regionId: region?.id ?? 'figure-dialog',
      startBlockId: sceneBlocks[0].id,
      endBlockId: sceneBlocks[sceneBlocks.length - 1].id,
      blocks: sceneBlocks,
      layout: chooseLayout(sceneBlocks),
      figureColumns: figureGridColumns(sceneBlocks),
      sourceRange: sceneBlocks[0].sourceRange,
      fillRatio: 0,
      score: 0,
      scores: DIALOG_SCORES,
    },
    targetId: target?.id ?? 'figure-dialog-preview',
  }
}

export function FigureDialog({ state, documentId, onChange, onCancel, onSave }: FigureDialogProps) {
  const dialogRef = useModalFocus<HTMLDialogElement>()
  const canvasRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [handlePosition, setHandlePosition] = useState<{ left: number; top: number } | null>(null)
  const size = sizePercent(state.options)
  const { scene, targetId } = useMemo(() => contextScene(state), [state])

  useLayoutEffect(() => {
    const reposition = () => {
      const canvas = canvasRef.current
      const frame = canvas?.querySelector(targetId ? `[data-block-id="${targetId}"] .figure-frame` : '.figure-frame')
        ?? canvas?.querySelector('.figure-frame')
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
  }, [scene, targetId])

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
      <dialog open ref={dialogRef} className="figure-dialog" aria-modal="true" aria-label="Figure editor">
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
          <label><span>Size (scene %)</span><input value={state.options.size} onChange={(event) => onChange({ size: event.target.value })} placeholder="e.g. 45%" title="The only figure setting: how much of the scene it occupies. Everything else follows the fixed layout." /></label>
        </div>
        <footer>
          <button onClick={onCancel}>Cancel</button>
          <button className="is-primary" onClick={onSave} disabled={!state.url.trim()}><Check size={15} /> Save</button>
        </footer>
      </dialog>
    </div>,
    document.body,
  )
}
