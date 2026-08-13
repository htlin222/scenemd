import { DurableObject } from 'cloudflare:workers'

interface Env {
  DB: D1Database
  AI: Ai
  HACKMD_API: string
}

interface PresentationConfig {
  theme: 'default' | 'editorial' | 'catppuccin'
  title: string
  subtitle: string
  seriesName: string
  date: string
  author: string
  affiliation: string
  email: string
  license: string
}

interface DocumentState {
  id: string
  title: string
  markdown: string
  presentationConfig: PresentationConfig
  revision: number
  createdAt: string
  updatedAt: string
  hackmdNoteId: string | null
  hackmdSyncedAt: number
}

interface DocumentRow {
  id: string
  title: string
  markdown: string
  presentation_config: string
  revision: number
  created_at: string
  updated_at: string
  hackmd_note_id: string | null
  hackmd_synced_at: number
}

interface TextEdit {
  start: number
  end: number
  insert: string
}

interface HackMDNote {
  id: string
  title: string
  content: string
  lastChangedAt: number
  publishLink?: string | null
}

const json = (data: unknown, status = 200) => Response.json(data, {
  status,
  headers: { 'Cache-Control': 'no-store' },
})

function normalizePresentationConfig(value: unknown, title: string): PresentationConfig {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const text = (key: keyof PresentationConfig, fallback = '') => typeof source[key] === 'string' ? source[key].slice(0, 300) : fallback
  const theme = source.theme === 'editorial' || source.theme === 'catppuccin' ? source.theme : 'default'
  return {
    theme,
    title: text('title', title).trim() || title,
    subtitle: text('subtitle'),
    seriesName: text('seriesName', 'SceneMD'),
    date: text('date', new Date().toISOString().slice(0, 10)),
    author: text('author'),
    affiliation: text('affiliation'),
    email: text('email'),
    license: text('license', 'CC BY-NC'),
  }
}

function parsePresentationConfig(value: string | undefined, title: string): PresentationConfig {
  try {
    return normalizePresentationConfig(JSON.parse(value || '{}'), title)
  } catch {
    return normalizePresentationConfig({}, title)
  }
}

function cleanBulletMarkdown(value: string): string {
  const withoutFence = value.trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const lines = withoutFence.split('\n').map((line) => line.trim()).filter(Boolean)
  return lines.map((line) => /^[-*+]\s+/.test(line) ? `- ${line.replace(/^[-*+]\s+/, '')}` : `- ${line.replace(/^\d+[.)]\s+/, '')}`).join('\n')
}

function cleanGeneratedNote(value: string): string {
  return value.trim().replace(/^```(?:markdown|md|text)?\s*/i, '').replace(/\s*```$/i, '').trim()
}

function changedSpan(base: string, next: string): TextEdit | null {
  if (base === next) return null
  let start = 0
  const sharedLimit = Math.min(base.length, next.length)
  while (start < sharedLimit && base[start] === next[start]) start += 1
  let baseEnd = base.length
  let nextEnd = next.length
  while (baseEnd > start && nextEnd > start && base[baseEnd - 1] === next[nextEnd - 1]) {
    baseEnd -= 1
    nextEnd -= 1
  }
  return { start, end: baseEnd, insert: next.slice(start, nextEnd) }
}

function editsOverlap(left: TextEdit, right: TextEdit): boolean {
  if (left.start === left.end && right.start === right.end) return left.start === right.start
  if (left.start === left.end) return left.start > right.start && left.start < right.end
  if (right.start === right.end) return right.start > left.start && right.start < left.end
  return left.start < right.end && right.start < left.end
}

/**
 * Merge the common autosave case: each client changed one contiguous span of
 * the same base document. Ambiguous overlapping edits remain a real conflict
 * and must be resolved by the author.
 */
function mergeMarkdown(base: string, local: string, cloud: string): string | null {
  if (local === cloud) return cloud
  if (local === base) return cloud
  if (cloud === base) return local
  const localEdit = changedSpan(base, local)
  const cloudEdit = changedSpan(base, cloud)
  if (!localEdit) return cloud
  if (!cloudEdit) return local
  if (editsOverlap(localEdit, cloudEdit)) return null
  const edits = [localEdit, cloudEdit].sort((left, right) => right.start - left.start)
  return edits.reduce((result, edit) => `${result.slice(0, edit.start)}${edit.insert}${result.slice(edit.end)}`, base)
}

