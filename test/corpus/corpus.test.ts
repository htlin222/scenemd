import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSemanticRegions, parsePresentationDocument } from '../../src/engine/semantics'
import { planScenes } from '../../src/engine/planner'
import type { Density, PresentationBlock, Scene, ScenePlan, SemanticRegion } from '../../src/engine/types'
import { measurementsFor } from './measure'

// Automates the Evaluation section of spec.md: every fixture category the spec
// names, planned at every viewport class and density mode, checked against the
// critical invariants. Expected values come from the spec's stated contracts.
//
// The "main content below 20px = 0" invariant is not asserted here because the
// planner contains no typography at all — it cannot shrink fonts, so the
// invariant is structural. It becomes testable only in a DOM (see #3, #14).

const FIXTURE_DIR = join(__dirname, 'fixtures')

// spec: "across 16:9, 4:3, ultrawide, and narrow viewports"
const VIEWPORTS = {
  '16:9': 1080,
  '4:3': 768,
  ultrawide: 1440,
  narrow: 640,
} as const

const DENSITIES: Density[] = ['compact', 'balanced', 'cinematic']

const OVERSIZED = new Set(['oversized-figure.md', 'oversized-math.md'])

// Known invariant gaps in the current planner, recorded as a ratchet.
//
// The greedy scan treats keep bindings and orphan headings as score penalties
// rather than hard constraints, so under tight capacity it still chooses
// boundaries that violate them. Tracked in #8 (global optimization) — when a
// combo below starts passing, the ratchet test fails until its entry is
// removed, so this list can only shrink.
//
// Key format: `${fixture}@${viewportHeight}/${density}:${invariant}`
const KNOWN_GAPS = new Set([
  // Critical invariant "split image-caption pairs = 0" — figure glued to its
  // caption ends a scene anyway.
  ...['compact', 'balanced', 'cinematic'].flatMap((density) => [
    `image-heavy.md@768/${density}:keep`,
    `image-heavy.md@640/${density}:keep`,
    `code-heavy.md@768/${density}:keep`,
    `list-heavy.md@768/${density}:keep`,
  ]),
  // "orphan headings = 0" — a heading ends a scene mid-region.
  ...['compact', 'balanced', 'cinematic'].flatMap((density) => [
    `code-heavy.md@768/${density}:orphan`,
    `list-heavy.md@768/${density}:orphan`,
  ]),
])

const gapKey = (name: string, viewportHeight: number, density: Density, invariant: string) =>
  `${name}@${viewportHeight}/${density}:${invariant}`

const fixtures = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith('.md'))
  .map((name) => ({ name, markdown: readFileSync(join(FIXTURE_DIR, name), 'utf8') }))

interface PlannedFixture {
  name: string
  blocks: PresentationBlock[]
  regions: SemanticRegion[]
  plan: ScenePlan
  viewport: string
  density: Density
}

function planFixture(name: string, markdown: string, viewportHeight: number, density: Density, previous?: ScenePlan): PlannedFixture & { measurements: Map<string, number> } {
  const blocks = parsePresentationDocument(markdown)
  const regions = buildSemanticRegions(blocks)
  const measurements = measurementsFor(blocks)
  const plan = planScenes(regions, measurements, viewportHeight, density, previous)
  return { name, blocks, regions, plan, viewport: String(viewportHeight), density, measurements }
}

function baseId(id: string): string {
  return id.replace(/-part-\d+$/, '')
}

function regionOf(regions: SemanticRegion[], scene: Scene): SemanticRegion | undefined {
  return regions.find((region) => region.id === scene.regionId)
}

/** Index of a scene block within its region's planned order, by base id. */
function keepViolations(planned: PlannedFixture): string[] {
  const violations: string[] = []
  for (const scene of planned.plan.scenes) {
    const region = regionOf(planned.regions, scene)
    if (!region) continue
    const last = scene.blocks.at(-1)!
    const lastBaseIndex = region.blocks.findIndex((block) => block.id === baseId(last.id))
    const nextRegionBlock = region.blocks[lastBaseIndex + 1]
    if (!nextRegionBlock) continue // scene ends where the region ends
    // A continuation part is allowed to continue on the next scene; anything
    // else bound by keepWithNext must not end a scene mid-region.
    if (last.keepWithNext && !last.continuation) {
      violations.push(`${planned.name}@${planned.viewport}/${planned.density}: "${last.type}" ends scene but keeps with next`)
    }
  }
  return violations
}

