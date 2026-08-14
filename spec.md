# SceneMD product specification

> **Present documents, not slides.**

## Product definition

SceneMD is an open-source, document-first presentation engine that transforms ordinary Markdown into responsive, semantically coherent presentation scenes.

Traditional tools model:

```text
Markdown → author-defined slides → presentation
```

SceneMD models:

```text
Document → semantic structure → viewport-aware composition → scenes
```

The user normally writes ordinary Markdown without slide delimiters. The document remains the single source of truth; presentation mode is derived state.

## Core thesis

The central product and technical question is:

> Given this document, this viewport, and this speaking context, what should the audience see right now?

```ts
plan(
  document: PresentationAST,
  viewport: Viewport,
  theme: Theme,
  density: Density,
  previousPlan?: ScenePlan,
): Scene[]
```

The quality, stability, and explainability of this function are the primary differentiators.

## Product principles

1. **Document-first.** Markdown is canonical; there is no second deck artifact.
2. **Zero presentation syntax by default.** At least 90% of normal documents should present acceptably without overrides.
3. **Scenes, not slides.** A scene is a semantic unit currently projected into a viewport.
4. **Semantic integrity.** Keep headings with their bodies, images with captions, and short lists intact.
5. **Responsive composition.** Layout adapts and may repaginate when the viewport materially changes.
6. **Deterministic core.** Identical content, viewport, theme, and density produce the same plan. AI provides optional hints or editor transformations only.
7. **Progressive control.** System decisions → semantic hints → layout hints → manual breaks.
8. **Readable typography.** Prefer a coherent break over shrinking main content below 20px.

## Engine architecture

```text
Markdown source
      ↓
remark / mdast
      ↓
Semantic normalizer
      ↓
Presentation AST
      ↓
Structural planner
      ↓
SemanticRegion[]
      ↓
fit test ── comfortable ─────────┐
      │                          │
      └─ overflow → measurement  │
                         ↓       │
                  semantic paginator
                         ↓       │
                         Scene[] ◀┘
                            ↓
                  responsive renderer
```

Pagination is two-stage. The structural planner first derives regions from headings, manual breaks, and semantic blocks. Comfortable regions become scenes directly. Only dense or overflowing regions enter the measured breakpoint search.

## Presentation AST

```ts
interface PresentationBlock {
  id: string
  type: 'heading' | 'paragraph' | 'list' | 'figure' |
        'blockquote' | 'code' | 'code-group' | 'math' |
        'table' | 'columns'
  semanticRole: 'title' | 'section-title' | 'body' |
                'key-message' | 'evidence' | 'figure' |
                'caption' | 'aside' | 'reference'
  importance: number
  keepTogether: boolean
  keepWithNext: boolean
  keepWithPrevious: boolean
  breakBefore: 'never' | 'avoid' | 'auto' | 'prefer' | 'always'
  breakAfter: 'never' | 'avoid' | 'auto' | 'prefer' | 'always'
  visibility: 'normal' | 'hidden' | 'presentation-only'
  layoutHint?: 'auto' | 'hero' | 'media' | 'legend' | 'statement'
  sourceRange: SourceRange
}
```

`src/engine/types.ts` is the normative definition; this is the structural contract without the per-type payload fields.

Two block types are containers rather than leaves. A `code-group` holds consecutive fenced blocks presented as one tabbed unit, and `columns` holds parallel block lists. Both paginate as a unit and split only across their children, so the planner treats their height as the height of the arrangement, not the sum of their parts.

Beyond the structural fields, blocks carry the payload their type requires — inline content, list items, table rows, code text with optional per-step highlight ranges, image URL with parsed Marpit options, and the child arrays for the two container types. Blocks also carry authoring metadata that never renders in the scene: speaker notes with their own source ranges, and a `stepped` flag for progressive reveal.

