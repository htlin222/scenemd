import { describe, expect, it } from 'vitest'
import { buildSemanticRegions, parsePresentationDocument } from './semantics'
import { chooseLayout, figureCells, figureGridShape, planScenes, withPresentationCover } from './planner'
import { defaultPresentationConfig } from '../presentationConfig'
import type { PresentationBlock, SemanticRegion } from './types'

// Pagination depends on measured heights, so these tests supply an explicit
// measurement map rather than relying on the planner's fallback estimates.
// That makes them deterministic and lets each case target one contract from
// spec.md ("Measurement and fit", "Pagination and scoring").

const VIEWPORT = 1000
// capacity = viewportHeight - max(90, viewportHeight * 0.16)
const CAPACITY = VIEWPORT - 160

function measure(blocks: PresentationBlock[], height: number | ((block: PresentationBlock) => number)) {
  const map = new Map<string, number>()
  for (const block of blocks) {
    map.set(block.id, typeof height === 'function' ? height(block) : height)
  }
  return map
}

function regionsFrom(markdown: string): { blocks: PresentationBlock[]; regions: SemanticRegion[] } {
  const blocks = parsePresentationDocument(markdown)
  return { blocks, regions: buildSemanticRegions(blocks) }
}

const allBlockIds = (blocks: PresentationBlock[]) => blocks.map((block) => block.id).sort()
const plannedBlockIds = (scenes: { blocks: PresentationBlock[] }[]) =>
  scenes
    .flatMap((scene) => scene.blocks)
    // Oversized blocks are split into `-part-N` continuations; map them back.
    .map((block) => block.id.replace(/-part-\d+$/, ''))
    .filter((id, index, list) => list.indexOf(id) === index)
    .sort()

describe('figureCells — legend ownership', () => {
  it('treats everything before the first figure as body text', () => {
    const { blocks } = regionsFrom('## Title\n\n開場說明。\n\n![a](a.png)\n')
    const { bodyText, cells } = figureCells(blocks)

    expect(bodyText.map((block) => block.type)).toEqual(['paragraph'])
    expect(cells).toHaveLength(1)
    expect(cells[0].legend).toEqual([])
  })

  it('gives each figure the paragraphs that immediately follow it', () => {
    // Position decides the role: the run of prose after a figure is that
    // figure's legend, and the next figure ends the run.
    const { blocks } = regionsFrom('內文。\n\n![a](a.png)\n\n左圖說明。\n\n![b](b.png)\n\n右圖說明。\n')
    const { bodyText, cells } = figureCells(blocks)

    expect(bodyText).toHaveLength(1)
    expect(cells).toHaveLength(2)
    expect(cells[0].legend).toHaveLength(1)
    expect(cells[0].legend[0].inlines?.[0]).toMatchObject({ value: '左圖說明。' })
    expect(cells[1].legend[0].inlines?.[0]).toMatchObject({ value: '右圖說明。' })
  })

  it('ignores headings and reports no cells for a figureless scene', () => {
    const { blocks } = regionsFrom('## Title\n\n只有文字。\n')
    const { bodyText, cells } = figureCells(blocks)

    expect(cells).toEqual([])
    expect(bodyText.map((block) => block.type)).toEqual(['paragraph'])
  })
})

describe('figureGridShape — balanced grid, three columns max', () => {
  it.each([
    [1, { rows: 1, columns: 1 }],
    [2, { rows: 1, columns: 2 }],
    [3, { rows: 1, columns: 3 }],
    // Four is a quadrant, not a 3 + 1 orphan — that is what balancing buys.
    [4, { rows: 2, columns: 2 }],
    [5, { rows: 2, columns: 3 }],
    [6, { rows: 2, columns: 3 }],
    [7, { rows: 3, columns: 3 }],
  ])('lays %i figures out as %o', (count, expected) => {
    expect(figureGridShape(count)).toEqual(expected)
  })
})

