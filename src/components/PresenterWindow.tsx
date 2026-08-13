import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, ExternalLink, RotateCcw } from 'lucide-react'
import type { PresentationConfig, Scene } from '../engine/types'
import { type CitationReferenceMap, SceneView, sceneSpeakerNotes } from './SceneView'

interface PresenterWindowProps {
  target: Window
  scenes: Scene[]
  sceneIndex: number
  revealIndex: number
  presentationConfig: PresentationConfig
  citationReferences: CitationReferenceMap
  navigationLabels: string[]
  activeLabels: Array<string | undefined>
  onPrevious: () => void
  onNext: () => void
  onBlack: () => void
  onClosed: () => void
}

interface PresenterLayout {
  column: number
  leftRow: number
  rightRow: number
}

const DEFAULT_LAYOUT: PresenterLayout = { column: 66, leftRow: 60, rightRow: 60 }

function savedLayout(): PresenterLayout {
  try {
    const parsed = JSON.parse(localStorage.getItem('scenemd-presenter-layout') ?? '') as Partial<PresenterLayout>
    const clamp = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(85, Math.max(20, value)) : fallback
    return { column: clamp(parsed.column, 66), leftRow: clamp(parsed.leftRow, 60), rightRow: clamp(parsed.rightRow, 60) }
  } catch {
    return DEFAULT_LAYOUT
  }
}

