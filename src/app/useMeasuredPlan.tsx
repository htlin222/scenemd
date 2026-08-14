import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { BlockView } from '../components/SceneView'
import { buildSemanticRegions, parsePresentationDocument } from '../engine/semantics'
import { planScenes, withPresentationCover } from '../engine/planner'
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
  const [measuring, setMeasuring] = useState(true)
  const measureRef = useRef<HTMLDivElement>(null)
  const previousPlanRef = useRef<ScenePlan>(EMPTY_PLAN)
  const onPlanChangeRef = useRef(onPlanChange)
  onPlanChangeRef.current = onPlanChange

  const blocks = useMemo(() => parsePresentationDocument(markdown), [markdown])
  const regions = useMemo(() => buildSemanticRegions(blocks), [blocks])
  const plan = useMemo(
    () => withPresentationCover(
      planScenes(regions, measurements, presenting ? window.innerHeight : viewport.height, density, previousPlanRef.current),
      presentationConfig,
    ),
    [regions, measurements, viewport.height, density, presenting, presentationConfig],
  )

  useLayoutEffect(() => {
    if (!measureRef.current) return
    setMeasuring(true)
    const frame = window.requestAnimationFrame(() => {
      const next = new Map<string, number>()
      measureRef.current?.querySelectorAll<HTMLElement>('[data-measure-id], [data-measure-item-id]').forEach((element) => {
        const id = element.dataset.measureId ?? element.dataset.measureItemId
        if (id) next.set(id, element.getBoundingClientRect().height)
      })
      setMeasurements(next)
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

/**
 * The hidden render target the measurement pass reads from. Every block must
 * render with `measurement` so stepped reveals and hidden highlight states
 * show fully — the measured height must be the block's maximum.
 */
export function MeasurementRoot({ blocks, measureRef, width }: { blocks: PresentationBlock[]; measureRef: RefObject<HTMLDivElement | null>; width: number }) {
  return <div className="measurement-root" ref={measureRef} aria-hidden="true" style={{ width }}>
    {blocks.map((block) => <div data-measure-id={block.id} key={block.id}><BlockView block={block} measurement /></div>)}
  </div>
}