describe('planScenes — sized figures', () => {
  it('computes a sized figure from the viewport and keeps the following paragraph on its scene', () => {
    // design v2: `size=NN%` figures are pure arithmetic — a stale or absurd DOM
    // measurement must not strand the grouped paragraph onto the next scene.
    const { blocks, regions } = regionsFrom(
      '## Renal function\n\n<!-- present: group -->\n![chart](fig.png){size=45%} 圖一：說明\n\nA paragraph below the figure.\n<!-- present: end-group -->\n',
    )
    const shortViewport = 430
    const measurements = measure(blocks, (block) => (block.type === 'figure' ? 280 : block.type === 'heading' ? 76 : 60))
    const plan = planScenes(regions, measurements, shortViewport, 'balanced')

    expect(plan.scenes).toHaveLength(1)
    expect(plannedBlockIds(plan.scenes)).toEqual(allBlockIds(blocks))
  })
})

describe('planScenes — explicit groups', () => {
  // `---` cuts the figure page off from the free paragraphs (design v5).
  const GROUPED = '<!-- present: group -->\n![chart](fig.png){size=45%} 圖說\n\n重點一\n\n重點二\n<!-- present: end-group -->\n\n---\n\n自由段落甲。\n\n自由段落乙。\n'

  it('never splits a present: group across scenes', () => {
    const { blocks, regions } = regionsFrom(GROUPED)
    const measurements = measure(blocks, (block) => (block.type === 'figure' ? 280 : 150))
    const plan = planScenes(regions, measurements, 430, 'balanced')
    const groupScene = plan.scenes.find((scene) => scene.blocks.some((block) => block.type === 'figure'))

    expect(groupScene?.blocks.map((block) => block.type)).toEqual(['figure', 'paragraph', 'paragraph'])
  })

  it('keeps an overflowing group whole and flags the scene', () => {
    const { blocks, regions } = regionsFrom(GROUPED)
    const measurements = measure(blocks, (block) => (block.type === 'figure' ? 280 : 330))
    const plan = planScenes(regions, measurements, 430, 'balanced')
    const groupScene = plan.scenes.find((scene) => scene.blocks.some((block) => block.type === 'figure'))

    expect(groupScene?.blocks).toHaveLength(3)
    expect(groupScene?.fillRatio).toBeGreaterThan(1)
    expect(groupScene?.warning).toBeTruthy()
    expect(plan.overflowCount).toBeGreaterThan(0)
  })
})

describe('planScenes — full-bleed figures', () => {
  it('measures size against the height remaining after the heading', () => {
    // design v5: with an H2 on the scene, size=100% means the space left
    // under the heading — the scene fills exactly, no overflow warning.
    const { blocks, regions } = regionsFrom('## Title\n\n![chart](fig.png){size=100%} 圖說\n')
    const plan = planScenes(regions, measure(blocks, (b) => (b.type === 'heading' ? 76 : 300)), 430, 'balanced')

    expect(plan.scenes).toHaveLength(1)
    expect(plan.scenes[0].layout).toBe('figure')
    expect(plan.scenes[0].fillRatio).toBeLessThanOrEqual(1)
    expect(plan.scenes[0].warning).toBeUndefined()
  })

  it('lets a lone size=100% figure fill a scene without an overflow warning', () => {
    // The warning the author saw: size was measured against the full stage
    // while the budget is the content area, so ≥84% always overflowed.
    const { blocks, regions } = regionsFrom('![chart](fig.png){size=100%} 圖說\n')
    const plan = planScenes(regions, measure(blocks, 300), 430, 'balanced')

    expect(plan.scenes).toHaveLength(1)
    expect(plan.scenes[0].fillRatio).toBeLessThanOrEqual(1)
    expect(plan.scenes[0].warning).toBeUndefined()
    expect(plan.overflowCount).toBe(0)
  })
})

