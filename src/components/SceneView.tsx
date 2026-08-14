import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import katex from 'katex'
import type { InlineNode, PresentationBlock, PresentationConfig, Scene } from '../engine/types'
import { imageFilterCss } from '../imageSyntax'

interface BlockViewProps {
  block: PresentationBlock
  revealIndex?: number
  measurement?: boolean
}

function InlineContent({ nodes = [] }: { nodes?: InlineNode[] }) {
  const renderNode = (node: InlineNode, key: number): ReactNode => {
    switch (node.type) {
      case 'text':
        return <Fragment key={key}>{node.value}</Fragment>
      case 'code':
        return <code key={key}>{node.value}</code>
      case 'math':
        return (
          <span
            key={key}
            className="inline-math"
            dangerouslySetInnerHTML={{ __html: katex.renderToString(node.value, { throwOnError: false }) }}
          />
        )
      case 'strong':
        return <strong key={key}><InlineContent nodes={node.children} /></strong>
      case 'emphasis':
        return <em key={key}><InlineContent nodes={node.children} /></em>
      case 'delete':
        return <del key={key}><InlineContent nodes={node.children} /></del>
      case 'link':
        if (node.url.startsWith('#citation-')) return <sup key={key} className="citation-marker citation-key"><span title="Pandoc citation key"><InlineContent nodes={node.children} /></span></sup>
        return node.url.startsWith('#reference-')
          ? <sup key={key} className="citation-marker"><a href={node.url}><InlineContent nodes={node.children} /></a></sup>
          : <a key={key} href={node.url} target="_blank" rel="noreferrer"><InlineContent nodes={node.children} /></a>
      case 'break':
        return <br key={key} />
    }
  }
  return <>{nodes.map(renderNode)}</>
}

export type CitationReferenceMap = ReadonlyMap<number, InlineNode[]>

export function buildCitationReferenceMap(scenes: Scene[]): Map<number, InlineNode[]> {
  const references = new Map<number, InlineNode[]>()
  scenes.forEach((scene) => scene.blocks.forEach((block) => {
    if (block.type !== 'list' || block.semanticRole !== 'reference') return
    block.listItems?.forEach((item, index) => references.set((block.listStart ?? 1) + index, item))
  }))
  return references
}

export function sceneSpeakerNotes(scene: Scene | undefined): string[] {
  if (!scene) return []
  const notes: string[] = []
  const visit = (block: PresentationBlock) => {
    block.speakerNotes?.forEach((note) => notes.push(note))
    block.columns?.forEach((column) => column.forEach(visit))
  }
  scene.blocks.forEach(visit)
  return [...new Set(notes)]
}

