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
// Gap between the body-text row and the figure grid, and between grid rows.
// They mirror the `gap` values in .figure-gallery / .figure-gallery-grid.
const FIGURE_GRID_GAP = 20
const FIGURE_ROW_GAP = 18
// A frame below this share of the scene is not a figure, it is a smudge; the
// grid stops shrinking here and lets the body text yield, or the scene break.
//
// It is a fraction of the scene budget, not a pixel count: an absolute floor
// means 12% of a tall stage and 41% of a short one, so the same document
// paginates differently for no reason the author can see. It is deliberately
// NOT a fraction of the row slot — the slot is exactly the quantity that
// shrinks under pressure, so a floor defined against it can always be
// satisfied and never forces anything to give way.
const MIN_FRAME_RATIO = 0.13
const minFrameHeight = (sceneBudget: number) => sceneBudget * MIN_FRAME_RATIO

export interface FigureCell {
  figure: PresentationBlock
  legend: PresentationBlock[]
}

export interface FigureComposition {
  bodyText: PresentationBlock[]
  cells: FigureCell[]
}

/**
 * Legend heights measured at grid-cell width, keyed by column count.
 *
 * The measurement root renders every block at the full scene width, but a
 * legend in an n-column grid renders at roughly 1/n of it with a `cqw` type
 * size that does not shrink — so narrowing the column multiplies the line
 * count. Scaling the full-width height by the column count is wrong in both
 * directions: a short legend that still fits one line gets charged n times,
 * and a legend with long unbreakable tokens gets charged too little. This map
 * carries real heights instead; see `MeasurementRoot`.
 */
export type LegendMeasurements = Map<number, Map<string, number>>

/** The blocks that could be a figure's legend, for the narrow measurement pass. */
export function legendCandidates(blocks: PresentationBlock[]): PresentationBlock[] {
  return figureCells(blocks).cells.flatMap((cell) => cell.legend)
}

// Position decides the role (design v5, extended for multi-figure grids):
// everything before the first figure is body copy, and the consecutive
// non-heading blocks immediately after a figure are that figure's legend.
// The planner's height model and SceneView both read this — deriving it twice
// is how the two drift apart.
export function figureCells(blocks: PresentationBlock[]): FigureComposition {
  const bodyText: PresentationBlock[] = []
  const cells: FigureCell[] = []
  for (const block of blocks) {
    if (block.type === 'heading') continue
    if (block.type === 'figure') {
      cells.push({ figure: block, legend: [] })
      continue
    }
    if (cells.length) cells[cells.length - 1].legend.push(block)
    else bodyText.push(block)
  }
  return { bodyText, cells }
}

// Three columns is the cap: on a 16:9 stage a fourth column turns figures into
// postage stamps. Rows are balanced rather than greedily filled so four
// figures read as a 2 × 2 quadrant instead of a 3 + 1 orphan.
const MAX_FIGURE_COLUMNS = 3
// A seventh figure would need a third row of stamps; the planner breaks the
// scene instead (see usedHeight).
export const MAX_FIGURES_PER_SCENE = 6

export function figureGridShape(count: number): { rows: number; columns: number } {
  if (count <= 1) return { rows: count, columns: count }
  const rows = Math.ceil(count / MAX_FIGURE_COLUMNS)
  return { rows, columns: Math.ceil(count / rows) }
}

interface FigureColumns {
  headingTotal: number
  available: number
  frames: number
  nonFrame: number
  aboveHeight: number
}