function clock(value: number): string {
  const seconds = Math.floor(value / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function noteSections(notes: string[]): Array<{ at: number; text: string }> {
  const sections: Array<{ at: number; text: string }> = []
  let at = 0
  notes.forEach((note) => note.split('\n').forEach((rawLine) => {
    const marker = rawLine.match(/^\s*\[click(?::(\d+))?]\s*/i)
    if (marker) at = marker[1] ? Math.max(0, Number(marker[1])) : at + 1
    const line = rawLine.replace(/^\s*\[click(?::\d+)?]\s*/i, '').trim()
    if (!line) return
    const previous = sections.at(-1)
    if (previous?.at === at) previous.text += `\n${line}`
    else sections.push({ at, text: line })
  }))
  return sections
}

export function PresenterWindow({ target, scenes, sceneIndex, revealIndex, presentationConfig, citationReferences, navigationLabels, activeLabels, onPrevious, onNext, onBlack, onClosed }: PresenterWindowProps) {
  const [layout, setLayout] = useState(savedLayout)
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(true)
  const [timerMode, setTimerMode] = useState<'stopwatch' | 'countdown'>(() => localStorage.getItem('scenemd-presenter-timer-mode') === 'countdown' ? 'countdown' : 'stopwatch')
  const [durationMinutes, setDurationMinutes] = useState(() => Math.max(1, Number(localStorage.getItem('scenemd-presenter-duration')) || 30))
  const elapsedBaseRef = useRef(0)
  const startedAtRef = useRef(Date.now())
  const current = scenes[sceneIndex]
  const next = scenes[sceneIndex + 1]
  const notes = useMemo(() => sceneSpeakerNotes(current), [current])
  const sections = useMemo(() => noteSections(notes), [notes])
  const activeNoteAt = Math.max(0, ...sections.filter((section) => section.at <= revealIndex).map((section) => section.at))
  const timerValue = timerMode === 'countdown' ? Math.max(0, durationMinutes * 60_000 - elapsed) : elapsed

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (running) setElapsed(elapsedBaseRef.current + Date.now() - startedAtRef.current)
    }, 500)
    return () => window.clearInterval(interval)
  }, [running])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') { event.preventDefault(); onNext() }
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); onPrevious() }
      else if (event.key.toLowerCase() === 'b') onBlack()
      else if (event.key.toLowerCase() === 'r') { elapsedBaseRef.current = 0; startedAtRef.current = Date.now(); setElapsed(0); setRunning(true) }
    }
    const onUnload = () => onClosed()
    target.addEventListener('keydown', onKeyDown)
    target.addEventListener('beforeunload', onUnload)
    return () => {
      target.removeEventListener('keydown', onKeyDown)
      target.removeEventListener('beforeunload', onUnload)
    }
  }, [onBlack, onClosed, onNext, onPrevious, target])

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>, axis: 'column' | 'leftRow' | 'rightRow') => {
    event.preventDefault()
    const owner = axis === 'column' ? event.currentTarget.parentElement : event.currentTarget.parentElement
    const rect = owner?.getBoundingClientRect()
    if (!rect) return
    const start = layout[axis]
    const startPoint = axis === 'column' ? event.clientX : event.clientY
    const span = axis === 'column' ? rect.width : rect.height
    const onMove = (moveEvent: PointerEvent) => {
      const point = axis === 'column' ? moveEvent.clientX : moveEvent.clientY
      const value = Math.min(85, Math.max(20, start + ((point - startPoint) / span) * 100))
      setLayout((currentLayout) => ({ ...currentLayout, [axis]: value }))
    }
    const onEnd = () => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onEnd)
      setLayout((currentLayout) => { localStorage.setItem('scenemd-presenter-layout', JSON.stringify(currentLayout)); return currentLayout })
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onEnd, { once: true })
  }

  const toggleTimer = () => {
    if (running) {
      elapsedBaseRef.current = elapsed
      setRunning(false)
    } else {
      startedAtRef.current = Date.now()
      setRunning(true)
    }
  }

  return createPortal(<main className="presenter-console" style={{ '--presenter-column': `${layout.column}%` } as CSSProperties}>
    <div className="presenter-console-column is-left" style={{ '--presenter-row': `${layout.leftRow}%` } as CSSProperties}>
      <section className="presenter-card presenter-current"><header>Current</header><div className="presenter-scene-stage">{current && <SceneView scene={current} sceneNumber={sceneIndex + 1} sceneCount={scenes.length} revealIndex={revealIndex} navigationLabels={navigationLabels} activeNavigationLabel={activeLabels[sceneIndex]} presentationConfig={presentationConfig} citationReferences={citationReferences} />}</div></section>
      <button className="presenter-divider is-row" onPointerDown={(event) => beginResize(event, 'leftRow')} aria-label="Resize current scene and speaker notes"><span /></button>
      <section className="presenter-card presenter-notes"><header><span>Speaker notes</span><small>[click] follows reveals</small></header><div className="presenter-notes-body">{sections.length ? sections.map((section, index) => <p key={index} className={`${section.at === activeNoteAt ? 'is-active' : ''}${section.at > revealIndex ? ' is-upcoming' : ''}`}>{section.text}</p>) : <p className="is-empty">No notes for this scene.</p>}</div></section>
    </div>
    <button className="presenter-divider is-column" onPointerDown={(event) => beginResize(event, 'column')} aria-label="Resize presenter columns"><span /></button>
    <div className="presenter-console-column is-right" style={{ '--presenter-row': `${layout.rightRow}%` } as CSSProperties}>
      <section className="presenter-card presenter-next"><header>Next</header><div className="presenter-scene-stage">{next ? <SceneView scene={next} sceneNumber={sceneIndex + 2} sceneCount={scenes.length} revealIndex={Number.POSITIVE_INFINITY} navigationLabels={navigationLabels} activeNavigationLabel={activeLabels[sceneIndex + 1]} presentationConfig={presentationConfig} citationReferences={citationReferences} /> : <div className="presenter-end">End of document</div>}</div></section>
      <button className="presenter-divider is-row" onPointerDown={(event) => beginResize(event, 'rightRow')} aria-label="Resize next scene and presenter controls"><span /></button>
      <section className="presenter-card presenter-meta">
        <header>Presentation</header>
        <div className="presenter-timer-mode"><button onClick={() => { const mode = timerMode === 'stopwatch' ? 'countdown' : 'stopwatch'; setTimerMode(mode); localStorage.setItem('scenemd-presenter-timer-mode', mode) }}>{timerMode === 'stopwatch' ? 'Stopwatch' : 'Countdown'}</button>{timerMode === 'countdown' && <label><input type="number" min="1" max="360" value={durationMinutes} onChange={(event) => { const value = Math.min(360, Math.max(1, Number(event.target.value) || 1)); setDurationMinutes(value); localStorage.setItem('scenemd-presenter-duration', String(value)) }} /> min</label>}</div>
        <div className="presenter-timer-row"><button className="presenter-timer" onClick={toggleTimer}>{clock(timerValue)}</button><button onClick={() => { elapsedBaseRef.current = 0; startedAtRef.current = Date.now(); setElapsed(0); setRunning(true) }} aria-label="Reset timer"><RotateCcw size={16} /></button></div>
        <div className="presenter-counter">{sceneIndex + 1} / {scenes.length}</div>
        <div className="presenter-actions"><button onClick={onPrevious} disabled={sceneIndex === 0}><ArrowLeft size={17} /> Previous</button><button onClick={onNext} disabled={sceneIndex >= scenes.length - 1}>Next <ArrowRight size={17} /></button></div>
        <button className="presenter-audience" onClick={() => target.opener?.focus()}><ExternalLink size={15} /> Audience window</button>
        <div className="presenter-hints"><span>← → navigate</span><span>B black</span><span>R reset timer</span></div>
      </section>
    </div>
  </main>, target.document.body)
}
