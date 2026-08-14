import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bug,
  Check,
  Clock3,
  Copy,
  Download,
  Ellipsis,
  Expand,
  FileText,
  Files,
  Focus,
  GripVertical,
  Link2,
  LoaderCircle,
  MessageCircleQuestionMark,
  Mic2,
  Moon,
  PanelRight,
  Palette,
  Play,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Share2,
  SquareLibrary,
  Sun,
  Sparkles,
  Unlink,
  X,
} from 'lucide-react'
import { buildCitationReferenceMap, SceneView, BlockView, sceneSpeakerNotes } from './components/SceneView'
import { MarkdownDocumentView, MarkdownEditor, type EditorMode } from './components/MarkdownEditor'
import { PresentationSettingsDialog } from './components/PresentationSettingsDialog'
import { HackMDSyncDialog } from './components/HackMDSyncDialog'
import { BibliographyDialog } from './components/BibliographyDialog'
import { ExportDialog } from './components/ExportDialog'
import { PresenterWindow } from './components/PresenterWindow'
import { PresentationRuntimeTools } from './components/PresentationRuntimeTools'
import { buildSemanticRegions, parsePresentationDocument } from './engine/semantics'
import { planScenes, withPresentationCover } from './engine/planner'
import type { Density, PresentationConfig, ScenePlan, ThemeMode } from './engine/types'
import { defaultPresentationConfig, normalizePresentationConfig } from './presentationConfig'
import { downloadBlob, exportFileName } from './export'
import { DEMO_MARKDOWN } from './app/constants'
import { Cheatsheet } from './app/CheatsheetDialog'
import { LlmPromptDialog } from './app/LlmPromptDialog'
import {
  EMPTY_PLAN, CURRENT_DEPLOY_TIME, DEPLOY_CHECK_INTERVAL_MS,
  type Route, type SaveStatus, type HeaderActionSpec, type DocumentSummary, type DocumentPayload,
  type SaveConflictState, type ConflictBackup, type DeployVersion,
  directHeaderActionCount, stashConflictBackup, readConflictBackup, clearConflictBackup, conflictExcerpts,
  getInitialTheme, parseRoute, titleFromMarkdown, absoluteSceneImageUrls, formatUpdated, formatDeployTime,
  previewViewport, blockRevealSteps, updateSceneSpeakerNote, sceneTranscriptText,
} from './app/shared'
function App() {
  const [route, setRoute] = useState<Route>(parseRoute)
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [markdown, setMarkdown] = useState('')
  const [documentTitle, setDocumentTitle] = useState('Untitled document')
  const [documentRevision, setDocumentRevision] = useState(0)
  const [presentationConfig, setPresentationConfig] = useState<PresentationConfig>(() => defaultPresentationConfig('Untitled document'))
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [saveConflict, setSaveConflict] = useState<SaveConflictState | null>(null)
  const [conflictBackup, setConflictBackup] = useState<ConflictBackup | null>(null)
  const [newerDeployTime, setNewerDeployTime] = useState<string | null>(null)
  const [refreshingDeploy, setRefreshingDeploy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [shareLink, setShareLink] = useState<string | null>(null)
  const [shareBusy, setShareBusy] = useState(false)
  const [density, setDensity] = useState<Density>('balanced')
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme)
  const [debug, setDebug] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [previewWidth, setPreviewWidth] = useState(() => Math.min(720, Math.max(500, window.innerWidth * 0.46)))
  const [resizingPreview, setResizingPreview] = useState(false)
  const [editorMode, setEditorMode] = useState<EditorMode>('write')
  const [showCheatsheet, setShowCheatsheet] = useState(false)
  const [showLlmPrompt, setShowLlmPrompt] = useState(false)
  const [showBibliography, setShowBibliography] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showPresentationSettings, setShowPresentationSettings] = useState(false)
  const [showHackMDSync, setShowHackMDSync] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [rowBusyId, setRowBusyId] = useState<string | null>(null)
  const [hackMDSyncing, setHackMDSyncing] = useState(false)
  const [directHeaderCount, setDirectHeaderCount] = useState(() => directHeaderActionCount(window.innerWidth))
  const [headerOverflowOpen, setHeaderOverflowOpen] = useState(false)
  const [presenting, setPresenting] = useState(false)
  const [presenterWindow, setPresenterWindow] = useState<Window | null>(null)
  const [notesHeight, setNotesHeight] = useState(() => {
    const saved = Number(localStorage.getItem('scenemd-preview-notes-height'))
    return Number.isFinite(saved) && saved >= 90 && saved <= 320 ? saved : 150
  })
  const [noteDraft, setNoteDraft] = useState('')
  const [transcriptMode, setTranscriptMode] = useState<'verbatim' | 'tldr'>('verbatim')
  const [transcriptBusy, setTranscriptBusy] = useState(false)
  const [transcriptError, setTranscriptError] = useState<string | null>(null)
  const [showShortcutHint, setShowShortcutHint] = useState(false)
  const [sceneIndex, setSceneIndex] = useState(0)
  const [editorCursorLine, setEditorCursorLine] = useState(1)
  const [editorScrollRequest, setEditorScrollRequest] = useState<{ line: number; key: number } | null>(null)
  const [sceneSyncEnabled, setSceneSyncEnabled] = useState(() => localStorage.getItem('scenemd-scene-sync') !== 'false')
  const [revealIndex, setRevealIndex] = useState(0)
  const [blank, setBlank] = useState<'black' | 'white' | null>(null)
  const [presentationZoom, setPresentationZoom] = useState(1)
  const [viewport, setViewport] = useState({ width: 960, height: 540 })
  const [measurements, setMeasurements] = useState<Map<string, number>>(new Map())
  const [measuring, setMeasuring] = useState(true)
  const previewRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const previousPlanRef = useRef<ScenePlan>(EMPTY_PLAN)
  const lastSavedMarkdownRef = useRef('')
  const lastSavedPresentationConfigRef = useRef(JSON.stringify(defaultPresentationConfig('Untitled document')))
  const liveMarkdownRef = useRef(markdown)
  const livePresentationConfigRef = useRef(presentationConfig)
  const resizingPreviewRef = useRef(false)
  const headerOverflowRef = useRef<HTMLDivElement>(null)
  liveMarkdownRef.current = markdown
  livePresentationConfigRef.current = presentationConfig

  const blocks = useMemo(() => parsePresentationDocument(markdown), [markdown])
  const regions = useMemo(() => buildSemanticRegions(blocks), [blocks])
  const plan = useMemo(
    () => withPresentationCover(
      planScenes(regions, measurements, presenting ? window.innerHeight : viewport.height, density, previousPlanRef.current),
      presentationConfig,
    ),
    [regions, measurements, viewport.height, density, presenting, presentationConfig],
  )
  const activeDocumentId = route.kind === 'document' ? route.id : 'readonly'
  const citationReferences = useMemo(() => buildCitationReferenceMap(plan.scenes), [plan.scenes])

  useEffect(() => {
    localStorage.setItem('scenemd-scene-sync', String(sceneSyncEnabled))
  }, [sceneSyncEnabled])

  useEffect(() => {
    let cancelled = false

    const checkForNewDeploy = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const url = new URL('/version.json', window.location.origin)
        url.searchParams.set('t', String(Date.now()))
        const response = await fetch(url, { cache: 'no-store' })
        if (!response.ok) return
        const version = await response.json() as DeployVersion
        const remoteDeployTime = Date.parse(version.deployedAt ?? '')
        if (!cancelled && Number.isFinite(remoteDeployTime) && remoteDeployTime > CURRENT_DEPLOY_TIME) {
          setNewerDeployTime(version.deployedAt ?? null)
        }
      } catch {
        // Version checks are deliberately silent while offline.
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkForNewDeploy()
    }
    const interval = window.setInterval(() => void checkForNewDeploy(), DEPLOY_CHECK_INTERVAL_MS)
    window.addEventListener('focus', checkForNewDeploy)
    window.addEventListener('online', checkForNewDeploy)
    document.addEventListener('visibilitychange', onVisibilityChange)
    void checkForNewDeploy()

    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', checkForNewDeploy)
      window.removeEventListener('online', checkForNewDeploy)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  const forceRefreshForDeploy = useCallback(async () => {
    if (refreshingDeploy) return
    setRefreshingDeploy(true)
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration()
        await registration?.update()
        const worker = registration?.installing ?? registration?.waiting
        if (worker && worker.state !== 'activated' && worker.state !== 'redundant') {
          await new Promise<void>((resolve) => {
            const timeout = window.setTimeout(resolve, 4000)
            worker.addEventListener('statechange', () => {
              if (worker.state === 'activated' || worker.state === 'redundant') {
                window.clearTimeout(timeout)
                resolve()
              }
            })
          })
        }
      }
    } catch {
      // A normal reload is still useful if the service worker update check fails.
    }
    window.location.reload()
  }, [refreshingDeploy])

  useEffect(() => {
    if (!sceneSyncEnabled || !showPreview || presenting) return
    const targetIndex = plan.scenes.findIndex((scene) => scene.role !== 'cover'
      && editorCursorLine >= scene.sourceRange.startLine
      && editorCursorLine <= scene.sourceRange.endLine)
    if (targetIndex >= 0) {
      setSceneIndex((current) => current === targetIndex ? current : targetIndex)
      setRevealIndex(0)
    }
  }, [editorCursorLine, plan.scenes, presenting, sceneSyncEnabled, showPreview])

  const scrollEditorToScene = useCallback((index: number) => {
    if (!sceneSyncEnabled || !showPreview || presenting) return
    const line = plan.scenes[index]?.sourceRange.startLine ?? 0
    if (line <= 0) return
    setEditorScrollRequest((current) => ({ line, key: (current?.key ?? 0) + 1 }))
  }, [plan.scenes, presenting, sceneSyncEnabled, showPreview])
  const filteredDocuments = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase()
    return query ? documents.filter((document) => document.title.toLocaleLowerCase().includes(query)) : documents
  }, [documents, searchQuery])

  const navigate = useCallback((path: string) => {
    window.history.pushState({}, '', path)
    setRoute(parseRoute(path))
    setApiError(null)
    setShowPreview(false)
    setSceneIndex(0)
  }, [])

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    let frame = 0
    const update = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => setDirectHeaderCount(directHeaderActionCount(window.innerWidth)))
    }
    window.addEventListener('resize', update, { passive: true })
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
    }
  }, [])

  useEffect(() => {
    setHeaderOverflowOpen(false)
  }, [directHeaderCount, route.kind])

  useEffect(() => {
    if (!headerOverflowOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!headerOverflowRef.current?.contains(event.target as Node)) setHeaderOverflowOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHeaderOverflowOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [headerOverflowOpen])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1e1f21' : '#ffffff')
    localStorage.setItem('scenemd-theme', theme)
  }, [theme])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setApiError(null)
    setShareLink(null)

    const load = async () => {
      try {
        if (route.kind === 'home') {
          const response = await fetch('/api/documents', { signal: controller.signal })
          const result = await response.json() as { documents?: DocumentSummary[]; error?: string }
          if (!response.ok) throw new Error(result.error || 'Could not load documents')
          setDocuments(result.documents ?? [])
          setMarkdown('')
          setPresentationConfig(defaultPresentationConfig('Untitled document'))
        } else {
          const response = await fetch(route.kind === 'document' ? `/api/documents/${route.id}` : `/api/share/${route.token}`, { signal: controller.signal })
          const result = await response.json() as DocumentPayload & { error?: string }
          if (!response.ok) throw new Error(result.error || 'Could not load document')
          const loadedMarkdown = absoluteSceneImageUrls(result.markdown)
          setMarkdown(loadedMarkdown)
          setDocumentTitle(result.title)
          setDocumentRevision(result.revision)
          const config = normalizePresentationConfig(result.presentationConfig, result.title)
          setPresentationConfig(config)
          lastSavedPresentationConfigRef.current = JSON.stringify(config)
          lastSavedMarkdownRef.current = result.markdown
          setSaveStatus('saved')
          if (route.kind === 'document') {
            const backup = readConflictBackup(route.id)
            if (backup && backup.markdown !== loadedMarkdown) setConflictBackup(backup)
            else if (backup) clearConflictBackup(route.id)
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) setApiError(error instanceof Error ? error.message : 'Something went wrong')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [route])

  useEffect(() => {
    const serializedConfig = JSON.stringify(presentationConfig)
    if (route.kind !== 'document' || loading || saveConflict || (markdown === lastSavedMarkdownRef.current && serializedConfig === lastSavedPresentationConfigRef.current)) return
    const snapshot = markdown
    const snapshotConfig = presentationConfig
    const snapshotTitle = titleFromMarkdown(snapshot, documentTitle)
    const baseRevision = documentRevision
    const baseMarkdown = lastSavedMarkdownRef.current
    const timer = window.setTimeout(async () => {
      setSaveStatus('saving')
      try {
        const response = await fetch(`/api/documents/${route.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown: snapshot, baseMarkdown, title: snapshotTitle, presentationConfig: snapshotConfig, baseRevision }),
        })
        const result = await response.json() as DocumentPayload & { error?: string; document?: DocumentPayload; merged?: boolean }
        if (response.status === 409) {
          if (result.document) {
            const localMarkdown = liveMarkdownRef.current
            stashConflictBackup(route.id, localMarkdown)
            setSaveConflict({
              remote: result.document,
              localMarkdown,
              localTitle: titleFromMarkdown(localMarkdown, documentTitle),
              localConfig: livePresentationConfigRef.current,
            })
          }
          setSaveStatus('conflict')
          return
        }
        if (!response.ok) throw new Error(result.error || 'Save failed')
        const savedMarkdown = absoluteSceneImageUrls(result.markdown)
        const savedConfig = normalizePresentationConfig(result.presentationConfig, result.title)
        lastSavedMarkdownRef.current = savedMarkdown
        lastSavedPresentationConfigRef.current = JSON.stringify(savedConfig)
        if (savedMarkdown !== snapshot) setMarkdown((current) => current === snapshot ? savedMarkdown : current)
        if (JSON.stringify(savedConfig) !== serializedConfig) setPresentationConfig((current) => current === snapshotConfig ? savedConfig : current)
        setDocumentRevision(result.revision)
        setDocumentTitle(result.title)
        setSaveConflict(null)
        setSaveStatus('saved')
      } catch {
        setSaveStatus('offline')
      }
    }, 650)
    return () => window.clearTimeout(timer)
  }, [markdown, presentationConfig, documentRevision, documentTitle, loading, route, saveConflict])

  useEffect(() => {
    const previousPlan = previousPlanRef.current
    setSceneIndex((current) => {
      const previousScene = previousPlan.scenes[current]
      if (!previousScene) return Math.min(current, Math.max(0, plan.scenes.length - 1))

      if (previousScene.role === 'cover') {
        const coverIndex = plan.scenes.findIndex((scene) => scene.role === 'cover')
        return coverIndex >= 0 ? coverIndex : 0
      }

      const previousBlockIds = new Set(previousScene.blocks.map((block) => block.id))
      const matchingBlockIndex = plan.scenes.findIndex((scene) => scene.blocks.some((block) => previousBlockIds.has(block.id)))
      if (matchingBlockIndex >= 0) return matchingBlockIndex

      const matchingRegionIndex = plan.scenes.findIndex((scene) => scene.regionId === previousScene.regionId && scene.role === previousScene.role)
      if (matchingRegionIndex >= 0) return matchingRegionIndex

      return Math.min(current, Math.max(0, plan.scenes.length - 1))
    })
    previousPlanRef.current = plan
  }, [plan])

  useLayoutEffect(() => {
    if (!previewRef.current) return
    const observer = new ResizeObserver(([entry]) => {
      if (resizingPreviewRef.current) return
      const { width } = entry.contentRect
      const next = previewViewport(width)
      setViewport((current) => Math.abs(current.width - next.width) < 1 && Math.abs(current.height - next.height) < 1 ? current : next)
    })
    observer.observe(previewRef.current)
    return () => observer.disconnect()
  }, [showPreview])

  const beginPreviewResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = previewWidth
    resizingPreviewRef.current = true
    setResizingPreview(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    const onMove = (moveEvent: PointerEvent) => {
      const maximum = Math.max(420, window.innerWidth - 390)
      setPreviewWidth(Math.max(420, Math.min(maximum, startWidth + startX - moveEvent.clientX)))
    }
    const onEnd = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      resizingPreviewRef.current = false
      setResizingPreview(false)
      window.requestAnimationFrame(() => {
        const width = previewRef.current?.getBoundingClientRect().width
        if (!width) return
        setViewport(previewViewport(width))
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd, { once: true })
  }

  useLayoutEffect(() => {
    if (!measureRef.current) return
    setMeasuring(true)
    const frame = window.requestAnimationFrame(() => {
      const next = new Map<string, number>()
      measureRef.current?.querySelectorAll<HTMLElement>('[data-measure-id], [data-measure-item-id]').forEach((element) => {
        const id = element.dataset.measureId ?? element.dataset.measureItemId
        if (id) next.set(id, element.getBoundingClientRect().height)
      })
      setMeasurements(next)
      setMeasuring(false)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [blocks, viewport.width, density, theme])

  const currentScene = plan.scenes[sceneIndex]
  const currentSpeakerNotes = useMemo(() => sceneSpeakerNotes(currentScene), [currentScene])
  const currentSpeakerNoteText = currentSpeakerNotes.join('\n\n')
  const stepCount = currentScene?.blocks.reduce((total, block) => total + blockRevealSteps(block), 0) ?? 0
  const navigationLabels = useMemo(() => [...new Set(regions
    .filter((region) => region.blocks[0]?.type === 'heading' && region.blocks[0].depth === 1)
    .map((region) => region.headingPath[0])
    .filter((label): label is string => Boolean(label)))], [regions])
  const activeNavigationLabel = regions.find((region) => region.id === currentScene?.regionId)?.headingPath[0]
  const sceneNavigationLabels = useMemo(() => plan.scenes.map((scene) => regions.find((region) => region.id === scene.regionId)?.headingPath[0]), [plan.scenes, regions])

  useEffect(() => {
    setNoteDraft(currentSpeakerNoteText)
    setTranscriptError(null)
  }, [currentScene?.id, currentSpeakerNoteText])

  const changeSpeakerNote = useCallback((value: string) => {
    setNoteDraft(value)
    setMarkdown((source) => updateSceneSpeakerNote(source, currentScene, value))
  }, [currentScene])

  const generateTranscript = useCallback(async () => {
    if (!currentScene || currentScene.role === 'cover' || transcriptBusy) return
    setTranscriptBusy(true)
    setTranscriptError(null)
    try {
      const response = await fetch('/api/ai/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: activeDocumentId,
          mode: transcriptMode,
          previous: sceneTranscriptText(plan.scenes[sceneIndex - 1]),
          current: sceneTranscriptText(currentScene),
          next: sceneTranscriptText(plan.scenes[sceneIndex + 1]),
        }),
      })
      const result = await response.json() as { note?: string; error?: string }
      if (!response.ok || !result.note) throw new Error(result.error || '無法生成逐字稿')
      changeSpeakerNote(result.note)
    } catch (error) {
      setTranscriptError(error instanceof Error ? error.message : '無法生成逐字稿')
    } finally {
      setTranscriptBusy(false)
    }
  }, [activeDocumentId, changeSpeakerNote, currentScene, plan.scenes, sceneIndex, transcriptBusy, transcriptMode])

  const navigateToLabel = useCallback((label: string) => {
    const region = regions.find((candidate) => candidate.blocks[0]?.type === 'heading' && candidate.blocks[0].depth === 1 && candidate.headingPath[0] === label)
    const targetIndex = region ? plan.scenes.findIndex((scene) => scene.regionId === region.id) : -1
    if (targetIndex >= 0) { setSceneIndex(targetIndex); setRevealIndex(0); scrollEditorToScene(targetIndex) }
  }, [plan.scenes, regions, scrollEditorToScene])

  const goNext = useCallback(() => {
    setBlank(null)
    if (revealIndex < stepCount) setRevealIndex((value) => value + 1)
    else {
      const targetIndex = Math.min(sceneIndex + 1, plan.scenes.length - 1)
      setSceneIndex(targetIndex)
      setRevealIndex(0)
      scrollEditorToScene(targetIndex)
    }
  }, [plan.scenes.length, revealIndex, sceneIndex, scrollEditorToScene, stepCount])

  const goPrevious = useCallback(() => {
    setBlank(null)
    if (revealIndex > 0) setRevealIndex((value) => value - 1)
    else {
      const targetIndex = Math.max(0, sceneIndex - 1)
      setSceneIndex(targetIndex)
      setRevealIndex(0)
      scrollEditorToScene(targetIndex)
    }
  }, [revealIndex, sceneIndex, scrollEditorToScene])

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

  const beginNotesResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = notesHeight
    let height = startHeight
    const resizeTo = (clientY: number) => {
      // The notes panel sits below the handle: moving the handle upward grows it.
      height = Math.min(320, Math.max(90, startHeight + startY - clientY))
      setNotesHeight(height)
    }
    const cleanup = () => {
      document.body.classList.remove('is-resizing-notes')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onCancel)
    }
    const onMove = (moveEvent: PointerEvent) => resizeTo(moveEvent.clientY)
    const onEnd = (endEvent: PointerEvent) => {
      resizeTo(endEvent.clientY)
      localStorage.setItem('scenemd-preview-notes-height', String(Math.round(height)))
      cleanup()
    }
    const onCancel = () => cleanup()
    document.body.classList.add('is-resizing-notes')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onCancel)
  }

  const exitPresentation = useCallback(() => {
    setPresenting(false)
    setBlank(null)
    if (document.fullscreenElement) void document.exitFullscreen()
  }, [])

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

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !presenting && route.kind !== 'home') {
        event.preventDefault()
        setPresenting(true)
        setRevealIndex(0)
        document.documentElement.requestFullscreen?.().catch(() => undefined)
      }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [presenting, route.kind])

  const startPresentation = () => {
    setPresenting(true)
    setRevealIndex(0)
    document.documentElement.requestFullscreen?.().catch(() => undefined)
  }

  const togglePreview = () => {
    if (showPreview) {
      setShowPreview(false)
      return
    }
    const expectedWidth = Math.max(320, (window.innerWidth <= 900 ? window.innerWidth : previewWidth) - (window.innerWidth <= 900 ? 36 : 48))
    setViewport(previewViewport(expectedWidth))
    setShowPreview(true)
  }

  const renameDocument = async (documentId: string) => {
    const title = renameDraft.trim()
    const previous = documents.find((entry) => entry.id === documentId)
    setRenamingId(null)
    if (!title || title === previous?.title) return
    setRowBusyId(documentId)
    setApiError(null)
    try {
      // rename: true also rewrites the document's leading H1, because the
      // title follows the H1 and would otherwise revert on the next autosave.
      const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, rename: true }),
      })
      const result = await response.json() as DocumentPayload & { error?: string }
      if (!response.ok) throw new Error(result.error || 'Could not rename document')
      setDocuments((current) => current.map((entry) => entry.id === documentId ? { ...entry, title: result.title, revision: result.revision, updatedAt: result.updatedAt ?? entry.updatedAt } : entry))
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Could not rename document')
    } finally {
      setRowBusyId(null)
    }
  }

  const deleteDocument = async (documentId: string) => {
    setConfirmingDeleteId(null)
    setRowBusyId(documentId)
    setApiError(null)
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' })
      if (!response.ok && response.status !== 404) {
        const result = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(result.error || 'Could not delete document')
      }
      setDocuments((current) => current.filter((entry) => entry.id !== documentId))
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Could not delete document')
    } finally {
      setRowBusyId(null)
    }
  }

  const createDocument = async () => {
    setCreating(true)
    setApiError(null)
    try {
      const response = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled document', markdown: '# Introduction\n\nStart writing here.\n', presentationConfig: defaultPresentationConfig('Untitled presentation') }),
      })
      const result = await response.json() as DocumentPayload & { error?: string }
      if (!response.ok) throw new Error(result.error || 'Could not create document')
      navigate(`/document/${result.id}`)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Could not create document')
    } finally {
      setCreating(false)
    }
  }

  const createShareLink = async () => {
    if (route.kind !== 'document') return
    setShareBusy(true)
    try {
      const response = await fetch(`/api/documents/${route.id}/share`, { method: 'POST' })
      const result = await response.json() as { sharePath?: string; error?: string }
      if (!response.ok || !result.sharePath) throw new Error(result.error || 'Could not create share link')
      const link = new URL(result.sharePath, window.location.origin).toString()
      setShareLink(link)
      await navigator.clipboard.writeText(link).catch(() => undefined)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Could not create share link')
    } finally {
      setShareBusy(false)
    }
  }

  const useCloudConflictVersion = () => {
    if (!saveConflict) return
    const remote = saveConflict.remote
    const remoteMarkdown = absoluteSceneImageUrls(remote.markdown)
    const remoteConfig = normalizePresentationConfig(remote.presentationConfig, remote.title)
    lastSavedMarkdownRef.current = remoteMarkdown
    lastSavedPresentationConfigRef.current = JSON.stringify(remoteConfig)
    setMarkdown(remoteMarkdown)
    setDocumentTitle(remote.title)
    setDocumentRevision(remote.revision)
    setPresentationConfig(remoteConfig)
    setSaveConflict(null)
    setSaveStatus('saved')
  }

  const keepLocalConflictVersion = async () => {
    if (!saveConflict || route.kind !== 'document') return
    const conflict = saveConflict
    setSaveStatus('saving')
    try {
      const response = await fetch(`/api/documents/${route.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markdown: conflict.localMarkdown,
          baseMarkdown: conflict.remote.markdown,
          title: conflict.localTitle,
          presentationConfig: conflict.localConfig,
          baseRevision: conflict.remote.revision,
        }),
      })
      const result = await response.json() as DocumentPayload & { error?: string }
      if (response.status === 409) {
        const remote = (result as DocumentPayload & { document?: DocumentPayload }).document
        stashConflictBackup(route.id, conflict.localMarkdown)
        if (remote) setSaveConflict((current) => current ? { ...current, remote } : current)
        setSaveStatus('conflict')
        return
      }
      if (!response.ok) throw new Error(result.error || 'Could not save your version')
      clearConflictBackup(route.id)
      const savedMarkdown = absoluteSceneImageUrls(result.markdown)
      const savedConfig = normalizePresentationConfig(result.presentationConfig, result.title)
      lastSavedMarkdownRef.current = savedMarkdown
      lastSavedPresentationConfigRef.current = JSON.stringify(savedConfig)
      setMarkdown(savedMarkdown)
      setDocumentTitle(result.title)
      setDocumentRevision(result.revision)
      setPresentationConfig(savedConfig)
      setSaveConflict(null)
      setSaveStatus('saved')
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Could not resolve save conflict')
      setSaveStatus('conflict')
    }
  }

  const renderThemeButton = (inOverflow = false) => (
    <button className={inOverflow ? 'header-overflow-item' : 'icon-button'} onClick={() => { setTheme((value) => value === 'light' ? 'dark' : 'light'); if (inOverflow) setHeaderOverflowOpen(false) }} title={`Use ${theme === 'light' ? 'dark' : 'light'} mode`} aria-label={`Use ${theme === 'light' ? 'dark' : 'light'} mode`}>
      {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
      {inOverflow && <span>{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>}
    </button>
  )

  const saveLabel = saveStatus === 'saving' ? 'Saving…' : saveStatus === 'conflict' ? 'Edit conflict' : saveStatus === 'offline' ? 'Save failed' : 'Saved'
  const isReadOnlyShare = route.kind === 'share'
  const documentHeaderActions: HeaderActionSpec[] = isReadOnlyShare ? [] : [
    { id: 'design', label: 'Design', ariaLabel: 'Open presentation design settings', icon: <Palette size={16} />, onClick: () => setShowPresentationSettings(true) },
    { id: 'hackmd', label: 'HackMD', ariaLabel: 'Sync document with HackMD', icon: <RefreshCw className={`sync-rotation-icon${hackMDSyncing ? ' is-spinning' : ''}`} size={16} />, onClick: () => setShowHackMDSync(true), busy: hackMDSyncing },
    { id: 'prompt', label: 'LLM Prompt', ariaLabel: 'Open reusable SceneMD LLM prompt', icon: <MessageCircleQuestionMark size={16} />, onClick: () => setShowLlmPrompt(true) },
    { id: 'library', label: 'Library', ariaLabel: 'Open generated BibTeX bibliography', icon: <SquareLibrary size={16} />, onClick: () => setShowBibliography(true) },
    { id: 'export', label: 'Export', ariaLabel: 'Export document', icon: <Download size={16} />, onClick: () => setShowExport(true) },
    { id: 'cheatsheet', label: 'Cheat sheet', ariaLabel: 'Open Markdown and presentation cheat sheet', icon: <BookOpen size={16} />, onClick: () => setShowCheatsheet(true) },
    { id: 'share', label: shareBusy ? 'Sharing…' : 'Share', ariaLabel: 'Create read-only share link', icon: <Share2 size={16} />, onClick: () => { void createShareLink() }, disabled: shareBusy },
  ]
  const headerActionPriority = ['design', 'export', 'hackmd', 'library', 'prompt', 'cheatsheet', 'share']
  const directActionIds = new Set(headerActionPriority.slice(0, directHeaderCount))
  const directHeaderActions = documentHeaderActions.filter((action) => directActionIds.has(action.id))
  const overflowHeaderActions = documentHeaderActions.filter((action) => !directActionIds.has(action.id))
  const themeInOverflow = directHeaderCount === 0 && !isReadOnlyShare
  const hasHeaderOverflow = !isReadOnlyShare && (themeInOverflow || overflowHeaderActions.length > 0)
  const renderDocumentHeaderAction = (action: HeaderActionSpec, inOverflow = false) => (
    <button
      key={action.id}
      className={inOverflow ? 'header-overflow-item' : 'cheatsheet-button'}
      onClick={() => { action.onClick(); if (inOverflow) setHeaderOverflowOpen(false) }}
      disabled={action.disabled}
      aria-label={action.ariaLabel}
      aria-busy={action.busy}
    >{action.icon}<span>{action.label}</span></button>
  )

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand brand-button" onClick={() => navigate('/')} aria-label="SceneMD home">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>Scene<span>MD</span></span>
        </button>
        {route.kind === 'home' ? <div className="document-breadcrumb"><Files size={14} /><span>Documents</span><small>{documents.length} files</small></div> : <div className="document-breadcrumb"><FileText size={14} /><span>{documentTitle}</span><small>{isReadOnlyShare ? 'Read only' : saveLabel}</small></div>}
        <nav className="header-actions" aria-label="Document actions">
          {(!themeInOverflow || route.kind === 'home' || isReadOnlyShare) && renderThemeButton()}
          {route.kind === 'home' ? <button className="present-button" onClick={() => void createDocument()} disabled={creating}><Plus size={16} /> {creating ? 'Creating…' : 'New document'}</button> : <>
            {directHeaderActions.map((action) => renderDocumentHeaderAction(action))}
            {hasHeaderOverflow && <div className="header-overflow" ref={headerOverflowRef}>
              <button className={`header-overflow-trigger${headerOverflowOpen ? ' is-active' : ''}`} onClick={() => setHeaderOverflowOpen((open) => !open)} aria-label="More document actions" aria-expanded={headerOverflowOpen} aria-haspopup="menu"><Ellipsis size={18} /></button>
              {headerOverflowOpen && <div className="header-overflow-menu" role="menu">
                {themeInOverflow && renderThemeButton(true)}
                {overflowHeaderActions.map((action) => renderDocumentHeaderAction(action, true))}
              </div>}
            </div>}
            {!isReadOnlyShare && <button className={`preview-button ${showPreview ? 'is-active' : ''}`} onClick={togglePreview} aria-label={showPreview ? 'Close presentation preview' : 'Open presentation preview'}><PanelRight size={16} /> Scenes</button>}
            <button className="present-button" onClick={startPresentation}><Play size={15} fill="currentColor" /> Present</button>
          </>}
        </nav>
      </header>

      {route.kind === 'home' ? (
        <main className="documents-home">
          <section className="documents-hero">
            <span>Document-first presentations</span>
            <h1>Your documents</h1>
            <p>Write once in Markdown. SceneMD composes the presentation when you need it.</p>
            <button onClick={() => void createDocument()} disabled={creating}><Plus size={18} /> {creating ? 'Creating document…' : 'New document'}</button>
          </section>
          <section className="documents-library" aria-labelledby="documents-title">
            <div className="library-heading"><div><h2 id="documents-title">Files</h2><span>{filteredDocuments.length} documents</span></div><label className="document-search"><Search size={16} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search documents" aria-label="Search documents" /></label></div>
            {apiError && <div className="api-message is-error">{apiError}</div>}
            {loading ? <div className="document-empty">Loading your documents…</div> : filteredDocuments.length ? <div className="document-list">
              {filteredDocuments.map((document) => <div key={document.id} className={`document-row-wrap${rowBusyId === document.id ? ' is-busy' : ''}`}>
                {renamingId === document.id ? <form className="document-row document-rename" onSubmit={(event) => { event.preventDefault(); void renameDocument(document.id) }}>
                  <span className="document-icon"><FileText size={19} /></span>
                  <input value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} onKeyDown={(event) => event.key === 'Escape' && setRenamingId(null)} aria-label={`Rename ${document.title}`} ref={(node) => node?.focus()} />
                  <button type="submit" className="row-action" aria-label="Save name"><Check size={15} /></button>
                  <button type="button" className="row-action" onClick={() => setRenamingId(null)} aria-label="Cancel rename"><X size={15} /></button>
                </form> : <>
                  <button className="document-row" onClick={() => navigate(`/document/${document.id}`)} disabled={rowBusyId === document.id}>
                    <span className="document-icon"><FileText size={19} /></span>
                    <span className="document-name"><strong>{document.title}</strong><small><Clock3 size={12} /> Updated {formatUpdated(document.updatedAt)}</small></span>
                    {document.shared && <span className="shared-badge"><Link2 size={12} /> Shared</span>}
                    <span className="document-revision">v{document.revision}</span>
                    <ArrowRight size={17} />
                  </button>
                  <span className="document-row-actions">
                    <button className="row-action" onClick={() => { setRenamingId(document.id); setRenameDraft(document.title); setConfirmingDeleteId(null) }} aria-label={`Rename ${document.title}`} disabled={rowBusyId === document.id}><Pencil size={15} /></button>
                    {confirmingDeleteId === document.id
                      ? <button className="row-action is-danger is-confirming" onClick={() => void deleteDocument(document.id)} onBlur={() => setConfirmingDeleteId(null)} aria-label={`Confirm deleting ${document.title}`} disabled={rowBusyId === document.id}>Delete?</button>
                      : <button className="row-action is-danger" onClick={() => setConfirmingDeleteId(document.id)} aria-label={`Delete ${document.title}`} disabled={rowBusyId === document.id}><Trash2 size={15} /></button>}
                  </span>
                </>}
              </div>)}
            </div> : <div className="document-empty"><Files size={28} /><strong>No documents yet</strong><span>Create your first Markdown document to begin.</span><button onClick={() => void createDocument()}><Plus size={15} /> New document</button></div>}
          </section>
        </main>
      ) : loading ? <main className="route-loading">Loading document…</main> : apiError ? <main className="route-loading is-error"><strong>Could not open this document</strong><span>{apiError}</span><button onClick={() => navigate('/')}>Back to documents</button></main> : isReadOnlyShare ? (
        <main className="shared-document-shell">
          <div className="shared-document-notice"><Link2 size={15} /><span>This is a read-only shared document.</span></div>
          <MarkdownDocumentView value={markdown} className="shared-document" />
        </main>
      ) : (
        <main className={`workspace ${showPreview ? 'is-preview-open' : ''}${resizingPreview ? ' is-resizing-preview' : ''}`} id="top" style={showPreview ? { '--preview-width': `${previewWidth}px` } as React.CSSProperties : undefined}>
          <section className="editor-panel" aria-label="Markdown editor">
            <div className="editor-wrap">
              <MarkdownEditor value={markdown} onChange={(value) => { setMarkdown(value); setDocumentTitle(titleFromMarkdown(value, documentTitle)) }} theme={theme} mode={editorMode} onModeChange={setEditorMode} onReset={() => { setMarkdown(DEMO_MARKDOWN); setSceneIndex(0) }} documentId={activeDocumentId} saveStatus={saveStatus} onCursorLineChange={setEditorCursorLine} scrollRequest={editorScrollRequest} />
            </div>
          </section>

          {showPreview && <button className="preview-resize-handle" onPointerDown={beginPreviewResize} aria-label="Resize Scenes panel" title="Drag to resize Scenes panel"><GripVertical size={16} /></button>}
          {showPreview && <section className="preview-panel" aria-label="Presentation preview">
            <div className="preview-toolbar">
              <div className="preview-title"><Focus size={15} /><strong>Scenes</strong><span className={measuring ? 'status-dot is-working' : 'status-dot'} /></div>
              <div className="preview-tools">
                <button className={`icon-button ${sceneSyncEnabled ? 'is-active' : ''}`} onClick={() => setSceneSyncEnabled((enabled) => !enabled)} title={sceneSyncEnabled ? 'Unlink Markdown and Scenes' : 'Link Markdown and Scenes'} aria-label={sceneSyncEnabled ? 'Unlink Markdown and Scenes' : 'Link Markdown and Scenes'} aria-pressed={sceneSyncEnabled}>{sceneSyncEnabled ? <Link2 size={16} /> : <Unlink size={16} />}</button>
                <button className="icon-button" onClick={openPresenterWindow} title="Open presenter window" aria-label="Open presenter window"><Mic2 size={16} /></button>
                <button className={`icon-button ${debug ? 'is-active' : ''}`} onClick={() => setDebug((value) => !value)} title="Toggle planner debug overlay" aria-label="Toggle planner debug overlay"><Bug size={16} /></button>
                <div className="density-switch" aria-label="Presentation density">
                  {(['compact', 'balanced', 'cinematic'] as Density[]).map((option) => <button key={option} className={density === option ? 'is-active' : ''} onClick={() => setDensity(option)}>{option}</button>)}
                </div>
                <button className="icon-button" onClick={() => setShowPreview(false)} aria-label="Close preview"><X size={17} /></button>
              </div>
            </div>
            <div className="preview-area" style={{ '--notes-height': `${notesHeight}px` } as React.CSSProperties}>
              <div className="preview-meta"><span>{plan.scenes.length} semantic scenes</span><span>{Math.round(plan.averageFill * 100)}% avg fill</span><span>{plan.overflowCount === 0 ? <><Check size={12} /> no overflow</> : `${plan.overflowCount} overflow`}</span></div>
              <div className={`stage-shell ${viewport.width < 560 ? 'is-narrow' : ''}`} ref={previewRef}>{currentScene ? <SceneView scene={currentScene} sceneNumber={sceneIndex + 1} sceneCount={plan.scenes.length} debug={debug} revealIndex={stepCount} navigationLabels={navigationLabels} activeNavigationLabel={activeNavigationLabel} onNavigateLabel={navigateToLabel} presentationConfig={presentationConfig} citationReferences={citationReferences} /> : <div className="empty-state">Start writing to compose your first scene.</div>}</div>
              <div className="scene-nav">
                <button className="icon-button" onClick={goPrevious} disabled={sceneIndex === 0} aria-label="Previous scene"><ArrowLeft size={16} /></button>
                <div className="scene-dots" aria-label={`Scene ${sceneIndex + 1} of ${plan.scenes.length}`}>{plan.scenes.map((scene, index) => <button key={scene.id} className={index === sceneIndex ? 'is-active' : ''} onClick={() => { setSceneIndex(index); setRevealIndex(0); scrollEditorToScene(index) }} aria-label={`Go to scene ${index + 1}`} />)}</div>
                <span className="scene-count"><strong>{String(sceneIndex + 1).padStart(2, '0')}</strong> / {String(plan.scenes.length).padStart(2, '0')}</span>
                <button className="icon-button" onClick={goNext} disabled={sceneIndex >= plan.scenes.length - 1} aria-label="Next scene"><ArrowRight size={16} /></button>
              </div>
              <button className="preview-notes-resize" onPointerDown={beginNotesResize} aria-label="Resize speaker notes"><span /></button>
              <section className="preview-speaker-notes" style={{ height: notesHeight }} aria-label="Speaker notes for current scene">
                <header><span>Speaker notes</span><div className="speaker-note-actions"><select value={transcriptMode} onChange={(event) => setTranscriptMode(event.target.value as 'verbatim' | 'tldr')} aria-label="Transcript detail"><option value="verbatim">1:1 逐字稿</option><option value="tldr">TL;DR</option></select><button onClick={() => void generateTranscript()} disabled={transcriptBusy || currentScene?.role === 'cover'}>{transcriptBusy ? <LoaderCircle className="is-spinning" size={14} /> : <Sparkles size={14} />}生成逐字稿</button></div></header>
                <textarea value={noteDraft} onChange={(event) => changeSpeakerNote(event.target.value)} disabled={!currentScene || currentScene.role === 'cover'} placeholder={currentScene?.role === 'cover' ? 'Cover scene has no speaker note.' : 'Type speaker notes here. They sync to a Marp-compatible HTML comment in Markdown.'} aria-label="Edit speaker notes" />
                {transcriptError && <small className="speaker-note-error">{transcriptError}</small>}
              </section>
            </div>
          </section>}
        </main>
      )}

      {showCheatsheet && <Cheatsheet onClose={() => setShowCheatsheet(false)} />}
      {showLlmPrompt && <LlmPromptDialog onClose={() => setShowLlmPrompt(false)} />}
      {showBibliography && <BibliographyDialog markdown={markdown} documentTitle={documentTitle} onClose={() => setShowBibliography(false)} />}
      {showExport && <ExportDialog markdown={markdown} title={documentTitle} scenes={plan.scenes} presentationConfig={presentationConfig} navigationLabels={navigationLabels} activeLabels={sceneNavigationLabels} onClose={() => setShowExport(false)} />}
      {showPresentationSettings && <PresentationSettingsDialog value={presentationConfig} onSave={(config) => { setPresentationConfig(config); setSceneIndex(0) }} onClose={() => setShowPresentationSettings(false)} />}
      {showHackMDSync && route.kind === 'document' && <HackMDSyncDialog documentId={route.id} onBusyChange={setHackMDSyncing} onClose={() => setShowHackMDSync(false)} onDocument={(document) => {
        setMarkdown(absoluteSceneImageUrls(document.markdown))
        setDocumentTitle(document.title)
        setDocumentRevision(document.revision)
        setPresentationConfig(document.presentationConfig)
        lastSavedMarkdownRef.current = document.markdown
        lastSavedPresentationConfigRef.current = JSON.stringify(document.presentationConfig)
        setSaveStatus('saved')
      }} />}
      {presenterWindow && !presenterWindow.closed && <PresenterWindow target={presenterWindow} scenes={plan.scenes} sceneIndex={sceneIndex} revealIndex={revealIndex} presentationConfig={presentationConfig} citationReferences={citationReferences} navigationLabels={navigationLabels} activeLabels={sceneNavigationLabels} onPrevious={goPrevious} onNext={goNext} onBlack={() => setBlank((value) => value === 'black' ? null : 'black')} onClosed={closePresenterWindow} />}
      {shareLink && <div className="cheatsheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShareLink(null) }}><aside className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title"><div className="share-icon"><Link2 size={22} /></div><h2 id="share-title">Read-only link ready</h2><p>Anyone with this unguessable link can read and present this document. They cannot edit it.</p><div className="share-link-field"><input value={shareLink} readOnly aria-label="Read-only share link" /><button onClick={() => void navigator.clipboard.writeText(shareLink)}><Copy size={15} /> Copy</button></div><button className="share-done" onClick={() => setShareLink(null)}>Done</button></aside></div>}
      {saveConflict && <div className="save-conflict-backdrop" role="presentation"><aside className="save-conflict-dialog" role="alertdialog" aria-modal="true" aria-labelledby="save-conflict-title">
        <div className="save-conflict-icon"><RefreshCw size={21} /></div>
        <h2 id="save-conflict-title">Two sessions edited this document</h2>
        <p>SceneMD could not safely merge changes made to the same content. Your local Markdown is still in this editor, and a backup copy is kept on this device until the conflict is resolved.</p>
        <div className="save-conflict-meta"><span>Your copy</span><strong>{saveConflict.localMarkdown.split('\n').length} lines</strong><span>Cloud copy</span><strong>revision {saveConflict.remote.revision}</strong></div>
        {(() => {
          const excerpts = conflictExcerpts(saveConflict.localMarkdown, saveConflict.remote.markdown)
          return <div className="save-conflict-diff">
            <div><span>Your version</span><pre>{excerpts.local || '(empty)'}</pre></div>
            <div><span>Cloud version</span><pre>{excerpts.remote || '(empty)'}</pre></div>
          </div>
        })()}
        <div className="save-conflict-actions">
          <button onClick={() => void navigator.clipboard.writeText(saveConflict.localMarkdown)}><Copy size={15} /> Copy my Markdown</button>
          <button onClick={() => downloadBlob(new Blob([saveConflict.localMarkdown], { type: 'text/markdown;charset=utf-8' }), exportFileName(`${saveConflict.localTitle} (my version)`, 'md'))}>Download .md</button>
          <button onClick={useCloudConflictVersion}>Use cloud version</button>
          <button className="is-primary" onClick={() => void keepLocalConflictVersion()}>Keep my version</button>
        </div>
      </aside></div>}

      {conflictBackup && route.kind === 'document' && !saveConflict && <aside className="deploy-update-toast conflict-backup-toast" role="status" aria-live="polite">
        <span className="deploy-update-icon"><Copy size={18} /></span>
        <span className="deploy-update-copy"><strong>A backup from an unresolved conflict exists</strong><small>saved {new Date(conflictBackup.at).toLocaleString()} — it differs from the loaded document</small></span>
        <button onClick={() => void navigator.clipboard.writeText(conflictBackup.markdown)}><Copy size={14} /> Copy</button>
        <button onClick={() => downloadBlob(new Blob([conflictBackup.markdown], { type: 'text/markdown;charset=utf-8' }), exportFileName(`${documentTitle} (conflict backup)`, 'md'))}>Download</button>
        <button onClick={() => { clearConflictBackup(route.id); setConflictBackup(null) }}>Discard</button>
      </aside>}

      {newerDeployTime && <aside className="deploy-update-toast" role="status" aria-live="polite">
        <span className="deploy-update-icon"><RefreshCw className={refreshingDeploy ? 'is-spinning' : ''} size={18} /></span>
        <span className="deploy-update-copy"><strong>SceneMD 已有新版本</strong><small>部署時間 {formatDeployTime(newerDeployTime)} GMT+8</small></span>
        <button onClick={() => void forceRefreshForDeploy()} disabled={refreshingDeploy}>{refreshingDeploy ? '更新中…' : '重新整理'}</button>
      </aside>}

      {route.kind !== 'home' && <div className="measurement-root" ref={measureRef} aria-hidden="true" style={{ width: Math.max(320, viewport.width - 150) }}>{blocks.map((block) => <div data-measure-id={block.id} key={block.id}><BlockView block={block} measurement /></div>)}</div>}

      {presenting && currentScene && <div className="presentation-overlay" role="dialog" aria-label="Presentation mode">
        <div className="presentation-zoom-layer" style={{ transform: `scale(${presentationZoom})` }}><SceneView scene={currentScene} sceneNumber={sceneIndex + 1} sceneCount={plan.scenes.length} debug={debug} revealIndex={revealIndex} navigationLabels={navigationLabels} activeNavigationLabel={activeNavigationLabel} onNavigateLabel={navigateToLabel} presentationConfig={presentationConfig} citationReferences={citationReferences} /></div>
        <PresentationRuntimeTools sceneId={currentScene.id} zoom={presentationZoom} onZoomChange={setPresentationZoom} />
        <div className="presentation-controls"><button onClick={goPrevious} aria-label="Previous"><ArrowLeft size={18} /></button><span>{sceneIndex + 1} / {plan.scenes.length}</span><button onClick={goNext} aria-label="Next"><ArrowRight size={18} /></button><span className="control-separator" /><button onClick={openPresenterWindow} aria-label="Open presenter window"><Mic2 size={17} /></button>{!isReadOnlyShare && <button onClick={() => setDebug((value) => !value)} aria-label="Toggle debug"><Bug size={17} /></button>}<button onClick={exitPresentation} aria-label="Exit presentation"><X size={18} /></button></div>
        <div className={`keyboard-hint ${showShortcutHint ? 'is-visible' : ''}`}><span><kbd>←</kbd><kbd>→</kbd> navigate</span><span><kbd>S</kbd> speaker</span><span><kbd>B</kbd> black</span><span><kbd>W</kbd> white</span><span><kbd>Esc</kbd> exit</span></div>
        {blank && <div className={`blank-screen blank-${blank}`} onClick={() => setBlank(null)} />}
      </div>}

      {route.kind !== 'home' && !isReadOnlyShare && <button className="mobile-present" onClick={startPresentation}><Expand size={17} /> Present</button>}
    </div>
  )
}

export default App
