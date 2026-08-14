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
  await expect(page.locator('.cm-image-preview')).toHaveCount(2)
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

test('an external value update keeps the cursor where it was', async ({ page }) => {
  await page.locator('.cm-line', { hasText: 'Legend two explains' }).click()
  await expect(page.locator('.markdown-statusbar')).toContainText('Ln 11,')

  await page.getByTestId('external-append').click()
  await expect(page.locator('.cm-content')).toContainText('Appended by external sync.')
  // The old whole-document replacement mapped the selection to offset 0 (Ln 1).
  await expect(page.locator('.markdown-statusbar')).toContainText('Ln 11,')
})