Every block retains a stable source range, and identity is content-derived rather than positional. Scene identity derives from region and boundary block identities, not array position alone. Blocks produced by splitting an oversized block are marked as continuations and keep a reference to their origin, so a split does not read as new content on the next replan.

## Semantic normalization

- Headings strongly keep with the next block.
- Paragraphs are atomic for the MVP.
- Short lists remain atomic; long lists split only at item boundaries with continuation context.
- Image and caption normalize into one atomic figure.
- Code prefers atomic rendering and may split only at logical line boundaries.
- Display math never splits.
- Quote and attribution remain together.
- Small tables remain atomic. Large tables repeat headers and paginate by logical row groups.

## Measurement and fit

Capacity must use actual browser geometry, not character or word counts. Measurements reflect fonts, theme, viewport, typography, highlighting, math, and resolved media dimensions.

```ts
interface FitResult {
  fitsComfortably: boolean
  fitsHardLimit: boolean
  usedHeight: number
  comfortableHeight: number
  maximumHeight: number
  fillRatio: number
}
```

Useful states are Comfortable, Dense, and Overflow. Optimal fill is intentionally below 100%.

## Pagination and scoring

Overflowing regions generate candidate boundaries primarily between semantic blocks. Each candidate is measured and scored:

```text
quality = semantic coherence
        + density quality
        + breakpoint quality
        + visual balance
        + hierarchy
        + layout quality
        + stability
        - fragmentation
        - orphaning
        - crowding
        - excessive whitespace
        - readability violations
        - overflow
```

