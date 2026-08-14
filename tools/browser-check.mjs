#!/usr/bin/env node
/**
 * SceneMD end-to-end smoke test. Self-contained: launches the full local stack
 * (wrangler pages dev with the Pages Functions, local D1, local R2, and the
 * DocumentRoom Durable Object via multi-config) plus a headless Chrome, then
 * drives the app over the Chrome DevTools Protocol with no dependencies.
 *
 *   node tools/browser-check.mjs
 *
 * Environment:
 *   SCENEMD_TEST_URL   Use an already-running app instead of starting one.
 *   SCENEMD_CDP_URL    Attach to an already-running Chrome (http://host:port).
 *   CHROME_PATH        Chrome binary (auto-detected otherwise).
 *   SCENEMD_APP_PORT   Port for the launched app (default 8940).
 *   SCENEMD_CDP_PORT   Port for the launched Chrome (default 9222).
 *
 * Requires `npm run build` to have produced dist/ when launching the stack.
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'

const APP_PORT = Number(process.env.SCENEMD_APP_PORT ?? 8940)
const CDP_PORT = Number(process.env.SCENEMD_CDP_PORT ?? 9222)
const baseUrl = process.env.SCENEMD_TEST_URL ?? `http://127.0.0.1:${APP_PORT}`
const cdpBase = process.env.SCENEMD_CDP_URL ?? `http://127.0.0.1:${CDP_PORT}`

const children = []
function cleanup() {
  for (const child of children) {
    try { process.kill(-child.pid, 'SIGTERM') } catch { try { child.kill('SIGTERM') } catch { /* gone */ } }
  }
}
process.on('exit', cleanup)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { cleanup(); process.exit(130) })

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function waitFor(probe, { timeout = 30000, interval = 250, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await probe()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await wait(interval)
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`)
}

function detached(command, args, options = {}) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true, ...options })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})
  children.push(child)
  return child
}

// ── App server ───────────────────────────────────────────────────────────────
if (!process.env.SCENEMD_TEST_URL) {
  if (!existsSync('dist/index.html')) throw new Error('dist/ is missing — run `npm run build` first')
  console.log('· applying local D1 migrations')
  execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'scenemd-documents', '--local'], { stdio: 'inherit' })
  console.log(`· starting wrangler pages dev on :${APP_PORT}`)
  // Both configs in one dev session so the DOCUMENTS binding resolves to a
  // local DocumentRoom instead of "Worker scenemd-live not found".
  //
  // The AI binding is remote-only: wrangler needs Cloudflare credentials for
  // it even in local dev. CI has none, and the smoke test never touches the
  // AI routes, so SCENEMD_NO_AI=1 runs against a generated copy of the worker
  // config with the binding stripped.
  let workerConfig = 'worker/wrangler.jsonc'
  if (process.env.SCENEMD_NO_AI === '1') {
    const config = JSON.parse(readFileSync('worker/wrangler.jsonc', 'utf8'))
    delete config.ai
    workerConfig = 'worker/wrangler.smoke.generated.jsonc'
    writeFileSync(workerConfig, JSON.stringify(config, null, 2))
  }
  detached('npx', ['wrangler', 'pages', 'dev', '-c', 'wrangler.jsonc', '-c', workerConfig, '--port', String(APP_PORT)])
  await waitFor(async () => (await fetch(`${baseUrl}/api/documents`)).ok, { timeout: 90000, interval: 1000, label: 'the app API' })
}

// ── Chrome ───────────────────────────────────────────────────────────────────
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) throw new Error('No Chrome binary found — set CHROME_PATH')
  return found
}

async function cdpTargets() {
  const response = await fetch(`${cdpBase}/json`)
  if (!response.ok) throw new Error(`CDP endpoint answered ${response.status}`)
  return response.json()
}

let launchedChrome = false
try {
  await cdpTargets()
} catch {
  console.log(`· launching headless Chrome on :${CDP_PORT}`)
  detached(chromePath(), [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--user-data-dir=/tmp/scenemd-smoke-profile',
    'about:blank',
  ])
  launchedChrome = true
  await waitFor(cdpTargets, { timeout: 30000, label: 'Chrome DevTools' })
}

const targets = await cdpTargets()
const target = targets.find((entry) => entry.type === 'page')
if (!target) throw new Error('SceneMD browser target not found')

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let id = 0
const pending = new Map()
const browserErrors = []
const failedResources = []
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(message.error.message))
    else resolve(message.result)
  }
  if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails.text)
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') browserErrors.push(message.params.entry.text)
  if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) failedResources.push({ status: message.params.response.status, url: message.params.response.url })
})

function send(method, params = {}) {
  const callId = ++id
  socket.send(JSON.stringify({ id: callId, method, params }))
  return new Promise((resolve, reject) => pending.set(callId, { resolve, reject }))
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
  return response.result.value
}

const waitForPage = (expression, label) => waitFor(() => evaluate(expression), { timeout: 15000, label })

await mkdir('artifacts', { recursive: true })
await send('Runtime.enable')
await send('Log.enable')
await send('Page.enable')
await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: baseUrl })

// ── Document home ────────────────────────────────────────────────────────────
await waitForPage(`Boolean(document.querySelector('.documents-hero h1'))`, 'the document home')
const home = await evaluate(`(() => ({
  title: document.querySelector('.documents-hero h1')?.textContent,
  files: document.querySelectorAll('.document-row').length,
  hasSearch: Boolean(document.querySelector('.document-search input')),
  hasNewDocument: Boolean(document.querySelector('.documents-hero button'))
}))()`)
if (home.title !== 'Your documents' || !home.hasSearch || !home.hasNewDocument) throw new Error(`Document home failed: ${JSON.stringify(home)}`)
const homeShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
await writeFile('artifacts/scenemd-home.png', Buffer.from(homeShot.data, 'base64'))

if (home.files) await evaluate(`document.querySelector('.document-row')?.click()`)
else await evaluate(`document.querySelector('.documents-hero button')?.click()`)

// ── Editor ───────────────────────────────────────────────────────────────────
await waitForPage(`Boolean(document.querySelector('.cm-editor')) && document.querySelectorAll('.markdown-mode-button').length > 0 && [...document.querySelectorAll('.markdown-mode-button')].some((button) => button.textContent?.trim())`, 'the editor with mode tabs')
const editor = await evaluate(`(() => ({
  codeMirror: Boolean(document.querySelector('.cm-editor')),
  sourceLabel: document.querySelector('.cm-content')?.getAttribute('aria-label'),
  toolbarButtons: document.querySelectorAll('.markdown-toolbar button').length,
  modes: [...document.querySelectorAll('.markdown-mode-button')].map((button) => button.textContent?.trim()),
  sceneHeader: Boolean(document.querySelector('.scene-chrome-top'))
}))()`)
if (!editor.codeMirror || editor.sourceLabel !== 'Markdown source' || editor.toolbarButtons < 10 || !editor.modes.includes('Split') || editor.sceneHeader) throw new Error(`Editor failed: ${JSON.stringify(editor)}`)

await evaluate(`[...document.querySelectorAll('.markdown-mode-button')].find((button) => button.textContent?.includes('Split'))?.click()`)
await waitForPage(`Boolean(document.querySelector('.markdown-document-scroll .markdown-document h1'))`, 'the split-mode rendered Markdown')

// ── Clipboard image upload to R2 ─────────────────────────────────────────────
// Portrait (200×800) rather than square: the bg bleed layout sizes the panel
// from the image's aspect ratio, and a square would hide ratio mistakes.
const pasteDispatched = await evaluate(`(async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 200
  canvas.height = 800
  const context = canvas.getContext('2d')
  context.fillStyle = '#33475b'
  context.fillRect(0, 0, 200, 800)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  const file = new File([blob], 'clipboard-image.png', { type: 'image/png' })
  const transfer = new DataTransfer()
  transfer.items.add(file)
  return document.querySelector('.cm-content')?.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })) === false
})()`)
if (!pasteDispatched) throw new Error('Clipboard image paste was not intercepted')
await waitForPage(`document.querySelector('.cm-content')?.textContent?.includes('/api/images/')`, 'the uploaded image Markdown')
const pastedImage = await evaluate(`(() => ({
  markdownInserted: document.querySelector('.cm-content')?.textContent?.includes('/api/images/'),
  rendered: Boolean(document.querySelector('.markdown-document img[src*="/api/images/"]')),
  uploadErrors: document.querySelectorAll('.image-upload-toast.is-error').length
}))()`)
if (!pastedImage.markdownInserted || !pastedImage.rendered || pastedImage.uploadErrors) throw new Error(`Clipboard image upload failed: ${JSON.stringify(pastedImage)}`)

// ── bg figure markdown (design v5.1) ─────────────────────────────────────────
// Append a `{bg}` scene reusing the image that was just uploaded, so the
// preview section below can verify the full-height right-bleed layout.
const uploadedImageUrl = await evaluate(`document.querySelector('.markdown-document img[src*="/api/images/"]')?.getAttribute('src')`)
if (!uploadedImageUrl) throw new Error('No uploaded image URL available for the bg bleed check')
const bgPasted = await evaluate(`(() => {
  const content = document.querySelector('.cm-content')
  if (!content) return false
  if (content.textContent.includes('{bg}')) return true // already appended by a previous run
  content.focus()
  const selection = window.getSelection()
  selection.selectAllChildren(content)
  selection.collapseToEnd()
  const transfer = new DataTransfer()
  transfer.setData('text/plain', '\\n\\n## Bleed check\\n\\n左欄內文段落，確認正文留在左欄。\\n\\n![bleed](${uploadedImageUrl}){bg}\\n\\n圖說在左欄底部。\\n')
  return content.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })) === false
})()`)
if (!bgPasted) throw new Error('bg markdown paste was not applied')
await waitForPage(`document.querySelector('.cm-content')?.textContent?.includes('{bg}')`, 'the bg figure markdown')

// ── Cheat sheet ──────────────────────────────────────────────────────────────
await evaluate(`document.querySelector('button[aria-label="Open Markdown and presentation cheat sheet"]')?.click()`)
await waitForPage(`document.querySelectorAll('.cheatsheet-grid code').length >= 15`, 'the cheat sheet')
await evaluate(`document.querySelector('button[aria-label="Close cheat sheet"]')?.click()`)

// ── Presentation preview ─────────────────────────────────────────────────────
await evaluate(`document.querySelector('button[aria-label="Open presentation preview"]')?.click()`)
await waitForPage(`document.querySelectorAll('.scene-dots button').length > 0`, 'the presentation preview')
await evaluate(`document.querySelectorAll('.scene-dots button')[1]?.click()`)
await wait(150)
const preview = await evaluate(`(() => ({
  scenes: document.querySelectorAll('.scene-dots button').length,
  scaledPreviewFontSize: document.querySelector('.scene p') ? Number.parseFloat(getComputedStyle(document.querySelector('.scene p')).fontSize) : 14,
  overflow: document.querySelector('.preview-meta span:last-child')?.textContent?.trim()
}))()`)
if (!preview.scenes || preview.scaledPreviewFontSize < 11 || !preview.overflow?.includes('no overflow')) throw new Error(`Presentation preview failed: ${JSON.stringify(preview)}`)

// ── bg figure bleed geometry (design v5.1) ───────────────────────────────────
// Walk the scene dots until the figure-bg scene is on stage, then verify the
// image really reaches the scene's right and bottom edges (design v5.1: the
// panel undoes .scene-content's insets) and the prose stayed in the left column.
let bgGeometry = null
const sceneDotCount = await evaluate(`document.querySelectorAll('.scene-dots button').length`)
for (let index = 0; index < sceneDotCount && !bgGeometry; index++) {
  await evaluate(`document.querySelectorAll('.scene-dots button')[${index}]?.click()`)
  await wait(120)
  bgGeometry = await evaluate(`(() => {
    const scene = document.querySelector('.scene[data-layout="figure-bg"]')
    if (!scene) return null
    const image = scene.querySelector('.figure-bg-panel img')
    const text = scene.querySelector('.figure-bg-text p')
    const heading = scene.querySelector('.figure-bg-left .scene-heading')
    if (!image || !text) return { missing: true }
    const sceneRect = scene.getBoundingClientRect()
    const imageRect = image.getBoundingClientRect()
    const textRect = text.getBoundingClientRect()
    // object-fit: contain can letterbox inside the element box, so measure the
    // painted image, not just the <img> box.
    const paintedScale = Math.min(imageRect.width / image.naturalWidth, imageRect.height / image.naturalHeight)
    const paintedHeight = image.naturalHeight * paintedScale
    return {
      rightGap: sceneRect.right - imageRect.right,
      bottomGap: sceneRect.bottom - imageRect.bottom,
      paintedShortfall: imageRect.height - paintedHeight,
      // full height: the image's top must reach the heading's top edge, not
      // start below the heading (design v5.1: heading lives in the left column)
      topAlignedWithHeading: !heading || imageRect.top <= heading.getBoundingClientRect().top + 2,
      textLeftOfImage: textRect.right <= imageRect.left,
      hasLegend: Boolean(scene.querySelector('.figure-bg-caption')),
    }
  })()`)
}
if (!bgGeometry || bgGeometry.missing) {
  const debugState = await evaluate(`JSON.stringify({
    layouts: [...document.querySelectorAll('.scene[data-layout]')].map((scene) => scene.dataset.layout),
    imageLines: [...document.querySelectorAll('.cm-line')].map((line) => line.textContent).filter((text) => text.includes('![')),
  })`)
  throw new Error(`figure-bg scene not found or incomplete: ${JSON.stringify(bgGeometry)} ${debugState}`)
}
if (Math.abs(bgGeometry.rightGap) > 3 || Math.abs(bgGeometry.bottomGap) > 3 || bgGeometry.paintedShortfall > 3 || !bgGeometry.topAlignedWithHeading || !bgGeometry.textLeftOfImage || !bgGeometry.hasLegend) {
  throw new Error(`figure-bg bleed geometry failed: ${JSON.stringify(bgGeometry)}`)
}
const bgShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
await writeFile('artifacts/scenemd-figure-bg.png', Buffer.from(bgShot.data, 'base64'))

// ── Presentation mode ────────────────────────────────────────────────────────
await evaluate(`document.querySelector('.present-button')?.click()`)
await waitForPage(`Boolean(document.querySelector('.presentation-overlay'))`, 'presentation mode')
const presentationFontSize = await evaluate(`document.querySelector('.presentation-overlay .scene p') ? Number.parseFloat(getComputedStyle(document.querySelector('.presentation-overlay .scene p')).fontSize) : 20`)
if (presentationFontSize < 20) throw new Error(`Presentation content font is below 20px: ${presentationFontSize}`)
if (!(await evaluate(`document.querySelector('.keyboard-hint')?.classList.contains('is-visible')`))) throw new Error('Shortcut hint was not visible when presentation opened')
// These two waits test real timing behavior (hint fades after inactivity,
// returns on pointer movement) and must stay as fixed delays.
await wait(1700)
if (await evaluate(`document.querySelector('.keyboard-hint')?.classList.contains('is-visible')`)) throw new Error('Shortcut hint did not fade after pointer inactivity')
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 400, y: 300 })
await wait(50)
if (!(await evaluate(`document.querySelector('.keyboard-hint')?.classList.contains('is-visible')`))) throw new Error('Shortcut hint did not return after pointer movement')

const presentationShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
await writeFile('artifacts/scenemd-presentation.png', Buffer.from(presentationShot.data, 'base64'))
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
await waitForPage(`!document.querySelector('.presentation-overlay')`, 'presentation mode to close')

// ── Narrow viewport ──────────────────────────────────────────────────────────
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
await waitForPage(`document.documentElement.clientWidth === 390`, 'the narrow viewport')
const narrow = await evaluate(`(() => ({
  width: document.documentElement.clientWidth,
  present: getComputedStyle(document.querySelector('.present-button')).display,
  editorWidth: Math.round(document.querySelector('.editor-panel').getBoundingClientRect().width),
  fontSize: Number.parseFloat(getComputedStyle(document.querySelector('.cm-content')).fontSize)
}))()`)
if (narrow.width !== 390 || narrow.present === 'none' || narrow.editorWidth !== 390 || narrow.fontSize < 20) throw new Error(`Narrow editor failed: ${JSON.stringify(narrow)}`)

socket.close()
console.log(JSON.stringify({ home, editor, pastedImage, preview, narrow, browserErrors, failedResources, launchedChrome }, null, 2))
console.log('✓ smoke test passed')
process.exit(0)
