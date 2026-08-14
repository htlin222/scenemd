import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download, FileCode2, FileText, FileType2, LoaderCircle, MonitorPlay, Presentation, X } from 'lucide-react'
import type { InlineNode, PresentationBlock, PresentationConfig, Scene } from '../engine/types'
import { parsePresentationDocument } from '../engine/semantics'
import { documentVisibleMarkdown, MarkdownDocumentView } from './editor/MarkdownDocumentView'
import { buildCitationReferenceMap, SceneView, sceneSpeakerNotes } from './SceneView'
import { documentHtml, downloadBlob, exportFileName, inlineText, slideHtml, type ExportFormat } from '../export'

interface ExportDialogProps {
  markdown: string
  title: string
  scenes: Scene[]
  presentationConfig: PresentationConfig
  navigationLabels: string[]
  activeLabels: Array<string | undefined>
  onClose: () => void
}

const FORMATS: Array<{ id: ExportFormat; label: string; detail: string; icon: typeof Presentation }> = [
  { id: 'pptx', label: 'PowerPoint', detail: 'Presentation scenes · .pptx', icon: Presentation },
  { id: 'pdf', label: 'PDF', detail: 'Presentation scenes · .pdf', icon: FileType2 },
  { id: 'slide-html', label: 'Slide HTML', detail: 'Keyboard-ready presentation · .html', icon: MonitorPlay },
  { id: 'docx', label: 'Word document', detail: 'Semantic document · .docx', icon: FileText },
  { id: 'markdown', label: 'Markdown', detail: 'Canonical source · .md', icon: FileCode2 },
  { id: 'document-html', label: 'Document HTML', detail: 'Readable document · .html', icon: FileType2 },
]

// Export at twice the previous raster dimensions: 3840×2160 per 16:9 scene.
const EXPORT_PIXEL_RATIO = 4

