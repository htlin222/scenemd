# Multi-Figure Grid Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A scene holding two or more figures renders as a full-width body-text row above a balanced figure grid, instead of stacking every image in one narrow column.

**Architecture:** One new pure helper, `figureCells()`, becomes the single source of truth for "which paragraph belongs to which figure" and is consumed by both the planner's height model and `SceneView`. The planner gains a grid height model (`figureGridPlan`) used only when a scene has ≥2 figures and publishes the column count on `Scene.figureColumns`; `SceneView` branches on that number into a new `.figure-gallery` DOM. Single-figure scenes keep the design-v5 layout with identical output.

**Tech Stack:** React 19, TypeScript, Vite, vitest (node environment, `npm test`), Playwright (`npm run test:e2e`), plain CSS with container queries (`cqw`).

**Design doc:** [2026-08-15-multi-figure-grid-design.md](2026-08-15-multi-figure-grid-design.md) — read it first; it explains *why* each constant exists.

---

## Orientation for someone new to this repo

- The pipeline is `markdown → parsePresentationDocument → buildSemanticRegions → planScenes → <SceneView>`. Only `planner.ts` decides pagination; `SceneView.tsx` only renders.
- **Pagination runs on real measured heights.** `App.tsx` renders a hidden `.measurement-root` containing every block at the full scene width and reads `offsetHeight` into a `Map<blockId, height>` that `planScenes` receives. That map is why a paragraph rendered in a narrow column is *under*-measured — the correction in Task 3 exists for exactly this reason.
- `npm test` runs vitest in a **node** environment over `src/**/*.test.ts`. There is no DOM there, so component behaviour is tested with Playwright against `tests/harness/pipeline/`, which runs the *real* pipeline in a browser.
- `npm run typecheck` runs **two** compilations (`tsc -b` and `tsc -p tsconfig.cloudflare.json`). Always run the whole script.
- Never use `rm`; this environment uses `rip`.

Run these once before starting, so you know the baseline is green:

```bash
npm test
npm run typecheck
```

Expected: all tests pass, no type errors.

---

## Task 1: `figureCells()` — who owns which paragraph

Today the "prose above / prose below the first figure" split is written twice: in `figureColumns()` in the planner and again in `SceneView`. Multi-figure legends make that rule richer, so it moves into one exported function both sides call.

**Files:**
- Modify: `src/engine/planner.ts` (add near `figureColumns`, around line 164)
- Test: `src/engine/planner.test.ts`

**Step 1: Write the failing tests**

Add to `src/engine/planner.test.ts`. Import `figureCells` in the existing import from `./planner`.

```ts
describe('figureCells — legend ownership', () => {
  it('treats everything before the first figure as body text', () => {
    const { blocks } = regionsFrom('## Title\n\n開場說明。\n\n![a](a.png)\n')
    const { bodyText, cells } = figureCells(blocks)

    expect(bodyText.map((block) => block.type)).toEqual(['paragraph'])
    expect(cells).toHaveLength(1)
    expect(cells[0].legend).toEqual([])
  })

  it('gives each figure the paragraphs that immediately follow it', () => {
    // Position decides the role: the run of prose after a figure is that
    // figure's legend, and the next figure ends the run.
    const { blocks } = regionsFrom('內文。\n\n![a](a.png)\n\n左圖說明。\n\n![b](b.png)\n\n右圖說明。\n')
    const { bodyText, cells } = figureCells(blocks)

    expect(bodyText).toHaveLength(1)
    expect(cells).toHaveLength(2)
    expect(cells[0].legend).toHaveLength(1)
    expect(cells[0].legend[0].inlines?.[0]).toMatchObject({ value: '左圖說明。' })
    expect(cells[1].legend[0].inlines?.[0]).toMatchObject({ value: '右圖說明。' })
  })

  it('ignores headings and reports no cells for a figureless scene', () => {
    const { blocks } = regionsFrom('## Title\n\n只有文字。\n')
    const { bodyText, cells } = figureCells(blocks)

    expect(cells).toEqual([])
    expect(bodyText.map((block) => block.type)).toEqual(['paragraph'])
  })
})
```

**Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/engine/planner.test.ts -t 'figureCells'
```

Expected: FAIL — `figureCells is not a function` / import error.

**Step 3: Write the implementation**

In `src/engine/planner.ts`, immediately above `interface FigureColumns` (line 164):

```ts
export interface FigureCell {
  figure: PresentationBlock
  legend: PresentationBlock[]
}

