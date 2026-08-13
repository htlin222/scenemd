import type { PresentationBlock } from './engine/types'

export type ExportFormat = 'pptx' | 'pdf' | 'slide-html' | 'docx' | 'markdown' | 'document-html'

export function exportFileName(title: string, extension: string): string {
  const base = title.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'scenemd-document'
  return `${base}.${extension}`
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function inlineText(block: PresentationBlock): string {
  const visit = (nodes = block.inlines): string => (nodes ?? []).map((node) => {
    if ('value' in node) return node.value
    if ('children' in node) return node.children.map((child) => 'value' in child ? child.value : '').join('')
    return ''
  }).join('')
  return visit()
}

export function pageStyles(): string {
  const styles: string[] = []
  for (const sheet of [...document.styleSheets]) {
    try {
      styles.push([...sheet.cssRules].map((rule) => rule.cssText).join('\n'))
    } catch {
      if (sheet.href) styles.push(`@import url(${JSON.stringify(sheet.href)});`)
    }
  }
  return styles.join('\n')
}

function htmlShell(title: string, body: string, extraStyle = '', script = ''): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<base href="${location.origin}/"><title>${escapeHtml(title)}</title><style>${pageStyles()}\n${extraStyle}</style></head>
<body>${body}${script ? `<script>${script}</script>` : ''}</body></html>`
}

export function documentHtml(title: string, articleHtml: string): string {
  return htmlShell(title, `<main class="export-document-page">${articleHtml}</main>`, `
body{margin:0;background:#fff}.export-document-page{max-width:920px;margin:0 auto}.export-document-page .markdown-document{width:auto;padding:64px 56px;}
@media print{.export-document-page .markdown-document{padding:0}a{color:inherit}}`)
}

export function slideHtml(title: string, sceneHtml: string[]): string {
  const slides = sceneHtml.map((scene, index) => `<section class="export-html-slide${index === 0 ? ' is-active' : ''}" data-index="${index}">${scene}</section>`).join('')
  const script = `(()=>{let i=0;const s=[...document.querySelectorAll('.export-html-slide')];const show=n=>{i=Math.max(0,Math.min(s.length-1,n));s.forEach((x,j)=>x.classList.toggle('is-active',j===i))};addEventListener('keydown',e=>{if(['ArrowRight','ArrowDown',' '].includes(e.key))show(i+1);if(['ArrowLeft','ArrowUp'].includes(e.key))show(i-1);if(e.key==='Home')show(0);if(e.key==='End')show(s.length-1)});})();`
  return htmlShell(title, `<main class="export-html-deck">${slides}</main>`, `
html,body,.export-html-deck,.export-html-slide{width:100%;height:100%;margin:0;overflow:hidden;background:#111}.export-html-slide{position:absolute;inset:0;display:none}.export-html-slide.is-active{display:block}.export-html-slide>.scene{position:absolute;inset:0}`, script)
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}