describe('planScenes — above-figure text shrinks to fit', () => {
  it('scales oversized body text instead of pushing it off the figure page', () => {
    // "你可以縮小文字，總之塞就對了" — above-figure prose shrinks (floor 0.6)
    // so the author-delimited figure page holds.
    const { blocks, regions } = regionsFrom('大量內文段落。\n\n![chart](fig.png){size=45%}\n\n圖說。\n')
    const measurements = measure(blocks, (block) => (block.type === 'paragraph' && blocks.indexOf(block) === 0 ? 500 : block.type === 'figure' ? 280 : 60))
    const plan = planScenes(regions, measurements, 430, 'balanced')

    expect(plan.scenes).toHaveLength(1)
    expect(plan.scenes[0].fillRatio).toBeLessThanOrEqual(1)
    expect(plan.scenes[0].warning).toBeUndefined()
    expect(plan.scenes[0].figureTextScale).toBeGreaterThanOrEqual(0.6)
    expect(plan.scenes[0].figureTextScale).toBeLessThan(1)
  })
})

describe('planScenes — fit test', () => {
  it('emits one scene for a region that fits comfortably', () => {
    // spec: "Comfortable regions become scenes directly."
    const { blocks, regions } = regionsFrom('## Section\n\nOne.\n\nTwo.\n')
    const plan = planScenes(regions, measure(blocks, 100), VIEWPORT, 'balanced')

    expect(plan.scenes).toHaveLength(1)
    expect(plan.scenes[0].blocks).toHaveLength(3)
  })

  it('splits a region that exceeds the comfortable fill', () => {
    const markdown = `## Section\n\n${Array.from({ length: 8 }, (_, i) => `Paragraph ${i}.`).join('\n\n')}\n`
    const { blocks, regions } = regionsFrom(markdown)
    const plan = planScenes(regions, measure(blocks, 200), VIEWPORT, 'balanced')

    expect(plan.scenes.length).toBeGreaterThan(1)
  })

  it('keeps optimal fill below 100%', () => {
    // spec: "Optimal fill is intentionally below 100%."
    const markdown = `## Section\n\n${Array.from({ length: 10 }, (_, i) => `Paragraph ${i}.`).join('\n\n')}\n`
    const { blocks, regions } = regionsFrom(markdown)
    const plan = planScenes(regions, measure(blocks, 180), VIEWPORT, 'balanced')

    for (const scene of plan.scenes) {
      expect(scene.fillRatio).toBeLessThanOrEqual(1)
    }
  })

  it('produces fewer scenes in compact than in cinematic for the same document', () => {
    // spec: Compact targets ~70-85% fill, Cinematic ~30-55%. Denser packing
    // must therefore need fewer scenes for identical content.
    const markdown = `## Section\n\n${Array.from({ length: 12 }, (_, i) => `Paragraph ${i}.`).join('\n\n')}\n`
    const { blocks, regions } = regionsFrom(markdown)
    const heights = measure(blocks, 120)

    const compact = planScenes(regions, heights, VIEWPORT, 'compact')
    const cinematic = planScenes(regions, heights, VIEWPORT, 'cinematic')

    expect(compact.scenes.length).toBeLessThanOrEqual(cinematic.scenes.length)
  })

  it('loses no content when paginating', () => {
    const markdown = `## Section\n\n${Array.from({ length: 15 }, (_, i) => `Paragraph ${i}.`).join('\n\n')}\n`
    const { blocks, regions } = regionsFrom(markdown)
    const plan = planScenes(regions, measure(blocks, 150), VIEWPORT, 'balanced')

    expect(plannedBlockIds(plan.scenes)).toEqual(allBlockIds(blocks))
  })
})

