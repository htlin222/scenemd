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

test('a long legend wraps at the image width instead of widening the column', async ({ page }) => {
  // 圖片的大小是寬度限制：the caption must not contribute to the fit-content
  // column width — it wraps within the frame's width.
  await page.goto('/tests/harness/pipeline/?width=640&size=45')
  await page.getByTestId('plan-json').waitFor()
  const frame = page.locator('[data-testid="scene-0"] .figure-frame')
  const caption = page.locator('[data-testid="scene-0"] .figure-below-caption')
  // The layout converges over a few ResizeObserver rounds (caption wraps →
  // area height settles → frame width settles), so poll until stable.
  // The harness image is 1×1, so the displayed width equals the frame height;
  // the column (and the caption) must hug that, not the caption's text width.
  await expect.poll(async () => {
    const f = await frame.boundingBox()
    return Math.abs(f!.width - f!.height)
  }).toBeLessThan(12)
  const f = await frame.boundingBox()
  const c = await caption.boundingBox()
  expect(c!.width).toBeLessThanOrEqual(f!.width + 2)
})

test('the rendered figure honors size as a fraction of the figure column', async ({ page }) => {
  const frame = page.locator('[data-testid="scene-0"] .figure-frame')
  const column = page.locator('[data-testid="scene-0"] .figure-col .block-figure')
  // design v5: size% resolves against the figure column — the height left
  // under the heading. Poll until the ResizeObserver rounds converge.
  await expect.poll(async () => {
    const frameBox = await frame.boundingBox()
    const columnBox = await column.boundingBox()
    if (!frameBox || !columnBox || columnBox.height < 50) return Number.POSITIVE_INFINITY
    return Math.abs(frameBox.height - 0.45 * columnBox.height)
  }).toBeLessThan(10)
})