export function ExportDialog({ markdown, title, scenes, presentationConfig, navigationLabels, activeLabels, onClose }: ExportDialogProps) {
  const sceneRefs = useRef<Array<HTMLDivElement | null>>([])
  const documentRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const [done, setDone] = useState<ExportFormat | null>(null)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const documentMarkdown = useMemo(() => documentVisibleMarkdown(markdown), [markdown])
  const citationReferences = useMemo(() => buildCitationReferenceMap(scenes), [scenes])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  const captureScenes = async (): Promise<string[]> => {
    const { toPng } = await import('html-to-image')
    const images: string[] = []
    for (let index = 0; index < scenes.length; index += 1) {
      const node = sceneRefs.current[index]
      if (!node) throw new Error(`Scene ${index + 1} is not ready`)
      setProgress(`Rendering scene ${index + 1} of ${scenes.length}`)
      images.push(await toPng(node, { width: 960, height: 540, pixelRatio: EXPORT_PIXEL_RATIO, cacheBust: true, backgroundColor: '#ffffff' }))
    }
    return images
  }

  const exportPptx = async () => {
    const [{ default: PptxGenJS }, images] = await Promise.all([import('pptxgenjs'), captureScenes()])
    setProgress('Building PowerPoint')
    const pptx = new PptxGenJS()
    pptx.layout = 'LAYOUT_WIDE'
    pptx.author = presentationConfig.author || 'SceneMD'
    pptx.subject = 'Generated from a semantic SceneMD document'
    pptx.title = title
    pptx.company = presentationConfig.affiliation || 'SceneMD'
    images.forEach((data, index) => {
      const slide = pptx.addSlide()
      slide.background = { color: 'FFFFFF' }
      slide.addImage({ data, x: 0, y: 0, w: 13.333, h: 7.5 })
      const notes = sceneSpeakerNotes(scenes[index])
      slide.addNotes(notes.length ? notes.join('\n\n') : `Scene ${index + 1} of ${images.length} · generated from SceneMD`)
    })
    await pptx.writeFile({ fileName: exportFileName(title, 'pptx'), compression: true })
  }

  const exportPdf = async () => {
    const [{ jsPDF }, images] = await Promise.all([import('jspdf'), captureScenes()])
    setProgress('Building PDF')
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [960, 540], compress: true, hotfixes: ['px_scaling'] })
    images.forEach((data, index) => {
      if (index > 0) pdf.addPage([960, 540], 'landscape')
      pdf.addImage(data, 'PNG', 0, 0, 960, 540, undefined, 'FAST')
    })
    pdf.setProperties({ title, author: presentationConfig.author || 'SceneMD', creator: 'SceneMD' })
    pdf.save(exportFileName(title, 'pdf'))
  }

  const exportSlideHtml = () => {
    const sceneHtml = sceneRefs.current.map((node) => node?.innerHTML ?? '')
    if (sceneHtml.some((value) => !value)) throw new Error('Presentation scenes are not ready')
    downloadBlob(new Blob([slideHtml(title, sceneHtml)], { type: 'text/html;charset=utf-8' }), exportFileName(title, 'slides.html'))
  }

  const exportDocumentHtml = () => {
    const article = documentRef.current?.querySelector('.markdown-document')
    if (!article) throw new Error('Document preview is not ready')
    downloadBlob(new Blob([documentHtml(title, article.outerHTML)], { type: 'text/html;charset=utf-8' }), exportFileName(title, 'document.html'))
  }

  const exportMarkdown = () => {
    downloadBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), exportFileName(title, 'md'))
  }

  const exportDocx = async () => {
    setProgress('Building Word document')
    const docx = await import('docx')
    const blocks = parsePresentationDocument(documentMarkdown).filter((block) => block.visibility !== 'presentation-only')
    const children: Array<InstanceType<typeof docx.Paragraph> | InstanceType<typeof docx.Table>> = []
    for (const block of blocks) children.push(...docxBlocks(block, docx))
    const document = new docx.Document({
      creator: presentationConfig.author || 'SceneMD',
      title,
      description: 'Generated from the canonical SceneMD document',
      styles: {
        default: { document: { run: { font: 'Aptos', size: 24, color: '202020' }, paragraph: { spacing: { after: 150, line: 300 } } } },
        paragraphStyles: [
          { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 48, bold: true, color: '315F60' }, paragraph: { spacing: { before: 0, after: 260 } } },
          { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 38, bold: true, color: '315F60' }, paragraph: { spacing: { before: 320, after: 160 } } },
          { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 30, bold: true, color: '315F60' }, paragraph: { spacing: { before: 260, after: 130 } } },
          { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, color: '315F60' }, paragraph: { spacing: { before: 220, after: 110 } } },
        ],
      },
      sections: [{ properties: { page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } }, children }],
    })
    downloadBlob(await docx.Packer.toBlob(document), exportFileName(title, 'docx'))
  }

  const runExport = async (format: ExportFormat) => {
    if (busy) return
    setBusy(format)
    setDone(null)
    setError('')
    setProgress('Preparing export')
    try {
      if (format === 'pptx') await exportPptx()
      if (format === 'pdf') await exportPdf()
      if (format === 'slide-html') exportSlideHtml()
      if (format === 'docx') await exportDocx()
      if (format === 'markdown') exportMarkdown()
      if (format === 'document-html') exportDocumentHtml()
      setDone(format)
      setProgress('Download ready')
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Export failed')
      setProgress('')
    } finally {
      setBusy(null)
    }
  }

  return <div className="export-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <header><div><Download size={19} /><div><small>One source, multiple projections</small><h2 id="export-title">Export document</h2></div></div><button onClick={onClose} disabled={Boolean(busy)} aria-label="Close export"><X size={18} /></button></header>
      <div className="export-intro"><p>Choose an output. SceneMD preserves the document for reading formats and uses the current scene plan for presentation formats.</p><span>{scenes.length} scenes</span></div>
      <div className="export-grid">
        {FORMATS.map(({ id, label, detail, icon: Icon }) => <button key={id} onClick={() => void runExport(id)} disabled={Boolean(busy)} className={done === id ? 'is-done' : ''}>
          <span className="export-format-icon">{busy === id ? <LoaderCircle className="is-spinning" size={20} /> : done === id ? <Check size={20} /> : <Icon size={20} />}</span>
          <span><strong>{label}</strong><small>{detail}</small></span>
          <Download size={15} />
        </button>)}
      </div>
      <footer><span className={error ? 'is-error' : ''}>{error || progress || 'Layout is handled automatically from the current document and viewport plan.'}</span>{busy && <span className="export-progress"><i /></span>}</footer>
    </section>
    <div className="export-render-root" aria-hidden="true">
      {scenes.map((scene, index) => <div className="export-scene" key={scene.id} ref={(node) => { sceneRefs.current[index] = node }}><SceneView scene={scene} sceneNumber={index + 1} sceneCount={scenes.length} revealIndex={Number.POSITIVE_INFINITY} navigationLabels={navigationLabels} activeNavigationLabel={activeLabels[index]} presentationConfig={presentationConfig} citationReferences={citationReferences} /></div>)}
      <div ref={documentRef}><MarkdownDocumentView value={documentMarkdown} /></div>
    </div>
  </div>
}

