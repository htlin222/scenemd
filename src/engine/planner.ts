import type {
  Density,
  PresentationBlock,
  PresentationConfig,
  Scene,
  SceneLayout,
  ScenePlan,
  ScoreBreakdown,
  SemanticRegion,
} from './types'

const DENSITY_TARGETS: Record<Density, { target: number; comfortable: number; maximum: number }> = {
  compact: { target: 0.78, comfortable: 0.84, maximum: 0.93 },
  balanced: { target: 0.65, comfortable: 0.75, maximum: 0.88 },
  cinematic: { target: 0.44, comfortable: 0.58, maximum: 0.78 },
}

function hash(value: string): string {
  let h = 5381
  for (let index = 0; index < value.length; index += 1) h = (h * 33) ^ value.charCodeAt(index)
  return (h >>> 0).toString(36)
}

function blockHeight(block: PresentationBlock, measurements: Map<string, number>): number {
  const measured = measurements.get(block.id)
  if (measured) return measured
  if (block.estimatedHeight) return block.estimatedHeight
  if (block.type === 'heading') return block.depth === 1 ? 112 : 76
  if (block.type === 'figure') return 260
  if (block.type === 'list') return 54 + (block.listItems?.length ?? 1) * 38
  if (block.type === 'code') return 76 + (block.value?.split('\n').length ?? 1) * 24
  if (block.type === 'code-group') return 96 + Math.max(1, ...(block.codeGroup ?? []).map((child) => child.value?.split('\n').length ?? 1)) * 24
  if (block.type === 'math') return 110
  if (block.type === 'table') return 70 + (block.tableRows?.length ?? 1) * 42
  return 104
}

function inlineLength(nodes: PresentationBlock['inlines'] = []): number {
  return nodes.reduce((total, node) => total + ('value' in node ? node.value.length : 'children' in node ? inlineLength(node.children) : 1), 0)
}

function splitInlineContent(nodes: NonNullable<PresentationBlock['inlines']>, partCount: number): NonNullable<PresentationBlock['inlines']>[] {
  const target = Math.max(40, Math.ceil(inlineLength(nodes) / partCount))
  const fragments = nodes.flatMap((node) => {
    if (node.type !== 'text' || node.value.length <= target) return [node]
    const pieces: typeof nodes = []
    let remaining = node.value
    while (remaining.length > target) {
      let splitAt = remaining.lastIndexOf(' ', target)
      if (splitAt < target * 0.55) {
        const punctuation = [...remaining.slice(0, target + 1).matchAll(/[.!?。！？；;]/g)].at(-1)
        splitAt = punctuation?.index !== undefined ? punctuation.index + 1 : target
      }
      pieces.push({ type: 'text', value: remaining.slice(0, splitAt).trimEnd() })
      remaining = remaining.slice(splitAt).trimStart()
    }
    if (remaining) pieces.push({ type: 'text', value: remaining })
    return pieces
  })
  const groups: NonNullable<PresentationBlock['inlines']>[] = [[]]
  let currentLength = 0
  fragments.forEach((fragment) => {
    const length = inlineLength([fragment])
    if (groups[groups.length - 1].length && currentLength + length > target && groups.length < partCount) {
      groups.push([])
      currentLength = 0
    }
    groups[groups.length - 1].push(fragment)
    currentLength += length
  })
  return groups.filter((group) => group.length > 0)
}

