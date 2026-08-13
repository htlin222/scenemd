export interface OpenEvidenceTurn {
  question: string
  answerMarkdown: string
}

export interface OpenEvidenceConversation {
  title: string
  turns: OpenEvidenceTurn[]
}

interface ReferenceSection {
  start: number
  end: number
  entries: Array<{ number: number; text: string }>
}

const CHROME_SELECTOR = [
  'button',
  'svg',
  'textarea',
  'input',
  'form',
  '[role="button"]',
  '[role="progressbar"]',
  '.MuiStepper-root',
  '.MuiStep-root',
  '.MuiStepButton-root',
  '.MuiStepLabel-root',
  '[data-testid$="Icon"]',
  '[data-testid^="ask--query-bar"]',
].join(',')

const REFS_SELECTOR = '[class*="references_container"], .brandable--references'
const REF_ITEM_SELECTOR = '[class*="ArticleReferences_reference__"]'
const CITATION_CHIP_SELECTOR = '[class*="markdown-article-citation-chip"]'
const STATUS_TEXTS = new Set([
  'Analyzed query, searched for evidence',
  'Analyzed query',
  'Searched published medical literature, guidelines, FDA, CDC, and more',
  'Done',
])

export function isOpenEvidenceConversationUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && ['openevidence.com', 'www.openevidence.com'].includes(url.hostname.toLowerCase())
      && url.pathname.startsWith('/ask/')
      && url.pathname.length > '/ask/'.length
  } catch {
    return false
  }
}

export function parseOpenEvidenceConversation(html: string): OpenEvidenceConversation {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  let title = normalize(doc.querySelector('title')?.textContent ?? '')
    .replace(/\s*\|\s*OpenEvidence\s*$/i, '')
    .trim()
  const articles = [...doc.querySelectorAll('article')]

  if (!articles.length) {
    if (!doc.querySelector('[data-answer-end]')) return { title, turns: [] }
    const body = doc.body?.cloneNode(true) as HTMLElement | undefined
    if (!body) return { title, turns: [] }
    const answerMarkdown = extractAnswerMarkdown(body)
    return { title, turns: answerMarkdown ? [{ question: title || 'OpenEvidence answer', answerMarkdown }] : [] }
  }

  const queryBars = [...doc.querySelectorAll('[data-testid="ask--query-bar"]')]
  const turns = articles
    .map((article) => ({
      question: questionForArticle(article, queryBars) || 'OpenEvidence answer',
      answerMarkdown: extractAnswerMarkdown(article),
    }))
    .filter((turn) => turn.answerMarkdown)

  if (!title || title.toLowerCase() === 'openevidence') title = turns[0]?.question ?? ''
  return { title, turns }
}

export async function openEvidenceConversationMarkdown(conversation: OpenEvidenceConversation, selected: Set<number>): Promise<string> {
  const markdown = normalizeMarkdownUrls(conversation.turns
    .filter((_, index) => selected.has(index))
    .map((turn) => `## ${turn.question}\n\n${turn.answerMarkdown}`)
    .join('\n\n'))
  return normalizeMarkdownUrls(await enrichMarkdownReferences(aggregateMarkdownReferences(markdown)))
}

export function normalizeMarkdownUrls(markdown: string): string {
  return markdown.replace(/\]\((https?:\/\/[^)]*)\)/gi, (_match, url: string) => `](${url.replace(/\s+/g, '')})`)
}

function cleanDoiMatch(value: string): string {
  let doi = value.replace(/[.,;:]+$/, '')
  while (doi.endsWith(')') && (doi.match(/\(/g)?.length ?? 0) < (doi.match(/\)/g)?.length ?? 0)) doi = doi.slice(0, -1)
  return doi
}

/**
 * OpenEvidence restarts citation numbers for every answer. Normalize every
 * body/reference pair into one document-level bibliography, deduplicating by
 * DOI, PMID, canonical URL, and finally normalized title.
 */