type DocxModule = typeof import('docx')

function nodeText(nodes: InlineNode[] = []): string {
  return nodes.map((node) => 'value' in node ? node.value : 'children' in node ? nodeText(node.children) : '').join('')
}

function docxBlocks(block: PresentationBlock, docx: DocxModule): Array<InstanceType<typeof docx.Paragraph> | InstanceType<typeof docx.Table>> {
  const paragraph = (text: string, options: Record<string, unknown> = {}) => new docx.Paragraph({ ...options, children: [new docx.TextRun({ text })] })
  if (block.type === 'heading') {
    const heading = block.depth === 1 ? docx.HeadingLevel.HEADING_1 : block.depth === 2 ? docx.HeadingLevel.HEADING_2 : docx.HeadingLevel.HEADING_3
    return [paragraph(inlineText(block), { heading, keepNext: true })]
  }
  if (block.type === 'paragraph') return [paragraph(inlineText(block))]
  if (block.type === 'list') return (block.listItems ?? []).map((item, index) => block.ordered
    ? paragraph(`${(block.listStart ?? 1) + index}. ${nodeText(item)}`, { indent: { left: 360, hanging: 240 } })
    : paragraph(nodeText(item), { bullet: { level: 0 } }))
  if (block.type === 'blockquote') return [paragraph(inlineText(block), { indent: { left: 420 }, border: { left: { color: '3D6869', size: 16, style: docx.BorderStyle.SINGLE, space: 10 } } })]
  if (block.type === 'code') return [new docx.Paragraph({ shading: { fill: 'F2F4F3' }, spacing: { before: 100, after: 180 }, children: [new docx.TextRun({ text: block.value ?? '', font: 'Aptos Mono', size: 19 })] })]
  if (block.type === 'code-group') return (block.codeGroup ?? []).flatMap((child) => docxBlocks(child, docx))
  if (block.type === 'math') return [paragraph(block.value ?? '')]
  if (block.type === 'figure') return [new docx.Paragraph({ children: [new docx.TextRun({ text: `${block.alt || 'Figure'} — `, bold: true }), new docx.ExternalHyperlink({ link: block.url ?? '', children: [new docx.TextRun({ text: block.url ?? '', style: 'Hyperlink' })] })] })]
  if (block.type === 'table') return [new docx.Table({
    width: { size: 100, type: docx.WidthType.PERCENTAGE },
    borders: { top: { style: docx.BorderStyle.NONE }, left: { style: docx.BorderStyle.NONE }, right: { style: docx.BorderStyle.NONE }, bottom: { style: docx.BorderStyle.NONE }, insideVertical: { style: docx.BorderStyle.NONE }, insideHorizontal: { style: docx.BorderStyle.SINGLE, color: 'D8DEDC', size: 4 } },
    rows: (block.tableRows ?? []).map((row, rowIndex) => new docx.TableRow({ tableHeader: rowIndex === 0, children: row.map((cell) => new docx.TableCell({ margins: { top: 90, bottom: 90, left: 90, right: 90 }, shading: rowIndex === 0 ? { fill: 'EEF3F2' } : undefined, children: [new docx.Paragraph({ children: [new docx.TextRun({ text: cell.replace(/[*_~`]/g, ''), bold: rowIndex === 0 })] })] })) })),
  })]
  if (block.type === 'columns') return (block.columns ?? []).flatMap((column) => column.flatMap((child) => docxBlocks(child, docx)))
  return []
}