describe('planScenes — invariants from spec.md', () => {
  it('never separates a figure from the prose bound to it', () => {
    // spec critical invariant: "split image-caption pairs = 0". Since design
    // v3, prose is bound to a figure explicitly via present: group markers.
    const markdown = [
      '## Section',
      ...Array.from({ length: 4 }, (_, i) => `Filler ${i}.`),
      '<!-- present: group -->\n\nLead-in prose.',
      '![Figure](f.png)',
      'Explanatory copy.\n\n<!-- present: end-group -->',
    ].join('\n\n')
    const { blocks, regions } = regionsFrom(`${markdown}\n`)
    const plan = planScenes(regions, measure(blocks, 150), VIEWPORT, 'balanced')

    const figure = blocks.find((block) => block.type === 'figure')!
    const sceneWithFigure = plan.scenes.find((scene) => scene.blocks.some((block) => block.id === figure.id))!
    const idsOnScene = new Set(sceneWithFigure.blocks.map((block) => block.id))

    const figureIndex = blocks.indexOf(figure)
    expect(idsOnScene.has(blocks[figureIndex - 1].id)).toBe(true)
    expect(idsOnScene.has(blocks[figureIndex + 1].id)).toBe(true)
  })

  it('does not orphan a heading at the end of a scene', () => {
    // spec tracks "orphan headings" as a failure metric, and headings are
    // defined as keeping with the next block.
    const markdown = [
      '## Section',
      ...Array.from({ length: 5 }, (_, i) => `Paragraph ${i}.`),
      '### Subsection',
      ...Array.from({ length: 5 }, (_, i) => `More ${i}.`),
    ].join('\n\n')
    const { blocks, regions } = regionsFrom(`${markdown}\n`)
    const plan = planScenes(regions, measure(blocks, 170), VIEWPORT, 'balanced')

    for (const scene of plan.scenes) {
      const last = scene.blocks.at(-1)!
      const isRegionEnd = scene.blocks.length === 1 && last.depth === 1
      if (!isRegionEnd) {
        expect(last.type).not.toBe('heading')
      }
    }
  })

  it('respects a manual break as a hard boundary', () => {
    // spec: "A manual break has infinite priority and cannot be overridden."
    const { blocks, regions } = regionsFrom('Before break.\n\n<!-- present: break -->\n\nAfter break.\n')
    const plan = planScenes(regions, measure(blocks, 50), VIEWPORT, 'balanced')

    // Both blocks are tiny and would otherwise share one comfortable scene.
    expect(plan.scenes).toHaveLength(2)
  })

  it('splits an oversized list at item boundaries rather than overflowing', () => {
    // spec: "long lists split only at item boundaries with continuation context."
    const items = Array.from({ length: 20 }, (_, i) => `- Item ${i}`).join('\n')
    const { blocks, regions } = regionsFrom(`## Section\n\n${items}\n`)
    const list = blocks.find((block) => block.type === 'list')!
    const plan = planScenes(regions, measure(blocks, (b) => (b.id === list.id ? CAPACITY * 3 : 60)), VIEWPORT, 'balanced')

    const listParts = plan.scenes.flatMap((scene) => scene.blocks).filter((block) => block.type === 'list')
    expect(listParts.length).toBeGreaterThan(1)

    // No item may be dropped or duplicated by the split.
    const splitItems = listParts.flatMap((part) => part.listItems ?? [])
    expect(splitItems).toHaveLength(list.listItems!.length)

    // Parts after the first are marked as continuations.
    expect(listParts.slice(1).every((part) => part.continuation)).toBe(true)
  })

  it('marks continuation scenes with a label', () => {
    const items = Array.from({ length: 20 }, (_, i) => `- Item ${i}`).join('\n')
    const { blocks, regions } = regionsFrom(`## Diagnosis\n\n${items}\n`)
    const list = blocks.find((block) => block.type === 'list')!
    const plan = planScenes(regions, measure(blocks, (b) => (b.id === list.id ? CAPACITY * 3 : 60)), VIEWPORT, 'balanced')

    const continued = plan.scenes.filter((scene) => scene.continuationLabel)
    expect(continued.length).toBeGreaterThan(0)
    expect(continued[0].continuationLabel).toContain('Diagnosis')
  })
})