export interface FigureComposition {
  bodyText: PresentationBlock[]
  cells: FigureCell[]
}

// Position decides the role (design v5, extended for multi-figure grids):
// everything before the first figure is body copy, and the consecutive
// non-heading blocks immediately after a figure are that figure's legend.
// The planner's height model and SceneView both read this — deriving it twice
// is how the two drift apart.
export function figureCells(blocks: PresentationBlock[]): FigureComposition {
  const bodyText: PresentationBlock[] = []
  const cells: FigureCell[] = []
  for (const block of blocks) {
    if (block.type === 'heading') continue
    if (block.type === 'figure') {
      cells.push({ figure: block, legend: [] })
      continue
    }
    if (cells.length) cells[cells.length - 1].legend.push(block)
    else bodyText.push(block)
  }
  return { bodyText, cells }
}
```

**Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/engine/planner.test.ts -t 'figureCells'
```

Expected: 3 passed.

**Step 5: Commit**

```bash
git add src/engine/planner.ts src/engine/planner.test.ts
git commit -m "feat: extract figureCells as the single legend-ownership rule"
```

---

## Task 2: `figureGridShape()` — how many columns

**Files:**
- Modify: `src/engine/planner.ts`
- Test: `src/engine/planner.test.ts`

**Step 1: Write the failing test**

```ts
describe('figureGridShape — balanced grid, three columns max', () => {
  it.each([
    [1, { rows: 1, columns: 1 }],
    [2, { rows: 1, columns: 2 }],
    [3, { rows: 1, columns: 3 }],
    [4, { rows: 2, columns: 2 }],
    [5, { rows: 2, columns: 3 }],
    [6, { rows: 2, columns: 3 }],
    [7, { rows: 3, columns: 3 }],
  ])('lays %i figures out as %o', (count, expected) => {
    expect(figureGridShape(count)).toEqual(expected)
  })
})
```

Note four figures must be a 2 × 2 quadrant, not a 3 + 1 orphan — that is what `columns = ceil(count / rows)` buys over a greedy fill.

**Step 2: Run the test to verify it fails**

```bash
npx vitest run src/engine/planner.test.ts -t 'figureGridShape'
```

Expected: FAIL — `figureGridShape is not a function`.

**Step 3: Write the implementation**

In `src/engine/planner.ts`, below `figureCells`:

```ts
// Three columns is the cap: on a 16:9 stage a fourth column turns figures into
// postage stamps. Rows are balanced rather than greedily filled so four
// figures read as a 2 × 2 quadrant instead of a 3 + 1 orphan.
const MAX_FIGURE_COLUMNS = 3
// A seventh figure would need a third row of stamps; the planner breaks the
// scene instead (see usedHeight).
export const MAX_FIGURES_PER_SCENE = 6

export function figureGridShape(count: number): { rows: number; columns: number } {
  if (count <= 1) return { rows: count, columns: count }
  const rows = Math.ceil(count / MAX_FIGURE_COLUMNS)
  return { rows, columns: Math.ceil(count / rows) }
}
```

**Step 4: Run the test to verify it passes**

```bash
npx vitest run src/engine/planner.test.ts -t 'figureGridShape'
```

Expected: 7 passed.

**Step 5: Commit**

```bash
git add src/engine/planner.ts src/engine/planner.test.ts
git commit -m "feat: add the balanced figure grid shape"
```

---

## Task 3: the grid height model

This is the substantive change. `usedHeight`'s figure branch currently computes `headingTotal + max(figureColumn, aboveText)` — a **max**, because figure and text sit side by side. In the grid the text row sits *above* the figures, so it becomes a **sum**.

**Files:**
- Modify: `src/engine/planner.ts:156-219`
- Test: `src/engine/planner.test.ts`

**Step 1: Write the failing tests**

