import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { InlineNode, PresentationBlock, SemanticRegion, SourceRange } from './types'
import { parseImageAttributes } from '../imageSyntax'
import { remarkBracketCitations } from '../citations'

interface MdPosition {
  start?: { line?: number; column?: number }
  end?: { line?: number; column?: number }
}

interface MdNode {
  type: string
  value?: string
  depth?: number
  ordered?: boolean
  start?: number
  url?: string
  alt?: string
  lang?: string
  meta?: string
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

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkBracketCitations)

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

function parseGroupDirective(value: string): 'start' | 'end' | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'present: group') return 'start'
  if (normalized === 'present: end-group') return 'end'
  return null
}

function parseColumnsDirective(value: string): 'start' | 'next' | 'end' | null {
  const normalized = value.trim().toLowerCase()
  if (/^present:\s*columns(?:\s+\d+)?$/.test(normalized)) return 'start'
  if (normalized === 'present: column') return 'next'
  if (normalized === 'present: end-columns') return 'end'
  return null
}

function isMarpDirective(value: string): boolean {
  return /^\s*(?:theme|paginate|header|footer|style|class|color|backgroundcolor|backgroundimage|backgroundposition|backgroundrepeat|backgroundsize)\s*:/i.test(value)
}

function columnsBlock(columns: PresentationBlock[][], index: number): PresentationBlock | null {
  const populated = columns.filter((column) => column.length > 0)
  const first = populated[0]?.[0]
  const lastColumn = populated[populated.length - 1]
  const last = lastColumn?.[lastColumn.length - 1]
  if (!first || !last) return null
  return {
    id: `block-${hash(`columns:${first.id}:${last.id}:${index}`)}`,
    type: 'columns',
    semanticRole: 'body',
    importance: 0.7,
    keepTogether: true,
    keepWithNext: false,
    keepWithPrevious: false,
    breakBefore: 'auto',
    breakAfter: 'auto',
    visibility: 'normal',
    layoutHint: 'auto',
    sourceRange: { ...first.sourceRange, endLine: last.sourceRange.endLine, endColumn: last.sourceRange.endColumn },
    columns: populated,
  }
}

function parseCodeLines(value: string): number[] | 'all' | 'none' | 'hide' {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'all' || normalized === 'none' || normalized === 'hide') return normalized
  const lines = new Set<number>()
  value.split(',').forEach((part) => {
    const range = part.trim().match(/^(\d+)(?:-(\d+))?$/)
    if (!range) return
    const start = Number(range[1])
    const end = Number(range[2] ?? range[1])
    for (let line = Math.min(start, end); line <= Math.max(start, end); line += 1) lines.add(line)
  })
  return [...lines]
}

function applyCodeMeta(block: PresentationBlock, meta = '') {
  const title = meta.match(/\[([^\]]+)]/)
  if (title) block.codeTitle = title[1].trim()
  const lineConfig = meta.match(/\{([^{}]*\b(?:lines|startLine)\s*:[^{}]+)}/i)?.[1]
  if (lineConfig) {
    block.codeLineNumbers = /\blines\s*:\s*true\b/i.test(lineConfig)
    const start = lineConfig.match(/\bstartLine\s*:\s*(\d+)/i)
    if (start) block.codeStartLine = Math.max(1, Number(start[1]))
  }
  const highlight = [...meta.matchAll(/\{([^{}]+)}/g)]
    .map((match) => match[1])
    .find((value) => !/:/.test(value) && /(?:\d|all|none|hide)/i.test(value))
  if (highlight) block.codeHighlightSteps = highlight.split('|').map(parseCodeLines)
}

