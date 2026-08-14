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

// Fixed cost per additional scene in the global pagination objective. A good
// on-target scene scores roughly 150 and a mediocre half-empty one roughly
// 110, so a boundary must recover more than this in combined score before
// splitting beats keeping content together — without it, summing mostly
// positive per-scene scores would reward shattering a region into thin scenes.
const SCENE_COST = 140

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

function blockHeight(block: PresentationBlock, measurements: Map<string, number>, sceneBudget: number): number {
  // Sized figures are computed contextually inside usedHeight's figure branch
  // (their basis is the space remaining under the heading, design v5). Here a
  // sized figure only needs a sane fallback for the pre-split pass.
  // A bg figure lives in the full-height bleed panel (design v5.1) — it never
  // occupies the text flow, so it costs the vertical budget nothing anywhere:
  // pre-split, scoring, and usedHeight all see zero.
  if (block.type === 'figure' && block.imageOptions?.background) return 0
  const sized = block.type === 'figure' ? block.imageOptions?.size?.match(/^(\d+(?:\.\d+)?)%$/) : null
  if (sized) return (sceneBudget * Number(sized[1])) / 100
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

function continuationParts(block: PresentationBlock, measuredHeight: number, capacity: number, measurements: Map<string, number>): PresentationBlock[] {
  const availableCapacity = block.semanticRole === 'reference' ? Math.max(180, capacity - 112) : capacity
  if (measuredHeight <= availableCapacity) return [block]
  const partCount = Math.max(2, Math.ceil(measuredHeight / (availableCapacity * 0.82)))
  let parts: PresentationBlock[] = []

  if ((block.type === 'paragraph' || block.type === 'blockquote') && block.inlines?.length) {
    parts = splitInlineContent(block.inlines, partCount).map((inlines) => ({ ...block, inlines }))
  } else if (block.type === 'list' && block.listItems?.length) {
    if (block.semanticRole === 'reference') {
      let offset = 0
      while (offset < block.listItems.length) {
        const start = offset
        let height = 0
        while (offset < block.listItems.length) {
          const itemHeight = measurements.get(`${block.id}:item:${offset}`) ?? measuredHeight / block.listItems.length
          const nextHeight = height + itemHeight + (offset === start ? 0 : 7)
          if (offset > start && nextHeight > availableCapacity) break
          height = nextHeight
          offset += 1
        }
        parts.push({
          ...block,
          listItems: block.listItems.slice(start, offset),
          listStart: (block.listStart ?? 1) + start,
          estimatedHeight: height,
        })
      }
    } else {
      const size = Math.max(1, Math.ceil(block.listItems.length / partCount))
      for (let offset = 0; offset < block.listItems.length; offset += size) {
        parts.push({ ...block, listItems: block.listItems.slice(offset, offset + size), listStart: (block.listStart ?? 1) + offset })
      }
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
    estimatedHeight: part.estimatedHeight ?? measuredHeight / parts.length,
  }))
}

const FIGURE_CAPTION_ALLOWANCE = 40
// The frame yields at most this much of its declared size to its captions;
// the renderer mirrors it with a matching min-height.
const MIN_FRAME_SHRINK = 0.75
// Above-figure prose may shrink to fit the scene ("縮小文字，總之塞就對了"),
// down to this floor — below it the scene overflows visibly instead.
const MIN_TEXT_SCALE = 0.6
// The bg bleed panel may take up to 62% of the scene width (design v5.1), so
// left-column prose wraps roughly this much taller than its full-width
// measurement. The planner cannot know the image's aspect ratio, so it plans
// for the worst case; calibrate against browser-check screenshots.
const BG_TEXT_WIDTH_FACTOR = 1.9

interface FigureColumns {
  headingTotal: number
  available: number
  frames: number
  nonFrame: number
  aboveHeight: number
}

// A run of blocks stacked vertically with a fixed gap between them.
function stackHeight(blocks: PresentationBlock[], measurements: Map<string, number>, sceneBudget: number, gap: number): number {
  return blocks.reduce((total, block) => total + blockHeight(block, measurements, sceneBudget), 0)
    + Math.max(0, blocks.length - 1) * gap
}

// Heading band height and the content height remaining under it.
function headingArea(blocks: PresentationBlock[], measurements: Map<string, number>, sceneBudget: number): { headingTotal: number; available: number } {
  const headings = blocks.filter((block) => block.type === 'heading')
  const headingTotal = headings.length ? stackHeight(headings, measurements, sceneBudget, 20) + 20 : 0
  const available = Math.max(120, sceneBudget - headingTotal)
  return { headingTotal, available }
}