```ts
describe('planScenes — multi-figure grid', () => {
  const twoFigures = '## 對照\n\n本頁比較治療前後。\n\n![a](a.png){size=80%}\n\n圖一：治療前。\n\n![b](b.png){size=80%}\n\n圖二：治療後。\n'

  it('fits two sized figures on one scene without an overflow warning', () => {
    const { blocks, regions } = regionsFrom(twoFigures)
    const measurements = measure(blocks, (block) => (block.type === 'heading' ? 76 : block.type === 'figure' ? 280 : 40))
    const plan = planScenes(regions, measurements, VIEWPORT, 'balanced')

    expect(plan.scenes).toHaveLength(1)
    expect(plan.scenes[0].layout).toBe('figure')
    expect(plan.scenes[0].figureColumns).toBe(2)
    expect(plan.scenes[0].fillRatio).toBeLessThanOrEqual(1)
    expect(plan.scenes[0].warning).toBeUndefined()
  })

  it('leaves a single figure on the v5 layout with no column count', () => {
    // Regression fence: one figure must behave exactly as before.
    const { blocks, regions } = regionsFrom('## 標題\n\n內文。\n\n![a](a.png){size=80%}\n\n圖說。\n')
    const measurements = measure(blocks, (block) => (block.type === 'heading' ? 76 : block.type === 'figure' ? 280 : 40))
    const plan = planScenes(regions, measurements, VIEWPORT, 'balanced')

    expect(plan.scenes[0].figureColumns).toBeUndefined()
  })

  it('costs a second row of figures more than a second column', () => {
    // Four figures need two rows, three need one — the height model must
    // reflect that or the planner cannot tell the two apart.
    const figures = (count: number) =>
      Array.from({ length: count }, (_, index) => `![f${index}](f${index}.png){size=80%}`).join('\n\n')
    const shape = (count: number) => {
      const { blocks, regions } = regionsFrom(`<!-- present: group -->\n${figures(count)}\n<!-- present: end-group -->\n`)
      const measurements = measure(blocks, 280)
      return planScenes(regions, measurements, VIEWPORT, 'balanced').scenes[0].fillRatio
    }

    expect(shape(4)).toBeGreaterThan(shape(3))
  })

  it('breaks a run of seven figures rather than shrinking them further', () => {
    const figures = Array.from({ length: 7 }, (_, index) => `![f${index}](f${index}.png){size=80%}`).join('\n\n')
    const { blocks, regions } = regionsFrom(figures)
    const plan = planScenes(regions, measure(blocks, 280), VIEWPORT, 'balanced')

    expect(plan.scenes.length).toBeGreaterThan(1)
    for (const scene of plan.scenes) {
      expect(scene.blocks.filter((block) => block.type === 'figure').length).toBeLessThanOrEqual(6)
    }
  })

  it('shrinks the body-text row before giving up on a two-figure page', () => {
    const { blocks, regions } = regionsFrom(
      '<!-- present: group -->\n大量內文段落。\n\n![a](a.png){size=70%}\n\n![b](b.png){size=70%}\n<!-- present: end-group -->\n',
    )
    const measurements = measure(blocks, (block) =>
      block.type === 'paragraph' ? 700 : block.type === 'figure' ? 280 : 40)
    const plan = planScenes(regions, measurements, VIEWPORT, 'balanced')

    expect(plan.scenes[0].figureTextScale).toBeGreaterThanOrEqual(0.6)
    expect(plan.scenes[0].figureTextScale).toBeLessThan(1)
  })
})
```

**Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/engine/planner.test.ts -t 'multi-figure grid'
```

Expected: FAIL — `figureColumns` is not a property of `Scene`, and the seven-figure case produces one scene.

**Step 3: Add the constants**

In `src/engine/planner.ts`, next to `FIGURE_CAPTION_ALLOWANCE` (line 156):

```ts
// Gap between the body-text row and the figure grid, and between grid rows.
// They mirror the `gap` values in .figure-gallery / .figure-gallery-grid.
const FIGURE_GRID_GAP = 20
const FIGURE_ROW_GAP = 18
// A frame below this is not a figure, it is a smudge; the grid stops shrinking
// here and lets the scene overflow (or break) visibly instead.
const MIN_FRAME_HEIGHT = 110
```

**Step 4: Write the grid metrics**

Add below `figureColumns()` (after line 200):

```ts
interface FigureGridMetrics {
  columns: number
  textRow: number
  used: number
}