function collectCitationNumbers(nodes: InlineNode[] | undefined, target: Set<number>) {
  nodes?.forEach((node) => {
    if (node.type === 'link') {
      const match = node.url.match(/^#reference-(\d+)$/)
      if (match) target.add(Number(match[1]))
      collectCitationNumbers(node.children, target)
    } else if ('children' in node) collectCitationNumbers(node.children, target)
  })
}

function sceneCitationNumbers(scene: Scene): number[] {
  const numbers = new Set<number>()
  scene.blocks.forEach((block) => {
    collectCitationNumbers(block.inlines, numbers)
    collectCitationNumbers(block.caption, numbers)
    block.listItems?.forEach((item) => collectCitationNumbers(item, numbers))
  })
  return [...numbers].sort((left, right) => left - right)
}

// Publishes the frame area's laid-out height as a pixel CSS variable so sized
// figure frames get a definite height (see the sized frameStyle in BlockView),
// and reports the widest image's rendered width — 文字配合圖片寬: captions set
// their width from it so text always wraps at the image's displayed width.
function FigureFrameArea({ children, onImageWidth }: { children: ReactNode; onImageWidth?: (width: number | null) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [areaHeight, setAreaHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => {
      setAreaHeight(element.clientHeight)
      const images = [...element.querySelectorAll<HTMLElement>('.figure-frame img')]
      const width = images.length ? Math.max(...images.map((image) => image.getBoundingClientRect().width)) : 0
      onImageWidth?.(width > 1 ? Math.round(width) : null)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    element.querySelectorAll('.figure-frame img').forEach((image) => {
      observer.observe(image)
      image.addEventListener('load', measure)
    })
    measure()
    return () => {
      observer.disconnect()
      element.querySelectorAll('.figure-frame img').forEach((image) => image.removeEventListener('load', measure))
    }
  }, [onImageWidth])
  return (
    <div className="figure-frame-area" ref={ref} style={areaHeight ? { '--frame-area-height': `${areaHeight}px` } as CSSProperties : undefined}>
      {children}
    </div>
  )
}

function TableCellContent({ value }: { value: string }) {
  const parts = value.split(/(\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`)/g).filter(Boolean)
  return <>{parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('~~') && part.endsWith('~~')) return <del key={index}>{part.slice(2, -2)}</del>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
    return <Fragment key={index}>{part}</Fragment>
  })}</>
}

function CodeBlock({ block, revealIndex, measurement }: { block: PresentationBlock; revealIndex: number; measurement: boolean }) {
  const lines = (block.value ?? '').split('\n')
  const steps = block.codeHighlightSteps ?? []
  const active = steps.length ? steps[Math.min(steps.length - 1, Math.max(0, Math.floor(revealIndex)))] : 'all'
  const hidden = !measurement && active === 'hide'
  const isHighlighted = (line: number) => measurement || active === 'all' || (Array.isArray(active) && active.includes(line))
  const hasHighlight = active !== 'all' && active !== 'none' && active !== 'hide' && Array.isArray(active) && active.length > 0
  const start = block.codeStartLine ?? 1
  return <div className={`code-lines${block.codeLineNumbers ? ' has-line-numbers' : ''}${hidden ? ' is-code-hidden' : ''}`}>
    {lines.map((line, index) => <div className={`code-line${hasHighlight && !isHighlighted(index + 1) ? ' is-dimmed' : ''}${isHighlighted(index + 1) && hasHighlight ? ' is-highlighted' : ''}`} key={index}>
      {block.codeLineNumbers && <span className="code-line-number" aria-hidden="true">{start + index}</span>}
      <span className="code-line-content">{line || ' '}</span>
    </div>)}
  </div>
}

function MermaidDiagram({ value }: { value: string }) {
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    void import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'neutral' })
      try {
        const result = await mermaid.render(`scenemd-${reactId}`, value)
        if (!cancelled) setSvg(result.svg)
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not render diagram')
      }
    })
    return () => { cancelled = true }
  }, [reactId, value])
  if (error) return <div className="mermaid-error" role="alert">Mermaid: {error}</div>
  return <div className="mermaid-diagram" aria-label="Mermaid diagram" dangerouslySetInnerHTML={{ __html: svg }} />
}

function CodeGroup({ block, revealIndex, measurement }: { block: PresentationBlock; revealIndex: number; measurement: boolean }) {
  const children = block.codeGroup ?? []
  const [active, setActive] = useState(0)
  const selected = children[Math.min(active, Math.max(0, children.length - 1))]
  if (!selected) return null
  return <div className="code-group-shell">
    <div className="code-group-tabs" role="tablist" aria-label="Code examples">
      {children.map((child, index) => <button key={child.id} role="tab" aria-selected={index === active} onClick={() => setActive(index)}>{child.codeTitle || child.language || `Example ${index + 1}`}</button>)}
    </div>
    <CodeBlock block={selected} revealIndex={revealIndex} measurement={measurement} />
  </div>
}

export function BlockView({ block, revealIndex = Number.POSITIVE_INFINITY, measurement = false }: BlockViewProps) {
  const common = {
    className: `content-block block-${block.type}${block.continuation ? ' is-continuation' : ''}`,
    'data-block-id': block.id,
    'data-semantic-role': block.semanticRole,
  }

  if (block.type === 'heading') {
    const Tag = (`h${Math.min(block.depth ?? 2, 3)}`) as 'h1' | 'h2' | 'h3'
    return <Tag {...common}><InlineContent nodes={block.inlines} /></Tag>
  }
  if (block.type === 'paragraph') return <p {...common}><InlineContent nodes={block.inlines} /></p>
  if (block.type === 'list') {
    const Tag = block.ordered ? 'ol' : 'ul'
    const visibleCount = measurement || !block.stepped ? block.listItems?.length ?? 0 : revealIndex
    return (
      <Tag {...common} {...(Tag === 'ol' ? { start: block.listStart ?? 1 } : {})}>
        {block.listItems?.map((item, index) => (
          <li key={index} data-measure-item-id={`${block.id}:item:${index}`} id={block.semanticRole === 'reference' ? `reference-${(block.listStart ?? 1) + index}` : undefined} className={index < visibleCount ? 'is-revealed' : 'is-hidden-step'}>
            <span className="list-marker">{block.ordered ? `${(block.listStart ?? 1) + index}.` : '•'}</span>
            <span><InlineContent nodes={item} /></span>
          </li>
        ))}
      </Tag>
    )
  }
  if (block.type === 'figure') {
    const imageStyle: CSSProperties = {
      width: block.imageOptions?.width || undefined,
      filter: imageFilterCss(block.imageOptions?.filters ?? ''),
      objectFit: block.imageOptions?.fit === 'auto' ? 'scale-down' : 'contain',
    }
    // `size=NN%` resolves against the frame area (the space left after the
    // heading and the legend). The area publishes its measured height as a
    // pixel variable, so the frame height is a definite length — which lets
    // the image's auto width resolve and the fit-content column truly follow
    // the figure instead of leaving dead padding when it shrinks.
    const sized = block.imageOptions?.size?.match(/^(\d+(?:\.\d+)?)%$/)
    const frameStyle = sized
      ? { '--figure-height': `calc(var(--frame-area-height, 320px) * ${Number(sized[1]) / 100})` } as CSSProperties
      : block.imageOptions?.height
        ? { '--figure-height': block.imageOptions.height } as CSSProperties
        : undefined
    return (
      <figure {...common} data-layout-hint={block.layoutHint} data-background={block.imageOptions?.background || undefined}>
        <div className="figure-frame" style={frameStyle}>
          <img src={block.url} alt={block.alt ?? ''} style={imageStyle} />
          <span className="figure-index" aria-hidden="true">{block.figureNumber ? `FIG. ${block.figureNumber}` : 'FIG.'}</span>
        </div>
        {(block.caption?.length || block.alt) && (
          <figcaption>{block.figureNumber !== undefined && <strong className="figure-caption-number">Fig. {block.figureNumber}</strong>}<InlineContent nodes={block.caption?.length ? block.caption : [{ type: 'text', value: block.alt ?? '' }]} /></figcaption>
        )}
      </figure>
    )
  }
  if (block.type === 'blockquote') return <blockquote {...common}><span className="quote-mark">“</span><InlineContent nodes={block.inlines} /></blockquote>
  if (block.type === 'code') {
    if (block.language?.toLowerCase() === 'mermaid') return <div {...common}><MermaidDiagram value={block.value ?? ''} /></div>
    return (
      <div {...common}>
        <div className="code-header"><span>{block.codeTitle || block.language || 'text'}</span><span>{block.codeLineNumbers ? 'numbered' : 'source'}</span></div>
        <pre><CodeBlock block={block} revealIndex={revealIndex} measurement={measurement} /></pre>
      </div>
    )
  }
  if (block.type === 'code-group') return <div {...common}><CodeGroup block={block} revealIndex={revealIndex} measurement={measurement} /></div>
  if (block.type === 'math') {
    return <div {...common} dangerouslySetInnerHTML={{ __html: katex.renderToString(block.value ?? '', { displayMode: true, throwOnError: false }) }} />
  }
  if (block.type === 'table') {
    return (
      <div {...common}>
        <table>
          <tbody>
            {block.tableRows?.map((row, rowIndex) => (
              <tr key={rowIndex}>{row.map((cell, cellIndex) => {
                const Cell = rowIndex === 0 ? 'th' : 'td'
                return <Cell key={cellIndex} data-label={rowIndex > 0 ? block.tableRows?.[0]?.[cellIndex] : undefined}><TableCellContent value={cell} /></Cell>
              })}</tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  if (block.type === 'columns') {
    return <div {...common} style={{ '--column-count': Math.max(1, block.columns?.length ?? 2) } as CSSProperties}>
      {block.columns?.map((column, columnIndex) => <section className="semantic-column" key={columnIndex}>
        {column.map((child) => <BlockView key={child.id} block={child} revealIndex={revealIndex} measurement={measurement} />)}
      </section>)}
    </div>
  }
  return null
}

function DebugCard({ scene }: { scene: Scene }) {
  const rows = [
    ['Fill', `${Math.round(scene.fillRatio * 100)}%`],
    ['Semantics', signed(scene.scores.semanticCoherence)],
    ['Density', signed(scene.scores.density)],
    ['Breakpoint', signed(scene.scores.breakpoint)],
    ['Stability', signed(scene.scores.stability)],
    ['Orphan', signed(scene.scores.orphanPenalty)],
  ]
  return (
    <aside className="debug-card" aria-label="Planner score breakdown">
      <div className="debug-title"><span>Planner trace</span><strong>{scene.score}</strong></div>
      {rows.map(([label, value]) => <div className="debug-row" key={label}><span>{label}</span><span>{value}</span></div>)}
      <div className="debug-source">L{scene.sourceRange.startLine}–{scene.sourceRange.endLine} · {scene.layout}</div>
    </aside>
  )
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
}

interface SceneViewProps {
  scene: Scene
  sceneNumber: number
  sceneCount: number
  debug?: boolean
  revealIndex?: number
  measurement?: boolean
  navigationLabels?: string[]
  activeNavigationLabel?: string
  onNavigateLabel?: (label: string) => void
  presentationConfig: PresentationConfig
  citationReferences?: CitationReferenceMap
}

export function SceneView({ scene, sceneNumber, sceneCount, debug = false, revealIndex, measurement = false, navigationLabels = [], activeNavigationLabel, onNavigateLabel, presentationConfig, citationReferences }: SceneViewProps) {
  const heading = scene.blocks.find((block) => block.type === 'heading')
  const content = scene.blocks.filter((block) => block !== heading)
  const visibleFigures = content.filter((block) => block.type === 'figure')
  const prose = content.filter((block) => block.type !== 'figure')
  const firstFigureIndex = scene.blocks.findIndex((block) => block.type === 'figure')
  const aboveProse = prose.filter((block) => scene.blocks.indexOf(block) < firstFigureIndex)
  const belowProse = prose.filter((block) => scene.blocks.indexOf(block) > firstFigureIndex)
  const [figureImageWidth, setFigureImageWidth] = useState<number | null>(null)
  useEffect(() => setFigureImageWidth(null), [scene.id])
  const sceneReferences = sceneCitationNumbers(scene)
    .map((number) => ({ number, content: citationReferences?.get(number) }))
    .filter((entry): entry is { number: number; content: InlineNode[] } => Boolean(entry.content))

  const renderBlocks = (blocks: PresentationBlock[]) => blocks.map((block) => (
    <BlockView key={block.id} block={block} revealIndex={revealIndex} measurement={measurement} />
  ))

  if (scene.role === 'cover') {
    return (
      <article className="scene scene-title scene-cover" data-layout="title" data-scene-id={scene.id} data-presentation-theme={presentationConfig.theme}>
        <div className="presentation-cover-top">
          {presentationConfig.seriesName && <span className="series-name-badge"><span>{presentationConfig.seriesName}</span></span>}
          {presentationConfig.date && <time>{presentationConfig.date}</time>}
        </div>
        <div className="presentation-cover-center">
          <h1>{presentationConfig.title}</h1>
          {presentationConfig.subtitle && <p>{presentationConfig.subtitle}</p>}
          <div className="presentation-cover-separator" />
          {(presentationConfig.author || presentationConfig.affiliation || presentationConfig.email) && <div className="presentation-cover-author">
            {presentationConfig.author && <strong>{presentationConfig.author}</strong>}
            {presentationConfig.affiliation && <span>{presentationConfig.affiliation}</span>}
            {presentationConfig.email && <a href={`mailto:${presentationConfig.email}`}>{presentationConfig.email}</a>}
          </div>}
        </div>
        {presentationConfig.license && <small className="presentation-cover-license">{presentationConfig.license}</small>}
        {debug && <DebugCard scene={scene} />}
      </article>
    )
  }

  if (scene.role === 'chapter') {
    const activeIndex = Math.max(0, navigationLabels.indexOf(activeNavigationLabel ?? ''))
    return (
      <article className="scene scene-chapter" data-layout="chapter" data-scene-id={scene.id} data-presentation-theme={presentationConfig.theme}>
        <div className="scene-chapter-label">Section: {activeIndex + 1}</div>
        <ol className="scene-chapter-list">
          {navigationLabels.map((label, index) => <li key={label} className={label === activeNavigationLabel ? 'is-active' : ''}>
            <button onClick={() => onNavigateLabel?.(label)}><span>{index + 1}.</span><strong>{label}</strong></button>
          </li>)}
        </ol>
        <div className="scene-chrome scene-chrome-bottom"><span /><span>{sceneNumber} / {sceneCount}</span></div>
        {debug && <DebugCard scene={scene} />}
        <div className="scene-progress" aria-hidden="true"><span style={{ width: `${(sceneNumber / sceneCount) * 100}%` }} /></div>
      </article>
    )
  }

  return (
    <article className={`scene scene-${scene.layout}${sceneReferences.length ? ' has-citations' : ''}`} data-layout={scene.layout} data-scene-id={scene.id} data-presentation-theme={presentationConfig.theme}>
      {navigationLabels.length > 0 && (
        <nav className="scene-section-nav" aria-label="Document sections">
          {navigationLabels.slice(0, 7).map((label) => (
            <button key={label} className={label === activeNavigationLabel ? 'is-active' : ''} onClick={() => onNavigateLabel?.(label)}>{label}</button>
          ))}
        </nav>
      )}
      {scene.breadcrumb && <div className="scene-breadcrumb">{scene.breadcrumb}</div>}
      <div className="scene-content">
        {scene.continuationLabel && <div className="continuation-label">{scene.continuationLabel}</div>}
        {heading && <div className="scene-heading">{renderBlocks([heading])}</div>}

        {scene.layout === 'figure-bg' ? (
          // design v5.1: the bg figure bleeds to the right and bottom edges at
          // full remaining height; every piece of text — body copy, legend
          // paragraphs, and the figures' own captions — lives in the left column.
          <div className="figure-bg-grid">
            <div className="figure-bg-text" style={scene.figureTextScale ? { '--figure-text-scale': scene.figureTextScale } as CSSProperties : undefined}>
              {renderBlocks(prose)}
              {visibleFigures.filter((block) => block.caption?.length || block.alt).map((block) => (
                <p className="figure-bg-caption" key={`${block.id}-caption`}>
                  {block.figureNumber !== undefined && <strong className="figure-caption-number">Fig. {block.figureNumber}</strong>}
                  <InlineContent nodes={block.caption?.length ? block.caption : [{ type: 'text', value: block.alt ?? '' }]} />
                </p>
              ))}
            </div>
            <div className="figure-bg-panel">{renderBlocks(visibleFigures)}</div>
          </div>
        ) : scene.layout === 'figure' ? (
          // Position decides the text's role: paragraphs above the figure are
          // body copy in the right column, paragraphs below it are the legend
          // under the image (design v5).
          <div className={`figure-grid${aboveProse.length ? '' : ' is-figure-only'}`}>
            <div className="figure-col" style={figureImageWidth ? { '--figure-width': `${figureImageWidth}px` } as CSSProperties : undefined}>
              <FigureFrameArea onImageWidth={setFigureImageWidth}>{renderBlocks(visibleFigures)}</FigureFrameArea>
              {!!belowProse.length && <div className="figure-below-caption">{renderBlocks(belowProse)}</div>}
            </div>
            {!!aboveProse.length && <div className="figure-text-col" style={scene.figureTextScale ? { '--figure-text-scale': scene.figureTextScale } as CSSProperties : undefined}>{renderBlocks(aboveProse)}</div>}
          </div>
        ) : (
          <div className="prose-flow">{renderBlocks(content)}</div>
        )}
      </div>

      {sceneReferences.length > 0 && <aside className="scene-citations" aria-label="References cited on this scene">
        {sceneReferences.map(({ number, content: reference }) => <div key={number}><sup>{number}</sup><span><InlineContent nodes={reference} /></span></div>)}
      </aside>}

      <div className="scene-chrome scene-chrome-bottom">
        <span>DOCUMENT → MEANING → SCENE</span>
        <span>{sceneNumber} / {sceneCount}</span>
      </div>
      {scene.warning && <div className="scene-warning">{scene.warning}</div>}
      {debug && <DebugCard scene={scene} />}
      <div className="scene-progress" aria-hidden="true"><span style={{ width: `${(sceneNumber / sceneCount) * 100}%` }} /></div>
    </article>
  )
}
