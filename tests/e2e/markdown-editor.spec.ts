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
  await expect(page.locator('.figure-dialog')).toHaveCount(0)
})

test('clicking inside image syntax opens the popover', async ({ page }) => {
  await page.locator('.cm-line', { hasText: '![First figure]' }).click({ position: { x: 40, y: 16 } })
  await expect(page.locator('.figure-dialog')).toBeVisible()
  await expect(page.locator('.figure-dialog')).toContainText('Figure')
  // The canvas renders the figure's whole page from the live document, so
  // neighboring content shows for relative-size feedback while dragging.
  await expect(page.locator('.figure-dialog-canvas')).toContainText('Legend one explains the first figure')
})

test('saving the dialog keeps the caption and normalizes legacy options away', async ({ page }) => {
  // design v5: the dialog edits only the figure; the caption survives, and
  // retired options like width normalize out of the syntax on save.
  await page.locator('.cm-line', { hasText: '![Hybrid chart]' }).click({ position: { x: 40, y: 16 } })
  const dialog = page.locator('.figure-dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.cm-content')).toContainText(
    '![Hybrid chart](https://img.test/three.png) Hybrid legend text.',
  )
})

test('the popover round-trips hybrid attribute syntax', async ({ page }) => {
  await page.locator('.cm-line', { hasText: '![Hybrid chart]' }).click({ position: { x: 40, y: 16 } })
  const popover = page.locator('.figure-dialog')
  await expect(popover).toBeVisible()

  // Bracket text is verbatim alt; size is the only writable config.
  await expect(popover.getByLabel('Alt text')).toHaveValue('Hybrid chart')

  await popover.getByPlaceholder('e.g. 45%').fill('55%')
  await popover.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.cm-content')).toContainText(
    '![Hybrid chart](https://img.test/three.png){size=55%} Hybrid legend text.',
  )
})

test('dragging the size handle moves size by the dragged fraction of the frame area', async ({ page }) => {
  await page.locator('.cm-line', { hasText: '![Hybrid chart]' }).click({ position: { x: 40, y: 16 } })
  const dialog = page.locator('.figure-dialog')
  await expect(dialog).toBeVisible()

  // `size` is a percentage of the frame area — what --frame-area-height
  // resolves against — not of the canvas. Dragging a fifth of that area must
  // move size by about twenty points, whatever the surrounding layout is.
  const area = await dialog.locator('.figure-frame-area').first().boundingBox()
  const handle = await dialog.locator('.figure-size-handle').boundingBox()
  expect(area && handle).toBeTruthy()
  const startX = handle!.x + handle!.width / 2
  const startY = handle!.y + handle!.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX, startY + area!.height * 0.2, { steps: 5 })
  await page.mouse.up()

  const shown = Number.parseInt((await dialog.locator('.figure-size-handle').innerText()).replace('%', ''), 10)
  expect(Math.abs(shown - 75)).toBeLessThanOrEqual(4)

  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.cm-content')).toContainText(/\{size=7\d%\} Hybrid legend text\./)
})

test('the size handle drags all the way to full bleed', async ({ page }) => {
  await page.locator('.cm-line', { hasText: '![Hybrid chart]' }).click({ position: { x: 40, y: 16 } })
  const dialog = page.locator('.figure-dialog')
  await expect(dialog).toBeVisible()

  const canvas = await dialog.locator('.figure-dialog-canvas').boundingBox()
  const handle = await dialog.locator('.figure-size-handle').boundingBox()
  const startX = handle!.x + handle!.width / 2
  const startY = handle!.y + handle!.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX, startY + canvas!.height * 1.2, { steps: 5 })
  await page.mouse.up()
  await expect(dialog.locator('.figure-size-handle')).toHaveText('100%')

  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.cm-content')).toContainText('{size=100%} Hybrid legend text.')
})

test('the size field says which basis the percentage is against', async ({ page }) => {
  // The harness document has three figures on one page, so size is a
  // fraction of the figure's own cell — the label must not claim "scene".
  await page.locator('.cm-line', { hasText: '![Hybrid chart]' }).click({ position: { x: 40, y: 16 } })
  await expect(page.locator('.figure-dialog')).toContainText('Size (cell %, 3-up grid)')
})

test('an external value update keeps the cursor where it was', async ({ page }) => {
  await page.locator('.cm-line', { hasText: 'Legend two explains' }).click()
  await expect(page.locator('.markdown-statusbar')).toContainText('Ln 11,')

  await page.getByTestId('external-append').click()
  await expect(page.locator('.cm-content')).toContainText('Appended by external sync.')
  // The old whole-document replacement mapped the selection to offset 0 (Ln 1).
  await expect(page.locator('.markdown-statusbar')).toContainText('Ln 11,')
})

test('a satisfied scroll request is not replayed by later edits', async ({ page }) => {
  // App arms a scroll request whenever the author picks a scene in the
  // preview. The request is a one-shot command — once the editor has jumped
  // to that line, typing somewhere else must leave the view where it is.
  await page.getByTestId('load-tall').click()
  await expect(page.locator('.cm-content')).toContainText('Tall harness')
  await page.getByTestId('scroll-request').click()
  const scroller = page.locator('.cm-scroller')
  const scrollTop = () => scroller.evaluate((node) => node.scrollTop)
  await expect.poll(scrollTop).toBeLessThan(60)

  // Scroll away, put the cursor at the bottom of the document, and edit.
  await scroller.evaluate((node) => { node.scrollTop = node.scrollHeight - node.clientHeight })
  await page.locator('.cm-line', { hasText: 'Filler line 90.' }).click()
  const before = await scrollTop()
  expect(before).toBeGreaterThan(400)

  await page.keyboard.press('Enter')
  await expect(page.locator('.markdown-statusbar')).toContainText('Ln 94,')
  // The stale request used to fire again here and yank the editor back to
  // line 3 — which reads as "pressing Enter scrolls the view to the top".
  await expect.poll(scrollTop).toBeGreaterThan(before - 120)
})
