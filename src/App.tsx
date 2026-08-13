import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bug,
  Check,
  Clock3,
  Copy,
  Expand,
  FileText,
  Files,
  Focus,
  GripVertical,
  Link2,
  Moon,
  PanelRight,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Share2,
  Sun,
  X,
} from 'lucide-react'
import { SceneView, BlockView } from './components/SceneView'
import { MarkdownDocumentView, MarkdownEditor, type EditorMode } from './components/MarkdownEditor'
import { PresentationSettingsDialog } from './components/PresentationSettingsDialog'
import { HackMDSyncDialog } from './components/HackMDSyncDialog'
import { buildSemanticRegions, parsePresentationDocument } from './engine/semantics'
import { planScenes, withPresentationCover } from './engine/planner'
import type { Density, PresentationConfig, ScenePlan, ThemeMode } from './engine/types'
import { defaultPresentationConfig, normalizePresentationConfig } from './presentationConfig'

const DEMO_MARKDOWN = `# Acute Myeloid Leukemia

AML is a clonal hematopoietic malignancy characterized by abnormal proliferation of myeloid precursor cells.

## Diagnosis

Diagnosis requires integration of morphology, immunophenotyping, cytogenetics, and molecular genetics.

- Morphology
- Flow cytometry
- Cytogenetics
- Molecular testing

![Microscopic cellular structure](https://images.unsplash.com/photo-1576086213369-97a306d36557?auto=format&fit=crop&w=1200&q=85)

## Classification

Modern AML classification increasingly incorporates molecular genetics and disease-defining genomic alterations.

> Classification is no longer only what the cells look like. It is what the disease means biologically.

## Treatment

Treatment depends on age, fitness, disease biology, and targetable mutations.

<!-- present: step -->
- Assess patient fitness
- Define molecular risk
- Identify targetable mutations
- Select induction strategy

## Risk model

| Signal | Interpretation |
| --- | --- |
| Favorable genetics | Lower relapse risk |
| Adverse genetics | Consider transplant strategy |

$$
Risk = f(Genetics, Fitness, Response)
$$

<!-- present: break -->
## Take-home message

Treat the patient, the biology, and the trajectory — not a single snapshot.
`

const EMPTY_PLAN: ScenePlan = { scenes: [], averageFill: 0, overflowCount: 0, measuredBlockCount: 0 }

type Route = { kind: 'home' } | { kind: 'document'; id: string } | { kind: 'share'; token: string }
type SaveStatus = 'saved' | 'saving' | 'conflict' | 'offline'

interface DocumentSummary {
  id: string
  title: string
  revision: number
  ownerEmail: string | null
  shared: boolean
  createdAt: string
  updatedAt: string
}

interface DocumentPayload {
  id: string
  title: string
  markdown: string
  revision: number
  createdAt?: string
  updatedAt?: string
  created_at?: string
  updated_at?: string
  presentationConfig?: unknown
}

function getInitialTheme(): ThemeMode {
  const saved = localStorage.getItem('scenemd-theme')
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function parseRoute(pathname = window.location.pathname): Route {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] === 'document' && parts[1]) return { kind: 'document', id: decodeURIComponent(parts[1]) }
  if (parts[0] === 'share' && parts[1]) return { kind: 'share', token: decodeURIComponent(parts[1]) }
  return { kind: 'home' }
}

function titleFromMarkdown(markdown: string, fallback: string): string {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback
}

