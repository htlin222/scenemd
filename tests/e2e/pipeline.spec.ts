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

test('the rendered figure honors size as a fraction of the figure column', async ({ page }) => {
  const frame = await page.locator('[data-testid="scene-0"] .figure-frame').boundingBox()
  const column = await page.locator('[data-testid="scene-0"] .figure-col .block-figure').boundingBox()
  // design v5: size% resolves against the figure column — the height left
  // under the heading — so the layout itself does the arithmetic.
  const expected = 0.45 * (column?.height ?? 0)
  expect(column?.height ?? 0).toBeGreaterThan(50)
  expect(Math.abs((frame?.height ?? 0) - expected)).toBeLessThan(10)
})
