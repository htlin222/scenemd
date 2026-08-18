import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { ScenePlan, SemanticRegion, ThemeMode } from '../engine/types'

/**
 * Presentation runtime: fullscreen presenting, step reveals, black/white
 * screens, zoom, the shortcut hint, chapter navigation, and the presenter
 * window. Extracted verbatim from App.tsx (#13).
 *
 * The scene index and the presenting flag stay with the caller: editor↔scene
 * sync and the transcript tools need the index outside presentation mode, and
 * the measurement hook needs `presenting` before this hook can run (it owns
 * the plan this hook consumes). Both arrive as state-setter pairs.
 */
export function usePresentationRuntime(
  presenting: boolean,
  setPresenting: Dispatch<SetStateAction<boolean>>,
  plan: ScenePlan,
  regions: SemanticRegion[],
  stepCount: number,
  sceneIndex: number,
  setSceneIndex: Dispatch<SetStateAction<number>>,
  scrollEditorToScene: (index: number) => void,
  documentTitle: string,
  theme: ThemeMode,
  routeKind: 'home' | 'document' | 'share',
) {
  const [revealIndex, setRevealIndex] = useState(0)
  const [blank, setBlank] = useState<'black' | 'white' | null>(null)
  const [presentationZoom, setPresentationZoom] = useState(1)
  const [showShortcutHint, setShowShortcutHint] = useState(false)
  const [presenterWindow, setPresenterWindow] = useState<Window | null>(null)

  const navigateToLabel = useCallback((label: string) => {
    const region = regions.find((candidate) => candidate.blocks[0]?.type === 'heading' && candidate.blocks[0].depth === 1 && candidate.headingPath[0] === label)
    const targetIndex = region ? plan.scenes.findIndex((scene) => scene.regionId === region.id) : -1
    if (targetIndex >= 0) { setSceneIndex(targetIndex); setRevealIndex(0); scrollEditorToScene(targetIndex) }
  }, [plan.scenes, regions, scrollEditorToScene, setSceneIndex])

  const goNext = useCallback(() => {
    setBlank(null)
    if (revealIndex < stepCount) setRevealIndex((value) => value + 1)
    else {
      const targetIndex = Math.min(sceneIndex + 1, plan.scenes.length - 1)
      setSceneIndex(targetIndex)
      setRevealIndex(0)
      scrollEditorToScene(targetIndex)
    }
  }, [plan.scenes.length, revealIndex, sceneIndex, scrollEditorToScene, setSceneIndex, stepCount])

  const goPrevious = useCallback(() => {
    setBlank(null)
    if (revealIndex > 0) setRevealIndex((value) => value - 1)
    else {
      const targetIndex = Math.max(0, sceneIndex - 1)
      setSceneIndex(targetIndex)
      setRevealIndex(0)
      scrollEditorToScene(targetIndex)
    }
  }, [revealIndex, sceneIndex, scrollEditorToScene, setSceneIndex])

  const closePresenterWindow = useCallback(() => setPresenterWindow(null), [])

  const openPresenterWindow = useCallback(() => {
    if (presenterWindow && !presenterWindow.closed) { presenterWindow.focus(); return }
    const popup = window.open('', 'scenemd-presenter', 'popup=yes,width=1280,height=820')
    if (!popup) return
    popup.document.title = `${documentTitle} — Presenter`
    popup.document.documentElement.dataset.theme = theme
    document.querySelectorAll('style,link[rel="stylesheet"]').forEach((node) => popup.document.head.appendChild(node.cloneNode(true)))
    popup.document.body.innerHTML = ''
    popup.document.body.className = 'presenter-window-body'
    setPresenterWindow(popup)
  }, [documentTitle, presenterWindow, theme])

  useEffect(() => {
    if (!presenterWindow || presenterWindow.closed) return
    presenterWindow.document.documentElement.dataset.theme = theme
  }, [presenterWindow, theme])

  const exitPresentation = useCallback(() => {
    setPresenting(false)
    setBlank(null)
    if (document.fullscreenElement) void document.exitFullscreen()
  }, [setPresenting])

  useEffect(() => {
    if (!presenting) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'ArrowDown') { event.preventDefault(); goNext() }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); goPrevious() }
      else if (event.key.toLowerCase() === 'b') setBlank((value) => value === 'black' ? null : 'black')
      else if (event.key.toLowerCase() === 'w') setBlank((value) => value === 'white' ? null : 'white')
      else if (event.key.toLowerCase() === 's') openPresenterWindow()
      else if (event.key === '+' || event.key === '=') setPresentationZoom((value) => Math.min(1.5, Number((value + 0.1).toFixed(2))))
      else if (event.key === '-') setPresentationZoom((value) => Math.max(0.75, Number((value - 0.1).toFixed(2))))
      else if (event.key === '0') setPresentationZoom(1)
      else if (event.key === 'Escape') exitPresentation()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [presenting, goNext, goPrevious, exitPresentation, openPresenterWindow])

  useEffect(() => {
    if (!presenting) { setShowShortcutHint(false); return }
    let hideTimer = 0
    const showHint = () => {
      setShowShortcutHint(true)
      window.clearTimeout(hideTimer)
      hideTimer = window.setTimeout(() => setShowShortcutHint(false), 1400)
    }
    showHint()
    window.addEventListener('mousemove', showHint, { passive: true })
    return () => { window.clearTimeout(hideTimer); window.removeEventListener('mousemove', showHint) }
  }, [presenting])

  const startPresentation = useCallback(() => {
    setPresenting(true)
    setRevealIndex(0)
    document.documentElement.requestFullscreen?.().catch(() => undefined)
  }, [setPresenting])

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !presenting && routeKind !== 'home') {
        event.preventDefault()
        startPresentation()
      }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [presenting, routeKind, startPresentation])

  return {
    revealIndex, setRevealIndex,
    blank, setBlank,
    presentationZoom, setPresentationZoom,
    showShortcutHint,
    presenterWindow,
    navigateToLabel, goNext, goPrevious,
    openPresenterWindow, closePresenterWindow,
    startPresentation, exitPresentation,
  }
}