function formatUpdated(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Recently' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function previewViewport(width: number) {
  return { width, height: width < 560 ? width * (16 / 9) : Math.max(360, width * 0.5625) }
}

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
  const [showPresentationSettings, setShowPresentationSettings] = useState(false)
  const [showHackMDSync, setShowHackMDSync] = useState(false)
  const [presenting, setPresenting] = useState(false)
  const [showShortcutHint, setShowShortcutHint] = useState(false)
  const [sceneIndex, setSceneIndex] = useState(0)
  const [revealIndex, setRevealIndex] = useState(0)
  const [blank, setBlank] = useState<'black' | 'white' | null>(null)
  const [viewport, setViewport] = useState({ width: 960, height: 540 })
  const [measurements, setMeasurements] = useState<Map<string, number>>(new Map())
  const [measuring, setMeasuring] = useState(true)
  const previewRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const previousPlanRef = useRef<ScenePlan>(EMPTY_PLAN)
  const lastSavedMarkdownRef = useRef('')
  const lastSavedPresentationConfigRef = useRef(JSON.stringify(defaultPresentationConfig('Untitled document')))
  const resizingPreviewRef = useRef(false)

  const blocks = useMemo(() => parsePresentationDocument(markdown), [markdown])
  const regions = useMemo(() => buildSemanticRegions(blocks), [blocks])
  const plan = useMemo(
    () => withPresentationCover(
      planScenes(regions, measurements, presenting ? window.innerHeight : viewport.height, density, previousPlanRef.current),
      presentationConfig,
    ),
    [regions, measurements, viewport.height, density, presenting, presentationConfig],
  )
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
          setMarkdown(result.markdown)
          setDocumentTitle(result.title)
          setDocumentRevision(result.revision)
          const config = normalizePresentationConfig(result.presentationConfig, result.title)
          setPresentationConfig(config)
          lastSavedPresentationConfigRef.current = JSON.stringify(config)
          lastSavedMarkdownRef.current = result.markdown
          setSaveStatus('saved')
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
    if (route.kind !== 'document' || loading || (markdown === lastSavedMarkdownRef.current && serializedConfig === lastSavedPresentationConfigRef.current)) return
    const snapshot = markdown
    const snapshotConfig = presentationConfig
    const snapshotTitle = titleFromMarkdown(snapshot, documentTitle)
    const baseRevision = documentRevision
    const timer = window.setTimeout(async () => {
      setSaveStatus('saving')
      try {
        const response = await fetch(`/api/documents/${route.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown: snapshot, title: snapshotTitle, presentationConfig: snapshotConfig, baseRevision }),
        })
        const result = await response.json() as DocumentPayload & { error?: string }
        if (response.status === 409) {
          setSaveStatus('conflict')
          return
        }
        if (!response.ok) throw new Error(result.error || 'Save failed')
        lastSavedMarkdownRef.current = snapshot
        lastSavedPresentationConfigRef.current = serializedConfig
        setDocumentRevision(result.revision)
        setDocumentTitle(result.title)
        setSaveStatus('saved')
      } catch {
        setSaveStatus('offline')
      }
    }, 650)
    return () => window.clearTimeout(timer)
  }, [markdown, presentationConfig, documentRevision, documentTitle, loading, route])

  useEffect(() => {
    previousPlanRef.current = plan
    setSceneIndex((current) => Math.min(current, Math.max(0, plan.scenes.length - 1)))
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
      measureRef.current?.querySelectorAll<HTMLElement>('[data-measure-id]').forEach((element) => {
        const id = element.dataset.measureId
        if (id) next.set(id, element.getBoundingClientRect().height)
      })
      setMeasurements(next)
      setMeasuring(false)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [blocks, viewport.width, density, theme])

  const currentScene = plan.scenes[sceneIndex]
  const stepCount = currentScene?.blocks.reduce((total, block) => total + (block.stepped ? block.listItems?.length ?? 0 : 0), 0) ?? 0
  const navigationLabels = useMemo(() => [...new Set(regions
    .filter((region) => region.blocks[0]?.type === 'heading' && region.blocks[0].depth === 1)
    .map((region) => region.headingPath[0])
    .filter((label): label is string => Boolean(label)))], [regions])
  const activeNavigationLabel = regions.find((region) => region.id === currentScene?.regionId)?.headingPath[0]

  const navigateToLabel = useCallback((label: string) => {
    const region = regions.find((candidate) => candidate.blocks[0]?.type === 'heading' && candidate.blocks[0].depth === 1 && candidate.headingPath[0] === label)
    const targetIndex = region ? plan.scenes.findIndex((scene) => scene.regionId === region.id) : -1
    if (targetIndex >= 0) { setSceneIndex(targetIndex); setRevealIndex(0) }
  }, [plan.scenes, regions])

  const goNext = useCallback(() => {
    setBlank(null)
    if (revealIndex < stepCount) setRevealIndex((value) => value + 1)
    else { setSceneIndex((value) => Math.min(value + 1, plan.scenes.length - 1)); setRevealIndex(0) }
  }, [plan.scenes.length, revealIndex, stepCount])

  const goPrevious = useCallback(() => {
    setBlank(null)
    if (revealIndex > 0) setRevealIndex((value) => value - 1)
    else { setSceneIndex((value) => Math.max(0, value - 1)); setRevealIndex(0) }
  }, [revealIndex])

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
      else if (event.key === 'Escape') exitPresentation()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [presenting, goNext, goPrevious, exitPresentation])

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

  const renderThemeButton = () => (
    <button className="icon-button" onClick={() => setTheme((value) => value === 'light' ? 'dark' : 'light')} title={`Use ${theme === 'light' ? 'dark' : 'light'} mode`} aria-label={`Use ${theme === 'light' ? 'dark' : 'light'} mode`}>
      {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
    </button>
  )

  const saveLabel = saveStatus === 'saving' ? 'Saving…' : saveStatus === 'conflict' ? 'Edit conflict' : saveStatus === 'offline' ? 'Save failed' : 'Saved'
  const isReadOnlyShare = route.kind === 'share'
  const activeDocumentId = route.kind === 'document' ? route.id : 'readonly'

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand brand-button" onClick={() => navigate('/')} aria-label="SceneMD home">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>Scene<span>MD</span></span>
        </button>
        {route.kind === 'home' ? <div className="document-breadcrumb"><Files size={14} /><span>Documents</span><small>{documents.length} files</small></div> : <div className="document-breadcrumb"><FileText size={14} /><span>{documentTitle}</span><small>{isReadOnlyShare ? 'Read only' : saveLabel}</small></div>}
        <nav className="header-actions" aria-label="Document actions">
          {renderThemeButton()}
          {route.kind === 'home' ? <button className="present-button" onClick={() => void createDocument()} disabled={creating}><Plus size={16} /> {creating ? 'Creating…' : 'New document'}</button> : <>
            {!isReadOnlyShare && <button className="cheatsheet-button" onClick={() => setShowPresentationSettings(true)} aria-label="Open presentation cover settings"><Settings2 size={16} /> Cover</button>}
            {!isReadOnlyShare && <button className="cheatsheet-button" onClick={() => setShowHackMDSync(true)} aria-label="Sync document with HackMD"><RefreshCw size={16} /> HackMD</button>}
            {!isReadOnlyShare && <button className="cheatsheet-button" onClick={() => setShowCheatsheet(true)} aria-label="Open Markdown and presentation cheat sheet"><BookOpen size={16} /> Cheat sheet</button>}
            {!isReadOnlyShare && <button className="cheatsheet-button" onClick={() => void createShareLink()} disabled={shareBusy} aria-label="Create read-only share link"><Share2 size={16} /> {shareBusy ? 'Sharing…' : 'Share'}</button>}
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
              {filteredDocuments.map((document) => <button key={document.id} className="document-row" onClick={() => navigate(`/document/${document.id}`)}>
                <span className="document-icon"><FileText size={19} /></span>
                <span className="document-name"><strong>{document.title}</strong><small><Clock3 size={12} /> Updated {formatUpdated(document.updatedAt)}</small></span>
                {document.shared && <span className="shared-badge"><Link2 size={12} /> Shared</span>}
                <span className="document-revision">v{document.revision}</span>
                <ArrowRight size={17} />
              </button>)}
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
              <MarkdownEditor value={markdown} onChange={(value) => { setMarkdown(value); setDocumentTitle(titleFromMarkdown(value, documentTitle)) }} theme={theme} mode={editorMode} onModeChange={setEditorMode} onReset={() => { setMarkdown(DEMO_MARKDOWN); setSceneIndex(0) }} documentId={activeDocumentId} />
            </div>
          </section>

          {showPreview && <button className="preview-resize-handle" onPointerDown={beginPreviewResize} aria-label="Resize Scenes panel" title="Drag to resize Scenes panel"><GripVertical size={16} /></button>}
          {showPreview && <section className="preview-panel" aria-label="Presentation preview">
            <div className="preview-toolbar">
              <div className="preview-title"><Focus size={15} /><strong>Scenes</strong><span className={measuring ? 'status-dot is-working' : 'status-dot'} /></div>
              <div className="preview-tools">
                <button className={`icon-button ${debug ? 'is-active' : ''}`} onClick={() => setDebug((value) => !value)} title="Toggle planner debug overlay" aria-label="Toggle planner debug overlay"><Bug size={16} /></button>
                <div className="density-switch" aria-label="Presentation density">
                  {(['compact', 'balanced', 'cinematic'] as Density[]).map((option) => <button key={option} className={density === option ? 'is-active' : ''} onClick={() => setDensity(option)}>{option}</button>)}
                </div>
                <button className="icon-button" onClick={() => setShowPreview(false)} aria-label="Close preview"><X size={17} /></button>
              </div>
            </div>
            <div className="preview-area">
              <div className="preview-meta"><span>{plan.scenes.length} semantic scenes</span><span>{Math.round(plan.averageFill * 100)}% avg fill</span><span>{plan.overflowCount === 0 ? <><Check size={12} /> no overflow</> : `${plan.overflowCount} overflow`}</span></div>
              <div className={`stage-shell ${viewport.width < 560 ? 'is-narrow' : ''}`} ref={previewRef}>{currentScene ? <SceneView scene={currentScene} sceneNumber={sceneIndex + 1} sceneCount={plan.scenes.length} debug={debug} revealIndex={stepCount} navigationLabels={navigationLabels} activeNavigationLabel={activeNavigationLabel} onNavigateLabel={navigateToLabel} presentationConfig={presentationConfig} /> : <div className="empty-state">Start writing to compose your first scene.</div>}</div>
              <div className="scene-nav">
                <button className="icon-button" onClick={goPrevious} disabled={sceneIndex === 0} aria-label="Previous scene"><ArrowLeft size={16} /></button>
                <div className="scene-dots" aria-label={`Scene ${sceneIndex + 1} of ${plan.scenes.length}`}>{plan.scenes.map((scene, index) => <button key={scene.id} className={index === sceneIndex ? 'is-active' : ''} onClick={() => { setSceneIndex(index); setRevealIndex(0) }} aria-label={`Go to scene ${index + 1}`} />)}</div>
                <span className="scene-count"><strong>{String(sceneIndex + 1).padStart(2, '0')}</strong> / {String(plan.scenes.length).padStart(2, '0')}</span>
                <button className="icon-button" onClick={goNext} disabled={sceneIndex >= plan.scenes.length - 1} aria-label="Next scene"><ArrowRight size={16} /></button>
              </div>
            </div>
          </section>}
        </main>
      )}

      {showCheatsheet && <Cheatsheet onClose={() => setShowCheatsheet(false)} />}
      {showPresentationSettings && <PresentationSettingsDialog value={presentationConfig} onSave={(config) => { setPresentationConfig(config); setSceneIndex(0) }} onClose={() => setShowPresentationSettings(false)} />}
      {showHackMDSync && route.kind === 'document' && <HackMDSyncDialog documentId={route.id} onClose={() => setShowHackMDSync(false)} onDocument={(document) => {
        setMarkdown(document.markdown)
        setDocumentTitle(document.title)
        setDocumentRevision(document.revision)
        setPresentationConfig(document.presentationConfig)
        lastSavedMarkdownRef.current = document.markdown
        lastSavedPresentationConfigRef.current = JSON.stringify(document.presentationConfig)
        setSaveStatus('saved')
      }} />}
      {shareLink && <div className="cheatsheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShareLink(null) }}><aside className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title"><div className="share-icon"><Link2 size={22} /></div><h2 id="share-title">Read-only link ready</h2><p>Anyone with this unguessable link can read and present this document. They cannot edit it.</p><div className="share-link-field"><input value={shareLink} readOnly aria-label="Read-only share link" /><button onClick={() => void navigator.clipboard.writeText(shareLink)}><Copy size={15} /> Copy</button></div><button className="share-done" onClick={() => setShareLink(null)}>Done</button></aside></div>}

      {route.kind !== 'home' && <div className="measurement-root" ref={measureRef} aria-hidden="true" style={{ width: Math.max(320, viewport.width - 150) }}>{blocks.map((block) => <div data-measure-id={block.id} key={block.id}><BlockView block={block} measurement /></div>)}</div>}

      {presenting && currentScene && <div className="presentation-overlay" role="dialog" aria-label="Presentation mode">
        <SceneView scene={currentScene} sceneNumber={sceneIndex + 1} sceneCount={plan.scenes.length} debug={debug} revealIndex={revealIndex} navigationLabels={navigationLabels} activeNavigationLabel={activeNavigationLabel} onNavigateLabel={navigateToLabel} presentationConfig={presentationConfig} />
        <div className="presentation-controls"><button onClick={goPrevious} aria-label="Previous"><ArrowLeft size={18} /></button><span>{sceneIndex + 1} / {plan.scenes.length}</span><button onClick={goNext} aria-label="Next"><ArrowRight size={18} /></button><span className="control-separator" />{!isReadOnlyShare && <button onClick={() => setDebug((value) => !value)} aria-label="Toggle debug"><Bug size={17} /></button>}<button onClick={exitPresentation} aria-label="Exit presentation"><X size={18} /></button></div>
        <div className={`keyboard-hint ${showShortcutHint ? 'is-visible' : ''}`}><span><kbd>←</kbd><kbd>→</kbd> navigate</span><span><kbd>B</kbd> black</span><span><kbd>W</kbd> white</span><span><kbd>Esc</kbd> exit</span></div>
        {blank && <div className={`blank-screen blank-${blank}`} onClick={() => setBlank(null)} />}
      </div>}

      {route.kind !== 'home' && !isReadOnlyShare && <button className="mobile-present" onClick={startPresentation}><Expand size={17} /> Present</button>}
    </div>
  )
}

function Cheatsheet({ onClose }: { onClose: () => void }) {
  return <div className="cheatsheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><aside className="cheatsheet-dialog" role="dialog" aria-modal="true" aria-labelledby="cheatsheet-title">
    <div className="cheatsheet-heading"><div><span>Reference</span><h2 id="cheatsheet-title">Markdown cheat sheet</h2></div><button className="icon-button" onClick={onClose} aria-label="Close cheat sheet"><X size={18} /></button></div>
    <div className="cheatsheet-grid"><section><h3>Markdown</h3><dl>
      <div><dt><code># Title</code></dt><dd>Document chapter</dd></div><div><dt><code>## Section</code></dt><dd>Section heading</dd></div><div><dt><code>**bold**</code></dt><dd>Bold text</dd></div><div><dt><code>_italic_</code></dt><dd>Italic text</dd></div><div><dt><code>- Item</code></dt><dd>Bulleted list</dd></div><div><dt><code>1. Item</code></dt><dd>Numbered list</dd></div><div><dt><code>&gt; Quote</code></dt><dd>Block quote</dd></div><div><dt><code>[text](url)</code></dt><dd>Link</dd></div><div><dt><code>![alt](url)</code></dt><dd>Image · click its syntax for visual controls</dd></div><div><dt><code>![w:400px](url)</code></dt><dd>Marpit image sizing</dd></div><div><dt><code>![bg right:40%](url)</code></dt><dd>Marpit scene background</dd></div><div><dt><code>```ts</code></dt><dd>Code block</dd></div><div><dt><code>$$ x $$</code></dt><dd>Display math</dd></div>
    </dl></section><section><h3>Presentation hints</h3><dl>
      <div><dt><code>&lt;!-- present: break --&gt;</code></dt><dd>Force a scene break</dd></div><div><dt><code>&lt;!-- present: keep --&gt;</code></dt><dd>Keep the next block together</dd></div><div><dt><code>&lt;!-- present: hero --&gt;</code></dt><dd>Emphasize the next image</dd></div><div><dt><code>&lt;!-- present: hide --&gt;</code></dt><dd>Hide the next block in presentation</dd></div><div><dt><code>&lt;!-- present: only --&gt;</code></dt><dd>Show the next block only in presentation</dd></div><div><dt><code>&lt;!-- present: step --&gt;</code></dt><dd>Reveal the next list item by item</dd></div>
    </dl><p>Hints apply to the block immediately following the comment. Type <code>&lt;!-- present:</code> in the editor to autocomplete one.</p></section></div>
  </aside></div>
}

export default App
