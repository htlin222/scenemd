/**
 * Types and pure helpers shared by the App shell.
 *
 * Everything here is stateless: route parsing, formatting, conflict backups,
 * source-offset math, and transcript flattening. Extracted from App.tsx (#13)
 * so the runtime hooks can be read and tested without scrolling past them.
 */
import type { ReactNode } from 'react'
import type { PresentationBlock, PresentationConfig, Scene, ScenePlan, SourceRange, ThemeMode } from '../engine/types'

export const EMPTY_PLAN: ScenePlan = { scenes: [], averageFill: 0, overflowCount: 0, measuredBlockCount: 0 }
export const CURRENT_DEPLOY_TIME = Date.parse(__SCENEMD_BUILD_TIME__)
export const DEPLOY_CHECK_INTERVAL_MS = 2 * 60 * 1000

export type Route = { kind: 'home' } | { kind: 'document'; id: string } | { kind: 'share'; token: string }
export type SaveStatus = 'saved' | 'saving' | 'conflict' | 'offline'
export interface HeaderActionSpec {
  id: string
  label: string
  ariaLabel: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
  busy?: boolean
}

export function directHeaderActionCount(width: number): number {
  if (width >= 1530) return 7
  if (width >= 1430) return 6
  if (width >= 1330) return 5
  if (width >= 1230) return 4
  if (width >= 1130) return 3
  if (width >= 1030) return 2
  if (width >= 930) return 1
  return 0
}

export interface DocumentSummary {
  id: string
  title: string
  revision: number
  ownerEmail: string | null
  shared: boolean
  createdAt: string
  updatedAt: string
}

