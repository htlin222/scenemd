import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/source-sans-3/latin-400.css'
import '@fontsource/source-sans-3/latin-600.css'
import '@fontsource/source-sans-3/latin-700.css'
import 'katex/dist/katex.min.css'
import '../../src/styles.css'
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

function Harness() {
  const [value, setValue] = useState(INITIAL_MARKDOWN)
  const [mode, setMode] = useState<EditorMode>('write')
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <button
        data-testid="external-append"
        onClick={() => setValue((current) => `${current}\n\nAppended by external sync.`)}
      >
        External update
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