function continuationParts(block: PresentationBlock, measuredHeight: number, capacity: number): PresentationBlock[] {
  if (measuredHeight <= capacity) return [block]
  const partCount = Math.max(2, Math.ceil(measuredHeight / (capacity * 0.62)))
  let parts: PresentationBlock[] = []

  if ((block.type === 'paragraph' || block.type === 'blockquote') && block.inlines?.length) {
    parts = splitInlineContent(block.inlines, partCount).map((inlines) => ({ ...block, inlines }))
  } else if (block.type === 'list' && block.listItems?.length) {
    const size = Math.max(1, Math.ceil(block.listItems.length / partCount))
    for (let offset = 0; offset < block.listItems.length; offset += size) {
      parts.push({ ...block, listItems: block.listItems.slice(offset, offset + size), listStart: (block.listStart ?? 1) + offset })
    }
  } else if (block.type === 'code' && block.value) {
    const lines = block.value.split('\n')
    const size = Math.max(1, Math.ceil(lines.length / partCount))
    for (let offset = 0; offset < lines.length; offset += size) parts.push({ ...block, value: lines.slice(offset, offset + size).join('\n') })
  } else if (block.type === 'code-group' && block.codeGroup?.length) {
    const longest = Math.max(1, ...block.codeGroup.map((child) => child.value?.split('\n').length ?? 1))
    const size = Math.max(1, Math.ceil(longest / partCount))
    for (let offset = 0; offset < longest; offset += size) {
      parts.push({
        ...block,
        codeGroup: block.codeGroup.map((child) => ({
          ...child,
          value: (child.value ?? '').split('\n').slice(offset, offset + size).join('\n'),
          codeStartLine: (child.codeStartLine ?? 1) + offset,
        })).filter((child) => child.value),
      })
    }
  } else if (block.type === 'table' && (block.tableRows?.length ?? 0) > 2) {
    const [header, ...rows] = block.tableRows ?? []
    const size = Math.max(1, Math.ceil(rows.length / partCount))
    for (let offset = 0; offset < rows.length; offset += size) parts.push({ ...block, tableRows: [header, ...rows.slice(offset, offset + size)] })
  } else if (block.type === 'columns' && (block.columns?.length ?? 0) > 1) {
    const size = Math.max(1, Math.ceil((block.columns?.length ?? 0) / partCount))
    for (let offset = 0; offset < (block.columns?.length ?? 0); offset += size) parts.push({ ...block, columns: block.columns?.slice(offset, offset + size) })
  }

  if (parts.length < 2) return [block]
  return parts.map((part, index) => ({
    ...part,
    id: `${block.id}-part-${index + 1}`,
    continuation: index > 0,
    keepWithPrevious: index > 0,
    estimatedHeight: measuredHeight / parts.length,
  }))
}

function usedHeight(blocks: PresentationBlock[], measurements: Map<string, number>): number {
  return blocks.reduce((total, block) => total + blockHeight(block, measurements), 0) + Math.max(0, blocks.length - 1) * 20
}

export function chooseLayout(blocks: PresentationBlock[]): SceneLayout {
  if (blocks.some((block) => block.layoutHint === 'statement') || (blocks.length === 1 && blocks[0].type === 'blockquote')) {
    return 'statement'
  }
  const figures = blocks.filter((block) => block.type === 'figure' && !block.imageOptions?.background)
  const text = blocks.filter((block) => block.type !== 'figure' && block.type !== 'heading')
  if (figures.some((block) => block.layoutHint === 'hero') || (figures.length && text.length <= 1)) return 'media-dominant'
  if (figures.length) return 'text-media'
  if (blocks[0]?.type === 'heading' && blocks[0].depth === 1) return 'chapter'
  return 'text'
}

function breakpointScore(previous: PresentationBlock): number {
  if (previous.type === 'figure') return 60
  if (previous.type === 'list') return 45
  if (previous.type === 'paragraph') return 30
  if (previous.type === 'code') return 12
  if (previous.type === 'heading') return -200
  return 20
}

function evaluate(
  blocks: PresentationBlock[],
  endIndex: number,
  regionLength: number,
  used: number,
  capacity: number,
  density: Density,
  previousEnds: Set<string>,
): { total: number; breakdown: ScoreBreakdown; fillRatio: number; invalid: boolean } {
  const fillRatio = used / capacity
  const target = DENSITY_TARGETS[density].target
  const last = blocks[blocks.length - 1]
  const nextExists = endIndex < regionLength
  const densityDistance = Math.abs(fillRatio - target)
  const overflow = fillRatio > DENSITY_TARGETS[density].maximum
  const orphan = nextExists && last.type === 'heading'
  const keepViolation = nextExists && (last.keepWithNext || last.breakAfter === 'never')
  const breakdown: ScoreBreakdown = {
    semanticCoherence: keepViolation ? -90 : 34,
    density: Math.round(50 - densityDistance * 95),
    breakpoint: nextExists ? breakpointScore(last) : 30,
    visualBalance: Math.round(22 - Math.abs(fillRatio - 0.62) * 34),
    hierarchy: orphan ? -60 : 18,
    stability: previousEnds.has(last.id) ? 18 : 0,
    fragmentationPenalty: keepViolation ? -70 : nextExists ? -4 : 0,
    orphanPenalty: orphan ? -140 : 0,
    crowdingPenalty: fillRatio > 0.86 ? -Math.round((fillRatio - 0.86) * 260) : 0,
    whitespacePenalty: fillRatio < 0.28 && nextExists ? -28 : 0,
  }
  return {
    total: Object.values(breakdown).reduce((sum, value) => sum + value, 0),
    breakdown,
    fillRatio,
    invalid: overflow && blocks.length > 1,
  }
}