function figureGridMetrics(
  blocks: PresentationBlock[],
  measurements: Map<string, number>,
  sceneBudget: number,
  textScale: number,
): FigureGridMetrics {
  const { bodyText, cells } = figureCells(blocks)
  const { rows, columns } = figureGridShape(cells.length)
  const headings = blocks.filter((block) => block.type === 'heading')
  const headingTotal = headings.length
    ? headings.reduce((total, block) => total + blockHeight(block, measurements, sceneBudget), 0)
      + Math.max(0, headings.length - 1) * 20 + 20
    : 0
  const available = Math.max(120, sceneBudget - headingTotal)
  const textRow = bodyText.length
    ? (bodyText.reduce((total, block) => total + blockHeight(block, measurements, sceneBudget), 0)
      + (bodyText.length - 1) * 12) * textScale
    : 0
  const textGap = bodyText.length ? FIGURE_GRID_GAP : 0
  const gridSpace = Math.max(MIN_FRAME_HEIGHT, available - textRow - textGap)
  const rowSlot = (gridSpace - (rows - 1) * FIGURE_ROW_GAP) / rows

  let gridNeeded = Math.max(0, rows - 1) * FIGURE_ROW_GAP
  for (let row = 0; row < rows; row += 1) {
    const rowCells = cells.slice(row * columns, row * columns + columns)
    // Legends are measured at the full scene width but render at 1/columns of
    // it, and .figure-below-caption is sized in cqw — relative to the scene,
    // not the column — so narrowing the column multiplies the line count
    // instead of the type size. Without this the planner under-counts legends
    // and they spill out of their cells.
    const legendHeight = Math.max(0, ...rowCells.map((cell) =>
      cell.legend.reduce((total, block) => total + blockHeight(block, measurements, sceneBudget), 0) * columns))
    const chrome = FIGURE_CAPTION_ALLOWANCE + legendHeight
    const frameSlot = Math.max(MIN_FRAME_HEIGHT, rowSlot - chrome)
    const frame = Math.max(0, ...rowCells.map((cell) => {
      const sized = cell.figure.imageOptions?.size?.match(/^(\d+(?:\.\d+)?)%$/)
      // Unsized figures were measured against .measurement-root's fixed 240px
      // frame, so they may claim more than their cell — clamp them to it.
      return sized
        ? (frameSlot * Number(sized[1])) / 100
        : Math.min(blockHeight(cell.figure, measurements, sceneBudget), frameSlot)
    }))
    gridNeeded += frame + chrome
  }
  return { columns, textRow, used: headingTotal + textRow + textGap + gridNeeded }
}

// Body text shrinks (floor 0.6) before the grid gives ground, matching the
// single-figure rule. One corrective pass only: shrinking the text also frees
// grid space, so the result is a conservative over-estimate — which is the
// safe direction for a fit test.
function figureGridPlan(
  blocks: PresentationBlock[],
  measurements: Map<string, number>,
  sceneBudget: number,
): { metrics: FigureGridMetrics; textScale?: number } {
  const first = figureGridMetrics(blocks, measurements, sceneBudget, 1)
  if (first.used <= sceneBudget || first.textRow <= 0) return { metrics: first }
  const surplus = first.used - sceneBudget
  const textScale = Math.max(MIN_TEXT_SCALE, Math.round(((first.textRow - surplus) / first.textRow) * 100) / 100)
  return { metrics: figureGridMetrics(blocks, measurements, sceneBudget, textScale), textScale }
}

export function figureGridColumns(blocks: PresentationBlock[]): number | undefined {
  const count = figureCells(blocks).cells.length
  return count > 1 ? figureGridShape(count).columns : undefined
}
```

**Step 5: Branch `figureTextScale` and `usedHeight`**

Replace `figureTextScale` (lines 202-207) and the figure branch of `usedHeight` (lines 209-217):

```ts
export function figureTextScale(blocks: PresentationBlock[], measurements: Map<string, number>, sceneBudget: number): number | undefined {
  if (chooseLayout(blocks) !== 'figure') return undefined
  if (figureCells(blocks).cells.length > 1) return figureGridPlan(blocks, measurements, sceneBudget).textScale
  const { available, aboveHeight } = figureColumns(blocks, measurements, sceneBudget)
  if (aboveHeight <= available) return undefined
  return Math.max(MIN_TEXT_SCALE, Math.round((available / aboveHeight) * 100) / 100)
}