describe('planScenes — stability', () => {
  it('is deterministic for identical input', () => {
    const markdown = `## Section\n\n${Array.from({ length: 12 }, (_, i) => `Paragraph ${i}.`).join('\n\n')}\n`
    const { blocks, regions } = regionsFrom(markdown)
    const heights = measure(blocks, 160)

    const first = planScenes(regions, heights, VIEWPORT, 'balanced')
    const second = planScenes(regions, heights, VIEWPORT, 'balanced')

    expect(second.scenes.map((scene) => scene.id)).toEqual(first.scenes.map((scene) => scene.id))
  })

  it('prefers previous boundaries when replanning unchanged content', () => {
    // spec: "Minor edits should preserve prior boundaries when their quality
    // remains competitive. This stability supports rehearsal."
    const markdown = `## Section\n\n${Array.from({ length: 12 }, (_, i) => `Paragraph ${i}.`).join('\n\n')}\n`
    const { blocks, regions } = regionsFrom(markdown)
    const heights = measure(blocks, 160)

    const first = planScenes(regions, heights, VIEWPORT, 'balanced')
    const replan = planScenes(regions, heights, VIEWPORT, 'balanced', first)

    expect(replan.scenes.map((scene) => scene.endBlockId)).toEqual(first.scenes.map((scene) => scene.endBlockId))
  })

  it('reports plan-level fill and overflow metrics', () => {
    const markdown = `## Section\n\n${Array.from({ length: 6 }, (_, i) => `Paragraph ${i}.`).join('\n\n')}\n`
    const { blocks, regions } = regionsFrom(markdown)
    const plan = planScenes(regions, measure(blocks, 150), VIEWPORT, 'balanced')

    expect(plan.averageFill).toBeGreaterThan(0)
    expect(plan.averageFill).toBeLessThanOrEqual(1)
    expect(plan.overflowCount).toBe(0)
    expect(plan.measuredBlockCount).toBe(blocks.length)
  })
})

describe('chooseLayout', () => {
  const block = (over: Partial<PresentationBlock>): PresentationBlock => ({
    id: over.id ?? 'b',
    type: 'paragraph',
    semanticRole: 'body',
    importance: 0.5,
    keepTogether: true,
    keepWithNext: false,
    keepWithPrevious: false,
    breakBefore: 'auto',
    breakAfter: 'auto',
    visibility: 'normal',
    layoutHint: 'auto',
    sourceRange: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
    ...over,
  })

  it('chooses chapter for a lone H1', () => {
    expect(chooseLayout([block({ type: 'heading', depth: 1 })])).toBe('chapter')
  })

  it('chooses statement for a lone quote', () => {
    expect(chooseLayout([block({ type: 'blockquote' })])).toBe('statement')
  })

  it('chooses the single figure layout for any composition containing a figure', () => {
    // design v5: figure scenes have exactly one structure — optional heading,
    // then figure left / text right. No legend, text-media, or media-dominant.
    expect(chooseLayout([block({ id: 'f', type: 'figure', layoutHint: 'legend' }), block({ id: 'p' })])).toBe('figure')
    expect(chooseLayout([block({ id: 'f', type: 'figure', layoutHint: 'hero' }), block({ id: 'p' })])).toBe('figure')
    expect(chooseLayout([block({ id: 'f', type: 'figure' })])).toBe('figure')
  })

  it('chooses text when there is no media', () => {
    expect(chooseLayout([block({ id: 'a' }), block({ id: 'b' })])).toBe('text')
  })

  it('derives layout from composition, never from author choice', () => {
    // Same blocks, same result — there is no per-scene layout override.
    const scene = [block({ id: 'a' }), block({ id: 'b' })]
    expect(chooseLayout(scene)).toBe(chooseLayout([...scene]))
  })
})