function figureColumns(blocks: PresentationBlock[], measurements: Map<string, number>, sceneBudget: number): FigureColumns {
  const headings = blocks.filter((block) => block.type === 'heading')
  const figures = blocks.filter((block) => block.type === 'figure')
  const prose = blocks.filter((block) => block.type !== 'heading' && block.type !== 'figure')
  const headingTotal = headings.length
    ? headings.reduce((total, block) => total + blockHeight(block, measurements, sceneBudget), 0)
      + Math.max(0, headings.length - 1) * 20 + 20
    : 0
  // size=NN% means a fraction of the height REMAINING under the heading.
  // Position decides text roles: prose above the figure fills the right
  // column, prose below it joins the legend under the image (design v5).
  const available = Math.max(120, sceneBudget - headingTotal)
  const firstFigureIndex = blocks.findIndex((block) => block.type === 'figure')
  const aboveProse = prose.filter((block) => blocks.indexOf(block) < firstFigureIndex)
  const belowProse = prose.filter((block) => blocks.indexOf(block) > firstFigureIndex)
  const belowHeight = belowProse.reduce((total, block) => total + blockHeight(block, measurements, sceneBudget), 0)
    + Math.max(0, belowProse.length - 1) * 12
  // The legend space is mandated by the layout; `size` distributes only what
  // remains after it, so size=100% always fits exactly and never overflows.
  const frameArea = Math.max(80, available - belowHeight)
  const frames = figures.reduce((total, block) => {
    const sized = block.imageOptions?.size?.match(/^(\d+(?:\.\d+)?)%$/)
    return total + (sized ? (frameArea * Number(sized[1])) / 100 : blockHeight(block, measurements, sceneBudget))
  }, 0)
  const nonFrame = figures.length * FIGURE_CAPTION_ALLOWANCE + Math.max(0, figures.length - 1) * 12 + belowHeight
  const aboveHeight = aboveProse.reduce((total, block) => total + blockHeight(block, measurements, sceneBudget), 0)
    + Math.max(0, aboveProse.length - 1) * 12
  return { headingTotal, available, frames, nonFrame, aboveHeight }
}

interface FigureGridMetrics {
  columns: number
  textRow: number
  used: number
}

// Two or more figures share a grid instead of stacking: the body text is a
// full-width row and the figures sit under it, so the scene's height is a sum
// where the single-figure layout takes a max (they are side by side there).
function figureGridMetrics(
  blocks: PresentationBlock[],
  measurements: Map<string, number>,
  sceneBudget: number,
  textScale: number,
  legendMeasurements?: LegendMeasurements,
): FigureGridMetrics {
  const { bodyText, cells } = figureCells(blocks)
  const { rows, columns } = figureGridShape(cells.length)
  const headings = blocks.filter((block) => block.type === 'heading')
  const headingTotal = headings.length
    ? headings.reduce((total, block) => total + blockHeight(block, measurements, sceneBudget), 0)
      + Math.max(0, headings.length - 1) * 20 + 20
    : 0
  const available = Math.max(120, sceneBudget - headingTotal)
  const textRow = bodyText.length
    ? (bodyText.reduce((total, block) => total + blockHeight(block, measurements, sceneBudget), 0)
      + (bodyText.length - 1) * 12) * textScale
    : 0
  const textGap = bodyText.length ? FIGURE_GRID_GAP : 0
  const minFrame = minFrameHeight(sceneBudget)
  const gridSpace = Math.max(minFrame, available - textRow - textGap)
  const rowSlot = (gridSpace - (rows - 1) * FIGURE_ROW_GAP) / rows

  let gridNeeded = Math.max(0, rows - 1) * FIGURE_ROW_GAP
  for (let row = 0; row < rows; row += 1) {
    const rowCells = cells.slice(row * columns, row * columns + columns)
    // Prefer heights measured at the real cell width. The `× columns` fallback
    // is only for callers with no narrow measurement pass (unit tests, and the
    // first frame before one has run); it over-charges every legend short
    // enough to still fit one line in its column.
    const atColumnWidth = legendMeasurements?.get(columns)
    const legendHeight = Math.max(0, ...rowCells.map((cell) =>
      cell.legend.reduce((total, block) => {
        const measured = atColumnWidth?.get(block.id)
        return total + (measured ?? blockHeight(block, measurements, sceneBudget) * columns)
      }, 0)))
    const chrome = FIGURE_CAPTION_ALLOWANCE + legendHeight
    const frameSlot = Math.max(minFrame, rowSlot - chrome)
    const frame = Math.max(0, ...rowCells.map((cell) => {
      const sized = cell.figure.imageOptions?.size?.match(/^(\d+(?:\.\d+)?)%$/)
      // The floor is on the frame, not the slot: a frame that has shrunk past
      // it is a smudge, so the grid keeps claiming the minimum frame and the
      // body text yields instead (or the scene breaks). Unsized figures were
      // measured against .measurement-root's fixed frame, so they may claim
      // more than their cell — clamp them to it.
      return sized
        ? Math.max(minFrame, (frameSlot * Number(sized[1])) / 100)
        : Math.min(blockHeight(cell.figure, measurements, sceneBudget), frameSlot)
    }))
    gridNeeded += frame + chrome
  }
  return { columns, textRow, used: headingTotal + textRow + textGap + gridNeeded }
}

