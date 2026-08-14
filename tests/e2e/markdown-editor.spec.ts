import { expect, test } from '@playwright/test'

// Line numbers below match INITIAL_MARKDOWN in tests/harness/main.tsx.

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test.beforeEach(async ({ page }) => {
  await page.route('https://img.test/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: ONE_PIXEL_PNG }),
  )
  await page.goto('/tests/harness/')
  await expect(page.locator('.cm-content')).toBeVisible()
  await expect(page.locator('.cm-image-preview')).toHaveCount(3)
})

test('clicking a legend paragraph below image previews selects that line', async ({ page }) => {
  await page.locator('.cm-line', { hasText: 'Legend two explains' }).click()
  await expect(page.locator('.markdown-statusbar')).toContainText('Ln 11,')

  await page.locator('.cm-line', { hasText: 'Closing paragraph' }).click()
  await expect(page.locator('.markdown-statusbar')).toContainText('Ln 13,')
})

test('keyboard cursor motion through image syntax does not open the popover', async ({ page }) => {
  await page.locator('.cm-line', { hasText: 'Intro paragraph' }).click()
  await expect(page.locator('.markdown-statusbar')).toContainText('Ln 3,')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.markdown-statusbar')).toContainText('Ln 5,')
  await expect(page.locator('.image-syntax-popover')).toHaveCount(0)
})

test('clicking inside image syntax opens the popover', async ({ page }) => {
  await page.locator('.cm-line', { hasText: '![First figure]' }).click({ position: { x: 40, y: 16 } })
  await expect(page.locator('.image-syntax-popover')).toBeVisible()
  await expect(page.locator('.image-syntax-popover')).toContainText('Marpit syntax')
})

test('the popover reads and rewrites the same-paragraph legend', async ({ page }) => {
  await page.locator('.cm-line', { hasText: '![Second figure]' }).click({ position: { x: 40, y: 16 } })
  const popover = page.locator('.image-syntax-popover')
  await expect(popover).toBeVisible()

  const legendField = popover.getByLabel('Legend text')
  await expect(legendField).toHaveValue('')
  await legendField.fill('圖二：新的 legend 文字')
  await popover.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.cm-content')).toContainText(
    '![Second figure](https://img.test/two.png) 圖二：新的 legend 文字',
  )

  // Reopening the popover reads the saved legend back.
  await page.locator('.cm-line', { hasText: '![Second figure]' }).click({ position: { x: 40, y: 16 } })
  await expect(popover.getByLabel('Legend text')).toHaveValue('圖二：新的 legend 文字')
})

test('the popover round-trips hybrid attribute syntax', async ({ page }) => {
  await page.locator('.cm-line', { hasText: '![Hybrid chart]' }).click({ position: { x: 40, y: 16 } })
  const popover = page.locator('.image-syntax-popover')
  await expect(popover).toBeVisible()

  // Bracket text is verbatim alt; config comes from the {…} block; the legend
  // excludes the attribute block.
  await expect(popover.getByLabel('Alt text')).toHaveValue('Hybrid chart')
  await expect(popover.getByLabel('Width')).toHaveValue('40%')
  await expect(popover.getByLabel('Legend text')).toHaveValue('Hybrid legend text.')

  await popover.getByLabel('Width').fill('55%')
  await popover.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.cm-content')).toContainText(
    '![Hybrid chart](https://img.test/three.png){width=55%} Hybrid legend text.',
  )
})

test('an external value update keeps the cursor where it was', async ({ page }) => {
  await page.locator('.cm-line', { hasText: 'Legend two explains' }).click()
  await expect(page.locator('.markdown-statusbar')).toContainText('Ln 11,')

  await page.getByTestId('external-append').click()
  await expect(page.locator('.cm-content')).toContainText('Appended by external sync.')
  // The old whole-document replacement mapped the selection to offset 0 (Ln 1).
  await expect(page.locator('.markdown-statusbar')).toContainText('Ln 11,')
})
