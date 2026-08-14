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
import { BlockView, SceneView } from '../../../src/components/SceneView'
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
// is the legend. `?size=` overrides the figure size and `?heading=0` drops
// the H2 so specs can compare both variants.
const figureSize = Number(params.get('size') || 45)
const withHeading = params.get('heading') !== '0'
const DOC = `${withHeading ? '## Renal function\n\n' : ''}腎功能隨年齡下降，本頁說明其臨床意義與判讀重點。

![GFR chart](https://img.test/fig.png){size=${figureSize}%}

圖一：腎絲球過濾率隨年齡下降（資料來源：NHANES 系列研究）。
`

const config = defaultPresentationConfig('Pipeline harness')

function Harness() {
  const markdown = DOC
  const blocks = useMemo(() => parsePresentationDocument(markdown), [markdown])
  const regions = useMemo(() => buildSemanticRegions(blocks), [blocks])
  const [measurements, setMeasurements] = useState<Map<string, number>>(new Map())
  const measureRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const next = new Map<string, number>()
      measureRef.current?.querySelectorAll<HTMLElement>('[data-measure-id], [data-measure-item-id]').forEach((element) => {
        const id = element.dataset.measureId ?? element.dataset.measureItemId
        if (id) next.set(id, element.getBoundingClientRect().height)
      })
      setMeasurements(next)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [blocks])

  const plan = useMemo(
    () => (measurements.size ? planScenes(regions, measurements, viewport.height, 'balanced') : null),
    [regions, measurements],
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
      <div className="measurement-root" ref={measureRef} aria-hidden="true" style={{ width: Math.max(320, viewport.width - 150) }}>
        {blocks.map((block) => (
          <div data-measure-id={block.id} key={block.id}><BlockView block={block} measurement /></div>
        ))}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
