import { expect, test } from '@playwright/test'

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

interface PlanJson {
  viewport: { width: number; height: number }
  scenes: Array<{ layout: string; fillRatio: number; blocks: Array<{ type: string }> }>
}

test.beforeEach(async ({ page }) => {
  await page.route('https://img.test/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: ONE_PIXEL_PNG }),
  )
  await page.goto('/tests/harness/pipeline/?width=640')
  await page.getByTestId('plan-json').waitFor()
})

test('a figure page keeps its structure: body above, figure, legend below', async ({ page }) => {
  const plan = JSON.parse(await page.getByTestId('plan-json').innerText()) as PlanJson

  expect(plan.scenes).toHaveLength(1)
  expect(plan.scenes[0].layout).toBe('figure')
  expect(plan.scenes[0].blocks.map((block) => block.type)).toEqual(['heading', 'paragraph', 'figure', 'paragraph'])

  // Position decides the role: above-prose lands in the text column, the
  // below-paragraph renders as the legend under the image.
  await expect(page.locator('[data-testid="scene-0"] .figure-text-col')).toContainText('臨床意義')
  await expect(page.locator('[data-testid="scene-0"] .figure-below-caption')).toContainText('圖一：腎絲球過濾率')
  await expect(page.locator('[data-testid="scene-0"] .figure-text-col')).not.toContainText('圖一')
})

test('with an H2, a size=100% figure stays below the heading', async ({ page }) => {
  await page.goto('/tests/harness/pipeline/?width=640&size=100')
  await page.getByTestId('plan-json').waitFor()
  const plan = JSON.parse(await page.getByTestId('plan-json').innerText()) as PlanJson
  expect(plan.scenes).toHaveLength(1)

  const heading = await page.locator('[data-testid="scene-0"] .scene-heading').boundingBox()
  const frame = await page.locator('[data-testid="scene-0"] .figure-frame').boundingBox()
  const caption = await page.locator('[data-testid="scene-0"] .figure-below-caption').boundingBox()
  // The figure's maximum extent is the height remaining under the H2: the
  // frame starts below the heading and still leaves room for the legend.
  expect(frame!.y).toBeGreaterThanOrEqual(heading!.y + heading!.height - 1)
  expect(caption!.y).toBeGreaterThanOrEqual(frame!.y + frame!.height - 1)
})

test('without the H2 the figure gets the extra height', async ({ page }) => {
  await page.goto('/tests/harness/pipeline/?width=640&size=100')
  await page.getByTestId('plan-json').waitFor()
  const withHeading = await page.locator('[data-testid="scene-0"] .figure-frame').boundingBox()

  await page.goto('/tests/harness/pipeline/?width=640&size=100&heading=0')
  await page.getByTestId('plan-json').waitFor()
  await expect(page.locator('[data-testid="scene-0"] .scene-heading')).toHaveCount(0)
  const withoutHeading = await page.locator('[data-testid="scene-0"] .figure-frame').boundingBox()

  expect(withoutHeading!.height).toBeGreaterThan(withHeading!.height + 10)
})

test('a long legend wraps at the image width instead of stretching the column', async ({ page }) => {
  // 文字配合圖片寬: the caption's width equals the image's displayed width.
  await page.goto('/tests/harness/pipeline/?width=640&size=45')
  await page.getByTestId('plan-json').waitFor()
  const image = page.locator('[data-testid="scene-0"] .figure-frame img')
  const caption = page.locator('[data-testid="scene-0"] .figure-below-caption')
  // Wrapping feeds back into the area height for a few ResizeObserver rounds;
  // poll until the widths agree.
  await expect.poll(async () => {
    const imageBox = await image.boundingBox()
    const captionBox = await caption.boundingBox()
    if (!imageBox || !captionBox) return Number.POSITIVE_INFINITY
    return Math.abs(captionBox.width - imageBox.width)
  }).toBeLessThan(4)
})