function codeGroupBlock(children: PresentationBlock[], index: number): PresentationBlock | null {
  if (!children.length) return null
  const first = children[0]
  const last = children[children.length - 1]
  return {
    id: `block-${hash(`code-group:${first.id}:${last.id}:${index}`)}`,
    type: 'code-group',
    semanticRole: 'evidence',
    importance: 0.7,
    keepTogether: true,
    keepWithNext: false,
    keepWithPrevious: false,
    breakBefore: 'auto',
    breakAfter: 'auto',
    visibility: 'normal',
    layoutHint: 'auto',
    sourceRange: { ...first.sourceRange, endLine: last.sourceRange.endLine, endColumn: last.sourceRange.endColumn },
    codeGroup: children,
  }
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
      // A `{key=value}` block directly after the image is hybrid-syntax config,
      // never caption text (docs/plans/2026-08-14-image-config-design.md).
      const children = node.children ?? []
      const sibling = children[children.indexOf(image) + 1]
      const attributeMatch = sibling?.type === 'text' ? (sibling.value ?? '').match(/^\{([^}\n]*)\}/) : null
      block.imageOptions = parseImageAttributes(image.alt ?? '', attributeMatch ? attributeMatch[1] : null)
      block.alt = block.imageOptions.alt || 'Presentation figure'
      const remaining = children
        .filter((child) => child !== image)
        .map((child) => {
          if (child !== sibling || !attributeMatch) return child
          const rest = (sibling.value ?? '').slice(attributeMatch[0].length).replace(/^\s+/, '')
          return rest ? { ...sibling, value: rest } : null
        })
        .filter((child): child is NonNullable<typeof child> => child !== null)
      block.caption = remaining.length ? inlineOf(remaining) : undefined
      block.importance = 0.8
      return [block]
    }
    // HackMD imsize (`![alt](url =WxH)`) fails CommonMark image parsing and
    // arrives as literal text; recover it as a figure with pixel dimensions.
    const imsize = images.length === 0
      ? textOf(node).match(/^!\[([^\]]*)\]\((\S+)\s+=(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)?\)\s*([\s\S]*)$/)
      : null
    if (imsize) {
      const block = baseBlock(node, index, 'figure')
      block.semanticRole = 'figure'
      block.url = imsize[2]
      block.imageOptions = parseImageAttributes(imsize[1], null)
      block.imageOptions.width = `${imsize[3]}px`
      if (imsize[4]) block.imageOptions.height = `${imsize[4]}px`
      block.alt = block.imageOptions.alt || 'Presentation figure'
      const trailing = imsize[5].trim()
      block.caption = trailing ? [{ type: 'text', value: trailing }] : undefined
      block.importance = 0.8
      return [block]
    }
    const block = baseBlock(node, index, 'paragraph')
    block.inlines = inlineOf(node.children)
    block.keepTogether = true
    return [block]
  }

  if (node.type === 'list') {
    // Preserve inline semantics inside list items (including numeric citation
    // links) instead of flattening the item back to plain text.
    const items = (node.children ?? []).map((item) => inlineOf(item.children ?? []))
    const block = baseBlock(node, index, 'list')
    block.listItems = items
    block.ordered = node.ordered ?? false
    block.listStart = node.start ?? 1
    block.keepTogether = true
    block.importance = 0.6
    return [block]
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
    applyCodeMeta(block, node.meta ?? '')
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
  // HackMD reveal.js compatibility: a leading YAML frontmatter block must not
  // become content. It is masked with blank lines (not stripped) so every
  // sourceRange below keeps its real line number for editor↔scene sync.
  const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
  let source = markdown
  let isSlideDocument = false
  if (frontmatter) {
    isSlideDocument = /^type:\s*slide\s*$/m.test(frontmatter[1])
    source = frontmatter[0].replace(/[^\n]+/g, '') + markdown.slice(frontmatter[0].length)
  }
  const tree = processor.runSync(processor.parse(source)) as MdNode
  const blocks: PresentationBlock[] = []
  let directives: Directives = {}
  let referencesDepth: number | null = null
  let activeColumns: PresentationBlock[][] | null = null
  let activeCodeGroup: PresentationBlock[] | null = null
  let activeGroup: string | null = null
  let groupCount = 0
  let pendingSpeakerNotes: Array<{ text: string; range: SourceRange }> = []

  const lastAuthoredBlock = () => activeColumns?.at(-1)?.at(-1) ?? blocks.at(-1)

  const finishColumns = (index: number) => {
    if (!activeColumns) return
    const block = columnsBlock(activeColumns, index)
    if (block) blocks.push(block)
    activeColumns = null
  }

  const finishCodeGroup = (index: number) => {
    if (!activeCodeGroup) return
    const block = codeGroupBlock(activeCodeGroup, index)
    if (block) blocks.push(block)
    activeCodeGroup = null
  }

  for (let index = 0; index < (tree.children ?? []).length; index += 1) {
    const node = (tree.children ?? [])[index]
    const nodeText = textOf(node).trim()
    if (node.type === 'paragraph' && nodeText === '::code-group') {
      finishCodeGroup(index)
      activeCodeGroup = []
      continue
    }
    if (node.type === 'paragraph' && nodeText === '::' && activeCodeGroup) {
      finishCodeGroup(index)
      continue
    }
    if (node.type === 'html') {
      const comment = (node.value ?? '').replace(/^<!--|-->$/g, '').trim()
      const columnDirective = parseColumnsDirective(comment)
      if (columnDirective === 'start') {
        finishColumns(index)
        activeColumns = [[]]
        directives = {}
        continue
      }
      if (columnDirective === 'next' && activeColumns) {
        if (activeColumns[activeColumns.length - 1].length) activeColumns.push([])
        continue
      }
      if (columnDirective === 'end' && activeColumns) {
        finishColumns(index)
        continue
      }
      const groupDirective = parseGroupDirective(comment)
      if (groupDirective === 'start') {
        groupCount += 1
        activeGroup = `group-${groupCount}`
        continue
      }
      if (groupDirective === 'end') {
        activeGroup = null
        continue
      }
      // reveal.js per-slide/per-element directives from HackMD decks are
      // presentation hints for another engine, never speaker notes.
      if (/^\.(?:slide|element):/.test(comment)) continue
      const directive = parseDirective(comment)
      if (directive) directives = { ...directives, ...directive }
      else if (comment && !isMarpDirective(comment)) {
        const target = lastAuthoredBlock()
        if (target) {
          target.speakerNotes = [...(target.speakerNotes ?? []), comment]
          target.speakerNoteRanges = [...(target.speakerNoteRanges ?? []), rangeOf(node)]
        } else pendingSpeakerNotes.push({ text: comment, range: rangeOf(node) })
      }
      continue
    }
    if (node.type === 'thematicBreak') {
      directives.break = true
      continue
    }
    if (node.type === 'heading') {
      const label = textOf(node).trim().toLowerCase()
      if ((node.depth ?? 4) <= (referencesDepth ?? 0) && label !== 'references') referencesDepth = null
      if (label === 'references' && node.depth === 3) referencesDepth = 3
    }
    // reveal.js speaker notes: only documents declaring `type: slide` treat a
    // `Note:` paragraph as notes — ordinary prose legitimately starts with it.
    if (isSlideDocument && node.type === 'paragraph') {
      const noteMatch = textOf(node).match(/^Note:\s*([\s\S]*)$/i)
      if (noteMatch) {
        const target = lastAuthoredBlock()
        const note = noteMatch[1].trim()
        if (target) {
          target.speakerNotes = [...(target.speakerNotes ?? []), note]
          target.speakerNoteRanges = [...(target.speakerNoteRanges ?? []), rangeOf(node)]
        } else pendingSpeakerNotes.push({ text: note, range: rangeOf(node) })
        continue
      }
    }
    const normalized = makeBlocks(node, index)
    if (activeColumns && node.type === 'heading' && node.depth === 3 && activeColumns[activeColumns.length - 1].length) activeColumns.push([])
    normalized.forEach((block, blockIndex) => {
      applyDirectives(block, blockIndex === 0 ? directives : {})
      if (blockIndex === 0 && pendingSpeakerNotes.length) {
        block.speakerNotes = pendingSpeakerNotes.map((note) => note.text)
        block.speakerNoteRanges = pendingSpeakerNotes.map((note) => note.range)
        pendingSpeakerNotes = []
      }
      if (referencesDepth !== null && block.type === 'list') block.semanticRole = 'reference'
      if (block.visibility !== 'hidden') {
        if (activeGroup) block.groupId = activeGroup
        if (activeCodeGroup && block.type === 'code') activeCodeGroup.push(block)
        else if (activeColumns) activeColumns[activeColumns.length - 1].push(block)
        else blocks.push(block)
      }
    })
    if (normalized.length) directives = {}
  }

  finishColumns((tree.children ?? []).length)
  finishCodeGroup((tree.children ?? []).length)

  // Images default to the presentation-friendly legend composition. Text that
  // must share the figure's scene is designated explicitly with
  // `present: group` markers — there is no implicit neighbor gluing.
  let figureCount = 0
  blocks.forEach((block) => {
    if (block.type !== 'figure') return
    figureCount += 1
    block.figureNumber = figureCount
    block.layoutHint = block.imageOptions?.layout === 'hero' ? 'hero' : block.imageOptions?.layout === 'auto' ? 'auto' : 'legend'
  })

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