function usedHeight(blocks: PresentationBlock[], measurements: Map<string, number>, sceneBudget: number): number {
  if (chooseLayout(blocks) === 'figure') {
    const count = figureCells(blocks).cells.length
    if (count > 1) {
      const { used } = figureGridPlan(blocks, measurements, sceneBudget).metrics
      // Sized figures always shrink to whatever space is left, so the arithmetic
      // alone would happily accept a dozen figures on one scene. Past the cap
      // the cost grows past the budget, and the existing candidate filter
      // (and overflow warning, for a forced `present: group`) does the rest.
      return count > MAX_FIGURES_PER_SCENE
        ? used + sceneBudget * (count - MAX_FIGURES_PER_SCENE)
        : used
    }
    const { headingTotal, available, frames, nonFrame, aboveHeight } = figureColumns(blocks, measurements, sceneBudget)
    const columnNeeded = frames + nonFrame
    const columnMinimum = frames * MIN_FRAME_SHRINK + nonFrame
    const figureColumn = Math.min(columnNeeded, Math.max(available, columnMinimum))
    const effectiveAbove = Math.min(aboveHeight, Math.max(available, aboveHeight * MIN_TEXT_SCALE))
    return headingTotal + Math.max(figureColumn, effectiveAbove)
  }
  return blocks.reduce((total, block) => total + blockHeight(block, measurements, sceneBudget), 0) + Math.max(0, blocks.length - 1) * 20
}
```

**Step 6: Publish the column count on the scene**

In `src/engine/types.ts:132`, add to `Scene` right after `figureTextScale`:

```ts
  /** Column count for a multi-figure grid scene; absent for the v5 single-figure layout. */
  figureColumns?: number
```

In `src/engine/planner.ts`, inside `makeScene`'s returned object (near line 320, beside `figureTextScale: textScale`):

```ts
    figureColumns: figureGridColumns(blocks),
```

Deriving it inside `makeScene` from `blocks` means neither of the two call sites (lines 448 and 506) changes.

**Step 7: Run the tests**

```bash
npx vitest run src/engine/planner.test.ts
```

Expected: the five new cases pass **and every pre-existing planner test still passes**. If a single-figure test regressed, the `count > 1` guard is wrong — fix that rather than the old test.

**Step 8: Typecheck and commit**

```bash
npm run typecheck && npm test
git add src/engine/planner.ts src/engine/planner.test.ts src/engine/types.ts
git commit -m "feat: give multi-figure scenes a grid height model"
```

---

## Task 4: teach the e2e harness to render N figures

The Playwright harness runs the real pipeline in a browser. It currently hardcodes one figure; add a `?figures=N` parameter so the layout specs can drive it. No assertions yet — this task only makes the next one possible.

**Files:**
- Modify: `tests/harness/pipeline/main.tsx`

**Step 1: Replace the `DOC` constant**

```tsx
const figureSize = Number(params.get('size') || 45)
const withHeading = params.get('heading') !== '0'
const figureCount = Math.max(1, Number(params.get('figures') || 1))
const FIGURES = Array.from({ length: figureCount }, (_, index) =>
  `![Figure ${index + 1}](https://img.test/fig${index}.png){size=${figureSize}%}\n\n圖${index + 1}：腎絲球過濾率隨年齡下降（資料來源：NHANES 系列研究）。`,
).join('\n\n')
const DOC = `${withHeading ? '## Renal function\n\n' : ''}腎功能隨年齡下降，本頁說明其臨床意義與判讀重點。

${FIGURES}
`
```

The existing specs pass no `figures` parameter, so they get `figureCount === 1` and the document they already assert on — the legend text stays `圖一：…`? **No:** the template above renders `圖1：…`. Keep the one-figure text identical to today by special-casing it:

```tsx
const legendFor = (index: number) =>
  figureCount === 1 ? '圖一：腎絲球過濾率隨年齡下降（資料來源：NHANES 系列研究）。' : `圖${index + 1}：第 ${index + 1} 組資料。`
```

and use `legendFor(index)` in the template.

**Step 2: Verify the existing specs still pass**

```bash
npm run test:e2e
```

Expected: all current `pipeline.spec.ts` and `markdown-editor.spec.ts` tests pass unchanged.

**Step 3: Commit**

```bash
git add tests/harness/pipeline/main.tsx
git commit -m "test: let the pipeline harness render N figures"
```

---

## Task 5: the failing layout specs

**Files:**
- Modify: `tests/e2e/pipeline.spec.ts`

**Step 1: Write the failing specs**

Append to `tests/e2e/pipeline.spec.ts`:

```ts
test('two figures render side by side with the body text above them', async ({ page }) => {
  await page.goto('/tests/harness/pipeline/?width=640&size=80&figures=2')
  await page.getByTestId('plan-json').waitFor()

  const scene = page.locator('[data-testid="scene-0"]')
  await expect(scene.locator('.figure-gallery')).toHaveCount(1)
  await expect(scene.locator('.figure-cell')).toHaveCount(2)
  await expect(scene.locator('.figure-col')).toHaveCount(0)

  const text = await scene.locator('.figure-gallery-text').boundingBox()
  const [left, right] = await scene.locator('.figure-cell').all()
  const leftBox = await left.boundingBox()
  const rightBox = await right.boundingBox()

  // Side by side: same row, different columns.
  expect(Math.abs(leftBox!.y - rightBox!.y)).toBeLessThan(2)
  expect(rightBox!.x).toBeGreaterThan(leftBox!.x + leftBox!.width - 1)
  // Body text sits above the grid, full width.
  expect(leftBox!.y).toBeGreaterThanOrEqual(text!.y + text!.height - 1)
  expect(text!.width).toBeGreaterThan(leftBox!.width * 1.8)
})

