import { useEffect, useRef, useState } from 'react'
import { defaultPresentationConfig, normalizePresentationConfig } from '../presentationConfig'
import type { PresentationConfig } from '../engine/types'
import {
  absoluteSceneImageUrls, clearConflictBackup, readConflictBackup, stashConflictBackup, titleFromMarkdown,
  type ConflictBackup, type DocumentPayload, type Route, type SaveConflictState, type SaveStatus,
} from './shared'

/**
 * Document lifecycle: load by route, debounced autosave with revision-based
 * optimistic concurrency, conflict handling with durable local backups, and
 * share-link creation. Extracted verbatim from App.tsx (#13).
 *
 * The refs are the contract with autosave: lastSaved* hold the server's last
 * accepted state (the merge base), live* always mirror the latest editor
 * state so a 409 handler can snapshot what the author actually has, not what
 * the stale closure saw.
 */
export function useDocument(route: Route) {
  const [markdown, setMarkdown] = useState('')
  const [documentTitle, setDocumentTitle] = useState('Untitled document')
  const [documentRevision, setDocumentRevision] = useState(0)
  const [presentationConfig, setPresentationConfig] = useState<PresentationConfig>(() => defaultPresentationConfig('Untitled document'))
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [saveConflict, setSaveConflict] = useState<SaveConflictState | null>(null)
  const [conflictBackup, setConflictBackup] = useState<ConflictBackup | null>(null)
  const [shareLink, setShareLink] = useState<string | null>(null)
  const [shareBusy, setShareBusy] = useState(false)
  const lastSavedMarkdownRef = useRef('')
  const lastSavedPresentationConfigRef = useRef(JSON.stringify(defaultPresentationConfig('Untitled document')))
  const liveMarkdownRef = useRef(markdown)
  const livePresentationConfigRef = useRef(presentationConfig)
  liveMarkdownRef.current = markdown
  livePresentationConfigRef.current = presentationConfig

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setApiError(null)
    setShareLink(null)

    const load = async () => {
      try {
        if (route.kind === 'home') {
          // The list itself is fetched by useDocumentLibrary; this effect only
          // resets the editor state left over from a document route.
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

  /** Adopt a full document pushed from the server (HackMD sync). */
  const adoptServerDocument = (document: { markdown: string; title: string; revision: number; presentationConfig: PresentationConfig }) => {
    setMarkdown(absoluteSceneImageUrls(document.markdown))
    setDocumentTitle(document.title)
    setDocumentRevision(document.revision)
    setPresentationConfig(document.presentationConfig)
    lastSavedMarkdownRef.current = document.markdown
    lastSavedPresentationConfigRef.current = JSON.stringify(document.presentationConfig)
    setSaveStatus('saved')
  }

  const discardConflictBackup = () => {
    if (route.kind === 'document') clearConflictBackup(route.id)
    setConflictBackup(null)
  }

  return {
    markdown, setMarkdown,
    documentTitle, setDocumentTitle,
    documentRevision,
    presentationConfig, setPresentationConfig,
    loading, apiError, clearApiError: () => setApiError(null),
    saveStatus, saveConflict, useCloudConflictVersion, keepLocalConflictVersion,
    conflictBackup, discardConflictBackup,
    shareLink, dismissShareLink: () => setShareLink(null), shareBusy, createShareLink,
    adoptServerDocument,
  }
}