function hackmdNoteId(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    return url.pathname.split('/').filter(Boolean).at(-1)?.replace(/[^a-zA-Z0-9_-]/g, '') ?? ''
  } catch {
    return trimmed.replace(/[^a-zA-Z0-9_-]/g, '')
  }
}

export class DocumentRoom extends DurableObject<Env> {
  private cachedState: DocumentState | null = null

  private async load(documentId: string): Promise<DocumentState | null> {
    if (this.cachedState?.id === documentId) return this.cachedState
    const stored = await this.ctx.storage.get<DocumentState>('document')
    if (stored?.id === documentId) {
      const normalized = {
        ...stored,
        presentationConfig: normalizePresentationConfig(stored.presentationConfig, stored.title),
        hackmdNoteId: stored.hackmdNoteId ?? null,
        hackmdSyncedAt: stored.hackmdSyncedAt ?? 0,
      }
      this.cachedState = normalized
      return normalized
    }
    const row = await this.env.DB.prepare(
      'SELECT id, title, markdown, presentation_config, revision, created_at, updated_at, hackmd_note_id, hackmd_synced_at FROM documents WHERE id = ?',
    ).bind(documentId).first<DocumentRow>()
    if (!row) return null
    this.cachedState = {
      id: row.id,
      title: row.title,
      markdown: row.markdown,
      presentationConfig: parsePresentationConfig(row.presentation_config, row.title),
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      hackmdNoteId: row.hackmd_note_id,
      hackmdSyncedAt: row.hackmd_synced_at,
    }
    await this.ctx.storage.put('document', this.cachedState)
    return this.cachedState
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/ai/bullets' && request.method === 'POST') {
      const body = await request.json<{ text?: string }>()
      const text = body.text?.trim() ?? ''
      if (!text || text.length > 12000) return json({ error: 'Select between 1 and 12,000 characters' }, 400)
      try {
        const result = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
          messages: [
            { role: 'system', content: 'Rewrite the selected prose as concise Markdown bullet points. Preserve every factual claim, number, qualifier, citation, and the original language. Do not add new information. Return only a flat Markdown list with one idea per bullet and no preamble or code fence.' },
            { role: 'user', content: text },
          ],
          temperature: 0.1,
          max_tokens: 768,
        }) as { response?: string }
        const markdown = cleanBulletMarkdown(result.response ?? '')
        return markdown ? json({ markdown }) : json({ error: 'The model returned no bullets' }, 502)
      } catch {
        return json({ error: 'Workers AI could not transform this selection' }, 502)
      }
    }

    if (url.pathname === '/ai/transcript' && request.method === 'POST') {
      const body = await request.json<{ previous?: string; current?: string; next?: string; mode?: 'verbatim' | 'tldr' }>()
      const current = body.current?.trim() ?? ''
      const contextLength = (body.previous?.length ?? 0) + current.length + (body.next?.length ?? 0)
      if (!current || contextLength > 18000) return json({ error: 'The three-scene context must contain between 1 and 18,000 characters' }, 400)
      const concise = body.mode === 'tldr'
      try {
        let transitionContext = 'PREVIOUS: (none)\nNEXT: (none)'
        if (body.previous?.trim() || body.next?.trim()) {
          try {
            const contextResult = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
              messages: [
                {
                  role: 'system',
                  content: 'Create transition-only context for a presentation writer. Summarize PREVIOUS and NEXT separately in exactly one short sentence each (maximum 25 words per sentence). Preserve the source language. Do not infer, explain, combine the scenes, or add facts. Return exactly two plain-text lines beginning PREVIOUS: and NEXT:. Use (none) when a scene is absent.',
                },
                { role: 'user', content: `PREVIOUS\n${body.previous?.trim() || '(none)'}\n\nNEXT\n${body.next?.trim() || '(none)'}` },
              ],
              temperature: 0,
              max_tokens: 160,
            }) as { response?: string }
            transitionContext = cleanGeneratedNote(contextResult.response ?? '') || transitionContext
          } catch {
            // Transcript generation remains useful when optional transition context fails.
          }
        }
        const result = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
          messages: [
            {
              role: 'system',
              content: concise
                ? 'Write concise speaker notes for the CURRENT SCENE. The CURRENT SCENE is the primary content and the only factual source. The TRANSITION CONTEXT is not a source: use it only for at most one brief opening connection and one brief closing connection, and never repeat a fact from it unless that fact also appears in the CURRENT SCENE. Do not infer benefits, consequences, background facts, or explanations. Preserve the current scene\'s language, facts, numbers, uncertainty, and citations. Produce a 30–60 second TL;DR speaking script. Return only spoken plain text, with no heading, bullets, Markdown fence, stage directions, greeting, or audience question.'
                : 'Write a natural 1:1 speaker transcript for the CURRENT SCENE. The CURRENT SCENE must dominate the transcript and is the only factual source. Cover every audience-facing point in it, preserving its language, facts, numbers, uncertainty, and citations. The TRANSITION CONTEXT is not a source: use it only for at most one brief opening connection and one brief closing connection, and never include a fact from it unless that fact also appears in the CURRENT SCENE. Do not infer benefits, consequences, background facts, or explanations. Return only what the presenter can say aloud as plain text, with no heading, bullets, Markdown fence, stage directions, greeting, or audience question.',
            },
            { role: 'user', content: `TRANSITION CONTEXT (navigation only; not a factual source)\n${transitionContext}\n\nCURRENT SCENE (the content to speak)\n${current}` },
          ],
          temperature: 0.15,
          max_tokens: concise ? 480 : 1400,
        }) as { response?: string }
        const note = cleanGeneratedNote(result.response ?? '')
        return note ? json({ note }) : json({ error: 'The model returned no transcript' }, 502)
      } catch {
        return json({ error: 'Workers AI could not generate the transcript' }, 502)
      }
    }

    const documentId = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? '')
    if (!documentId) return json({ error: 'Missing document id' }, 400)

    if (url.pathname.startsWith('/hackmd/')) {
      const current = await this.load(documentId)
      if (!current) return json({ error: 'Document not found' }, 404)
      const headers = { Authorization: `Bearer ${this.env.HACKMD_API}`, 'Content-Type': 'application/json' }
      const requestHackMD = async (path: string, init?: RequestInit) => {
        const response = await fetch(`https://api.hackmd.io/v1${path}`, { ...init, headers: { ...headers, ...init?.headers } })
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 240)
          throw new Error(`HackMD returned ${response.status}${detail ? `: ${detail}` : ''}`)
        }
        return response
      }

      if (request.method === 'GET') {
        try {
          const account = await (await requestHackMD('/me')).json<{ name?: string }>()
          return json({ noteId: current.hackmdNoteId, syncedAt: current.hackmdSyncedAt, accountName: account.name ?? 'HackMD account' })
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : 'HackMD authentication failed' }, 502)
        }
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

      const body = await request.json<{ action?: 'sync' | 'push' | 'pull'; noteId?: string }>()
      const action = body.action ?? 'sync'
      const noteId = hackmdNoteId(body.noteId ?? current.hackmdNoteId ?? '')

      try {
        if (!noteId) {
          if (action === 'pull') return json({ error: 'Enter a HackMD note URL or ID first' }, 400)
          const created = await (await requestHackMD('/notes', {
            method: 'POST',
            body: JSON.stringify({ title: current.title, content: current.markdown, readPermission: 'owner', writePermission: 'owner', commentPermission: 'disabled' }),
          })).json<HackMDNote>()
          const syncedAt = Number(created.lastChangedAt) || Date.now()
          const next = { ...current, hackmdNoteId: created.id, hackmdSyncedAt: syncedAt }
          await this.env.DB.prepare('UPDATE documents SET hackmd_note_id = ?, hackmd_synced_at = ? WHERE id = ?').bind(created.id, syncedAt, documentId).run()
          await this.ctx.storage.put('document', next)
          this.cachedState = next
          return json({ direction: 'created', note: created, document: next })
        }

        const remote = await (await requestHackMD(`/notes/${encodeURIComponent(noteId)}`)).json<HackMDNote>()
        const remoteChangedAt = Number(remote.lastChangedAt) || 0
        const localChangedAt = Date.parse(current.updatedAt)
        let direction: 'pull' | 'push'
        if (action === 'pull') direction = 'pull'
        else if (action === 'push') direction = 'push'
        else {
          const remoteChanged = remoteChangedAt > current.hackmdSyncedAt
          const localChanged = localChangedAt > current.hackmdSyncedAt
          if (remoteChanged && localChanged) return json({ error: 'Both SceneMD and HackMD changed since the last sync', conflict: true, remote }, 409)
          direction = remoteChanged ? 'pull' : 'push'
        }

        if (direction === 'pull') {
          const syncedAt = remoteChangedAt || Date.now()
          const next: DocumentState = {
            ...current,
            title: remote.title || current.title,
            markdown: remote.content ?? current.markdown,
            revision: current.revision + 1,
            updatedAt: new Date().toISOString(),
            hackmdNoteId: noteId,
            hackmdSyncedAt: syncedAt,
          }
          await this.env.DB.prepare(
            'UPDATE documents SET title = ?, markdown = ?, revision = ?, updated_at = ?, hackmd_note_id = ?, hackmd_synced_at = ? WHERE id = ?',
          ).bind(next.title, next.markdown, next.revision, next.updatedAt, noteId, syncedAt, documentId).run()
          await this.ctx.storage.put('document', next)
          this.cachedState = next
          return json({ direction, note: remote, document: next })
        }

        await requestHackMD(`/notes/${encodeURIComponent(noteId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ title: current.title, content: current.markdown }),
        })
        const refreshed = await (await requestHackMD(`/notes/${encodeURIComponent(noteId)}`)).json<HackMDNote>()
        const syncedAt = Number(refreshed.lastChangedAt) || Date.now()
        const next = { ...current, hackmdNoteId: noteId, hackmdSyncedAt: syncedAt }
        await this.env.DB.prepare('UPDATE documents SET hackmd_note_id = ?, hackmd_synced_at = ? WHERE id = ?').bind(noteId, syncedAt, documentId).run()
        await this.ctx.storage.put('document', next)
        this.cachedState = next
        return json({ direction, note: refreshed, document: next })
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'HackMD sync failed' }, 502)
      }
    }

    if (request.method === 'GET') {
      const state = await this.load(documentId)
      return state ? json(state) : json({ error: 'Document not found' }, 404)
    }

    if (request.method === 'PATCH') {
      const current = await this.load(documentId)
      if (!current) return json({ error: 'Document not found' }, 404)
      const body = await request.json<{ title?: string; markdown?: string; baseMarkdown?: string; presentationConfig?: unknown; baseRevision?: number }>()
      let nextMarkdown = body.markdown ?? current.markdown
      let merged = false
      if (body.baseRevision !== undefined && body.baseRevision !== current.revision) {
        if (typeof body.markdown !== 'string' || typeof body.baseMarkdown !== 'string') {
          return json({ error: 'Document changed in another session', document: current }, 409)
        }
        const mergedMarkdown = mergeMarkdown(body.baseMarkdown, body.markdown, current.markdown)
        if (mergedMarkdown === null) return json({ error: 'The same content changed in another session', document: current }, 409)
        nextMarkdown = mergedMarkdown
        merged = true
      }
      const next: DocumentState = {
        ...current,
        title: body.title?.trim() || current.title,
        markdown: nextMarkdown,
        presentationConfig: normalizePresentationConfig(body.presentationConfig ?? current.presentationConfig, body.title?.trim() || current.title),
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      }
      await this.env.DB.prepare(
        'UPDATE documents SET title = ?, markdown = ?, presentation_config = ?, revision = ?, updated_at = ? WHERE id = ?',
      ).bind(next.title, next.markdown, JSON.stringify(next.presentationConfig), next.revision, next.updatedAt, documentId).run()
      await this.ctx.storage.put('document', next)
      this.cachedState = next
      return json({ ...next, merged })
    }

    if (request.method === 'DELETE') {
      await this.env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(documentId).run()
      await this.ctx.storage.deleteAll()
      this.cachedState = null
      return new Response(null, { status: 204 })
    }

    return json({ error: 'Method not allowed' }, 405)
  }
}

export default {
  fetch() {
    return json({ service: 'SceneMD live document coordinator' })
  },
} satisfies ExportedHandler<Env>
