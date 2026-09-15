import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'
import { log } from 'node:console'
import { chromium, expect } from '@playwright/test'

if (process.platform !== 'win32') throw new Error('This smoke test requires Windows.')
const executable = fileURLToPath(new URL('../src-tauri/target/release/priority-queue.exe', import.meta.url))
const screenshotDirectory = fileURLToPath(new URL('../test-results', import.meta.url))
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'priority-queue-smoke-'))
const runFile = promisify(execFile)
const child = spawn(executable, [], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9223' },
  stdio: 'ignore',
})
let browser
try {
  await expect(async () => {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 2000 })
  }).toPass({ timeout: 30000 })
  const context = browser.contexts()[0]
  await expect(() => expect(context.pages().length).toBeGreaterThan(0)).toPass({ timeout: 10000 })
  const page = context.pages()[0]
  await expect(page.getByRole('heading', { name: 'Priority Queue', exact: true })).toBeVisible()
  const assetDirectory = fileURLToPath(new URL('../dist/assets', import.meta.url))
  const entry = (await readdir(assetDirectory)).find(name => /^index-.*\.js$/.test(name))
  if (!entry) throw new Error('Build the frontend before running the native smoke test.')
  const source = await readFile(join(assetDirectory, entry), 'utf8')
  if (!source.includes('"queue.json"')) throw new Error('Could not isolate the test store.')
  await page.route('**/assets/index-*.js', route => route.fulfill({ contentType: 'text/javascript', body: source.replaceAll('"queue.json"', JSON.stringify(join(temporaryDirectory, 'queue.json'))) }))
  await page.reload()
  await expect(page.getByText('Your queue is clear.')).toBeVisible()
  await expect(page.locator('.app-footer').getByRole('status')).toHaveText('Saved locally')
  await page.getByRole('button', { name: 'Unpin window', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Keep window on top', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Keep window on top', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Unpin window', exact: true })).toBeVisible()
  expect(await page.locator('.brand-mark img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await mkdir(screenshotDirectory, { recursive: true })
  await page.screenshot({ path: `${screenshotDirectory}/desktop-native.png` })
  const windowCommand = (command, args = {}) => page.evaluate(({ command, args }) => globalThis.__TAURI_INTERNALS__.invoke(`plugin:window|${command}`, { label: 'main', ...args }), { command, args })
  const normalSize = await windowCommand('inner_size')
  const normalPosition = await windowCommand('outer_position')
  for (const title of ['Publish the infra plugin to playground', 'Review the deployment logs']) {
    await page.getByRole('button', { name: 'New task', exact: true }).click()
    await page.getByLabel('Task', { exact: true }).fill(title)
    await page.getByRole('button', { name: 'Add task', exact: true }).last().click()
  }
  await page.getByRole('button', { name: 'Start focus', exact: true }).click()
  await expect(page.getByLabel('Focus time', { exact: true })).not.toHaveText('00:00:00')
  async function notify(notification) {
    await runFile(join(process.env.ProgramFiles, 'PowerShell/7/pwsh.exe'), ['-NoProfile', '-File', fileURLToPath(new URL('./Send-SessionNotification.ps1', import.meta.url)), '-TargetProcessId', String(child.pid), '-Notification', notification])
  }
  await notify('Lock')
  await expect(page.getByText('PAUSED ON LOCK', { exact: true })).toBeVisible()
  await notify('Unlock')
  await expect(page.getByText('PAUSED ON LOCK', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await page.getByRole('button', { name: 'Compact overlay (Ctrl+Shift+M)', exact: true }).click()
  const expand = page.getByRole('button', { name: 'Expand to full view', exact: true })
  await expect(expand).toBeEnabled()
  const scale = await windowCommand('scale_factor')
  await expect(async () => expect(await windowCommand('inner_size')).toEqual({ width: Math.round(420 * scale), height: Math.round(88 * scale) })).toPass()
  expect(await windowCommand('is_decorated')).toBe(false)
  expect(await windowCommand('is_always_on_top')).toBe(true)
  await page.mouse.move(-10, -10)
  await expect(page.locator('.overlay-controls')).toHaveCSS('opacity', '0')
  await expect(page.locator('.focus-overlay')).toHaveCSS('background-color', 'rgba(20, 25, 23, 0.38)')
  const overlayImage = await page.screenshot({ path: `${screenshotDirectory}/desktop-overlay.png`, omitBackground: true })
  const alpha = await page.evaluate(async encoded => {
    const image = new globalThis.Image()
    image.src = `data:image/png;base64,${encoded}`
    await image.decode()
    const canvas = globalThis.document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const graphics = canvas.getContext('2d')
    graphics.drawImage(image, 0, 0)
    return graphics.getImageData(image.width - 10, Math.floor(image.height / 2), 1, 1).data[3]
  }, overlayImage.toString('base64'))
  expect(alpha).toBeGreaterThan(0)
  expect(alpha).toBeLessThan(150)
  await page.locator('.focus-overlay').hover()
  await expect(page.locator('.overlay-controls')).toHaveCSS('opacity', '1')
  await page.screenshot({ path: `${screenshotDirectory}/desktop-overlay-hover.png`, omitBackground: true })
  await notify('Lock')
  await expect(page.getByLabel('Paused when Windows locked', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Resume focus', exact: true })).toBeDisabled()
  const pausedTime = await page.getByLabel('Focus time', { exact: true }).textContent()
  await notify('Unlock')
  await expect(page.getByRole('button', { name: 'Resume focus', exact: true })).toBeEnabled()
  await page.clock.install()
  await page.clock.fastForward(60000)
  await expect(page.getByLabel('Focus time', { exact: true })).toHaveText(pausedTime)
  await page.getByRole('button', { name: 'Complete and load next task', exact: true }).click()
  await expect(page.locator('.overlay-title')).toHaveText('Review the deployment logs')
  await expect(page.getByRole('button', { name: 'Resume focus', exact: true })).toBeVisible()
  await expand.click()
  await expect(page.getByRole('button', { name: 'Compact overlay (Ctrl+Shift+M)', exact: true })).toBeEnabled()
  await expect(async () => expect(await windowCommand('inner_size')).toEqual(normalSize)).toPass()
  expect(await windowCommand('outer_position')).toEqual(normalPosition)
  expect(await windowCommand('is_decorated')).toBe(true)
  await windowCommand('maximize')
  await expect(async () => expect(await windowCommand('is_maximized')).toBe(true)).toPass()
  await page.getByRole('button', { name: 'Compact overlay (Ctrl+Shift+M)', exact: true }).click()
  await expect(expand).toBeEnabled()
  await expand.click()
  await expect(page.getByRole('button', { name: 'Compact overlay (Ctrl+Shift+M)', exact: true })).toBeEnabled()
  await expect(async () => expect(await windowCommand('is_maximized')).toBe(true)).toPass()
  await expect(page.getByRole('alert')).toHaveCount(0)
  const exited = once(child, 'exit', { signal: globalThis.AbortSignal.timeout(10000) })
  await page.evaluate(() => globalThis.__TAURI_INTERNALS__.invoke('plugin:window|destroy', { label: 'main' })).catch(() => undefined)
  await exited
  log('Desktop smoke test passed: compact sizing, transparency, normal/maximized restoration, Windows lock/unlock in both views, paused auto-next, storage, pin/unpin and shutdown. Test tasks used a temporary store.')
} finally {
  await browser?.close().catch(() => undefined)
  if (child.exitCode === null) child.kill()
  await rm(temporaryDirectory, { recursive: true, force: true })
}