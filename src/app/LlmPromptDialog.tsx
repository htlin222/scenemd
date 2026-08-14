import { useEffect, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { SCENEMD_LLM_PROMPT } from './constants'

export function LlmPromptDialog({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(SCENEMD_LLM_PROMPT)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return <div className="cheatsheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <aside className="llm-prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="llm-prompt-title">
      <div className="cheatsheet-heading"><div><span>Reusable prompt</span><h2 id="llm-prompt-title">Prepare content for SceneMD</h2></div><button className="icon-button" onClick={onClose} aria-label="Close LLM prompt"><X size={18} /></button></div>
      <div className="llm-prompt-content">
        <p>Copy this into any LLM, then replace the final placeholder with your source content.</p>
        <textarea value={SCENEMD_LLM_PROMPT} readOnly aria-label="SceneMD conversion prompt" spellCheck={false} />
        <button className="llm-prompt-copy" onClick={() => void copyPrompt()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copied' : 'Copy prompt'}</button>
      </div>
    </aside>
  </div>
}