function makeScene(
  region: SemanticRegion,
  blocks: PresentationBlock[],
  used: number,
  capacity: number,
  score: number,
  scores: ScoreBreakdown,
): Scene {
  const first = blocks[0]
  const last = blocks[blocks.length - 1]
  const fillRatio = used / capacity
  return {
    id: `scene-${hash(`${region.id}:${first.id}:${last.id}`)}`,
    role: first.type === 'heading' && first.depth === 1 ? 'chapter' : 'content',
    regionId: region.id,
    startBlockId: first.id,
    endBlockId: last.id,
    blocks,
    layout: chooseLayout(blocks),
    sourceRange: {
      ...first.sourceRange,
      endLine: last.sourceRange.endLine,
      endColumn: last.sourceRange.endColumn,
    },
    fillRatio,
    score,
    scores,
    warning: undefined,
    continuationLabel: first.continuation ? `${region.headingPath.at(-1) ?? 'Section'} (continued)` : undefined,
    breadcrumb: first.type === 'heading' && first.depth === 3 ? region.headingPath.at(-2) : undefined,
  }
}

const COVER_SCORES: ScoreBreakdown = {
  semanticCoherence: 0,
  density: 0,
  breakpoint: 0,
  visualBalance: 0,
  hierarchy: 0,
  stability: 0,
  fragmentationPenalty: 0,
  orphanPenalty: 0,
  crowdingPenalty: 0,
  whitespacePenalty: 0,
}

export function withPresentationCover(plan: ScenePlan, config: PresentationConfig): ScenePlan {
  const configKey = [config.title, config.subtitle, config.seriesName, config.date, config.author, config.affiliation, config.email, config.license].join(':')
  const cover: Scene = {
    id: `cover-${hash(configKey)}`,
    role: 'cover',
    regionId: 'presentation-cover',
    startBlockId: 'presentation-cover',
    endBlockId: 'presentation-cover',
    blocks: [],
    layout: 'title',
    sourceRange: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
    fillRatio: 0,
    score: 0,
    scores: COVER_SCORES,
  }
  return { ...plan, scenes: [cover, ...plan.scenes] }
}

export function planScenes(
  regions: SemanticRegion[],
  measurements: Map<string, number>,
  viewportHeight: number,
  density: Density,
  previousPlan?: ScenePlan,
): ScenePlan {
  const scenes: Scene[] = []
  const capacity = Math.max(320, viewportHeight - Math.max(90, viewportHeight * 0.16))
  const previousEnds = new Set(previousPlan?.scenes.map((scene) => scene.endBlockId) ?? [])

  for (const region of regions) {
    const plannedBlocks = region.blocks.flatMap((block) => continuationParts(block, blockHeight(block, measurements), capacity))
    const planningRegion = plannedBlocks === region.blocks ? region : { ...region, blocks: plannedBlocks }
    const regionUsed = usedHeight(plannedBlocks, measurements)
    if (regionUsed / capacity <= DENSITY_TARGETS[density].comfortable) {
      const evaluated = evaluate(plannedBlocks, plannedBlocks.length, plannedBlocks.length, regionUsed, capacity, density, previousEnds)
      scenes.push(makeScene(planningRegion, plannedBlocks, regionUsed, capacity, evaluated.total, evaluated.breakdown))
      continue
    }

    let cursor = 0
    while (cursor < plannedBlocks.length) {
      const candidates: Array<ReturnType<typeof evaluate> & { blocks: PresentationBlock[]; end: number; used: number }> = []
      const limit = Math.min(plannedBlocks.length, cursor + 8)
      for (let end = cursor + 1; end <= limit; end += 1) {
        const candidateBlocks = plannedBlocks.slice(cursor, end)
        const used = usedHeight(candidateBlocks, measurements)
        candidates.push({
          ...evaluate(candidateBlocks, end, plannedBlocks.length, used, capacity, density, previousEnds),
          blocks: candidateBlocks,
          end,
          used,
        })
      }
      const valid = candidates.filter((candidate) => !candidate.invalid)
      const winner = (valid.length ? valid : candidates).sort((a, b) => b.total - a.total)[0]
      scenes.push(makeScene(planningRegion, winner.blocks, winner.used, capacity, winner.total, winner.breakdown))
      cursor = winner.end
    }
  }

  return {
    scenes,
    averageFill: scenes.length ? scenes.reduce((sum, scene) => sum + Math.min(scene.fillRatio, 1), 0) / scenes.length : 0,
    overflowCount: scenes.filter((scene) => scene.fillRatio > 1).length,
    measuredBlockCount: measurements.size,
  }
}
