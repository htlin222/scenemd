import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { CSSProperties } from 'react'
import { remarkBracketCitations } from '../../citations'
import { imageFilterCss, parseMarpitImageAlt } from '../../imageSyntax'
import { remarkFoldImageAttributes } from '../../lib/imageAttributesMdast'

export function documentVisibleMarkdown(value: string): string {
  const lines = value.split('\n')
  const visible: string[] = []
  let hiddenMode: 'await' | 'list' | 'paragraph' | 'fence' | null = null

  for (const line of lines) {
    if (/^\s*<!--\s*present:\s*(?:step|only)\s*-->\s*$/i.test(line)) {
      hiddenMode = 'await'
      continue
    }
    if (hiddenMode === 'await') {
      if (!line.trim()) continue
      if (/^\s*(?:[-+*]|\d+[.)])\s+/.test(line)) {
        hiddenMode = 'list'
        continue
      }
      if (/^\s*```/.test(line)) {
        hiddenMode = 'fence'
        continue
      }
      if (/^\s*(?:#{1,6}\s|!\[|>|\$\$|---\s*$)/.test(line)) {
        hiddenMode = null
        continue
      }
      hiddenMode = 'paragraph'
      continue
    }
    if (hiddenMode === 'list') {
      if (/^\s*(?:[-+*]|\d+[.)])\s+/.test(line) || /^\s{2,}\S/.test(line) || !line.trim()) continue
      hiddenMode = null
    } else if (hiddenMode === 'paragraph') {
      if (!line.trim()) hiddenMode = null
      continue
    } else if (hiddenMode === 'fence') {
      if (/^\s*```/.test(line)) hiddenMode = null
      continue
    }
    visible.push(line)
  }
  return visible.join('\n')
}

export function MarkdownDocumentView({ value, className = '' }: { value: string; className?: string }) {
  return (
    <article className={`markdown-document ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkBracketCitations, remarkFoldImageAttributes]}
        rehypePlugins={[rehypeKatex]}
        skipHtml
        components={{
          a({ href, children }) {
            if (href?.startsWith('#citation-')) return <sup className="citation-marker citation-key"><span title="Pandoc citation key">{children}</span></sup>
            return href?.startsWith('#reference-')
              ? <sup className="citation-marker"><a href={href}>{children}</a></sup>
              : <a href={href}>{children}</a>
          },
          img({ alt = '', src = '' }) {
            const options = parseMarpitImageAlt(alt)
            const style: CSSProperties = {
              width: options.width || undefined,
              height: options.height || undefined,
              objectFit: 'contain',
              filter: imageFilterCss(options.filters),
            }
            return <img src={src} alt={options.alt} style={style} />
          },
        }}
      >{documentVisibleMarkdown(value)}</ReactMarkdown>
    </article>
  )
}