export function aggregateMarkdownReferences(markdown: string): string {
  markdown = normalizeMarkdownUrls(markdown)
  const sections = referenceSections(markdown)
  if (!sections.length) return markdown

  const references: string[] = []
  const referenceNumbers = new Map<string, number>()
  let cursor = 0
  let body = ''

  sections.forEach((section) => {
    const localToGlobal = new Map<number, number>()
    section.entries.forEach((entry) => {
      const key = referenceKey(entry.text)
      let globalNumber = referenceNumbers.get(key)
      if (!globalNumber) {
        globalNumber = references.length + 1
        referenceNumbers.set(key, globalNumber)
        references.push(entry.text.trim())
      }
      localToGlobal.set(entry.number, globalNumber)
    })
    body += remapCitationMarkers(markdown.slice(cursor, section.start), localToGlobal)
    cursor = section.end
  })

  body += markdown.slice(cursor)
  const cleanBody = body.replace(/\n{3,}/g, '\n\n').trim()
  if (!references.length) return cleanBody
  return `${cleanBody}\n\n### References\n\n${references.map((reference, index) => `${index + 1}. ${reference}`).join('\n')}\n`
}

function referenceSections(markdown: string): ReferenceSection[] {
  const headings = [...markdown.matchAll(/^###\s+References\s*$/gim)]
  return headings.flatMap((heading): ReferenceSection[] => {
    if (heading.index === undefined) return []
    const bodyStart = heading.index + heading[0].length
    const tail = markdown.slice(bodyStart)
    const boundary = /^(?:---\s*$|#{1,3}\s+\S.*$)/m.exec(tail)
    const end = boundary?.index === undefined ? markdown.length : bodyStart + boundary.index
    const referenceBody = markdown.slice(bodyStart, end)
    const starts = [...referenceBody.matchAll(/^\s*(\d+)\.\s+/gm)]
    const entries = starts.map((entry, index) => ({
      number: Number(entry[1]),
      text: referenceBody.slice((entry.index ?? 0) + entry[0].length, starts[index + 1]?.index ?? referenceBody.length).replace(/\s+/g, ' ').trim(),
    }))
    return entries.length ? [{ start: heading.index, end, entries }] : []
  })
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value)
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key)) url.searchParams.delete(key)
    url.pathname = url.pathname.replace(/\/$/, '')
    return url.toString().toLowerCase()
  } catch {
    return value.toLowerCase()
  }
}

function referenceKey(reference: string): string {
  const doiMatch = reference.match(/10\.\d{4,9}\/[\w.()/:;+-]+/i)?.[0]
  const doi = doiMatch ? cleanDoiMatch(doiMatch).toLowerCase() : null
  if (doi) return `doi:${doi}`
  const url = reference.match(/https?:\/\/[^)\s]+/i)?.[0]
  const pmid = url?.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i)?.[1] ?? reference.match(/PMID\s*:\s*(\d+)/i)?.[1]
  if (pmid) return `pmid:${pmid}`
  if (url) return `url:${canonicalUrl(url)}`
  const title = reference.match(/^\[([^\]]+)]/)?.[1] ?? reference.split(/\.\s/)[0]
  return `title:${normalize(title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')}`
}

function citationNumbers(value: string): number[] {
  const numbers: number[] = []
  value.split(',').forEach((part) => {
    const range = part.trim().match(/^(\d+)\s*[-–]\s*(\d+)$/)
    if (range) {
      const start = Number(range[1])
      const end = Number(range[2])
      for (let number = Math.min(start, end); number <= Math.max(start, end); number += 1) numbers.push(number)
    } else if (/^\d+$/.test(part.trim())) numbers.push(Number(part.trim()))
  })
  return numbers
}

function mappedMarkers(value: string, mapping: Map<number, number>): string {
  const mapped = citationNumbers(value).map((number) => mapping.get(number)).filter((number): number is number => Boolean(number))
  return [...new Set(mapped)].map((number) => `[${number}]`).join('')
}