test('each cell keeps its own legend', async ({ page }) => {
  await page.goto('/tests/harness/pipeline/?width=640&size=80&figures=2')
  await page.getByTestId('plan-json').waitFor()

  const cells = page.locator('[data-testid="scene-0"] .figure-cell')
  await expect(cells.nth(0).locator('.figure-below-caption')).toContainText('第 1 組')
  await expect(cells.nth(1).locator('.figure-below-caption')).toContainText('第 2 組')
  await expect(cells.nth(0).locator('.figure-below-caption')).not.toContainText('第 2 組')
})

test('four figures fall into a 2 x 2 quadrant', async ({ page }) => {
  await page.goto('/tests/harness/pipeline/?width=640&size=80&figures=4')
  await page.getByTestId('plan-json').waitFor()

  const boxes = await Promise.all(
    (await page.locator('[data-testid="scene-0"] .figure-cell').all()).map((cell) => cell.boundingBox()),
  )
  expect(boxes).toHaveLength(4)
  const rows = [...new Set(boxes.map((box) => Math.round(box!.y / 5)))]
  const columns = [...new Set(boxes.map((box) => Math.round(box!.x / 5)))]
  expect(rows).toHaveLength(2)
  expect(columns).toHaveLength(2)
})

test('three figures share one row', async ({ page }) => {
  await page.goto('/tests/harness/pipeline/?width=640&size=80&figures=3')
  await page.getByTestId('plan-json').waitFor()

  const boxes = await Promise.all(
    (await page.locator('[data-testid="scene-0"] .figure-cell').all()).map((cell) => cell.boundingBox()),
  )
  expect(boxes).toHaveLength(3)
  expect([...new Set(boxes.map((box) => Math.round(box!.y / 5)))]).toHaveLength(1)
})

test('a lone figure keeps the v5 figure-left layout', async ({ page }) => {
  // Regression fence for the single-figure path.
  await page.goto('/tests/harness/pipeline/?width=640&size=45')
  await page.getByTestId('plan-json').waitFor()

  await expect(page.locator('[data-testid="scene-0"] .figure-col')).toHaveCount(1)
  await expect(page.locator('[data-testid="scene-0"] .figure-gallery')).toHaveCount(0)
})
```

**Step 2: Run them to verify they fail**

```bash
npx playwright test tests/e2e/pipeline.spec.ts
```

Expected: the four new grid specs FAIL (`.figure-gallery` resolves to 0 elements); the single-figure regression spec PASSES already.

**Step 3: Commit the failing specs**

```bash
git add tests/e2e/pipeline.spec.ts
git commit -m "test: specify the multi-figure grid layout"
```

---

## Task 6: render the gallery

**Files:**
- Modify: `src/components/SceneView.tsx:313-398`

**Step 1: Import the helper and replace the derivation**

Replace lines 316-322:

```tsx
  const visibleFigures = content.filter((block) => block.type === 'figure')
  const prose = content.filter((block) => block.type !== 'figure')
  const firstFigureIndex = scene.blocks.findIndex((block) => block.type === 'figure')
  const aboveProse = prose.filter((block) => scene.blocks.indexOf(block) < firstFigureIndex)
  const belowProse = prose.filter((block) => scene.blocks.indexOf(block) > firstFigureIndex)
  const [figureImageWidth, setFigureImageWidth] = useState<number | null>(null)
  useEffect(() => setFigureImageWidth(null), [scene.id])
