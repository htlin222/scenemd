export interface BibliographyUrl {
  url: string
  title: string
}

export interface BibliographySources {
  dois: string[]
  urls: BibliographyUrl[]
}

const DOI_PATTERN = /10\.\d{4,9}\/[\w.()/:;+-]+/i
const DOI_GLOBAL_PATTERN = /10\.\d{4,9}\/[\w.()/:;+-]+/gi
export interface CitationIdentifier {
  type: 'doi' | 'pmid'
  value: string
}

export function normalizeDoi(value: string): string | null {
  let candidate = value.trim()
    .replace(/^doi\s*:\s*/i, '')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .trim()
  try {
    candidate = decodeURIComponent(candidate)
  } catch {
    // Keep the original text when a pasted DOI contains a stray percent sign.
  }
  const match = candidate.match(DOI_PATTERN)
  if (!match || match.index !== 0) return null
  const doi = match[0].replace(/[.,;:]+$/, '')
  return doi.length === candidate.replace(/[.,;:]+$/, '').length ? doi.toLowerCase() : null
}

export function normalizePmid(value: string): string | null {
  let candidate = value.trim()
  const pubmedUrl = candidate.match(/^https?:\/\/(?:www\.)?pubmed\.ncbi\.nlm\.nih\.gov\/(\d{1,10})\/?(?:[?#].*)?$/i)
    ?? candidate.match(/^https?:\/\/www\.ncbi\.nlm\.nih\.gov\/pubmed\/(\d{1,10})\/?(?:[?#].*)?$/i)
  if (pubmedUrl) return pubmedUrl[1]
  candidate = candidate.replace(/^PMID\s*:\s*/i, '').trim()
  return /^\d{1,10}$/.test(candidate) ? candidate : null
}

export function normalizeCitationIdentifier(value: string): CitationIdentifier | null {
  const doi = normalizeDoi(value)
  if (doi) return { type: 'doi', value: doi }
  const pmid = normalizePmid(value)
  return pmid ? { type: 'pmid', value: pmid } : null
}

function referenceSection(markdown: string): { start: number; end: number; bodyStart: number } | null {
  const heading = /^###\s+References\s*$/im.exec(markdown)
  if (!heading || heading.index === undefined) return null
  const bodyStart = heading.index + heading[0].length
  const remainder = markdown.slice(bodyStart)
  const nextHeading = /^#{1,3}\s+\S.*$/m.exec(remainder)
  return {
    start: heading.index,
    bodyStart,
    end: nextHeading?.index === undefined ? markdown.length : bodyStart + nextHeading.index,
  }
}

export function existingReferenceNumber(markdown: string, doi: string): number | null {
  return existingCitationReferenceNumber(markdown, { type: 'doi', value: doi })
}

export function existingCitationReferenceNumber(markdown: string, identifier: CitationIdentifier): number | null {
  const section = referenceSection(markdown)
  if (!section) return null
  const normalized = identifier.type === 'doi' ? normalizeDoi(identifier.value) : normalizePmid(identifier.value)
  if (!normalized) return null
  const lines = markdown.slice(section.bodyStart, section.end).split('\n')
  for (const line of lines) {
    const numbered = /^\s*(\d+)\.\s+(.+)$/.exec(line)
    if (!numbered) continue
    if (identifier.type === 'doi') {
      const foundDoi = numbered[2].match(DOI_PATTERN)?.[0]
      if (foundDoi && normalizeDoi(foundDoi) === normalized) return Number(numbered[1])
    } else {
      const foundPmid = numbered[2].match(/PMID\s*:\s*(\d{1,10})/i)?.[1]
      if (foundPmid === normalized) return Number(numbered[1])
    }
  }
  return null
}

function nextReferenceNumber(markdown: string): number {
  const section = referenceSection(markdown)
  if (!section) return 1
  const numbers = [...markdown.slice(section.bodyStart, section.end).matchAll(/^\s*(\d+)\.\s+/gm)].map((match) => Number(match[1]))
  return numbers.length ? Math.max(...numbers) + 1 : 1
}

function cleanAmaCitation(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/^\d+\.\s*/, '')
}

export function insertDoiCitation(markdown: string, from: number, to: number, doi: string, citation: string): {
  markdown: string
  cursor: number
  number: number
  reused: boolean
} {
  const normalized = normalizeDoi(doi)
  if (!normalized) throw new Error('Enter a valid DOI')
  return insertCitationReference(markdown, from, to, { type: 'doi', value: normalized }, citation)
}

export function insertCitationReference(markdown: string, from: number, to: number, identifier: CitationIdentifier, citation: string): {
  markdown: string
  cursor: number
  number: number
  reused: boolean
} {
  const normalized = identifier.type === 'doi' ? normalizeDoi(identifier.value) : normalizePmid(identifier.value)
  if (!normalized) throw new Error('Enter a valid DOI or PubMed ID')
  const canonical = { ...identifier, value: normalized }
  const existing = existingCitationReferenceNumber(markdown, canonical)
  const number = existing ?? nextReferenceNumber(markdown)
  const marker = `[${number}]`
  let nextMarkdown = `${markdown.slice(0, from)}${marker}${markdown.slice(to)}`
  let cursor = from + marker.length

  if (existing !== null) return { markdown: nextMarkdown, cursor, number, reused: true }

  const entry = `${number}. ${cleanAmaCitation(citation)}`
  const section = referenceSection(nextMarkdown)
  if (!section) {
    nextMarkdown = `${nextMarkdown.replace(/\s*$/, '')}\n\n### References\n\n${entry}\n`
  } else {
    const before = nextMarkdown.slice(0, section.end).replace(/\s*$/, '')
    const after = nextMarkdown.slice(section.end)
    const inserted = `\n${entry}\n\n`
    nextMarkdown = `${before}${inserted}${after}`
    if (section.end <= cursor) cursor += inserted.length
  }
  return { markdown: nextMarkdown, cursor, number, reused: false }
}

function stripNonReferenceMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/!\[[^\]]*]\(\s*https?:\/\/[^)]+\)/g, '')
}

function cleanUrl(value: string): string {
  return value.trim().replace(/[.,;:!?]+$/, '')
}

function isReferenceUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return false
    if (/\.(?:avif|gif|jpe?g|png|svg|webp)(?:$|\?)/i.test(url.pathname)) return false
    if (url.hostname === 'scenemd.pages.dev' && url.pathname.startsWith('/api/images/')) return false
    return true
  } catch {
    return false
  }
}

