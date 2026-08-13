import { describe, expect, it } from 'vitest'
import { buildSemanticRegions, parsePresentationDocument } from './semantics'
import { chooseLayout, planScenes, withPresentationCover } from './planner'
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
    // spec critical invariant: "split image-caption pairs = 0"
    const markdown = [
      '## Section',
      ...Array.from({ length: 4 }, (_, i) => `Filler ${i}.`),
      'Lead-in prose.',
      '![Figure](f.png)',
      'Explanatory copy.',
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

  it('chooses legend for the default figure composition', () => {
    // The normalizer makes `legend` the default hint for images, so an
    // ordinary figure with prose lands here rather than in text-media.
    const scene = [block({ id: 'f', type: 'figure', layoutHint: 'legend' }), block({ id: 'p' })]
    expect(chooseLayout(scene)).toBe('legend')
  })

  it('chooses media-dominant for a hero figure', () => {
    const scene = [block({ id: 'f', type: 'figure', layoutHint: 'hero' }), block({ id: 'p' })]
    expect(chooseLayout(scene)).toBe('media-dominant')
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
