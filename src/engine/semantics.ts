import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { InlineNode, PresentationBlock, SemanticRegion, SourceRange } from './types'
import { parseMarpitImageAlt } from '../imageSyntax'

interface MdPosition {
  start?: { line?: number; column?: number }
  end?: { line?: number; column?: number }
}

interface MdNode {
  type: string
  value?: string
  depth?: number
  ordered?: boolean
  url?: string
  alt?: string
  lang?: string
  children?: MdNode[]
  position?: MdPosition
}

interface Directives {
  break?: boolean
  keep?: boolean
  hero?: boolean
  hide?: boolean
  only?: boolean
  step?: boolean
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath)

function hash(value: string): string {
  let h = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    h ^= value.charCodeAt(index)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

function rangeOf(node: MdNode): SourceRange {
  return {
    startLine: node.position?.start?.line ?? 1,
    startColumn: node.position?.start?.column ?? 1,
    endLine: node.position?.end?.line ?? node.position?.start?.line ?? 1,
    endColumn: node.position?.end?.column ?? node.position?.start?.column ?? 1,
  }
}

function textOf(node: MdNode): string {
  if (typeof node.value === 'string') return node.value
  if (node.type === 'image') return node.alt ?? ''
  return (node.children ?? []).map(textOf).join('')
}

function tableTextOf(node: MdNode): string {
  if (node.type === 'inlineCode') return `\`${node.value ?? ''}\``
  if (typeof node.value === 'string') return node.value
  const content = (node.children ?? []).map(tableTextOf).join('')
  if (node.type === 'strong') return `**${content}**`
  if (node.type === 'emphasis') return `_${content}_`
  if (node.type === 'delete') return `~~${content}~~`
  if (node.type === 'link') return `[${content}](${node.url ?? '#'})`
  return content
}

function inlineOf(nodes: MdNode[] = []): InlineNode[] {
  return nodes.flatMap((node): InlineNode[] => {
    switch (node.type) {
      case 'text':
        return [{ type: 'text', value: node.value ?? '' }]
      case 'inlineCode':
        return [{ type: 'code', value: node.value ?? '' }]
      case 'inlineMath':
        return [{ type: 'math', value: node.value ?? '' }]
      case 'strong':
      case 'emphasis':
      case 'delete':
        return [{ type: node.type, children: inlineOf(node.children) }]
      case 'link':
        return [{ type: 'link', url: node.url ?? '#', children: inlineOf(node.children) }]
      case 'break':
        return [{ type: 'break' }]
      case 'image':
        return [{ type: 'text', value: node.alt ?? '' }]
      default:
        return node.children ? inlineOf(node.children) : []
    }
  })
}

function baseBlock(node: MdNode, index: number, type: PresentationBlock['type']): PresentationBlock {
  const text = textOf(node)
  return {
    id: `block-${hash(`${type}:${text}:${index}`)}`,
    type,
    semanticRole: 'body',
    importance: 0.5,
    keepTogether: true,
    keepWithNext: false,
    keepWithPrevious: false,
    breakBefore: 'auto',
    breakAfter: 'auto',
    visibility: 'normal',
    layoutHint: 'auto',
    sourceRange: rangeOf(node),
  }
}

function applyDirectives(block: PresentationBlock, directives: Directives): PresentationBlock {
  if (directives.break) block.breakBefore = 'always'
  if (directives.keep) {
    block.keepTogether = true
    block.keepWithNext = true
  }
  if (directives.hero) block.layoutHint = 'hero'
  if (directives.hide) block.visibility = 'hidden'
  if (directives.only) block.visibility = 'presentation-only'
  if (directives.step) block.stepped = true
  return block
}

function parseDirective(value: string): Directives | null {
  const match = value.match(/^\s*present:\s*(break|keep|hero|hide|only|step)\s*$/i)
  if (!match) return null
  return { [match[1].toLowerCase()]: true }
}

function makeBlocks(node: MdNode, index: number): PresentationBlock[] {
  if (node.type === 'heading') {
    const block = baseBlock(node, index, 'heading')
    block.inlines = inlineOf(node.children)
    block.depth = node.depth ?? 2
    block.keepWithNext = true
    block.semanticRole = block.depth === 1 ? 'title' : 'section-title'
    block.importance = block.depth === 1 ? 1 : Math.max(0.65, 1 - block.depth * 0.1)
    block.keepTogether = true
    return [block]
  }

  if (node.type === 'paragraph') {
    const images = (node.children ?? []).filter((child) => child.type === 'image')
    if (images.length === 1) {
      const image = images[0]
      const block = baseBlock(node, index, 'figure')
      block.semanticRole = 'figure'
      block.url = image.url ?? ''
      block.imageOptions = parseMarpitImageAlt(image.alt ?? '')
      block.alt = block.imageOptions.alt || 'Presentation figure'
      const remaining = (node.children ?? []).filter((child) => child !== image)
      block.caption = remaining.length ? inlineOf(remaining) : undefined
      block.importance = 0.8
      return [block]
    }
    const block = baseBlock(node, index, 'paragraph')
    block.inlines = inlineOf(node.children)
    block.keepTogether = true
    return [block]
  }

  if (node.type === 'list') {
    const items = (node.children ?? []).map((item) => inlineOf([{ type: 'text', value: textOf(item) }]))
    const chunks: PresentationBlock[] = []
    for (let offset = 0; offset < items.length; offset += 6) {
      const block = baseBlock(node, index + offset, 'list')
      block.listItems = items.slice(offset, offset + 6)
      block.ordered = node.ordered ?? false
      block.continuation = offset > 0
      block.keepTogether = true
      block.importance = 0.6
      if (offset > 0) block.keepWithPrevious = true
      chunks.push(block)
    }
    return chunks
  }

  if (node.type === 'blockquote') {
    const block = baseBlock(node, index, 'blockquote')
    block.inlines = inlineOf([{ type: 'text', value: textOf(node) }])
    block.semanticRole = 'key-message'
    block.layoutHint = 'statement'
    block.importance = 0.85
    return [block]
  }

  if (node.type === 'code') {
    const block = baseBlock(node, index, 'code')
    block.value = node.value ?? ''
    block.language = node.lang ?? 'text'
    block.keepTogether = true
    return [block]
  }

  if (node.type === 'math') {
    const block = baseBlock(node, index, 'math')
    block.value = node.value ?? ''
    block.keepTogether = true
    return [block]
  }

  if (node.type === 'table') {
    const rows = (node.children ?? []).map((row) => (row.children ?? []).map(tableTextOf))
    if (rows.length <= 4) {
      const block = baseBlock(node, index, 'table')
      block.tableRows = rows
      block.semanticRole = 'evidence'
      return [block]
    }
    const [header, ...body] = rows
    const chunks: PresentationBlock[] = []
    for (let offset = 0; offset < body.length; offset += 1) {
      const block = baseBlock(node, index + offset, 'table')
      block.tableRows = [header, body[offset]]
      block.semanticRole = 'evidence'
      block.continuation = offset > 0
      chunks.push(block)
    }
    return chunks
  }

  return []
}

export function parsePresentationDocument(markdown: string): PresentationBlock[] {
  const tree = processor.parse(markdown) as MdNode
  const blocks: PresentationBlock[] = []
  let directives: Directives = {}

  for (let index = 0; index < (tree.children ?? []).length; index += 1) {
    const node = (tree.children ?? [])[index]
    if (node.type === 'html') {
      const directive = parseDirective((node.value ?? '').replace(/^<!--|-->$/g, '').trim())
      if (directive) directives = { ...directives, ...directive }
      continue
    }
    if (node.type === 'thematicBreak') {
      directives.break = true
      continue
    }
    const normalized = makeBlocks(node, index)
    normalized.forEach((block, blockIndex) => {
      applyDirectives(block, blockIndex === 0 ? directives : {})
      if (block.visibility !== 'hidden') blocks.push(block)
    })
    if (normalized.length) directives = {}
  }

  return blocks
}

export function buildSemanticRegions(blocks: PresentationBlock[]): SemanticRegion[] {
  const regions: SemanticRegion[] = []
  let current: PresentationBlock[] = []
  let headingPath: string[] = []
  let explicitBreakBefore = false

  const flush = () => {
    if (!current.length) return
    const first = current[0]
    const last = current[current.length - 1]
    regions.push({
      id: `region-${hash(`${first.id}:${last.id}`)}`,
      headingPath: [...headingPath],
      blocks: current,
      sourceRange: {
        ...first.sourceRange,
        endLine: last.sourceRange.endLine,
        endColumn: last.sourceRange.endColumn,
      },
      importance: Math.max(...current.map((block) => block.importance)),
      explicitBreakBefore,
      explicitBreakAfter: false,
    })
    current = []
    explicitBreakBefore = false
  }

  for (const block of blocks) {
    const isMajorHeading = block.type === 'heading' && (block.depth ?? 4) <= 3
    if (block.breakBefore === 'always' || (isMajorHeading && current.length)) {
      flush()
      explicitBreakBefore = block.breakBefore === 'always'
    }
    if (block.type === 'heading') {
      const label = block.inlines?.map((inline) => ('value' in inline ? inline.value : '')).join('') ?? ''
      if (block.depth === 1) headingPath = [label]
      if (block.depth === 2) headingPath = [headingPath[0] ?? '', label].filter(Boolean)
      if (block.depth === 3) headingPath = [headingPath[0] ?? '', headingPath[1] ?? '', label].filter(Boolean)
    }
    current.push(block)
    if (block.type === 'heading' && block.depth === 1) flush()
  }
  flush()
  return regions
}