export function scanBibliographySources(markdown: string): BibliographySources {
  const source = stripNonReferenceMarkdown(markdown)
  const dois = new Map<string, string>()
  for (const match of source.matchAll(DOI_GLOBAL_PATTERN)) {
    const normalized = normalizeDoi(match[0])
    if (normalized) dois.set(normalized, normalized)
  }

  const urls = new Map<string, BibliographyUrl>()
  const linkedRanges: Array<[number, number]> = []
  const markdownLink = /(?<!!)\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g
  for (const match of source.matchAll(markdownLink)) {
    if (match.index === undefined) continue
    linkedRanges.push([match.index, match.index + match[0].length])
    const url = cleanUrl(match[2])
    if (normalizeDoi(url) || !isReferenceUrl(url)) continue
    urls.set(url, { url, title: match[1].replace(/[*_~`]/g, '').trim() || new URL(url).hostname })
  }

  const bareUrl = /https?:\/\/[^\s<>)\]]+/g
  for (const match of source.matchAll(bareUrl)) {
    if (match.index === undefined || linkedRanges.some(([start, end]) => match.index! >= start && match.index! < end)) continue
    const url = cleanUrl(match[0])
    if (normalizeDoi(url) || !isReferenceUrl(url)) continue
    urls.set(url, { url, title: new URL(url).hostname.replace(/^www\./, '') })
  }

  return { dois: [...dois.values()], urls: [...urls.values()] }
}

function escapeBibtex(value: string): string {
  return value.replace(/[{}]/g, '').replace(/([%&_#])/g, '\\$1')
}

export function urlBibtex(entry: BibliographyUrl, index: number, accessed = new Date()): string {
  const host = new URL(entry.url).hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')
  const key = `web_${host || 'source'}_${index + 1}`
  const date = accessed.toISOString().slice(0, 10)
  return `@misc{${key},\n  title = {${escapeBibtex(entry.title)}},\n  url = {${entry.url}},\n  urldate = {${date}}\n}`
}

type MdastNode = {
  type: string
  value?: string
  depth?: number
  ordered?: boolean
  start?: number
  children?: MdastNode[]
  data?: { hProperties?: Record<string, unknown> }
}

export function remarkBracketCitations() {
  return (tree: MdastNode) => {
    const transform = (parent: MdastNode) => {
      if (!parent.children) return
      parent.children = parent.children.flatMap((node): MdastNode[] => {
        if (node.type !== 'text' || !node.value || !/\[\d+]/.test(node.value)) {
          transform(node)
          return [node]
        }
        const parts: MdastNode[] = []
        let cursor = 0
        for (const match of node.value.matchAll(/\[(\d+)]|\[((?:@[a-z0-9_:.+/-]+)(?:\s*;\s*@[a-z0-9_:.+/-]+)*)]/gi)) {
          if (match.index === undefined) continue
          if (match.index > cursor) parts.push({ type: 'text', value: node.value.slice(cursor, match.index) })
          const citationKey = match[2]?.match(/@([a-z0-9_:.+/-]+)/i)?.[1]
          const url = match[1]
            ? `#reference-${match[1]}`
            : `#citation-${citationKey?.replace(/[^a-z0-9_-]+/gi, '-') || 'unresolved'}`
          parts.push({ type: 'link', url, children: [{ type: 'text', value: match[0] }] } as MdastNode & { url: string })
          cursor = match.index + match[0].length
        }
        if (cursor < node.value.length) parts.push({ type: 'text', value: node.value.slice(cursor) })
        return parts
      })
    }
    transform(tree)

    const children = tree.children ?? []
    const referencesIndex = children.findIndex((node) => node.type === 'heading' && node.depth === 3 && (node.children ?? []).map((child) => child.value ?? '').join('').trim().toLowerCase() === 'references')
    if (referencesIndex < 0) return
    const list = children.slice(referencesIndex + 1).find((node) => node.type === 'list' && node.ordered)
    list?.children?.forEach((item, index) => {
      item.data = { ...item.data, hProperties: { ...item.data?.hProperties, id: `reference-${(list.start ?? 1) + index}` } }
    })
  }
}
