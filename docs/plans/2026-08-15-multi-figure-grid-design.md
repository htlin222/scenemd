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

## This repaginates existing documents

Not a side effect — the point of the change — but it must not be discovered in
front of an audience. Measured against `main`, same measurement map, same
viewport:

| document | before | after |
| --- | --- | --- |
| two `size=80%` figures with legends | **2 scenes** | **1 scene** |
| two bare `size=80%` figures | **2 scenes** | **1 scene** |
| three bare `size=80%` figures | **3 scenes** | **1 scene** |
| two figures with no `size` | 1 | 1 |
| two `size=45%` figures | 1 | 1 |

Any deck whose figures stack today gets fewer, denser pages: slide numbers move,
printed handouts stop matching, a rehearsed run changes shape. Sized figures are
affected most, because it was their arithmetic that used to overflow the page.

The `size` number itself is also re-based (see below), so **the same
`size=80%` renders smaller once a second figure joins its page** — the basis
went from the whole figure column to one grid cell. The figure dialog labels
which basis is in effect; the raw Markdown does not.

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

### Known hazard: the lead-in authoring style

The rule cannot distinguish `圖 → 說明 → 圖 → 說明` from
`引言 → 圖 → 引言 → 圖`. They are the same token sequence shifted by one, so
no structural rule separates them. This repository's own
`test/corpus/fixtures/image-heavy.md` is written the second way:

```markdown
Morning light over the survey area.
![Survey area at dawn](site-dawn.jpg)
The same ridge after the storm front passed.   ← meant as a lead-in for the NEXT figure
![Ridge after the storm](ridge-storm.jpg)
```

"The same ridge…" becomes the **dawn** figure's legend. The misattribution
pre-dates this design — every paragraph after the first figure was already the
stacked column's shared legend — but the grid binds it to one specific, wrong
image, which is more visibly wrong.

Left as is deliberately: the alternatives are a heuristic on where the block run
ends (fragile), or new syntax (rejected under YAGNI). Authors who write lead-ins
should put the prose *above* the first figure, or separate the pages with `---`.

### `size=NN%`

The basis changes from "the height remaining under the heading" to "this
figure's own frame slot in its grid cell". `size=100%` still means *fill the
space you were given, never overflow*. Planner and renderer keep sharing one
formula: the planner divides the grid space into equal rows, CSS realises the
same division with `grid-auto-rows: 1fr`.

### Ceiling

Six figures is the maximum for one scene, enforced by `exceedsFigureLimit()` as
its own predicate on candidate validity.

Not by inflating `usedHeight` past the budget, which is what the first
implementation did: `fillRatio` is shown in the debug card and quoted verbatim
by the overflow warning, so a seven-figure `present: group` announced
"Content overflows this scene by 84%" about a grid whose real height fits. A
figure count is not a height; it gets its own message.

## Height model (planner)

Single-figure scenes take `max(figureColumn, aboveText)` because figure and text
sit side by side. In the grid layout text is *above* the figures, so it is a
sum:

```
available   = sceneBudget - headingTotal
textRow     = Σ bodyText
gridSpace   = available - textRow - GRID_GAP
rowSlot     = (gridSpace - (rows - 1) * ROW_GAP) / rows

legend_i    = legendMeasurements[cols][block]  ?? measured × cols   // fallback
cellChrome  = CAPTION_ALLOWANCE + max_i(legend_i)      // per row, cells align
minFrame    = sceneBudget × MIN_FRAME_RATIO
frameSlot   = max(minFrame, rowSlot - cellChrome)
frame_i     = sized ? max(minFrame, frameSlot × pct) : min(measured_i, frameSlot)

gridNeeded  = Σ_rows ( max_i(frame_i) + cellChrome_row )
used        = headingTotal + textRow + GRID_GAP + gridNeeded
```

### Legends are measured, not extrapolated

The measurement root measures every block at the full scene width, but a legend
occupies `1/cols` of it and `.figure-below-caption p` is sized in `cqw` —
relative to the stage, not the column — so narrowing the column multiplies the
line count instead of shrinking the type.

Scaling the full-width height by `cols` looks like the fix and is not: text
height is not inversely linear in width. A short legend that still fits one line
in a third of the page gets charged three lines; one with long unbreakable
tokens gets charged too little. In practice this over-reserved about a fifth of
the grid — six single-line legends budgeted as three lines each — which is
exactly why six figures sat pinned at `fillRatio` 1.0.

So `MeasurementRoot` renders legend candidates a second and third time at real
cell width inside a `.figure-below-caption`, and the planner uses those heights.
The narrow copies must **not** declare `container-type`, or `cqw` resolves
against them and changes the type size being measured. `× cols` survives only as
the fallback for callers with no narrow pass (unit tests, the first frame).

Body text needs no correction: in the grid layout it really is full width, so
its measured height is finally accurate. (The v5 right-hand text column is
measured at full width and rendered at roughly half, an inaccuracy that
`figureTextScale` absorbs. Unchanged here.)

### Why the minimum frame is a fraction of the budget

`MIN_FRAME_RATIO × sceneBudget`, not a pixel count: an absolute floor is 12% of
a tall stage and 41% of a short one, so the same document paginates differently
for no reason the author can see. It is deliberately **not** a fraction of the
row slot either — the slot is exactly the quantity that shrinks under pressure,
so a floor defined against it can always be satisfied and never forces anything
to give way. The floor is on the *frame*, not the slot: a frame that has shrunk
past it is a smudge, so the grid keeps claiming it and the body text yields.

### Why the text scale is bisected, not solved

Shrinking the body text frees grid space that sized figures immediately grow
into, so the surplus recovered per unit of shrink is `1 - size%`, not `1`. A
one-step solve therefore under-corrects by `1/(1 - size%)`: the first
implementation returned a scale of 0.96 for a page that still overflowed to
1.002 and warned "Content overflows this scene by 0%". `used()` is monotone
non-decreasing in the scale, so bisection finds the largest scale that fits and
stays correct through the minimum-frame clamp, which no closed form survives.

Floor 0.6, as in the single-figure model. When even 0.6 does not fit, the
planner breaks the scene rather than shrinking further.

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
