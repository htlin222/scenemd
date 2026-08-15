# Multi-figure scenes lay out as a grid

Date: 2026-08-15
Status: designed, not implemented
Supersedes part of: [2026-08-14-image-config-design.md](2026-08-14-image-config-design.md) ("every figure scene has exactly one layout")

## Problem

Design v5 gives every figure scene one structure: optional heading, then figure
left / body text right. All figures in a scene stack vertically inside that one
left column. Two images therefore render as two half-height images in a narrow
column beside a text column — the worst use of a 16:9 frame for the most common
two-image case, an A/B comparison.

## Contract

A figure scene with **two or more** figures switches to a stacked structure:

```
heading            (full width, unchanged)
body text          (full width — every paragraph before the first figure)
figure grid        (rows × cols; each cell = figure + its own legend)
```

A scene with exactly one figure keeps the v5 figure-left / text-right layout,
unchanged.

### Column count

```
rows = ceil(n / 3)
cols = ceil(n / rows)
```

Cells fill left-to-right, then wrap to the next row.

| n | rows × cols | per row |
| --- | --- | --- |
| 2 | 1 × 2 | 2 |
| 3 | 1 × 3 | 3 |
| 4 | 2 × 2 | 2 + 2 |
| 5 | 2 × 3 | 3 + 2 |
| 6 | 2 × 3 | 3 + 3 |

Three columns is the cap: narrower cells on a 16:9 frame reduce figures to
postage stamps. Rows are balanced rather than greedy so four figures read as a
2 × 2 quadrant instead of a 3 + 1 orphan.

### Legend ownership

Position decides the role, as it already does in v5:

- Every block before the first figure is **body text**.
- The consecutive non-heading, non-figure blocks **immediately after** a figure
  are that figure's **legend**. The next figure ends the run.

```markdown
Body copy for the whole scene.

![](a.png){size=80%}

Left: before treatment.        ← Figure 1's legend

![](b.png){size=80%}

Right: after treatment.        ← Figure 2's legend
```

With one figure this rule degenerates to today's `aboveProse` / `belowProse`
split, so single-figure behaviour is bit-identical.

### `size=NN%`

The basis changes from "the height remaining under the heading" to "this
figure's own frame slot in its grid cell". `size=100%` still means *fill the
space you were given, never overflow*. Planner and renderer keep sharing one
formula: the planner divides the grid space into equal rows, CSS realises the
same division with `grid-auto-rows: 1fr`.

### Ceiling

Six figures (3 × 2) is the maximum for one scene. The seventh makes
`usedHeight` exceed capacity, so the existing greedy window drops the candidate
and breaks the scene — no new branch. A `present: group` that hard-binds more
than six figures shows the existing overflow warning.

## Height model (planner)

Single-figure scenes take `max(figureColumn, aboveText)` because figure and text
sit side by side. In the grid layout text is *above* the figures, so it is a
sum:

```
available   = sceneBudget - headingTotal
textRow     = Σ bodyText
gridSpace   = available - textRow - GRID_GAP
rowSlot     = (gridSpace - (rows - 1) * ROW_GAP) / rows

legend_i    = Σ(that figure's legend blocks) × cols
cellChrome  = CAPTION_ALLOWANCE + max_i(legend_i)      // per row, cells align
frameSlot   = max(MIN_FRAME, rowSlot - cellChrome)
frame_i     = sized ? frameSlot × pct : min(measured_i, frameSlot)

gridNeeded  = Σ_rows ( max_i(frame_i) + cellChrome_row )
used        = headingTotal + textRow + GRID_GAP + gridNeeded
```

### Why `× cols` on legends

The measurement root measures every block at the full scene width. A legend
actually occupies `1/cols` of it, and `.figure-below-caption p` is sized in
`cqw` — relative to the scene, not the column — so narrowing the column does not
shrink the type, it multiplies the line count by roughly `cols`. Without the
correction the planner systematically under-counts legend height and the legends
overflow their cells.

Body text needs no such correction: in the grid layout it really is full width,
so its measured height is finally accurate. (The v5 right-hand text column is
measured at full width and rendered at roughly half, an inaccuracy that
`figureTextScale` currently absorbs.)

