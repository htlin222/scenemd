import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/source-sans-3/latin-400.css'
import '@fontsource/source-sans-3/latin-600.css'
import '@fontsource/source-sans-3/latin-700.css'
import 'katex/dist/katex.min.css'
import '../../src/styles.css'
// The figure dialog renders a real <SceneView> preview, so the harness needs
// the scene theme too. Without it the preview is unstyled — .scene-content
// falls back to display:block and the image overflows the 16:9 stage, which
// makes every geometry assertion against the dialog meaningless.
import '../../src/scene-theme.css'
import { MarkdownEditor, type EditorMode } from '../../src/components/MarkdownEditor'

// The e2e specs assert on these exact line numbers; keep them in sync with
// tests/e2e/markdown-editor.spec.ts when editing.
const INITIAL_MARKDOWN = [
  '# Editor harness', // 1
  '', // 2
  'Intro paragraph before any figure.', // 3
  '', // 4
  '![First figure](https://img.test/one.png)', // 5
  '', // 6
  'Legend one explains the first figure.', // 7
  '', // 8
  '![Second figure](https://img.test/two.png)', // 9
  '', // 10
  'Legend two explains the second figure.', // 11
  '', // 12
  'Closing paragraph at the bottom.', // 13
  '', // 14
  '![Hybrid chart](https://img.test/three.png){width=40%} Hybrid legend text.', // 15
].join('\n')

// A second, deliberately tall document. Scroll behaviour needs a document
// taller than the editor viewport, and lengthening INITIAL_MARKDOWN would
// move the line numbers the specs above assert on.
const TALL_MARKDOWN = [
  '# Tall harness',
  '',
  'Intro paragraph before any figure.',
  ...Array.from({ length: 90 }, (_, index) => `Filler line ${index + 1}.`),
].join('\n')

function Harness() {
  const [value, setValue] = useState(INITIAL_MARKDOWN)
  const [mode, setMode] = useState<EditorMode>('write')
  // Stands in for App's editorScrollRequest, which clicking a scene arms.
  const [scrollRequest, setScrollRequest] = useState<{ line: number; key: number } | null>(null)
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <button
        data-testid="external-append"
        onClick={() => setValue((current) => `${current}\n\nAppended by external sync.`)}
      >
        External update
      </button>
      <button data-testid="load-tall" onClick={() => setValue(TALL_MARKDOWN)}>
        Load tall document
      </button>
      <button
        data-testid="scroll-request"
        onClick={() => setScrollRequest((current) => ({ line: 3, key: (current?.key ?? 0) + 1 }))}
      >
        Scroll to line 3
      </button>
      <div style={{ flex: 1, minHeight: 0 }}>
        <MarkdownEditor
          value={value}
          onChange={setValue}
          theme="light"
          mode={mode}
          onModeChange={setMode}
          onReset={() => setValue(INITIAL_MARKDOWN)}
          documentId="harness"
          saveStatus="saved"
          scrollRequest={scrollRequest}
        />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
