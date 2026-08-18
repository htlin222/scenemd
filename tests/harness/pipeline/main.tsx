import { StrictMode, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/source-sans-3/latin-400.css'
import '@fontsource/source-sans-3/latin-600.css'
import '@fontsource/source-sans-3/latin-700.css'
import 'katex/dist/katex.min.css'
import '../../../src/styles.css'
import '../../../src/scene-theme.css'
import { buildSemanticRegions, parsePresentationDocument } from '../../../src/engine/semantics'
import { planScenes } from '../../../src/engine/planner'
import { SceneView } from '../../../src/components/SceneView'
import { MeasurementRoot, collectMeasurements } from '../../../src/app/useMeasuredPlan'
import type { LegendMeasurements } from '../../../src/engine/planner'
import { defaultPresentationConfig } from '../../../src/presentationConfig'

// Mirrors App.tsx: previewViewport() + the hidden measurement-root loop, so the
// e2e specs exercise the real markdown → measure → planScenes → SceneView path.
const params = new URLSearchParams(window.location.search)
const stageWidth = Number(params.get('width') || 640)
const viewport = {
  width: stageWidth,
  height: stageWidth < 560 ? stageWidth * (16 / 9) : Math.max(360, stageWidth * 0.5625),
}

// The author's canonical figure-page pattern (design v5): `---` cuts pages;
// inside a figure page, prose above the image is body copy and prose below it
// is the legend. `?size=` overrides the figure size, `?heading=0` drops the H2
// so specs can compare both variants, and `?figures=N` writes N figures so the
// multi-figure grid specs can drive the column count.
const figureSize = Number(params.get('size') || 45)
const withHeading = params.get('heading') !== '0'
const figureCount = Math.max(1, Number(params.get('figures') || 1))
// The one-figure legend text is unchanged so the pre-existing specs keep
// asserting on the exact string they were written against.
const legendFor = (index: number) => (figureCount === 1
  ? '圖一：腎絲球過濾率隨年齡下降（資料來源：NHANES 系列研究）。'
  : `圖${index + 1}：第 ${index + 1} 組資料的年齡分布與判讀重點。`)
const FIGURES = Array.from({ length: figureCount }, (_, index) =>
  `![Figure ${index + 1}](https://img.test/fig${index}.png){size=${figureSize}%}\n\n${legendFor(index)}`,
).join('\n\n')
const DOC = `${withHeading ? '## Renal function\n\n' : ''}腎功能隨年齡下降，本頁說明其臨床意義與判讀重點。

${FIGURES}
`

const config = defaultPresentationConfig('Pipeline harness')

function Harness() {
  const markdown = DOC
  const blocks = useMemo(() => parsePresentationDocument(markdown), [markdown])
  const regions = useMemo(() => buildSemanticRegions(blocks), [blocks])
  const [measurements, setMeasurements] = useState<Map<string, number>>(new Map())
  const [legendMeasurements, setLegendMeasurements] = useState<LegendMeasurements>(new Map())
  const measureRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!measureRef.current) return
      const next = collectMeasurements(measureRef.current)
      setMeasurements(next.blocks)
      setLegendMeasurements(next.legends)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [blocks])

  const plan = useMemo(
    () => (measurements.size ? planScenes(regions, measurements, viewport.height, 'balanced', undefined, legendMeasurements) : null),
    [regions, measurements, legendMeasurements],
  )

  return (
    <div>
      {plan && (
        <pre data-testid="plan-json" style={{ font: '11px monospace' }}>
          {JSON.stringify({
            viewport,
            scenes: plan.scenes.map((scene) => ({
              layout: scene.layout,
              fillRatio: Number(scene.fillRatio.toFixed(3)),
              blocks: scene.blocks.map((block) => ({ type: block.type })),
            })),
          }, null, 1)}
        </pre>
      )}
      {plan?.scenes.map((scene, index) => (
        <div
          key={scene.id}
          className="stage-shell"
          data-testid={`scene-${index}`}
          style={{ width: viewport.width, margin: '12px 0' }}
        >
          <SceneView scene={scene} sceneNumber={index + 1} sceneCount={plan.scenes.length} presentationConfig={config} />
        </div>
      ))}
      <MeasurementRoot blocks={blocks} measureRef={measureRef} width={Math.max(320, viewport.width - 150)} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