function remapCitationMarkers(body: string, mapping: Map<number, number>): string {
  const linked = body.replace(/\[((?:\\.|[^\]])*)]\(([^)\n]+)\)/g, (match, label: string) => {
    const groups = [...label.matchAll(/\\?\[([\d,\s\-–]+)\\?\]/g)]
    if (!groups.length) return match
    const markers = groups.map((group) => mappedMarkers(group[1], mapping)).join('')
    return markers || match
  })
  return linked.replace(/\\?\[([\d,\s\-–]+)\\?\]/g, (match, numbers: string) => mappedMarkers(numbers, mapping) || match)
}

function citationIdentifier(reference: string): { type: 'doi' | 'pmid'; value: string } | null {
  const pmid = reference.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i)?.[1] ?? reference.match(/PMID\s*:\s*(\d+)/i)?.[1]
  if (pmid) return { type: 'pmid', value: pmid }
  const doiMatch = reference.match(/10\.\d{4,9}\/[\w.()/:;+-]+/i)?.[0]
  const doi = doiMatch ? cleanDoiMatch(doiMatch) : null
  return doi ? { type: 'doi', value: doi } : null
}

/** Resolve DOI/PubMed-backed entries through SceneMD's server citation
 * endpoint so OpenEvidence imports use the same AMA formatter as the editor. */
export async function enrichMarkdownReferences(markdown: string): Promise<string> {
  const section = referenceSections(markdown)[0]
  if (!section) return markdown
  const enriched: string[] = []
  for (const entry of section.entries) {
    const identifier = citationIdentifier(entry.text)
    if (!identifier) {
      enriched.push(entry.text)
      continue
    }
    try {
      const endpoint = `/api/citations?${identifier.type}=${encodeURIComponent(identifier.value)}&format=ama&v=2`
      let response = await fetch(endpoint)
      if (response.status === 429 || response.status >= 500) {
        await new Promise((resolve) => window.setTimeout(resolve, 240))
        response = await fetch(endpoint)
      }
      const result = await response.json() as { citation?: string }
      enriched.push(response.ok && result.citation
        ? result.citation.replace(/^\s*\d+\.\s*/, '').replace(/\.\s*,\s*ed\.\s*/gi, '. ').trim()
        : entry.text)
    } catch {
      enriched.push(entry.text)
    }
  }
  const bibliography = `### References\n\n${enriched.map((reference, index) => `${index + 1}. ${reference}`).join('\n')}\n`
  return `${markdown.slice(0, section.start).trimEnd()}\n\n${bibliography}${markdown.slice(section.end).trimStart()}`.trimEnd() + '\n'
}

function questionForArticle(article: Element, queryBars: Element[]): string {
  let nearest: Element | null = null
  for (const bar of queryBars) {
    const position = article.compareDocumentPosition(bar)
    if (position & Node.DOCUMENT_POSITION_PRECEDING) nearest = bar
    else break
  }
  return normalize(nearest?.textContent ?? '')
}

function extractAnswerMarkdown(article: Element): string {
  const clone = article.cloneNode(true) as HTMLElement
  const references = clone.querySelector(REFS_SELECTOR)
  const referenceUrls = references ? extractReferenceUrls(references) : []
  const referencesMarkdown = references ? referencesToMarkdown(references) : ''
  const sentinel = clone.querySelector('[data-answer-end]')
  let body: HTMLElement

  if (sentinel) {
    const range = clone.ownerDocument.createRange()
    range.selectNodeContents(clone)
    range.setEndBefore(sentinel)
    body = clone.ownerDocument.createElement('div')
    body.appendChild(range.cloneContents())
  } else {
    body = clone
    removeFollowUps(body)
  }

  body.querySelectorAll(REFS_SELECTOR).forEach((node) => node.remove())
  linkifyCitations(body, referenceUrls)
  stripChrome(body)
  const answer = htmlElementToMarkdown(body)
  return [answer, referencesMarkdown].filter(Boolean).join('\n\n').trim()
}