Three terms of this objective are not yet implemented. `ScoreBreakdown` in `src/engine/types.ts` currently carries semantic coherence, density, breakpoint, visual balance, hierarchy, stability, and the fragmentation, orphan, crowding, and whitespace penalties. Layout quality and readability violations are unimplemented, and overflow is handled as a feasibility filter that discards overflowing candidates rather than as a scored penalty — which is why an unsplittable oversized block can still produce an overflowing scene (see #7).

The formula above remains the target, not a description of the current implementation. Candidate search is a dynamic program over all feasible scene partitions of a region — globally optimal for the current scoring function, with a fixed per-scene cost so that summing mostly-positive scene scores cannot reward fragmentation.

Every boundary must expose its score breakdown in development mode. A manual break has infinite priority and cannot be overridden.

Minor edits should preserve prior boundaries when their quality remains competitive. This stability supports rehearsal, scene references, and collaborative discussion.

## Density modes

- **Compact:** teaching and technical talks; target fill roughly 70–85%.
- **Balanced:** default; target fill roughly 55–75%.
- **Cinematic:** keynote and storytelling; target fill roughly 30–55%.

Density influences the objective function; it is not a hard typography threshold.

## Layout grammar

The MVP has a deliberately small deterministic grammar:

```text
cover
chapter
text
text-media
media-dominant
legend
statement
```

`legend` pairs one figure with its explanatory copy side by side. It is not a marginal addition: the semantic normalizer makes `legend` the **default** composition for images, so an ordinary figure with adjacent prose lands here rather than in `text-media`. `hero` images opt out into `media-dominant`.

The layout is derived from the composition of the blocks on a scene, never chosen by the author. Authors influence it only through `present: hero` and Marpit image options.

Wide scenes may use columns; narrow scenes stack. If the responsive layout exceeds capacity, the planner replans.

## Navigation and presentation chrome

- Cover metadata comes from separate presentation configuration, not the Markdown body.
- H1 headings define chapter navigation.
- H1 chapter dividers hide the top navigation.
- H3 scenes show their parent H2 as a breadcrumb.
- Cover scenes hide navigation and progress.
- Chapter dividers hide navigation but retain progress.
- Other scenes show clickable H1 navigation and a bottom progress track with `current / total`.

## Manual overrides

```markdown
<!-- present: break -->
<!-- present: keep -->
<!-- present: hero -->
<!-- present: hide -->
<!-- present: only -->
<!-- present: step -->
```

Each applies to the block that follows it.

Column groups are a bracketing form rather than a single-block hint:

```markdown
<!-- present: columns 2 -->
first column content
<!-- present: column -->
second column content
<!-- present: end-columns -->
```

Inside a group, an H3 also advances to the next column, so parallel subsections need no explicit separator.

Any other HTML comment becomes a speaker note attached to the following block. Notes are presenter-only: they appear in the presenter window and the editor, never in a scene. This makes the comment syntax dual-purpose — recognized `present:` forms are directives, and everything else is narration.

Overrides are escape hatches. Ordinary documents should not require them.

## Editor and contextual tools

The default environment is a calm Markdown document editor, not a slide canvas or thumbnail rail. Write, Split, and Preview modes follow familiar GitHub Markdown conventions.

Contextual tools include:

- selection-to-bullets via Workers AI;
- click-to-edit Marpit image syntax with live preview;
- clipboard image upload to R2 and immediate Markdown insertion;
- OpenEvidence conversation import;
- pasted TSV-to-GFM-table normalization;
- presentation cover configuration;
- manual HackMD pull, push, and conflict-aware smart sync.

AI never controls pagination and must preserve facts, numbers, qualifiers, citations, and source language when transforming selected prose.

## Persistence and security

- Cloudflare D1 stores documents, revisions, presentation configuration, shares, and integration metadata.
- A Durable Object serializes document edits and rejects stale base revisions.
- R2 stores uploaded images.
- Cloudflare Access protects authoring routes for approved identities.
- Read-only shares use unguessable tokens.
- HackMD and Cloudflare credentials are Worker or repository secrets and never reach the browser or source control.

## MVP requirements

### Markdown

H1–H3, paragraphs, ordered/unordered lists, images, blockquotes, code, inline code, GFM, math, tables, task lists, and horizontal rules.

### Engine

Markdown parsing, semantic normalization, structural regions, DOM measurement, fit testing, overflow pagination, breakpoint scoring, stable identity, source mapping, and explainable debug output.

### Runtime

Fullscreen, keyboard navigation, manual breaks, step reveals, black/white screens, light/dark themes, density modes, and responsive replanning.

## Explicit non-goals for the MVP

- PowerPoint-style canvas or drag positioning
- Slide thumbnails as the primary navigation
- AI deck generation
- Multiplayer editing or comments
- Animation timeline or template marketplace
- Arbitrary WYSIWYG block editing

### Note on export

PPTX export was originally listed here as a non-goal and has since been implemented, alongside PDF, slide HTML, Word, document HTML, and Markdown.

The original objection is worth restating, because it still holds: a product that maintains an editable deck has two sources of truth and must reconcile them. The implemented export does not create that problem — PowerPoint and PDF capture each planned scene as a raster image, so the output is a rendering of the document rather than a parallel artifact that can be edited and drift.

Export is therefore a one-way door out of the system, not a second authoring surface. That is what keeps it compatible with the thesis, and it is the constraint to preserve if export is ever extended: the moment a format round-trips back into editable scenes, the non-goal applies again.

## Evaluation

Test a corpus containing short and long essays, technical documentation, academic and medical lectures, image-heavy, list-heavy, code-heavy, math-heavy, and mixed README documents across 16:9, 4:3, ultrawide, and narrow viewports in every density mode.

Track overflow, orphan headings, split figures, split short lists, font violations, scene count, fill distribution, and pagination stability.

Critical invariants:

```text
split image-caption pairs = 0
unintentional hard overflow = 0
main content below 20px = 0
```

## Success and failure

MVP success means a user can open an ordinary Markdown document and present it without manually inserting scene boundaries. Strong success means manual breaks are rare. Excellent success means the same source naturally serves as notes, handout, documentation, and presentation.

The product has failed its thesis if users routinely insert breaks, resize text, choose layouts, preview every scene, or repair overflow before presenting.

The canonical transformation remains:

```text
Document → Meaning → Scene → Viewport
```
