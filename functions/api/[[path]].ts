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

function normalizeDoi(value: string): string | null {
  let candidate = value.trim()
    .replace(/^doi\s*:\s*/i, '')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
  try {
    candidate = decodeURIComponent(candidate)
  } catch {
    // Preserve malformed percent sequences so they fail validation below.
  }
  const match = candidate.match(/^10\.\d{4,9}\/[\w.()/:;+-]+$/i)
  return match ? match[0].toLowerCase() : null
}

function normalizePmid(value: string): string | null {
  let candidate = value.trim()
  const pubmedUrl = candidate.match(/^https?:\/\/(?:www\.)?pubmed\.ncbi\.nlm\.nih\.gov\/(\d{1,10})\/?(?:[?#].*)?$/i)
    ?? candidate.match(/^https?:\/\/www\.ncbi\.nlm\.nih\.gov\/pubmed\/(\d{1,10})\/?(?:[?#].*)?$/i)
  if (pubmedUrl) return pubmedUrl[1]
  candidate = candidate.replace(/^PMID\s*:\s*/i, '').trim()
  return /^\d{1,10}$/.test(candidate) ? candidate : null
}

function doiUrl(doi: string): string {
  return `https://doi.org/${doi.split('/').map(encodeURIComponent).join('/')}`
}

async function formattedDoi(context: EventContext<Env, string, unknown>, doi: string, format: 'ama' | 'bibtex'): Promise<Response> {
  const cacheKey = new Request(`https://citation-cache.scenemd.local/v2/${format}/${encodeURIComponent(doi)}`)
  const cache = (caches as CacheStorage & { default: Cache }).default
  const cached = await cache.match(cacheKey)
  if (cached) return cached
  const accept = format === 'ama'
    ? 'text/x-bibliography; style=american-medical-association; locale=en-US'
    : 'application/x-bibtex'
  try {
    const response = await fetch(doiUrl(doi), {
      headers: {
        Accept: accept,
        'User-Agent': 'SceneMD/0.1 (https://scenemd.pages.dev; mailto:hsieh.ting.lin@gmail.com)',
      },
      redirect: 'follow',
    })
    if (!response.ok) return json({ error: response.status === 404 ? 'DOI not found' : `DOI service returned ${response.status}` }, response.status === 404 ? 404 : 502)
    const formatted = (await response.text()).trim().replace(/\.\s*,\s*ed\.\s*/gi, '. ')
    if (!formatted || formatted.length > 100_000) return json({ error: 'DOI service returned invalid metadata' }, 502)
    const payload = Response.json(format === 'ama' ? { doi, citation: formatted } : { doi, bibtex: formatted }, {
      headers: { 'Cache-Control': 'public, max-age=604800' },
    })
    context.waitUntil(cache.put(cacheKey, payload.clone()))
    return payload
  } catch {
    return json({ error: 'Could not reach the DOI metadata service' }, 502)
  }
}

async function formattedPmid(context: EventContext<Env, string, unknown>, pmid: string): Promise<Response> {
  const cacheKey = new Request(`https://citation-cache.scenemd.local/ama/pmid/${pmid}`)
  const cache = (caches as CacheStorage & { default: Cache }).default
  const cached = await cache.match(cacheKey)
  if (cached) return cached
  try {
    // NLM's official Literature Citation Exporter returns PubMed records in AMA.
    // https://pmc.ncbi.nlm.nih.gov/api/ctxp/
    const endpoint = new URL('https://pmc.ncbi.nlm.nih.gov/api/ctxp/v1/pubmed/')
    endpoint.searchParams.set('format', 'citation')
    endpoint.searchParams.set('id', pmid)
    const response = await fetch(endpoint, {
      headers: { 'User-Agent': 'SceneMD/0.1 (https://scenemd.pages.dev; mailto:hsieh.ting.lin@gmail.com)' },
    })
    if (!response.ok) return json({ error: `PubMed service returned ${response.status}` }, 502)
    const record = await response.json<{
      id?: string
      ama?: { orig?: string }
    } | null>()
    const citation = record?.ama?.orig?.replace(/\s+/g, ' ').trim() ?? ''
    if (record?.id?.toLowerCase() !== `pmid:${pmid}` || !citation || citation.length > 100_000) {
      return json({ error: 'PubMed ID not found' }, 404)
    }
    const doiMatch = citation.match(/10\.\d{4,9}\/[\w.()/:;+-]+/i)?.[0]
    const doi = doiMatch ? normalizeDoi(doiMatch.replace(/[.,;:]+$/, '')) : null
    const formatted = doi || /PMID\s*:/i.test(citation) ? citation : `${citation.replace(/[.\s]+$/, '')}. PMID: ${pmid}.`
    const payload = Response.json({ pmid, doi, citation: formatted }, {
      headers: { 'Cache-Control': 'public, max-age=604800' },
    })
    context.waitUntil(cache.put(cacheKey, payload.clone()))
    return payload
  } catch {
    return json({ error: 'Could not reach PubMed' }, 502)
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

  if (resource === 'ai' && id === 'transcript' && context.request.method === 'POST') {
    const body = await context.request.json<{ previous?: string; current?: string; next?: string; mode?: 'verbatim' | 'tldr'; documentId?: string }>()
    const current = body.current?.trim() ?? ''
    const contextLength = (body.previous?.length ?? 0) + current.length + (body.next?.length ?? 0)
    if (!current || contextLength > 18000) return json({ error: 'The three-scene context must contain between 1 and 18,000 characters' }, 400)
    const coordinatorId = body.documentId?.replace(/[^a-zA-Z0-9-]/g, '') || 'editor-assistant'
    const stub = documentStub(context.env, coordinatorId)
    return stub.fetch(new Request('https://document.internal/ai/transcript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ previous: body.previous, current, next: body.next, mode: body.mode }),
    }))
  }

  if (resource === 'citations' && context.request.method === 'GET') {
    const doi = normalizeDoi(url.searchParams.get('doi') ?? '')
    const pmid = normalizePmid(url.searchParams.get('pmid') ?? '')
    const format = url.searchParams.get('format') === 'bibtex' ? 'bibtex' : 'ama'
    if (doi) return formattedDoi(context, doi, format)
    if (pmid && format === 'ama') return formattedPmid(context, pmid)
    if (pmid) return json({ error: 'PubMed BibTeX export requires a DOI' }, 400)
    return json({ error: 'Enter a valid DOI or PubMed ID' }, 400)
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