function extractReferenceUrls(references: Element): string[] {
  return [...references.querySelectorAll(REF_ITEM_SELECTOR)].map((item) => item.querySelector('a[href]')?.getAttribute('href') ?? '')
}

function referencesToMarkdown(references: Element): string {
  const items = [...references.querySelectorAll(REF_ITEM_SELECTOR)]
  if (!items.length) return ''
  const lines = items.map((item, index) => {
    const anchor = item.querySelector('a[href]')
    const title = normalize(anchor?.textContent || item.querySelector('[class*="reference-title"]')?.textContent || '')
    const subtitleElement = item.querySelector('[class*="reference-subtitle"]')
    const subtitle = subtitleElement
      ? [...subtitleElement.children].map((child) => normalize(child.textContent ?? '')).filter(Boolean).join(' ')
      : ''
    const href = cleanExtractedUrl(anchor?.getAttribute('href') ?? '')
    const label = href && title ? `[${escapeMarkdownText(title)}](${href})` : escapeMarkdownText(title)
    return `${index + 1}. ${[label, escapeMarkdownText(subtitle)].filter(Boolean).join(' ')}`.trim()
  }).filter((line) => !/^\d+\.\s*$/.test(line))
  return lines.length ? `### References\n\n${lines.join('\n')}` : ''
}

function cleanExtractedUrl(value: string): string {
  // OpenEvidence sometimes serializes a long href with indentation/newlines.
  // Whitespace is never valid in these HTTP(S) destinations and would break
  // both the rendered link and DOI/PMID recognition.
  return value.trim().replace(/\s+/g, '')
}