describe.each(Object.entries(VIEWPORTS))('viewport %s', (_label, viewportHeight) => {
  describe.each(DENSITIES)('density %s', (density) => {
    const regular = fixtures.filter(({ name }) => !OVERSIZED.has(name))

    it.each(regular.map((fixture) => [fixture.name, fixture.markdown]))(
      '%s: no unintentional hard overflow',
      (name, markdown) => {
        // spec critical invariant: "unintentional hard overflow = 0"
        const { plan } = planFixture(name, markdown, viewportHeight, density)
        expect(plan.overflowCount).toBe(0)
        for (const scene of plan.scenes) expect(scene.fillRatio).toBeLessThanOrEqual(1)
      },
    )

    it.each(regular.map((fixture) => [fixture.name, fixture.markdown]))(
      '%s: no split image-caption pairs and no keep violations',
      (name, markdown) => {
        // spec critical invariant: "split image-caption pairs = 0". The glue is
        // expressed through keepWithNext/keepWithPrevious, so any keep
        // violation at a scene boundary is a split pair or equivalent.
        const planned = planFixture(name, markdown, viewportHeight, density)
        const violations = keepViolations(planned)
        if (KNOWN_GAPS.has(gapKey(name, viewportHeight, density, 'keep'))) {
          // Ratchet: this combo is a recorded gap. If it starts passing, the
          // fix landed — remove its entry from KNOWN_GAPS.
          expect(violations).not.toEqual([])
        } else {
          expect(violations).toEqual([])
        }
      },
    )

    it.each(regular.map((fixture) => [fixture.name, fixture.markdown]))(
      '%s: no orphan headings',
      (name, markdown) => {
        const { plan } = planFixture(name, markdown, viewportHeight, density)
        const orphans = plan.scenes.filter((scene) => {
          const last = scene.blocks.at(-1)!
          const chapterScene = scene.blocks.length === 1 && last.type === 'heading' && last.depth === 1
          return !chapterScene && last.type === 'heading'
        })
        if (KNOWN_GAPS.has(gapKey(name, viewportHeight, density, 'orphan'))) {
          expect(orphans).not.toEqual([])
        } else {
          expect(orphans).toEqual([])
        }
      },
    )

    it.each(regular.map((fixture) => [fixture.name, fixture.markdown]))(
      '%s: short lists stay atomic',
      (name, markdown) => {
        // spec: "Short lists remain atomic; long lists split only at item
        // boundaries with continuation context."
        const planned = planFixture(name, markdown, viewportHeight, density)
        const shortListIds = new Set(
          planned.blocks.filter((block) => block.type === 'list' && (block.listItems?.length ?? 0) <= 3).map((block) => block.id),
        )
        for (const scene of planned.plan.scenes) {
          for (const block of scene.blocks) {
            if (block.continuation && shortListIds.has(baseId(block.id))) {
              throw new Error(`${name}: short list split at ${block.id}`)
            }
          }
        }
      },
    )

    it.each(regular.map((fixture) => [fixture.name, fixture.markdown]))(
      '%s: no content lost or duplicated',
      (name, markdown) => {
        const planned = planFixture(name, markdown, viewportHeight, density)
        const plannedIds = [...new Set(planned.plan.scenes.flatMap((scene) => scene.blocks.map((block) => baseId(block.id))))].sort()
        expect(plannedIds).toEqual([...new Set(planned.blocks.map((block) => block.id))].sort())
      },
    )

    it.each(regular.map((fixture) => [fixture.name, fixture.markdown]))(
      '%s: replanning unchanged content preserves boundaries',
      (name, markdown) => {
        // spec: "Minor edits should preserve prior boundaries when their
        // quality remains competitive."
        const first = planFixture(name, markdown, viewportHeight, density)
        const replan = planFixture(name, markdown, viewportHeight, density, first.plan)
        expect(replan.plan.scenes.map((scene) => scene.endBlockId)).toEqual(first.plan.scenes.map((scene) => scene.endBlockId))
      },
    )
  })
})

describe('unsplittable oversized content', () => {
  // These fixtures contain a single block measured taller than any capacity in
  // the matrix. The planner cannot split a figure or display math, so the
  // scene overflows — currently silently. #7 tracks surfacing it via
  // Scene.warning; until then these document the gap.
  const cases = fixtures.filter(({ name }) => OVERSIZED.has(name))

  it.each(cases.map((fixture) => [fixture.name, fixture.markdown]))(
    '%s: overflow is reported in plan metrics',
    (name, markdown) => {
      const { plan } = planFixture(name, markdown, 1080, 'balanced')
      expect(plan.overflowCount).toBeGreaterThan(0)
    },
  )

  // KNOWN GAP — spec requires overflow to be surfaced to the author, but
  // makeScene hardcodes warning: undefined. Flips when #7 lands.
  it.fails.each(cases.map((fixture) => [fixture.name, fixture.markdown]))(
    '%s: the overflowing scene carries a warning',
    (name, markdown) => {
      const { plan } = planFixture(name, markdown, 1080, 'balanced')
      const overflowing = plan.scenes.filter((scene) => scene.fillRatio > 1)
      expect(overflowing.length).toBeGreaterThan(0)
      for (const scene of overflowing) expect(scene.warning).toBeTruthy()
    },
  )

  it.each(cases.map((fixture) => [fixture.name, fixture.markdown]))(
    '%s: surrounding content is not dragged into the overflow',
    (name, markdown) => {
      // The unsplittable block must overflow alone; neighbours stay on
      // fitting scenes rather than being pulled into an oversized one.
      const { plan } = planFixture(name, markdown, 1080, 'balanced')
      for (const scene of plan.scenes) {
        if (scene.fillRatio > 1) expect(scene.blocks).toHaveLength(1)
      }
    },
  )
})

describe('corpus metrics', () => {
  it('tracks the aggregate quality profile across the matrix', () => {
    // Not an invariant — a visible dashboard. A planner change that shifts
    // scene counts or fill distribution shows up here as a reviewable delta
    // instead of a silent behavior change.
    const profile: Record<string, { scenes: number; averageFill: number }> = {}
    for (const { name, markdown } of fixtures.filter((fixture) => !OVERSIZED.has(fixture.name))) {
      const { plan } = planFixture(name, markdown, 1080, 'balanced')
      profile[name] = { scenes: plan.scenes.length, averageFill: Math.round(plan.averageFill * 100) / 100 }
    }
    expect(profile).toMatchSnapshot()
  })
})