describe('withPresentationCover', () => {
  it('prepends exactly one cover scene', () => {
    const { blocks, regions } = regionsFrom('## Section\n\nProse.\n')
    const plan = planScenes(regions, measure(blocks, 100), VIEWPORT, 'balanced')
    const withCover = withPresentationCover(plan, defaultPresentationConfig('Talk title'))

    expect(withCover.scenes).toHaveLength(plan.scenes.length + 1)
    expect(withCover.scenes[0].role).toBe('cover')
    expect(withCover.scenes[0].layout).toBe('title')
  })

  it('keeps cover metadata out of the document body', () => {
    // spec: "Cover metadata comes from separate presentation configuration,
    // not the Markdown body."
    const { blocks, regions } = regionsFrom('## Section\n\nProse.\n')
    const plan = planScenes(regions, measure(blocks, 100), VIEWPORT, 'balanced')
    const withCover = withPresentationCover(plan, defaultPresentationConfig('Talk title'))

    expect(withCover.scenes[0].blocks).toHaveLength(0)
  })

  it('gives the cover a config-derived identity so edits do not reshuffle scenes', () => {
    const { blocks, regions } = regionsFrom('## Section\n\nProse.\n')
    const plan = planScenes(regions, measure(blocks, 100), VIEWPORT, 'balanced')

    const a = withPresentationCover(plan, defaultPresentationConfig('One')).scenes[0].id
    const b = withPresentationCover(plan, defaultPresentationConfig('One')).scenes[0].id
    const c = withPresentationCover(plan, defaultPresentationConfig('Two')).scenes[0].id

    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})

describe('relaxOversizedChains via planScenes (#31)', () => {
  // These exercise the constraint-relaxation pass through the public API:
  // chains measured taller than capacity must yield to feasible boundaries
  // without ever cutting a figure from its only prose.

  it('splits an oversized figure chain at shared prose, keeping pairs whole', () => {
    // heading + lead + figure + shared prose + figure: the whole chain cannot
    // fit, but [heading lead figure] and [shared figure] both can.
    const markdown = '## Site\n\nLead prose.\n\n![One](a.png)\n\nShared prose.\n\n![Two](b.png)\n'
    const { blocks, regions } = regionsFrom(markdown)
    const heights = measure(blocks, (block) => (block.type === 'figure' ? 280 : block.type === 'heading' ? 76 : 56))
    const plan = planScenes(regions, heights, 768, 'balanced')

    expect(plan.overflowCount).toBe(0)
    // The bound pair (first figure + its legend) must land on one scene; the
    // relaxation may only break links the normalizer left unbound.
    const figures = blocks.filter((block) => block.type === 'figure')
    const legend = blocks[blocks.indexOf(figures[0]) + 1]
    expect(legend.keepWithPrevious).toBe(true)
    const sceneWithFigure = plan.scenes.find((scene) => scene.blocks.some((block) => block.id === figures[0].id))!
    expect(sceneWithFigure.blocks.some((block) => block.id === legend.id)).toBe(true)
    // And no scene ends on a still-bound block.
    for (const scene of plan.scenes) {
      const last = scene.blocks.at(-1)!
      const lastIndexInRegion = regions[0].blocks.findIndex((block) => block.id === last.id)
      const isRegionEnd = lastIndexInRegion === regions[0].blocks.length - 1
      if (!isRegionEnd) expect(last.keepWithNext && !last.continuation).toBe(false)
    }
  })

  it('rescues a heading glued to a code block that fits alone but not together', () => {
    const code = Array.from({ length: 24 }, (_, i) => `line ${i}`).join('\n')
    const markdown = `## Build\n\n\`\`\`bash\n${code}\n\`\`\`\n`
    const { blocks, regions } = regionsFrom(markdown)
    const codeBlock = blocks.find((block) => block.type === 'code')!
    // Code alone fits (620 < 645 capacity at 768); heading + code does not.
    const heights = measure(blocks, (block) => (block.id === codeBlock.id ? 620 : 76))
    const plan = planScenes(regions, heights, 768, 'balanced')

    expect(plan.overflowCount).toBe(0)
    // The heading must not be orphaned: its scene also carries code.
    const headingScene = plan.scenes.find((scene) => scene.blocks.some((block) => block.type === 'heading'))!
    expect(headingScene.blocks.some((block) => block.type === 'code')).toBe(true)
    // And the code arrives in continuation parts rather than overflowing.
    const codeParts = plan.scenes.flatMap((scene) => scene.blocks).filter((block) => block.type === 'code')
    expect(codeParts.length).toBeGreaterThan(1)
  })

  it('leaves satisfiable chains exactly alone', () => {
    const markdown = '## Section\n\nLead prose.\n\n![One](a.png)\n\nLegend prose.\n'
    const { blocks, regions } = regionsFrom(markdown)
    const heights = measure(blocks, 60)
    const plan = planScenes(regions, heights, 1080, 'balanced')

    expect(plan.scenes).toHaveLength(1)
    expect(plan.overflowCount).toBe(0)
  })
})