// Body text shrinks (floor 0.6) before the grid gives ground, matching the
// single-figure rule.
//
// Solving for the scale in one step does not work: shrinking the text also
// frees grid space, which sized figures immediately grow into, so the surplus
// recovered per unit of shrink is `1 - size%`, not 1. A single pass therefore
// under-corrects by 1/(1-size%) and leaves the scene overflowing by a hair
// while reporting a scale that "fixed" it. `used()` is monotone
// non-decreasing in the scale, so bisect instead — that stays correct through
// the minimum-frame clamp, which no closed form survives.
function figureGridPlan(
  blocks: PresentationBlock[],
  measurements: Map<string, number>,
  sceneBudget: number,
  legendMeasurements?: LegendMeasurements,
): { metrics: FigureGridMetrics; textScale?: number } {
  const metricsAt = (scale: number) => figureGridMetrics(blocks, measurements, sceneBudget, scale, legendMeasurements)
  const full = metricsAt(1)
  if (full.used <= sceneBudget || full.textRow <= 0) return { metrics: full }
  const floor = metricsAt(MIN_TEXT_SCALE)
  // Even at the floor it overflows: report the floor and let the scene break.
  if (floor.used > sceneBudget) return { metrics: floor, textScale: MIN_TEXT_SCALE }
  let low = MIN_TEXT_SCALE
  let high = 1
  for (let step = 0; step < 12; step += 1) {
    const mid = (low + high) / 2
    if (metricsAt(mid).used <= sceneBudget) low = mid
    else high = mid
  }
  // Floor to whole percent: rounding up could re-cross the budget, and the
  // renderer receives this exact number as --figure-text-scale.
  const textScale = Math.max(MIN_TEXT_SCALE, Math.floor(low * 100) / 100)
  return { metrics: metricsAt(textScale), textScale }
}

// Sized figures shrink into whatever space is left, so height arithmetic alone
// would accept a dozen figures on one scene. The cap is a separate, honest
// predicate rather than a fake height: it makes a candidate invalid, and when
// an author forces the violation with `present: group` it produces a warning
// that says what actually went wrong.
export function exceedsFigureLimit(blocks: PresentationBlock[]): boolean {
  return figureCells(blocks).cells.length > MAX_FIGURES_PER_SCENE
}

export function figureGridColumns(blocks: PresentationBlock[]): number | undefined {
  const count = figureCells(blocks).cells.length
  return count > 1 ? figureGridShape(count).columns : undefined
}

export function figureTextScale(blocks: PresentationBlock[], measurements: Map<string, number>, sceneBudget: number, legendMeasurements?: LegendMeasurements): number | undefined {
  if (chooseLayout(blocks) !== 'figure') return undefined
  if (figureCells(blocks).cells.length > 1) return figureGridPlan(blocks, measurements, sceneBudget, legendMeasurements).textScale
  const { available, aboveHeight } = figureColumns(blocks, measurements, sceneBudget)
  if (aboveHeight <= available) return undefined
  return Math.max(MIN_TEXT_SCALE, Math.round((available / aboveHeight) * 100) / 100)
}

function usedHeight(blocks: PresentationBlock[], measurements: Map<string, number>, sceneBudget: number, legendMeasurements?: LegendMeasurements): number {
  if (chooseLayout(blocks) === 'figure') {
    const figureCount = figureCells(blocks).cells.length
    if (figureCount > 1) {
      // The figure cap is NOT folded in here. Inflating the height to force a
      // break made fillRatio — which the debug card shows and the overflow
      // warning quotes verbatim — report a fabricated number ("overflows by
      // 84%" for a grid that actually fits). The cap is enforced as its own
      // predicate; this stays a real measurement.
      return figureGridPlan(blocks, measurements, sceneBudget, legendMeasurements).metrics.used
    }
    const { headingTotal, available, frames, nonFrame, aboveHeight } = figureColumns(blocks, measurements, sceneBudget)
    const columnNeeded = frames + nonFrame
    const columnMinimum = frames * MIN_FRAME_SHRINK + nonFrame
    const figureColumn = Math.min(columnNeeded, Math.max(available, columnMinimum))
    const effectiveAbove = Math.min(aboveHeight, Math.max(available, aboveHeight * MIN_TEXT_SCALE))
    return headingTotal + Math.max(figureColumn, effectiveAbove)
  }
  return blocks.reduce((total, block) => total + blockHeight(block, measurements, sceneBudget), 0) + Math.max(0, blocks.length - 1) * 20
}

