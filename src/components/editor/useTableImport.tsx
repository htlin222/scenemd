import { useMemo, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Sheet, X } from 'lucide-react'
import type { EditorView } from 'codemirror'
import { detectPastedTable, markdownTableFromRows } from './markdownTable'

/**
 * Smart table paste: Word/Excel HTML, CSV, or TSV in — GFM table out.
 * Extracted from MarkdownEditor (#13).
 */

export interface TableImportState {
  source: string
  html: string
  from: number
  to: number
}

export function useTableImport(viewRef: RefObject<EditorView | null>) {
  const [tableImport, setTableImport] = useState<TableImportState | null>(null)
  const detectedTable = useMemo(() => detectPastedTable(tableImport?.source ?? '', tableImport?.html ?? ''), [tableImport?.source, tableImport?.html])

  const openTableImport = () => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    setTableImport({ source: view.state.sliceDoc(from, to), html: '', from, to })
  }

  const insertImportedTable = () => {
    const view = viewRef.current
    if (!view || !tableImport) return
    const markdownTable = markdownTableFromRows(detectedTable.rows)
    if (!markdownTable) return
    const prefix = tableImport.from > 0 && view.state.sliceDoc(tableImport.from - 1, tableImport.from) !== '\n' ? '\n\n' : ''
    const suffix = tableImport.to < view.state.doc.length && view.state.sliceDoc(tableImport.to, tableImport.to + 1) !== '\n' ? '\n\n' : '\n'
    const insert = `${prefix}${markdownTable}${suffix}`
    view.dispatch({ changes: { from: tableImport.from, to: tableImport.to, insert }, selection: { anchor: tableImport.from + insert.length } })
    setTableImport(null)
    view.focus()
  }

  return { tableImport, setTableImport, detectedTable, openTableImport, insertImportedTable }
}

export function TableImportDialog({ state, detected, onChange, onClose, onInsert }: {
  state: TableImportState
  detected: ReturnType<typeof detectPastedTable>
  onChange: (updater: (current: TableImportState | null) => TableImportState | null) => void
  onClose: () => void
  onInsert: () => void
}) {
  return createPortal(<div className="table-import-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <dialog open className="table-import-dialog" aria-modal="true" aria-labelledby="table-import-title">
      <header><div><Sheet size={18} /><div><small>Smart paste</small><h2 id="table-import-title">Import table</h2></div></div><button onClick={onClose} aria-label="Close table import"><X size={18} /></button></header>
      <div className="table-import-body">
        <label><span>Paste from Word, Excel, CSV, or TSV</span><textarea ref={(node) => node?.focus()} value={state.source} onChange={(event) => onChange((current) => current ? { ...current, source: event.target.value, html: '' } : current)} onPaste={(event) => {
          const html = event.clipboardData.getData('text/html')
          const plain = event.clipboardData.getData('text/plain')
          if (!html && !plain) return
          event.preventDefault()
          onChange((current) => current ? { ...current, source: plain, html } : current)
        }} placeholder={'Name,Value\nAlpha,42\nBeta,18'} /></label>
        <div className="table-import-detection"><span className={detected.format ? 'is-detected' : ''}>{detected.format ? `${detected.format} detected` : 'Waiting for tabular data'}</span>{detected.rows.length > 0 && <small>{detected.rows.length} rows · {Math.max(...detected.rows.map((row) => row.length))} columns</small>}</div>
        <div className="table-import-preview">{detected.rows.length ? <table><tbody>{detected.rows.slice(0, 8).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => rowIndex === 0 ? <th key={cellIndex}>{cell}</th> : <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table> : <div><Sheet size={22} /><span>Your table preview appears here.</span></div>}</div>
      </div>
      <footer><span>Format is detected automatically.</span><div><button onClick={onClose}>Cancel</button><button className="table-import-primary" onClick={onInsert} disabled={!markdownTableFromRows(detected.rows)}>Insert Markdown table</button></div></footer>
    </dialog>
  </div>, document.body)
}