export interface DocumentPayload {
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

export interface SaveConflictState {
  remote: DocumentPayload
  localMarkdown: string
  localTitle: string
  localConfig: PresentationConfig
}

export interface ConflictBackup {
  markdown: string
  at: string
}

// A conflicting save must never silently lose the author's text (#12). The
// losing side is stashed here the moment a 409 arrives, so it survives
// "Use cloud version", a tab crash, and a reload.
export const conflictBackupKey = (documentId: string) => `scenemd-conflict:${documentId}`

export function stashConflictBackup(documentId: string, markdown: string): void {
  try {
    localStorage.setItem(conflictBackupKey(documentId), JSON.stringify({ markdown, at: new Date().toISOString() } satisfies ConflictBackup))
  } catch {
    // Storage full or unavailable — the dialog's copy/download buttons remain.
  }
}

export function readConflictBackup(documentId: string): ConflictBackup | null {
  try {
    const raw = localStorage.getItem(conflictBackupKey(documentId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as ConflictBackup
    return typeof parsed.markdown === 'string' ? parsed : null
  } catch {
    return null
  }
}

export function clearConflictBackup(documentId: string): void {
  try {
    localStorage.removeItem(conflictBackupKey(documentId))
  } catch {
    // Nothing to do.
  }
}

/**
 * Trim the common prefix and suffix and return the differing middles with a
 * little context, so the conflict dialog can show what actually diverged
 * instead of two line counts.
 */
export function conflictExcerpts(local: string, remote: string): { local: string; remote: string } {
  let start = 0
  const limit = Math.min(local.length, remote.length)
  while (start < limit && local[start] === remote[start]) start += 1
  let localEnd = local.length
  let remoteEnd = remote.length
  while (localEnd > start && remoteEnd > start && local[localEnd - 1] === remote[remoteEnd - 1]) {
    localEnd -= 1
    remoteEnd -= 1
  }
  const context = 80
  const from = Math.max(0, start - context)
  const clip = (source: string, end: number) => `${from > 0 ? '…' : ''}${source.slice(from, Math.min(source.length, end + context))}${end + context < source.length ? '…' : ''}`
  return { local: clip(local, localEnd), remote: clip(remote, remoteEnd) }
}

export interface DeployVersion {
  deployedAt?: string
}

export function getInitialTheme(): ThemeMode {
  const saved = localStorage.getItem('scenemd-theme')
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function parseRoute(pathname = window.location.pathname): Route {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] === 'document' && parts[1]) return { kind: 'document', id: decodeURIComponent(parts[1]) }
  if (parts[0] === 'share' && parts[1]) return { kind: 'share', token: decodeURIComponent(parts[1]) }
  return { kind: 'home' }
}

export function titleFromMarkdown(markdown: string, fallback: string): string {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback
}

export function absoluteSceneImageUrls(markdown: string): string {
  return markdown.replace(
    /(!\[[^\]\n]*\]\()\/api\/images\//g,
    `$1${window.location.origin}/api/images/`,
  )
}

export function formatUpdated(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Recently' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function formatDeployTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function previewViewport(width: number) {
  return { width, height: width < 560 ? width * (16 / 9) : Math.max(360, width * 0.5625) }
}

export function blockRevealSteps(block: PresentationBlock): number {
  const listSteps = block.stepped ? block.listItems?.length ?? 0 : 0
  const codeSteps = Math.max(0, (block.codeHighlightSteps?.length ?? 0) - 1)
  const groupSteps = Math.max(0, ...(block.codeGroup ?? []).map((child) => Math.max(0, (child.codeHighlightSteps?.length ?? 0) - 1)))
  const columnSteps = (block.columns ?? []).flat().reduce((total, child) => total + blockRevealSteps(child), 0)
  return listSteps + codeSteps + groupSteps + columnSteps
}

export function sourceOffset(markdown: string, range: Pick<SourceRange, 'startLine' | 'startColumn'>): number {
  const lines = markdown.split('\n')
  let offset = 0
  for (let line = 1; line < range.startLine; line += 1) offset += (lines[line - 1]?.length ?? 0) + 1
  return Math.min(markdown.length, offset + Math.max(0, range.startColumn - 1))
}

export function updateSceneSpeakerNote(markdown: string, scene: Scene | undefined, value: string): string {
  if (!scene || scene.role === 'cover') return markdown
  const note = value.trim().replaceAll('-->', '--\u200b>')
  const insertAt = sourceOffset(markdown, { startLine: scene.sourceRange.endLine, startColumn: scene.sourceRange.endColumn })

  // During fast typing the scene plan may still point to the source range from
  // before the first note character was inserted. Reuse and consolidate any
  // adjacent speaker-note comments instead of appending another comment.
  let cursor = insertAt
  let adjacentNoteEnd: number | null = null
  while (cursor < markdown.length) {
    const whitespace = markdown.slice(cursor).match(/^\s*/)?.[0] ?? ''
    const commentStart = cursor + whitespace.length
    if (!markdown.startsWith('<!--', commentStart)) break
    const commentEnd = markdown.indexOf('-->', commentStart + 4)
    if (commentEnd < 0) break
    const comment = markdown.slice(commentStart + 4, commentEnd).trim()
    if (/^(?:present\s*:|_?(?:class|paginate|backgroundColor|color|header|footer|theme)\s*:)/i.test(comment)) break
    adjacentNoteEnd = commentEnd + 3
    cursor = adjacentNoteEnd
  }
  if (adjacentNoteEnd !== null) {
    const replacement = note ? `\n\n<!-- ${note} -->` : ''
    return `${markdown.slice(0, insertAt).replace(/[ \t]+$/g, '')}${replacement}${markdown.slice(adjacentNoteEnd)}`
  }

  const ranges = scene.blocks.flatMap((block) => block.speakerNoteRanges ?? [])
    .sort((a, b) => a.startLine - b.startLine || a.startColumn - b.startColumn)
  if (ranges.length) {
    const primary = ranges[0]
    return [...ranges].reverse().reduce((source, range) => {
      const from = sourceOffset(source, range)
      const to = sourceOffset(source, { startLine: range.endLine, startColumn: range.endColumn })
      return `${source.slice(0, from)}${range === primary && note ? `<!-- ${note} -->` : ''}${source.slice(to)}`
    }, markdown)
  }
  if (!note) return markdown
  return `${markdown.slice(0, insertAt)}\n\n<!-- ${note} -->${markdown.slice(insertAt)}`
}

export function blockTranscriptText(block: PresentationBlock): string {
  const inlineText = (nodes: PresentationBlock['inlines'] = []): string => nodes.map((node) => 'value' in node ? node.value : 'children' in node ? inlineText(node.children) : '\n').join('')
  if (block.type === 'figure') return `[Image: ${block.alt ?? ''}]`
  if (block.type === 'list') return (block.listItems ?? []).map((item) => `- ${inlineText(item)}`).join('\n')
  if (block.type === 'table') return (block.tableRows ?? []).map((row) => row.join(' | ')).join('\n')
  if (block.type === 'code' || block.type === 'math') return block.value ?? ''
  return inlineText(block.inlines)
}

export function sceneTranscriptText(scene: Scene | undefined): string {
  if (!scene || scene.role === 'cover') return ''
  return scene.blocks.map(blockTranscriptText).filter(Boolean).join('\n\n')
}