function figureColumns(blocks: PresentationBlock[], measurements: Map<string, number>, sceneBudget: number): FigureColumns {
  const figures = blocks.filter((block) => block.type === 'figure')
  const prose = blocks.filter((block) => block.type !== 'heading' && block.type !== 'figure')
  // size=NN% means a fraction of the height REMAINING under the heading.
  // Position decides text roles: prose above the figure fills the right
  // column, prose below it joins the legend under the image (design v5).
  const { headingTotal, available } = headingArea(blocks, measurements, sceneBudget)
  const firstFigureIndex = blocks.findIndex((block) => block.type === 'figure')
  const aboveProse = prose.filter((block) => blocks.indexOf(block) < firstFigureIndex)
  const belowProse = prose.filter((block) => blocks.indexOf(block) > firstFigureIndex)
  const belowHeight = stackHeight(belowProse, measurements, sceneBudget, 12)
  // The legend space is mandated by the layout; `size` distributes only what
  // remains after it, so size=100% always fits exactly and never overflows.
  const frameArea = Math.max(80, available - belowHeight)
  const frames = figures.reduce((total, block) => {
    const sized = block.imageOptions?.size?.match(/^(\d+(?:\.\d+)?)%$/)
    return total + (sized ? (frameArea * Number(sized[1])) / 100 : blockHeight(block, measurements, sceneBudget))
  }, 0)
  const nonFrame = figures.length * FIGURE_CAPTION_ALLOWANCE + Math.max(0, figures.length - 1) * 12 + belowHeight
  const aboveHeight = stackHeight(aboveProse, measurements, sceneBudget, 12)
  return { headingTotal, available, frames, nonFrame, aboveHeight }
}

// The bg layout's left column: everything that is not a heading or a figure,
// stacked, with the width-compensation factor applied (the panel narrows the
// column to ~38% of the scene, so full-width measurements read short).
function bgTextColumn(blocks: PresentationBlock[], measurements: Map<string, number>, sceneBudget: number): { headingTotal: number; available: number; textNeeded: number } {
  const { headingTotal, available } = headingArea(blocks, measurements, sceneBudget)
  const prose = blocks.filter((block) => block.type !== 'heading' && block.type !== 'figure')
  // The figures' captions render as real left-column paragraphs, so charge
  // them the same allowance the figure layout reserves per captioned figure.
  const captionAllowance = blocks
    .filter((block) => block.type === 'figure' && (block.caption?.length || block.alt)).length * FIGURE_CAPTION_ALLOWANCE
  return { headingTotal, available, textNeeded: (stackHeight(prose, measurements, sceneBudget, 12) + captionAllowance) * BG_TEXT_WIDTH_FACTOR }
}

// Shared shrink policy for figure text columns: scale down to the floor, and
// past the floor let the scene overflow visibly instead.
const scaleToFit = (needed: number, available: number): number | undefined =>
  needed <= available ? undefined : Math.max(MIN_TEXT_SCALE, Math.round((available / needed) * 100) / 100)
const effectiveTextHeight = (needed: number, available: number): number =>
  Math.min(needed, Math.max(available, needed * MIN_TEXT_SCALE))

export function figureTextScale(blocks: PresentationBlock[], measurements: Map<string, number>, sceneBudget: number): number | undefined {
  const layout = chooseLayout(blocks)
  if (layout === 'figure-bg') {
    const { available, textNeeded } = bgTextColumn(blocks, measurements, sceneBudget)
    return scaleToFit(textNeeded, available)
  }
  if (layout !== 'figure') return undefined
  const { available, aboveHeight } = figureColumns(blocks, measurements, sceneBudget)
  return scaleToFit(aboveHeight, available)
}

function usedHeight(blocks: PresentationBlock[], measurements: Map<string, number>, sceneBudget: number): number {
  const layout = chooseLayout(blocks)
  if (layout === 'figure-bg') {
    // The bg figure costs nothing (it bleeds beside the flow); the scene is
    // the heading plus the left text column, which shrinks like above-figure
    // prose does before it overflows.
    const { headingTotal, available, textNeeded } = bgTextColumn(blocks, measurements, sceneBudget)
    return headingTotal + effectiveTextHeight(textNeeded, available)
  }
  if (layout === 'figure') {
    const { headingTotal, available, frames, nonFrame, aboveHeight } = figureColumns(blocks, measurements, sceneBudget)
    const columnNeeded = frames + nonFrame
    const columnMinimum = frames * MIN_FRAME_SHRINK + nonFrame
    const figureColumn = Math.min(columnNeeded, Math.max(available, columnMinimum))
    return headingTotal + Math.max(figureColumn, effectiveTextHeight(aboveHeight, available))
  }
  return stackHeight(blocks, measurements, sceneBudget, 20)
}

