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
})

test('a paragraph below a sized figure shares its scene in a short viewport', async ({ page }) => {
  await page.goto('/tests/harness/pipeline/?width=640')
  const planText = await page.getByTestId('plan-json').innerText()
  const plan = JSON.parse(planText) as PlanJson

  // Pre-v2, the figure's stale measured height made every multi-block
  // candidate overflow and the paragraph was stranded on a second scene.
  expect(plan.scenes).toHaveLength(1)
  expect(plan.scenes[0].layout).toBe('legend')
  expect(plan.scenes[0].blocks.map((block) => block.type)).toEqual(['heading', 'figure', 'paragraph', 'paragraph'])

  // Stage 2: figures carry an automatic number rendered with the legend.
  await expect(page.locator('[data-testid="scene-0"] .legend-caption .figure-caption-number')).toHaveText('Fig. 1')
})

test('the rendered figure honors size as a fraction of the scene height', async ({ page }) => {
  await page.goto('/tests/harness/pipeline/?width=640')
  const plan = JSON.parse(await page.getByTestId('plan-json').innerText()) as PlanJson
  const frame = page.locator('[data-testid="scene-0"] .figure-frame')
  const box = await frame.boundingBox()
  const expected = 0.45 * plan.viewport.height
  // Planner arithmetic and CSS rendering must agree on what size=45% means.
  expect(Math.abs((box?.height ?? 0) - expected)).toBeLessThan(10)
})