export function chooseLayout(blocks: PresentationBlock[]): SceneLayout {
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
    invalid: (overflow || exceedsFigureLimit(blocks)) && blocks.length > 1,
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
  // A figure count past the cap is not a height overflow, so it gets its own
  // message: quoting a percentage here would invent a number.
  const figureCount = figureCells(blocks).cells.length
  const overflowPercent = Math.max(1, Math.round((fillRatio - 1) * 100))
  const warning = exceedsFigureLimit(blocks)
    ? `A scene holds at most ${MAX_FIGURES_PER_SCENE} figures; this one is pinned to ${figureCount}`
    : fillRatio > 1
      ? blocks.length === 1
        ? `${first.type === 'figure' ? 'Image' : first.type === 'math' ? 'Display math' : first.type === 'table' ? 'Table' : 'This block'} is taller than the scene by ${overflowPercent}% and cannot be split`
        : `Content overflows this scene by ${overflowPercent}%`
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
    // Derived here rather than at the two call sites: makeScene already has
    // the blocks, and one derivation cannot drift from the other.
    figureColumns: figureGridColumns(blocks),
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
function relaxOversizedChains(blocks: PresentationBlock[], measurements: Map<string, number>, capacity: number, legendMeasurements?: LegendMeasurements): PresentationBlock[] {
  const result = [...blocks]
  let changed = false
  let start = 0
  while (start < result.length) {
    let end = start
    while (end < result.length - 1 && result[end].keepWithNext && !result[end].groupId) end += 1
    if (end > start && usedHeight(result.slice(start, end + 1), measurements, capacity, legendMeasurements) > capacity) {
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
  legendMeasurements?: LegendMeasurements,
): ScenePlan {
  const scenes: Scene[] = []
  const capacity = Math.max(320, viewportHeight - Math.max(90, viewportHeight * 0.16))
  const previousEnds = new Set(previousPlan?.scenes.map((scene) => scene.endBlockId) ?? [])

  for (const region of regions) {
    const plannedBlocks = relaxOversizedChains(
      region.blocks.flatMap((block) => continuationParts(block, blockHeight(block, measurements, capacity), capacity, measurements)),
      measurements,
      capacity,
      legendMeasurements,
    )
    const planningRegion = plannedBlocks === region.blocks ? region : { ...region, blocks: plannedBlocks }
    const regionUsed = usedHeight(plannedBlocks, measurements, capacity, legendMeasurements)
    // A figure region IS the page the author delimited with `---` or a
    // heading: it becomes exactly one scene whenever it fits (above-text
    // shrinks to help). A region that still cannot fit falls through to the
    // partitioner so excess text flows out — 文讓步 — instead of producing a
    // giant overflowing scene on arbitrary documents.
    if (!exceedsFigureLimit(plannedBlocks)
      && ((plannedBlocks.some((block) => block.type === 'figure') && regionUsed <= capacity)
        || regionUsed / capacity <= DENSITY_TARGETS[density].comfortable)) {
      const evaluated = evaluate(plannedBlocks, plannedBlocks.length, plannedBlocks.length, regionUsed, capacity, density, previousEnds)
      scenes.push(makeScene(planningRegion, plannedBlocks, regionUsed, capacity, evaluated.total, evaluated.breakdown, figureTextScale(plannedBlocks, measurements, capacity, legendMeasurements)))
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
        const used = usedHeight(candidateBlocks, measurements, capacity, legendMeasurements)
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
      scenes.push(makeScene(planningRegion, choice.blocks, choice.used, capacity, choice.total, choice.breakdown, figureTextScale(choice.blocks, measurements, capacity, legendMeasurements)))
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