`figureTextScale` still applies to the body-text row, floor 0.6. When text at
0.6 plus the grid minimum still exceeds capacity, the planner breaks the scene
rather than shrinking further.

## Rendering

`Scene` gains `figureColumns?: number` — the planner's column count, with
`undefined` or `1` meaning the v5 single-figure layout. `SceneLayout` is
unchanged: a multi-figure scene is still `'figure'`. Adding a layout value would
fork `.scene-figure`, the debug card, and the documented layout contract for no
gain.

```jsx
<div className="figure-gallery" style={{ '--figure-cols': scene.figureColumns }}>
  {bodyText.length > 0 && (
    <div className="figure-gallery-text" style={{ '--figure-text-scale': scene.figureTextScale }}>
      {renderBlocks(bodyText)}
    </div>
  )}
  <div className="figure-gallery-grid">
    {cells.map((cell) => <FigureCell key={cell.figure.id} {...cell} />)}
  </div>
</div>
```

`FigureCell` is a new component owning **its own** `figureImageWidth` state and
**its own** `<FigureFrameArea>`. This is load-bearing, not tidiness: today
`figureImageWidth` is one state on `SceneView`, so sharing it across cells would
set every caption to the widest image's width, and `--frame-area-height` must be
measured per cell or `size=NN%` resolves against the wrong box. `FigureFrameArea`
itself is reused unchanged.

### CSS

```css
.figure-gallery { flex: 1; display: flex; flex-direction: column; gap: 1.4cqw; min-width: 0; min-height: 0; }
.figure-gallery-text { flex: 0 0 auto; display: flex; flex-direction: column; gap: 1.05cqw; }
.figure-gallery-text p,
.figure-gallery-text li { margin: 0; font-size: calc(2.083cqw * var(--figure-text-scale, 1)); }
.figure-gallery-grid {
  flex: 1 1 auto; display: grid;
  grid-template-columns: repeat(var(--figure-cols, 2), minmax(0, 1fr));
  grid-auto-rows: 1fr;
  gap: 1.6cqw 2.2cqw; min-height: 0;
}
.figure-cell { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.figure-cell .figure-frame-area { flex: 1 1 auto; }
```

`grid-auto-rows: 1fr` is what makes the renderer agree with the planner's equal
`rowSlot`. The existing frame / `figcaption` / `.figure-below-caption` rules are
widened from `.figure-col` to `.figure-col, .figure-cell` rather than duplicated.

`.measurement-root .figure-frame { height: 240px }` distorts measured heights for
figures with no `size`, which is why unsized figures clamp to
`min(measured, frameSlot)` — they can fill their cell but never overflow it.

## Shared derivation

`planner.ts` exports `figureCells(blocks)`, returning `{ bodyText, cells }` where
each cell is `{ figure, legend }`. The planner's height model and `SceneView`
both call it. Today the `firstFigureIndex` split is written twice — once in
`figureColumns`, once in `SceneView` — and the two would drift the moment legend
ownership got more interesting than "everything after the first figure".

## Edge cases

- `present: columns` produces `type: 'columns'` blocks, which are not figures.
  Unaffected.
- A heading between two figures cannot arise: `buildSemanticRegions` flushes a
  region at every H1/H2/H3.
- Display math between figures is prose, so it becomes body text or a legend by
  position. "Never split image-caption pairs or display math" is untouched.

## Verification

1. `npm test` — new planner cases for n = 2, 3, 4, 5, 7: column count,
   `usedHeight`, and that 7 figures break into 6 + 1. All existing
   single-figure tests must stay green; they are the regression fence.
2. `npm run typecheck` (both projects) and `npm run lint`.
3. `npm run dev` plus `tools/browser-check.mjs` screenshots of 2-, 3-, and
   4-figure scenes. `.figure-gallery` is a new selector and the smoke script
   needs an assertion for it.
4. Update CLAUDE.md: the "no test runner in this repo" line is stale (vitest runs
   under `npm test`), and the design-v5 sentence "figure scenes have exactly one
   layout" now needs the multi-figure exception.

## Out of scope

No syntax for authors to pick the column count, no alignment or crop options, no
legend spanning several cells, no changes to image attributes other than `size`'s
basis. Column count follows from the number of figures, nothing else.
