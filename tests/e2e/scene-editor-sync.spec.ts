import { expect, test } from '@playwright/test'

// The other e2e specs drive tests/harness/, which mounts one component. This
// one drives the real app, because the behaviour under test lives in the wiring
// between them: App arms an editor scroll request when the author picks a
// scene, and MarkdownEditor consumes it. The document API is stubbed so the
// route loads without Cloudflare bindings.
const LONG_MARKDOWN = [
  '# Scene sync',
  '',
  ...Array.from({ length: 60 }, (_, index) => [
    `## Section ${index + 1}`,
    '',
    `Paragraph body for section ${index + 1}.`,
    '',
  ]).flat(),
].join('\n')

test.beforeEach(async ({ page }) => {
  await page.route('**/api/documents/sync-spec', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: 'sync-spec', title: 'Scene sync', markdown: LONG_MARKDOWN, revision: 1 }),
  }))
  await page.route('**/api/**', (route) => route.request().url().includes('/documents/sync-spec')
    ? route.fallback()
    : route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))

  await page.goto('/document/sync-spec')
  await expect(page.locator('.cm-content')).toBeVisible()
  await page.getByRole('button', { name: /presentation preview/i }).click()
  await expect(page.locator('.scene-dots button').nth(20)).toBeVisible()
})

const editorScrollTop = (page: import('@playwright/test').Page) =>
  page.locator('.cm-scroller').evaluate((node) => node.scrollTop)

test('picking a scene scrolls the editor to it, every time', async ({ page }) => {
  await page.locator('.scene-dots button').nth(20).click()
  await expect.poll(() => editorScrollTop(page)).toBeGreaterThan(1000)
  const atLateScene = await editorScrollTop(page)

  await page.locator('.scene-dots button').nth(5).click()
  await expect.poll(() => editorScrollTop(page)).toBeLessThan(atLateScene)

  // Re-picking a scene must scroll again — the request carries a fresh key.
  await page.locator('.scene-dots button').nth(20).click()
  await expect.poll(() => editorScrollTop(page)).toBeGreaterThan(1000)
})

test('typing after picking a scene leaves the editor where the author is', async ({ page }) => {
  await page.locator('.scene-dots button').nth(2).click()
  await expect.poll(() => editorScrollTop(page)).toBeLessThan(600)

  // Scroll away from the picked scene and edit there.
  await page.locator('.cm-scroller').evaluate((node) => { node.scrollTop = node.scrollHeight - node.clientHeight })
  await page.locator('.cm-line').filter({ hasText: 'Paragraph body' }).last().click()
  const before = await editorScrollTop(page)
  expect(before).toBeGreaterThan(1000)

  // The satisfied request used to fire again on every document change, so the
  // first Enter threw the author back to the picked scene's line.
  await page.keyboard.press('Enter')
  await page.keyboard.type('typed after the line break')
  await expect.poll(() => editorScrollTop(page)).toBeGreaterThan(before - 120)
})
