import { Fragment, type CSSProperties, type ReactNode } from 'react'
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
        return <a key={key} href={node.url} target="_blank" rel="noreferrer"><InlineContent nodes={node.children} /></a>
      case 'break':
        return <br key={key} />
    }
  }
  return <>{nodes.map(renderNode)}</>
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

export function BlockView({ block, revealIndex = Number.POSITIVE_INFINITY, measurement = false }: BlockViewProps) {
  const common = {
    className: `content-block block-${block.type}${block.continuation ? ' is-continuation' : ''}`,
    'data-block-id': block.id,
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
      <Tag {...common}>
        {block.listItems?.map((item, index) => (
          <li key={index} className={index < visibleCount ? 'is-revealed' : 'is-hidden-step'}>
            <span className="list-marker">{block.ordered ? `${index + 1}.` : '•'}</span>
            <span><InlineContent nodes={item} /></span>
          </li>
        ))}
      </Tag>
    )
  }
  if (block.type === 'figure') {
    const imageStyle: CSSProperties = {
      width: block.imageOptions?.width || undefined,
      height: block.imageOptions?.height || undefined,
      filter: imageFilterCss(block.imageOptions?.filters ?? ''),
      objectFit: block.imageOptions?.fit === 'auto' ? 'none' : block.imageOptions?.fit,
    }
    return (
      <figure {...common} data-layout-hint={block.layoutHint} data-background={block.imageOptions?.background || undefined}>
        <div className="figure-frame">
          <img src={block.url} alt={block.alt ?? ''} style={imageStyle} />
          <span className="figure-index" aria-hidden="true">FIG.</span>
        </div>
        {(block.caption?.length || block.alt) && (
          <figcaption><InlineContent nodes={block.caption?.length ? block.caption : [{ type: 'text', value: block.alt ?? '' }]} /></figcaption>
        )}
      </figure>
    )
  }
  if (block.type === 'blockquote') return <blockquote {...common}><span className="quote-mark">“</span><InlineContent nodes={block.inlines} /></blockquote>
  if (block.type === 'code') {
    return (
      <div {...common}>
        <div className="code-header"><span>{block.language ?? 'text'}</span><span>source</span></div>
        <pre><code>{block.value}</code></pre>
      </div>
    )
  }
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
}

export function SceneView({ scene, sceneNumber, sceneCount, debug = false, revealIndex, measurement = false, navigationLabels = [], activeNavigationLabel, onNavigateLabel, presentationConfig }: SceneViewProps) {
  const heading = scene.blocks.find((block) => block.type === 'heading')
  const content = scene.blocks.filter((block) => block !== heading)
  const figures = content.filter((block) => block.type === 'figure')
  const backgroundFigure = figures.find((block) => block.imageOptions?.background)
  const visibleFigures = figures.filter((block) => block !== backgroundFigure)
  const prose = content.filter((block) => block.type !== 'figure')
  const backgroundStyle = backgroundFigure ? {
    backgroundImage: `url(${JSON.stringify(backgroundFigure.url ?? '').slice(1, -1)})`,
    backgroundSize: backgroundFigure.imageOptions?.fit === 'auto' ? 'auto' : backgroundFigure.imageOptions?.fit,
    filter: imageFilterCss(backgroundFigure.imageOptions?.filters ?? ''),
    '--scene-bg-split': backgroundFigure.imageOptions?.splitSize || '50%',
  } as CSSProperties : undefined

  const renderBlocks = (blocks: PresentationBlock[]) => blocks.map((block) => (
    <BlockView key={block.id} block={block} revealIndex={revealIndex} measurement={measurement} />
  ))

  if (scene.role === 'cover') {
    return (
      <article className="scene scene-title scene-cover" data-layout="title" data-scene-id={scene.id}>
        <div className="presentation-cover-top">
          {presentationConfig.seriesName && <span>{presentationConfig.seriesName}</span>}
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
      <article className="scene scene-chapter" data-layout="chapter" data-scene-id={scene.id}>
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
    <article className={`scene scene-${scene.layout}${backgroundFigure ? ` has-background background-${backgroundFigure.imageOptions?.side ?? 'none'}` : ''}`} data-layout={scene.layout} data-scene-id={scene.id}>
      {backgroundFigure && <div className="scene-background-image" style={backgroundStyle} role="img" aria-label={backgroundFigure.alt ?? ''} />}
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

        {scene.layout === 'text-media' ? (
          <div className="text-media-grid">
            <div className="prose-column">{renderBlocks(prose)}</div>
            <div className="media-column">{renderBlocks(visibleFigures)}</div>
          </div>
        ) : scene.layout === 'media-dominant' ? (
          <div className="media-dominant-grid">
            <div className="media-column">{renderBlocks(visibleFigures)}</div>
            {!!prose.length && <div className="prose-column">{renderBlocks(prose)}</div>}
          </div>
        ) : (
          <div className="prose-flow">{renderBlocks(content)}</div>
        )}
      </div>

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