function linkifyCitations(root: HTMLElement, referenceUrls: string[]) {
  root.querySelectorAll(CITATION_CHIP_SELECTOR).forEach((chip) => {
    const text = normalize(chip.textContent ?? '')
    const match = text.match(/\[(\d+)/)
    const href = match ? referenceUrls[Number.parseInt(match[1], 10) - 1] : ''
    if (!href || !text) {
      chip.replaceWith(chip.ownerDocument.createTextNode(text))
      return
    }
    const anchor = chip.ownerDocument.createElement('a')
    anchor.href = href
    anchor.textContent = text
    chip.replaceWith(anchor)
  })
}

function stripChrome(root: HTMLElement) {
  root.querySelectorAll('button, a, [role="button"]').forEach((element) => {
    const images = [...element.querySelectorAll('img')].filter((image) => isContentImage(image.getAttribute('src') ?? ''))
    if (images.length) element.replaceWith(...images)
  })
  root.querySelectorAll(CHROME_SELECTOR).forEach((node) => node.remove())
  root.querySelectorAll('p, span, div, li').forEach((element) => {
    const text = normalize(element.textContent ?? '')
    if (STATUS_TEXTS.has(text) || (text.startsWith('Analyzed query') && text.length < 80)) element.remove()
  })
  root.querySelectorAll('img').forEach((image) => {
    const source = image.getAttribute('src') ?? ''
    if (!isContentImage(source)) {
      image.remove()
      return
    }
    image.setAttribute('src', resolveNextImage(source))
    image.removeAttribute('srcset')
  })
}

function isContentImage(source: string): boolean {
  if (!source || source.includes('favicons')) return false
  return /^https?:\/\//i.test(source) || source.startsWith('/_next/image')
}

function resolveNextImage(source: string): string {
  if (!source.startsWith('/_next/image')) return source
  try {
    return new URL(source, 'https://www.openevidence.com').searchParams.get('url') || source
  } catch {
    return source
  }
}

function removeFollowUps(root: HTMLElement) {
  for (const element of [...root.querySelectorAll('*')]) {
    if (normalize(element.textContent ?? '') === 'Follow-Up Questions') {
      (element.closest('[class*="follow-up"]') || element.parentElement || element).remove()
      return
    }
  }
}

function htmlElementToMarkdown(root: HTMLElement): string {
  const render = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/g, ' ')
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const element = node as HTMLElement
    const tag = element.tagName.toLowerCase()
    const children = () => [...element.childNodes].map(render).join('')

    if (['script', 'style', 'noscript', 'template'].includes(tag)) return ''
    if (tag === 'br') return '\n'
    if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${children().trim()}\n\n`
    if (tag === 'p') return `\n\n${children().trim()}\n\n`
    if (tag === 'strong' || tag === 'b') return `**${children().trim()}**`
    if (tag === 'em' || tag === 'i') return `_${children().trim()}_`
    if (tag === 'del' || tag === 's') return `~~${children().trim()}~~`
    if (tag === 'code' && element.parentElement?.tagName.toLowerCase() !== 'pre') return `\`${children().trim().replaceAll('`', '\\`')}\``
    if (tag === 'pre') return `\n\n\`\`\`\n${element.textContent?.trim() ?? ''}\n\`\`\`\n\n`
    if (tag === 'a') {
      const label = children().trim()
      const href = cleanExtractedUrl(element.getAttribute('href') ?? '')
      const escapedLabel = label.replace(/([\[\]])/g, '\\$1')
      return href && escapedLabel ? `[${escapedLabel}](${href})` : label
    }
    if (tag === 'img') {
      const source = (element.getAttribute('src') ?? '').trim()
      return source ? `\n\n![${escapeMarkdownText(element.getAttribute('alt') || 'OpenEvidence figure')}](${source})\n\n` : ''
    }
    if (tag === 'blockquote') {
      const quote = children().trim().split('\n').map((line) => `> ${line}`).join('\n')
      return `\n\n${quote}\n\n`
    }
    if (tag === 'ul' || tag === 'ol') return renderList(element, tag === 'ol', render)
    if (tag === 'table') return renderTable(element)
    if (['div', 'section', 'article', 'figure', 'figcaption'].includes(tag)) return `\n\n${children().trim()}\n\n`
    return children()
  }

  return [...root.childNodes]
    .map(render)
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function renderList(element: HTMLElement, ordered: boolean, render: (node: Node) => string): string {
  const items = [...element.children].filter((child) => child.tagName.toLowerCase() === 'li')
  const lines = items.map((item, index) => {
    const nested = [...item.children].filter((child) => ['ul', 'ol'].includes(child.tagName.toLowerCase()))
    const body = [...item.childNodes]
      .filter((child) => !(child.nodeType === Node.ELEMENT_NODE && nested.includes(child as Element)))
      .map(render)
      .join('')
      .replace(/\n+/g, ' ')
      .trim()
    const marker = ordered ? `${index + 1}.` : '-'
    const nestedMarkdown = nested.map((child) => render(child).trim().split('\n').map((line) => `  ${line}`).join('\n')).join('\n')
    return `${marker} ${body}${nestedMarkdown ? `\n${nestedMarkdown}` : ''}`
  })
  return `\n\n${lines.join('\n')}\n\n`
}

function renderTable(element: HTMLElement): string {
  const rows = [...element.querySelectorAll('tr')].map((row) => [...row.querySelectorAll(':scope > th, :scope > td')].map((cell) => normalize(cell.textContent ?? '').replaceAll('|', '\\|')))
  if (!rows.length || !rows[0].length) return ''
  const width = Math.max(...rows.map((row) => row.length))
  const normalizedRows = rows.map((row) => [...row, ...Array.from({ length: width - row.length }, () => '')])
  return `\n\n| ${normalizedRows[0].join(' | ')} |\n| ${Array.from({ length: width }, () => '---').join(' | ')} |\n${normalizedRows.slice(1).map((row) => `| ${row.join(' | ')} |`).join('\n')}\n\n`
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\[\]*_`])/g, '\\$1')
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