```

with:

```tsx
  // One rule, shared with the planner: prose before the first figure is body
  // copy, prose after a figure is that figure's legend.
  const { bodyText, cells } = figureCells(scene.blocks)
  const isGallery = scene.layout === 'figure' && cells.length > 1
  const visibleFigures = cells.map((cell) => cell.figure)
  const aboveProse = bodyText
  const belowProse = cells[0]?.legend ?? []
  const [figureImageWidth, setFigureImageWidth] = useState<number | null>(null)
  useEffect(() => setFigureImageWidth(null), [scene.id])
```

Add `figureCells` to the existing import from `../engine/planner` (add the import if `SceneView.tsx` has none yet — check the top of the file; it currently imports only from `../engine/types`).

**Step 2: Add the `FigureCell` component**

Below `FigureFrameArea` (after line 120):

```tsx
// Each grid cell owns its own frame-area measurement and its own image width.
// Sharing SceneView's single figureImageWidth across cells would set every
// caption to the widest image's width, and --frame-area-height must be per
// cell or `size=NN%` resolves against the wrong box.
function FigureCell({ figure, legend, revealIndex, measurement }: {
  figure: PresentationBlock
  legend: PresentationBlock[]
  revealIndex?: number
  measurement: boolean
}) {
  const [imageWidth, setImageWidth] = useState<number | null>(null)
  return (
    <div className="figure-cell" style={imageWidth ? { '--figure-width': `${imageWidth}px` } as CSSProperties : undefined}>
      <FigureFrameArea onImageWidth={setImageWidth}>
        <BlockView block={figure} revealIndex={revealIndex} measurement={measurement} />
      </FigureFrameArea>
      {legend.length > 0 && (
        <div className="figure-below-caption">
          {legend.map((block) => <BlockView key={block.id} block={block} revealIndex={revealIndex} measurement={measurement} />)}
        </div>
      )}
    </div>
  )
}
```

**Step 3: Branch the render**

Replace the `scene.layout === 'figure' ? (...)` block (lines 385-395) with:

```tsx
        {isGallery ? (
          <div className="figure-gallery" style={{ '--figure-cols': scene.figureColumns ?? 2 } as CSSProperties}>
            {!!bodyText.length && (
              <div className="figure-gallery-text" style={scene.figureTextScale ? { '--figure-text-scale': scene.figureTextScale } as CSSProperties : undefined}>
                {renderBlocks(bodyText)}
              </div>
            )}
            <div className="figure-gallery-grid">
              {cells.map((cell) => (
                <FigureCell key={cell.figure.id} figure={cell.figure} legend={cell.legend} revealIndex={revealIndex} measurement={measurement} />
              ))}
            </div>
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
```

**Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: clean. `content` is still used by the `prose-flow` branch, so no unused-variable error; if oxlint flags one, delete the dead binding rather than silencing the rule.

**Step 5: Commit (specs still fail — CSS comes next)**

```bash
git add src/components/SceneView.tsx
git commit -m "feat: render multi-figure scenes as a cell grid"
```

---

## Task 7: the grid CSS

**Files:**
- Modify: `src/scene-theme.css:324-346`

**Step 1: Widen the shared figure rules**

The frame, image, and caption rules apply to a cell exactly as they do to the single-figure column. Change the selectors in place (lines 330-334) from `.figure-col X` to `.figure-col X, .figure-cell X`:

```css
.figure-col .block-figure, .figure-cell .block-figure { height: 100%; display: flex; flex-direction: column; justify-content: center; min-height: 0; min-width: 0; }
.figure-col .figure-frame, .figure-cell .figure-frame { width: auto; height: var(--figure-height, 60%); max-height: 100%; min-height: calc(var(--figure-height, 60%) * 0.75); flex: 0 1 auto; aspect-ratio: auto; background: transparent; }
.figure-col .figure-frame img, .figure-cell .figure-frame img { width: auto; height: 100%; max-width: 100%; margin: 0 auto; object-fit: contain; }
.figure-col figcaption, .figure-cell figcaption { flex: 0 0 auto; width: var(--figure-width, auto); max-width: 100%; margin-right: auto; margin-left: auto; overflow-wrap: break-word; }
```

**Step 2: Add the gallery rules**

Insert after the `.figure-text-col` rules (after line 344):

```css
/* Multi-figure scenes (design 2026-08-15): body text is a full-width row above
   a balanced grid, and each cell owns its own frame area and legend. */
.figure-gallery { flex: 1; display: flex; flex-direction: column; gap: 1.4cqw; min-width: 0; min-height: 0; }
.figure-gallery-text { flex: 0 0 auto; display: flex; flex-direction: column; gap: 1.05cqw; }
.figure-gallery-text > p { margin: 0; }
.figure-gallery-text p,
.figure-gallery-text li { font-size: calc(2.083cqw * var(--figure-text-scale, 1)); }
.figure-gallery-grid {
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: repeat(var(--figure-cols, 2), minmax(0, 1fr));
  /* Equal rows are what makes the renderer agree with the planner's rowSlot. */
  grid-auto-rows: 1fr;
  gap: 1.6cqw 2.2cqw;
  min-height: 0;
}
.figure-cell { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.figure-cell .figure-frame-area { flex: 1 1 auto; }
```

**Step 3: Run the layout specs**

```bash
npx playwright test tests/e2e/pipeline.spec.ts
```

Expected: all specs pass, including the four new grid ones and the single-figure fence.

**Step 4: Run the contrast test**

`src/scene-theme.contrast.test.ts` parses this stylesheet; a malformed rule breaks it.

```bash
npm test
```

Expected: all pass.

**Step 5: Look at it**

```bash
npm run dev
```

Open the editor and paste:

```markdown
## 治療前後對照

本頁比較治療前後的影像表現。

![CT before](https://placehold.co/800x600/png){size=80%}

圖一：治療前。

![CT after](https://placehold.co/800x600/png){size=80%}

圖二：治療後。
```

Check by eye: images the same height, legends under their own image, body text full width above, nothing clipped. Repeat with 3 and 4 figures. Layout work is verified visually, not only by geometry assertions.

**Step 6: Commit**

```bash
git add src/scene-theme.css
git commit -m "feat: lay out the multi-figure grid"
```

---

## Task 8: smoke script and docs

**Files:**
- Modify: `tools/browser-check.mjs`
- Modify: `CLAUDE.md`
- Modify: `docs/plans/2026-08-14-image-config-design.md`

**Step 1: Add the smoke assertion**

`tools/browser-check.mjs` asserts on DOM selectors. Add `.figure-gallery` to whatever selector list covers figure scenes, following the file's existing pattern. Read the file first — do not invent a new assertion style.

**Step 2: Fix the stale CLAUDE.md claims**

Two edits:

- Replace "There is **no test runner in this repo**. CI (`.github/workflows/ci.yml`) is exactly `npm ci && npm run typecheck && npm run build`" with the truth: vitest runs under `npm test` over `src/**/*.test.ts`, `worker/**`, and `functions/**`; Playwright runs under `npm run test:e2e` against `tests/harness/`. Check `.github/workflows/ci.yml` and describe what it *actually* runs.
- In the "Figure scenes have exactly one layout (design v5…)" paragraph, add: a scene with two or more figures instead lays out as a full-width body-text row above a balanced grid (≤3 columns, ≤6 figures), each figure owning the paragraphs that immediately follow it — see `docs/plans/2026-08-15-multi-figure-grid-design.md`.

**Step 3: Cross-reference the v5 design doc**

Add a line at the top of `docs/plans/2026-08-14-image-config-design.md` noting that the single-layout rule is amended by the 2026-08-15 design for multi-figure scenes.

**Step 4: Full verification**

```bash
npm run typecheck && npm run lint && npm test && npm run test:e2e && npm run build
```

Expected: all green.

**Step 5: Commit**

```bash
git add tools/browser-check.mjs CLAUDE.md docs/plans/2026-08-14-image-config-design.md
git commit -m "docs: record the multi-figure grid layout and the real test setup"
```

---

## Task 9: open the PR

```bash
git push -u origin feat/multi-figure-grid
gh pr create --base main --title "feat: lay out multi-figure scenes as a grid" --body "..."
```

The PR body should say **why**: two images on one scene currently stack in a narrow column beside the text, which is the worst use of a 16:9 frame for an A/B comparison. Link the design doc. Note the deliberate limits (3 columns, 6 figures) and that single-figure scenes are unchanged, with both a unit and an e2e regression fence proving it.

---

## Definition of done

- [ ] `npm test` green, including every pre-existing planner test
- [ ] `npm run test:e2e` green, including the single-figure regression fence
- [ ] `npm run typecheck` (both projects) and `npm run lint` clean
- [ ] `npm run build` succeeds
- [ ] 2-, 3-, and 4-figure scenes inspected by eye in `npm run dev`
- [ ] CLAUDE.md no longer claims there is no test runner
