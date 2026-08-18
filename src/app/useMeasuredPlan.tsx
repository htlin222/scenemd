import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { BlockView } from '../components/SceneView'
import { buildSemanticRegions, parsePresentationDocument } from '../engine/semantics'
import { legendCandidates, planScenes, withPresentationCover, type LegendMeasurements } from '../engine/planner'
import type { Density, PresentationBlock, PresentationConfig, ScenePlan, SemanticRegion, ThemeMode } from '../engine/types'
import { EMPTY_PLAN } from './shared'

/**
 * The measurement loop and the planning chain — the engine's most subtle
 * contract, extracted from App.tsx (#13) so it can be read in one place.
 *
 * A hidden measurement root renders every block at the live viewport width;
 * a rAF pass reads real heights off `[data-measure-id]` /
 * `[data-measure-item-id]` elements into the map that drives planScenes.
 * `blockHeight()` in the planner is only a fallback for unmeasured blocks.
 *
 * `previousPlanRef` threads the prior plan into the next planning pass so the
 * stability score can prefer existing boundaries. Ordering is load-bearing:
 * `onPlanChange` fires with the OLD plan before the ref advances, which is
 * what lets the caller keep the presented scene stable across replans.
 */

export interface MeasuredPlan {
  blocks: PresentationBlock[]
  regions: SemanticRegion[]
  plan: ScenePlan
  measuring: boolean
  measureRef: RefObject<HTMLDivElement | null>
}

export function useMeasuredPlan(
  markdown: string,
  viewport: { width: number; height: number },
  density: Density,
  theme: ThemeMode,
  presenting: boolean,
  presentationConfig: PresentationConfig,
  onPlanChange: (previousPlan: ScenePlan, plan: ScenePlan) => void,
): MeasuredPlan {
  const [measurements, setMeasurements] = useState<Map<string, number>>(new Map())
  const [legendMeasurements, setLegendMeasurements] = useState<LegendMeasurements>(new Map())
  const [measuring, setMeasuring] = useState(true)
  const measureRef = useRef<HTMLDivElement>(null)
  const previousPlanRef = useRef<ScenePlan>(EMPTY_PLAN)
  const onPlanChangeRef = useRef(onPlanChange)
  onPlanChangeRef.current = onPlanChange

  const blocks = useMemo(() => parsePresentationDocument(markdown), [markdown])
  const regions = useMemo(() => buildSemanticRegions(blocks), [blocks])
  const plan = useMemo(
    () => withPresentationCover(
      planScenes(regions, measurements, presenting ? window.innerHeight : viewport.height, density, previousPlanRef.current, legendMeasurements),
      presentationConfig,
    ),
    [regions, measurements, legendMeasurements, viewport.height, density, presenting, presentationConfig],
  )

  useLayoutEffect(() => {
    if (!measureRef.current) return
    setMeasuring(true)
    const frame = window.requestAnimationFrame(() => {
      if (!measureRef.current) return
      const next = collectMeasurements(measureRef.current)
      setMeasurements(next.blocks)
      setLegendMeasurements(next.legends)
      setMeasuring(false)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [blocks, viewport.width, density, theme])

  // Deliberately a passive effect (matching the pre-extraction timing), not a
  // layout effect: scene-index remapping does not need to beat paint.
  useEffect(() => {
    onPlanChangeRef.current(previousPlanRef.current, plan)
    previousPlanRef.current = plan
  }, [plan])

  return { blocks, regions, plan, measuring, measureRef }
}

// Column counts a figure grid can use (planner: MAX_FIGURE_COLUMNS = 3).
const GRID_COLUMN_COUNTS = [2, 3]
// Mirrors the column gap in .figure-gallery-grid (2.2cqw).
const GRID_COLUMN_GAP_RATIO = 0.022

const cellWidth = (width: number, columns: number) =>
  Math.max(80, (width - (columns - 1) * width * GRID_COLUMN_GAP_RATIO) / columns)

/**
 * The hidden render target the measurement pass reads from. Every block must
 * render with `measurement` so stepped reveals and hidden highlight states
 * show fully — the measured height must be the block's maximum.
 *
 * Legend candidates are rendered a second and third time at grid-cell width,
 * inside a real `.figure-below-caption`, because a legend's height in an
 * n-column grid is not its full-width height times n — the type size is `cqw`
 * against the stage and does not shrink with the column, so a short legend
 * still fits one line while a long one reflows unpredictably. The narrow
 * copies must NOT declare `container-type`, or `cqw` would resolve against
 * them instead of the measurement root and the type size would change.
 */
export function MeasurementRoot({ blocks, measureRef, width }: { blocks: PresentationBlock[]; measureRef: RefObject<HTMLDivElement | null>; width: number }) {
  const legends = legendCandidates(blocks)
  return <div className="measurement-root" ref={measureRef} aria-hidden="true" style={{ width }}>
    {blocks.map((block) => <div data-measure-id={block.id} key={block.id}><BlockView block={block} measurement /></div>)}
    {legends.length > 0 && GRID_COLUMN_COUNTS.map((columns) => (
      <div key={columns} className="figure-below-caption" style={{ width: cellWidth(width, columns) }}>
        {legends.map((block) => (
          <div data-measure-legend-id={block.id} data-measure-legend-columns={columns} key={block.id}>
            <BlockView block={block} measurement />
          </div>
        ))}
      </div>
    ))}
  </div>
}

/**
 * Reads both passes off a measurement root. Shared with `tests/harness/` so the
 * e2e specs exercise the same collection the app uses.
 */
export function collectMeasurements(root: HTMLElement): { blocks: Map<string, number>; legends: LegendMeasurements } {
  const blocks = new Map<string, number>()
  const legends: LegendMeasurements = new Map()
  root.querySelectorAll<HTMLElement>('[data-measure-id], [data-measure-item-id]').forEach((element) => {
    const id = element.dataset.measureId ?? element.dataset.measureItemId
    if (id) blocks.set(id, element.getBoundingClientRect().height)
  })
  root.querySelectorAll<HTMLElement>('[data-measure-legend-id]').forEach((element) => {
    const id = element.dataset.measureLegendId
    const columns = Number(element.dataset.measureLegendColumns)
    if (!id || !columns) return
    if (!legends.has(columns)) legends.set(columns, new Map())
    legends.get(columns)!.set(id, element.getBoundingClientRect().height)
  })
  return { blocks, legends }
}
