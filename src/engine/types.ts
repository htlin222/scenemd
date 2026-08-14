export type Density = 'compact' | 'balanced' | 'cinematic'
export type ThemeMode = 'light' | 'dark'
export type PresentationTheme = 'default' | 'editorial' | 'catppuccin'

export interface PresentationConfig {
  theme: PresentationTheme
  title: string
  subtitle: string
  seriesName: string
  date: string
  author: string
  affiliation: string
  email: string
  license: string
}

export interface SourceRange {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'math'; value: string }
  | { type: 'strong' | 'emphasis' | 'delete'; children: InlineNode[] }
  | { type: 'link'; url: string; children: InlineNode[] }
  | { type: 'break' }

export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'figure'
  | 'blockquote'
  | 'code'
  | 'code-group'
  | 'math'
  | 'table'
  | 'columns'

export interface PresentationBlock {
  id: string
  type: BlockType
  semanticRole:
    | 'title'
    | 'section-title'
    | 'body'
    | 'key-message'
    | 'evidence'
    | 'figure'
    | 'caption'
    | 'aside'
    | 'reference'
  importance: number
  keepTogether: boolean
  keepWithNext: boolean
  keepWithPrevious: boolean
  breakBefore: 'never' | 'avoid' | 'auto' | 'prefer' | 'always'
  breakAfter: 'never' | 'avoid' | 'auto' | 'prefer' | 'always'
  visibility: 'normal' | 'hidden' | 'presentation-only'
  layoutHint?: 'auto' | 'hero' | 'media' | 'legend' | 'statement'
  sourceRange: SourceRange
  inlines?: InlineNode[]
  depth?: number
  ordered?: boolean
  listStart?: number
  listItems?: InlineNode[][]
  continuation?: boolean
  url?: string
  alt?: string
  imageOptions?: import('../imageSyntax').MarpitImageOptions
  figureNumber?: number
  groupId?: string
  caption?: InlineNode[]
  value?: string
  language?: string
  codeTitle?: string
  codeLineNumbers?: boolean
  codeStartLine?: number
  codeHighlightSteps?: Array<number[] | 'all' | 'none' | 'hide'>
  codeGroup?: PresentationBlock[]
  tableRows?: string[][]
  columns?: PresentationBlock[][]
  estimatedHeight?: number
  speakerNotes?: string[]
  speakerNoteRanges?: SourceRange[]
  stepped?: boolean
}

export interface SemanticRegion {
  id: string
  headingPath: string[]
  blocks: PresentationBlock[]
  sourceRange: SourceRange
  importance: number
  explicitBreakBefore: boolean
  explicitBreakAfter: boolean
}

export type SceneLayout = 'title' | 'chapter' | 'text' | 'figure' | 'statement'
export type SceneRole = 'cover' | 'chapter' | 'content'

export interface ScoreBreakdown {
  semanticCoherence: number
  density: number
  breakpoint: number
  visualBalance: number
  hierarchy: number
  stability: number
  fragmentationPenalty: number
  orphanPenalty: number
  crowdingPenalty: number
  whitespacePenalty: number
}

export interface Scene {
  id: string
  role: SceneRole
  regionId: string
  startBlockId: string
  endBlockId: string
  blocks: PresentationBlock[]
  layout: SceneLayout
  sourceRange: SourceRange
  fillRatio: number
  score: number
  scores: ScoreBreakdown
  warning?: string
  figureTextScale?: number
  continuationLabel?: string
  breadcrumb?: string
}

export interface ScenePlan {
  scenes: Scene[]
  averageFill: number
  overflowCount: number
  measuredBlockCount: number
}
