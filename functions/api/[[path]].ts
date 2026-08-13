interface Env {
  DB: D1Database
  DOCUMENTS: DurableObjectNamespace
  IMAGES: R2Bucket
}

interface PresentationConfig {
  title: string
  subtitle: string
  seriesName: string
  date: string
  author: string
  affiliation: string
  email: string
  license: string
}

interface DocumentListRow {
  id: string
  title: string
  revision: number
  owner_email: string | null
  share_token_hash: string | null
  created_at: string
  updated_at: string
}

const responseHeaders = { 'Cache-Control': 'no-store' }
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: responseHeaders })

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function documentStub(env: Env, id: string): DurableObjectStub {
  return env.DOCUMENTS.getByName(id)
}

function presentationConfig(value: unknown, title: string): PresentationConfig {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const text = (key: keyof PresentationConfig, fallback = '') => typeof source[key] === 'string' ? source[key].slice(0, 300) : fallback
  return {
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

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const segments = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  const [resource, id, action] = segments

  if (resource === 'oe' && id === 'fetch' && context.request.method === 'GET') {
    const source = url.searchParams.get('url') ?? ''
    let conversationUrl: URL
    try {
      conversationUrl = new URL(source)
    } catch {
      return json({ error: 'Invalid OpenEvidence URL' }, 400)
    }
    const allowedHosts = new Set(['openevidence.com', 'www.openevidence.com'])
    if (conversationUrl.protocol !== 'https:' || !allowedHosts.has(conversationUrl.hostname.toLowerCase()) || !conversationUrl.pathname.startsWith('/ask/')) {
      return json({ error: 'URL must be a public openevidence.com/ask conversation' }, 400)
    }
    try {
      const response = await fetch(`https://www.openevidence.com${conversationUrl.pathname}`, {
        headers: {
          Accept: 'text/html',
          'User-Agent': 'Mozilla/5.0 (compatible; SceneMD/1.0; +https://scenemd.pages.dev)',
        },
        redirect: 'follow',
      })
      if (!response.ok) return json({ error: `OpenEvidence returned ${response.status}` }, 502)
      const finalUrl = new URL(response.url || conversationUrl)
      if (!allowedHosts.has(finalUrl.hostname.toLowerCase()) || !finalUrl.pathname.startsWith('/ask/')) return json({ error: 'Conversation is not public' }, 403)
      const html = await response.text()
      if (html.length > 3 * 1024 * 1024) return json({ error: 'Conversation page is too large' }, 413)
      return json({ html, url: finalUrl.toString() })
    } catch {
      return json({ error: 'Could not reach OpenEvidence' }, 502)
    }
  }

  if (resource === 'ai' && id === 'bullets' && context.request.method === 'POST') {
    const body = await context.request.json<{ text?: string; documentId?: string }>()
    const selectedText = body.text?.trim() ?? ''
    if (!selectedText || selectedText.length > 12000) return json({ error: 'Select between 1 and 12,000 characters' }, 400)
    const coordinatorId = body.documentId?.replace(/[^a-zA-Z0-9-]/g, '') || 'editor-assistant'
    const stub = documentStub(context.env, coordinatorId)
    return stub.fetch(new Request('https://document.internal/ai/bullets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: selectedText }),
    }))
  }

  if (resource === 'uploads' && id === 'images' && context.request.method === 'POST') {
    const contentType = context.request.headers.get('Content-Type')?.split(';')[0] ?? ''
    const allowedTypes: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
    }
    const extension = allowedTypes[contentType]
    if (!extension) return json({ error: 'Unsupported image type' }, 415)
    const bytes = await context.request.arrayBuffer()
    if (!bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024) return json({ error: 'Images must be between 1 byte and 10 MB' }, 413)
    const documentId = url.searchParams.get('documentId')?.replace(/[^a-zA-Z0-9-]/g, '') || 'draft'
    const key = `documents/${documentId}/${crypto.randomUUID()}.${extension}`
    await context.env.IMAGES.put(key, bytes, {
      httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: { uploadedBy: context.request.headers.get('Cf-Access-Authenticated-User-Email') ?? 'unknown' },
    })
    const imageUrl = new URL(`/api/images/${key}`, context.request.url)
    return json({ url: imageUrl.toString(), key }, 201)
  }

  if (resource === 'images' && id && context.request.method === 'GET') {
    const key = segments.slice(1).join('/')
    const object = await context.env.IMAGES.get(key)
    if (!object) return json({ error: 'Image not found' }, 404)
    const headers = new Headers()
    object.writeHttpMetadata(headers)
    headers.set('etag', object.httpEtag)
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    headers.set('X-Content-Type-Options', 'nosniff')
    return new Response(object.body, { headers })
  }

  if (resource === 'share' && id && context.request.method === 'GET') {
    const tokenHash = await sha256(id)
    const document = await context.env.DB.prepare(
      'SELECT id, title, markdown, presentation_config, revision, created_at, updated_at FROM documents WHERE share_token_hash = ?',
    ).bind(tokenHash).first()
    if (!document) return json({ error: 'Shared document not found' }, 404)
    const row = document as Record<string, unknown>
    return json({ ...row, presentationConfig: presentationConfig(JSON.parse(String(row.presentation_config || '{}')), String(row.title)) })
  }

  if (resource !== 'documents') return json({ error: 'Not found' }, 404)

  if (!id && context.request.method === 'GET') {
    const result = await context.env.DB.prepare(
      'SELECT id, title, revision, owner_email, share_token_hash, created_at, updated_at FROM documents ORDER BY updated_at DESC',
    ).all<DocumentListRow>()
    return json({ documents: result.results.map((document) => ({
      id: document.id,
      title: document.title,
      revision: document.revision,
      ownerEmail: document.owner_email,
      shared: Boolean(document.share_token_hash),
      createdAt: document.created_at,
      updatedAt: document.updated_at,
    })) })
  }

  if (!id && context.request.method === 'POST') {
    const body = await context.request.json<{ title?: string; markdown?: string; presentationConfig?: unknown }>()
    const documentId = crypto.randomUUID()
    const title = body.title?.trim() || 'Untitled document'
    const markdown = body.markdown ?? `# ${title}\n\nStart writing…\n`
    const now = new Date().toISOString()
    const ownerEmail = context.request.headers.get('Cf-Access-Authenticated-User-Email')
    const coverConfig = presentationConfig(body.presentationConfig, title)
    await context.env.DB.prepare(
      'INSERT INTO documents (id, title, markdown, presentation_config, revision, owner_email, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
    ).bind(documentId, title, markdown, JSON.stringify(coverConfig), ownerEmail, now, now).run()
    return json({ id: documentId, title, markdown, presentationConfig: coverConfig, revision: 1, createdAt: now, updatedAt: now }, 201)
  }

  if (!id) return json({ error: 'Not found' }, 404)

  if (action === 'share' && context.request.method === 'POST') {
    const token = randomToken()
    await context.env.DB.prepare('UPDATE documents SET share_token_hash = ? WHERE id = ?').bind(await sha256(token), id).run()
    return json({ token, sharePath: `/share/${token}` })
  }

  if (action === 'share' && context.request.method === 'DELETE') {
    await context.env.DB.prepare('UPDATE documents SET share_token_hash = NULL WHERE id = ?').bind(id).run()
    return new Response(null, { status: 204 })
  }

  if (action === 'hackmd' && ['GET', 'POST'].includes(context.request.method)) {
    const stub = documentStub(context.env, id)
    return stub.fetch(new Request(`https://document.internal/hackmd/${encodeURIComponent(id)}`, {
      method: context.request.method,
      headers: context.request.headers,
      body: context.request.method === 'GET' ? undefined : context.request.body,
    }))
  }

  if (!action && ['GET', 'PATCH', 'DELETE'].includes(context.request.method)) {
    const stub = documentStub(context.env, id)
    return stub.fetch(new Request(`https://document.internal/state/${encodeURIComponent(id)}`, {
      method: context.request.method,
      headers: context.request.headers,
      body: ['GET', 'HEAD'].includes(context.request.method) ? undefined : context.request.body,
    }))
  }

  return json({ error: 'Not found' }, 404)
}
