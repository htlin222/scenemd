export interface OpenEvidenceTurn {
  question: string
  answerMarkdown: string
}

export interface OpenEvidenceConversation {
  title: string
  turns: OpenEvidenceTurn[]
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
    const href = anchor?.getAttribute('href') ?? ''
    const label = href && title ? `[${escapeMarkdownText(title)}](${href})` : escapeMarkdownText(title)
    return `${index + 1}. ${[label, escapeMarkdownText(subtitle)].filter(Boolean).join(' ')}`.trim()
  }).filter((line) => !/^\d+\.\s*$/.test(line))
  return lines.length ? `### References\n\n${lines.join('\n')}` : ''
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
      const href = (element.getAttribute('href') ?? '').trim()
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