export function chooseLayout(blocks: PresentationBlock[]): SceneLayout {
  // design v5.1: a bg figure turns the scene into the full-height right-bleed
  // layout — figure panel right, all text (body + legend + quotes) in the
  // left column. It outranks statement: blockHeight prices bg figures at
  // zero, which only holds when the bleed panel actually renders them.
  if (blocks.some((block) => block.type === 'figure' && block.imageOptions?.background)) return 'figure-bg'
  if (blocks.some((block) => block.layoutHint === 'statement') || (blocks.length === 1 && blocks[0].type === 'blockquote')) {
    return 'statement'
  }
  // design v5: every figure scene has exactly one structure — an optional
  // heading, then figure left / text right. Composition never changes it.
  if (blocks.some((block) => block.type === 'figure')) return 'figure'
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
  nextBlock?: PresentationBlock,
): { total: number; breakdown: ScoreBreakdown; fillRatio: number; invalid: boolean } {
  const fillRatio = used / capacity
  const target = DENSITY_TARGETS[density].target
  const last = blocks[blocks.length - 1]
  const nextExists = endIndex < regionLength
  const densityDistance = Math.abs(fillRatio - target)
  const overflow = fillRatio > 1
  const orphan = nextExists && last.type === 'heading'
  const keepViolation = nextExists && (
    last.keepWithNext
    || last.breakAfter === 'never'
    || Boolean(nextBlock?.keepWithPrevious && !nextBlock.continuation)
  )
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
  textScale?: number,
): Scene {
  const first = blocks[0]
  const last = blocks[blocks.length - 1]
  const fillRatio = used / capacity
  // spec: "unintentional hard overflow = 0". When content genuinely cannot
  // fit — a single unsplittable block taller than the capacity — the overflow
  // is intentional but must never be silent (#7). SceneView renders this.
  const warning = fillRatio > 1
    ? blocks.length === 1
      ? `${first.type === 'figure' ? 'Image' : first.type === 'math' ? 'Display math' : first.type === 'table' ? 'Table' : 'This block'} is taller than the scene by ${Math.round((fillRatio - 1) * 100)}% and cannot be split`
      : `Content overflows this scene by ${Math.round((fillRatio - 1) * 100)}%`
    : undefined
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
    warning,
    figureTextScale: textScale,
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

/**
 * Capacity-aware relaxation of keep chains (#31).
 *
 * The semantic normalizer glues headings to their content and figures to
 * their surrounding prose. When such a chain measures taller than the scene
 * capacity, the constraint network has no solution: every partition violates
 * a binding, and no boundary search — however global — can fix an empty
 * feasible set. This pass changes the constraints instead, in preference
 * order:
 *
 * 1. Relax links that do not cut a figure from its only prose: prose-prose
 *    links, heading links (the orphan penalty still steers placement), and
 *    the far side of shared prose (a paragraph serving as one figure's
 *    legend and the next figure's lead keeps its lead role).
 * 2. Rescue a heading glued to a single splittable block that fits alone but
 *    not together with the heading: split the block against the space left
 *    beside the heading, so the heading keeps its first lines.
 * 3. Anything still unfittable falls through to the warned overflow (#7).
 *
 * Relaxation only ADDS feasible boundaries — cloned blocks drop a flag, the
 * scoring is untouched — so where the original bindings were satisfiable the
 * partitioner behaves exactly as before.
 */
function relaxOversizedChains(blocks: PresentationBlock[], measurements: Map<string, number>, capacity: number): PresentationBlock[] {
  const result = [...blocks]
  let changed = false
  let start = 0
  while (start < result.length) {
    let end = start
    while (end < result.length - 1 && result[end].keepWithNext && !result[end].groupId) end += 1
    if (end > start && usedHeight(result.slice(start, end + 1), measurements, capacity) > capacity) {
      // Preference 2: heading + one splittable companion that fits alone.
      if (end === start + 1 && result[start].type === 'heading') {
        const companion = result[end]
        const companionHeight = blockHeight(companion, measurements, capacity)
        const besideHeading = capacity - blockHeight(result[start], measurements, capacity) - 20
        if (companionHeight <= capacity && besideHeading > 120) {
          const parts = continuationParts(companion, companionHeight, besideHeading, measurements)
          if (parts.length > 1) {
            result.splice(end, 1, ...parts)
            changed = true
            start = end + parts.length
            continue
          }
        }
      }
      // Preference 1: relax every link that keeps figure-prose pairs intact.
      for (let link = start; link < end; link += 1) {
        const left = result[link]
        const right = result[link + 1]
        const relaxable = left.type === 'heading'
          || (left.type !== 'figure' && right.type !== 'figure')
          || (left.type === 'figure' && right.type !== 'figure' && right.keepWithNext)
        if (!relaxable) continue
        result[link] = { ...left, keepWithNext: false }
        result[link + 1] = { ...right, keepWithPrevious: false }
        changed = true
      }
    }
    start = end + 1
  }
  return changed ? result : blocks
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
    const plannedBlocks = relaxOversizedChains(
      region.blocks.flatMap((block) => continuationParts(block, blockHeight(block, measurements, capacity), capacity, measurements)),
      measurements,
      capacity,
    )
    const planningRegion = plannedBlocks === region.blocks ? region : { ...region, blocks: plannedBlocks }
    const regionUsed = usedHeight(plannedBlocks, measurements, capacity)
    // A figure region IS the page the author delimited with `---` or a
    // heading: it becomes exactly one scene whenever it fits (above-text
    // shrinks to help). A region that still cannot fit falls through to the
    // partitioner so excess text flows out — 文讓步 — instead of producing a
    // giant overflowing scene on arbitrary documents.
    if ((plannedBlocks.some((block) => block.type === 'figure') && regionUsed <= capacity)
      || regionUsed / capacity <= DENSITY_TARGETS[density].comfortable) {
      const evaluated = evaluate(plannedBlocks, plannedBlocks.length, plannedBlocks.length, regionUsed, capacity, density, previousEnds)
      scenes.push(makeScene(planningRegion, plannedBlocks, regionUsed, capacity, evaluated.total, evaluated.breakdown, figureTextScale(plannedBlocks, measurements, capacity)))
      continue
    }

    // Globally optimal pagination over the region (#8). The previous greedy
    // scan committed to the locally best boundary and never reconsidered it,
    // which produced avoidable keep violations and orphaned headings whenever
    // a good early break forced a bad late one. This is the Knuth-Plass shape
    // of the same problem: score every feasible scene (start, end), then pick
    // the partition maximizing the total score by dynamic programming.
    //
    // Candidates extend until they overflow, so the search window is derived
    // from capacity rather than a fixed block count. A single-block candidate
    // is always feasible — an unsplittable oversized block becomes its own
    // warned scene (#7) instead of making the region unplannable.
    //
    // Per-scene scores are mostly positive, so maximizing their plain sum
    // would reward fragmenting into many thin scenes. Each boundary therefore
    // pays a fixed cost: a split must earn more than SCENE_COST in combined
    // score to beat staying together, which is the sum-form of "prefer
    // coherent under-filled scenes over crowded ones, but do not shatter".
    //
    // A boundary must never fall inside a `present: group`: those ends are
    // simply not legal partition points.
    const total = plannedBlocks.length
    const insideGroup = (end: number): boolean =>
      end > 0
      && end < total
      && Boolean(plannedBlocks[end - 1].groupId)
      && plannedBlocks[end].groupId === plannedBlocks[end - 1].groupId
    type Candidate = ReturnType<typeof evaluate> & { blocks: PresentationBlock[]; end: number; used: number }
    const bestScore = Array.from({ length: total + 1 }, () => 0)
    const bestChoice = Array.from({ length: total + 1 }, (): Candidate | null => null)
    for (let start = total - 1; start >= 0; start -= 1) {
      if (insideGroup(start)) continue
      let bestTotal = Number.NEGATIVE_INFINITY
      let chosen: Candidate | null = null
      for (let end = start + 1; end <= total; end += 1) {
        if (insideGroup(end)) continue
        const candidateBlocks = plannedBlocks.slice(start, end)
        const used = usedHeight(candidateBlocks, measurements, capacity)
        const evaluated = evaluate(candidateBlocks, end, total, used, capacity, density, previousEnds, plannedBlocks[end])
        if (evaluated.invalid && chosen) break
        const candidateTotal = evaluated.total + bestScore[end] - (end < total ? SCENE_COST : 0)
        if (!evaluated.invalid || !chosen) {
          if (candidateTotal > bestTotal || !chosen) {
            bestTotal = candidateTotal
            chosen = { ...evaluated, blocks: candidateBlocks, end, used }
          }
        }
        if (used > capacity) break
      }
      bestScore[start] = bestTotal
      bestChoice[start] = chosen
    }
    for (let start = 0; start < total; ) {
      const choice = bestChoice[start]
      if (!choice) break
      scenes.push(makeScene(planningRegion, choice.blocks, choice.used, capacity, choice.total, choice.breakdown, figureTextScale(choice.blocks, measurements, capacity)))
      start = choice.end
    }
  }

  return {
    scenes,
    averageFill: scenes.length ? scenes.reduce((sum, scene) => sum + Math.min(scene.fillRatio, 1), 0) / scenes.length : 0,
    overflowCount: scenes.filter((scene) => scene.fillRatio > 1).length,
    measuredBlockCount: measurements.size,
  }
}