test('the rendered figure honors size as a fraction of the figure column', async ({ page }) => {
  // design v5: size% resolves against the figure column — the height left
  // under the heading — so the layout itself does the arithmetic.
  // Frame height is published through --frame-area-height by a ResizeObserver,
  // so it settles over a few frames; poll rather than sampling once.
  await expect.poll(async () => {
    const frame = await page.locator('[data-testid="scene-0"] .figure-frame').boundingBox()
    const column = await page.locator('[data-testid="scene-0"] .figure-col .block-figure').boundingBox()
    if (!frame || !column || column.height < 50) return Number.POSITIVE_INFINITY
    return Math.abs(frame.height - 0.45 * column.height)
  }).toBeLessThan(10)
})

// The multi-figure specs use a wider stage: the default 640px harness gives a
// 360px-tall scene, too short for two rows of figures, so the planner would
// (correctly) break them across scenes before the grid could be observed.
const GRID_STAGE = '/tests/harness/pipeline/?width=1280&size=80'
const gridScene = (page: import('@playwright/test').Page) =>
  page.locator('article:has(.figure-gallery)').first()

test('two figures render side by side with the body text above them', async ({ page }) => {
  await page.goto(`${GRID_STAGE}&figures=2`)
  await page.getByTestId('plan-json').waitFor()

  const scene = gridScene(page)
  await expect(scene.locator('.figure-cell')).toHaveCount(2)
  await expect(scene.locator('.figure-col')).toHaveCount(0)

  // Poll: cell geometry settles across a few ResizeObserver rounds.
  await expect.poll(async () => {
    const text = await scene.locator('.figure-gallery-text').boundingBox()
    const [left, right] = await scene.locator('.figure-cell').all()
    const leftBox = await left?.boundingBox()
    const rightBox = await right?.boundingBox()
    if (!text || !leftBox || !rightBox) return null
    return {
      sameRow: Math.abs(leftBox.y - rightBox.y) < 2,
      sideBySide: rightBox.x > leftBox.x + leftBox.width - 1,
      textAbove: leftBox.y >= text.y + text.height - 1,
      textSpansGrid: text.width > leftBox.width * 1.8,
    }
  }).toEqual({ sameRow: true, sideBySide: true, textAbove: true, textSpansGrid: true })
})

test('each cell keeps its own legend', async ({ page }) => {
  await page.goto(`${GRID_STAGE}&figures=2`)
  await page.getByTestId('plan-json').waitFor()

  const cells = gridScene(page).locator('.figure-cell')
  await expect(cells.nth(0).locator('.figure-below-caption')).toContainText('第 1 組')
  await expect(cells.nth(1).locator('.figure-below-caption')).toContainText('第 2 組')
  await expect(cells.nth(0).locator('.figure-below-caption')).not.toContainText('第 2 組')
})

const distinct = (values: number[]) => [...new Set(values.map((value) => Math.round(value / 5)))].length
// Poll the whole shape at once: cell boxes settle across ResizeObserver rounds,
// so a single sample can catch the grid mid-layout.
const gridShape = (page: import('@playwright/test').Page) => expect.poll(async () => {
  const cells = await gridScene(page).locator('.figure-cell').all()
  const boxes = await Promise.all(cells.map((cell) => cell.boundingBox()))
  if (boxes.some((box) => !box)) return null
  return {
    cells: boxes.length,
    rows: distinct(boxes.map((box) => box!.y)),
    columns: distinct(boxes.map((box) => box!.x)),
  }
})

test('three figures share one row', async ({ page }) => {
  await page.goto(`${GRID_STAGE}&figures=3`)
  await page.getByTestId('plan-json').waitFor()
  await gridShape(page).toEqual({ cells: 3, rows: 1, columns: 3 })
})

test('four figures fall into a 2 x 2 quadrant', async ({ page }) => {
  await page.goto(`${GRID_STAGE}&figures=4`)
  await page.getByTestId('plan-json').waitFor()
  await gridShape(page).toEqual({ cells: 4, rows: 2, columns: 2 })
})

test('a lone figure keeps the v5 figure-left layout', async ({ page }) => {
  // Regression fence for the single-figure path.
  await page.goto('/tests/harness/pipeline/?width=640&size=45')
  await page.getByTestId('plan-json').waitFor()

  await expect(page.locator('[data-testid="scene-0"] .figure-col')).toHaveCount(1)
  await expect(page.locator('[data-testid="scene-0"] .figure-gallery')).toHaveCount(0)
})
