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
  if (block.type === 'heading') return block.depth === 1 ? 112 : 76
  if (block.type === 'figure') return 260
  if (block.type === 'list') return 54 + (block.listItems?.length ?? 1) * 38
  if (block.type === 'code') return 76 + (block.value?.split('\n').length ?? 1) * 24
  if (block.type === 'math') return 110
  if (block.type === 'table') return 70 + (block.tableRows?.length ?? 1) * 42
  return 104
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
    warning: fillRatio > 1 ? 'Oversized atomic content' : undefined,
    continuationLabel: first.continuation ? `${region.headingPath.at(-1) ?? 'Section'} — continued` : undefined,
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
    const regionUsed = usedHeight(region.blocks, measurements)
    if (regionUsed / capacity <= DENSITY_TARGETS[density].comfortable) {
      const evaluated = evaluate(region.blocks, region.blocks.length, region.blocks.length, regionUsed, capacity, density, previousEnds)
      scenes.push(makeScene(region, region.blocks, regionUsed, capacity, evaluated.total, evaluated.breakdown))
      continue
    }

    let cursor = 0
    while (cursor < region.blocks.length) {
      const candidates: Array<ReturnType<typeof evaluate> & { blocks: PresentationBlock[]; end: number; used: number }> = []
      const limit = Math.min(region.blocks.length, cursor + 8)
      for (let end = cursor + 1; end <= limit; end += 1) {
        const candidateBlocks = region.blocks.slice(cursor, end)
        const used = usedHeight(candidateBlocks, measurements)
        candidates.push({
          ...evaluate(candidateBlocks, end, region.blocks.length, used, capacity, density, previousEnds),
          blocks: candidateBlocks,
          end,
          used,
        })
      }
      const valid = candidates.filter((candidate) => !candidate.invalid)
      const winner = (valid.length ? valid : candidates).sort((a, b) => b.total - a.total)[0]
      scenes.push(makeScene(region, winner.blocks, winner.used, capacity, winner.total, winner.breakdown))
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
