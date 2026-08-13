import { writeFile } from 'node:fs/promises'

const baseUrl = process.env.SCENEMD_TEST_URL ?? 'http://127.0.0.1:5173'
const targets = await fetch('http://127.0.0.1:9222/json').then((response) => response.json())
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

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

await send('Runtime.enable')
await send('Log.enable')
await send('Page.enable')
await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: baseUrl })
await wait(1800)

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
await wait(1500)

const editor = await evaluate(`(() => ({
  codeMirror: Boolean(document.querySelector('.cm-editor')),
  sourceLabel: document.querySelector('.cm-content')?.getAttribute('aria-label'),
  toolbarButtons: document.querySelectorAll('.markdown-toolbar button').length,
  modes: [...document.querySelectorAll('.markdown-mode-tabs button')].map((button) => button.textContent?.trim()),
  sceneHeader: Boolean(document.querySelector('.scene-chrome-top'))
}))()`)
if (!editor.codeMirror || editor.sourceLabel !== 'Markdown source' || editor.toolbarButtons < 10 || !editor.modes.includes('Split') || editor.sceneHeader) throw new Error(`Editor failed: ${JSON.stringify(editor)}`)

await evaluate(`[...document.querySelectorAll('.markdown-mode-tabs button')].find((button) => button.textContent?.includes('Split'))?.click()`)
await wait(700)
if (!(await evaluate(`Boolean(document.querySelector('.markdown-document-scroll .markdown-document h1'))`))) throw new Error('Split rendered Markdown did not render')

const pasteDispatched = await evaluate(`(() => {
  const binary = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  const file = new File([bytes], 'clipboard-image.png', { type: 'image/png' })
  const transfer = new DataTransfer()
  transfer.items.add(file)
  return document.querySelector('.cm-content')?.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })) === false
})()`)
if (!pasteDispatched) throw new Error('Clipboard image paste was not intercepted')
await wait(2200)
const pastedImage = await evaluate(`(() => ({
  markdownInserted: document.querySelector('.cm-content')?.textContent?.includes('/api/images/'),
  rendered: Boolean(document.querySelector('.markdown-document img[src*="/api/images/"]')),
  uploadErrors: document.querySelectorAll('.image-upload-toast.is-error').length
}))()`)
if (!pastedImage.markdownInserted || !pastedImage.rendered || pastedImage.uploadErrors) throw new Error(`Clipboard image upload failed: ${JSON.stringify(pastedImage)}`)

await evaluate(`document.querySelector('button[aria-label="Open Markdown and presentation cheat sheet"]')?.click()`)
await wait(200)
if ((await evaluate(`document.querySelectorAll('.cheatsheet-grid code').length`)) < 15) throw new Error('Cheat sheet is incomplete')
await evaluate(`document.querySelector('button[aria-label="Close cheat sheet"]')?.click()`)

await evaluate(`document.querySelector('button[aria-label="Open presentation preview"]')?.click()`)
await wait(600)
await evaluate(`document.querySelectorAll('.scene-dots button')[1]?.click()`)
await wait(150)
const preview = await evaluate(`(() => ({
  scenes: document.querySelectorAll('.scene-dots button').length,
  scaledPreviewFontSize: document.querySelector('.scene p') ? Number.parseFloat(getComputedStyle(document.querySelector('.scene p')).fontSize) : 14,
  overflow: document.querySelector('.preview-meta span:last-child')?.textContent?.trim()
}))()`)
if (!preview.scenes || preview.scaledPreviewFontSize < 11 || !preview.overflow?.includes('no overflow')) throw new Error(`Presentation preview failed: ${JSON.stringify(preview)}`)

await evaluate(`document.querySelector('.present-button')?.click()`)
await wait(400)
if (!(await evaluate(`Boolean(document.querySelector('.presentation-overlay'))`))) throw new Error('Presentation mode did not open')
const presentationFontSize = await evaluate(`document.querySelector('.presentation-overlay .scene p') ? Number.parseFloat(getComputedStyle(document.querySelector('.presentation-overlay .scene p')).fontSize) : 20`)
if (presentationFontSize < 20) throw new Error(`Presentation content font is below 20px: ${presentationFontSize}`)
if (!(await evaluate(`document.querySelector('.keyboard-hint')?.classList.contains('is-visible')`))) throw new Error('Shortcut hint was not visible when presentation opened')
await wait(1700)
if (await evaluate(`document.querySelector('.keyboard-hint')?.classList.contains('is-visible')`)) throw new Error('Shortcut hint did not fade after pointer inactivity')
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 400, y: 300 })
await wait(50)
if (!(await evaluate(`document.querySelector('.keyboard-hint')?.classList.contains('is-visible')`))) throw new Error('Shortcut hint did not return after pointer movement')

const presentationShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
await writeFile('artifacts/scenemd-presentation.png', Buffer.from(presentationShot.data, 'base64'))
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
await wait(250)

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
await wait(500)
const narrow = await evaluate(`(() => ({
  width: document.documentElement.clientWidth,
  present: getComputedStyle(document.querySelector('.present-button')).display,
  editorWidth: Math.round(document.querySelector('.editor-panel').getBoundingClientRect().width),
  fontSize: Number.parseFloat(getComputedStyle(document.querySelector('.cm-content')).fontSize)
}))()`)
if (narrow.width !== 390 || narrow.present === 'none' || narrow.editorWidth !== 390 || narrow.fontSize < 20) throw new Error(`Narrow editor failed: ${JSON.stringify(narrow)}`)

socket.close()
console.log(JSON.stringify({ home, editor, pastedImage, preview, narrow, browserErrors, failedResources }, null, 2))
