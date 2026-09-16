import { execFile, spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'
import { log } from 'node:console'
import { chromium, expect } from '@playwright/test'
import { LogicalSize, PhysicalPosition, Position, Size } from '@tauri-apps/api/dpi'

if (process.platform !== 'win32') throw new Error('This smoke test requires Windows.')
if (process.argv[2]) throw new Error('Desktop smoke requires the isolated debug build, not an installed executable.')
const executable = fileURLToPath(new URL('../src-tauri/target/debug/priority-queue.exe', import.meta.url))
if (!(await readFile(executable)).includes(Buffer.from('PRIORITY_QUEUE_TEST_DATA_DIR'))) throw new Error('Build the isolated debug executable first.')
const screenshotDirectory = fileURLToPath(new URL('../test-results', import.meta.url))
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'priority-queue-smoke-'))
const queuePath = join(temporaryDirectory, 'queue.json')
const preferencesPath = join(temporaryDirectory, 'preferences.json')
await writeFile(queuePath, JSON.stringify({ queue: { version: 1, tasks: [], sessions: [], focusId: null, runningSince: null } }))
await writeFile(preferencesPath, '{}')
async function userDataHashes() {
  return Promise.all(['queue.json', 'preferences.json'].map(async name => {
    try { return createHash('sha256').update(await readFile(join(process.env.APPDATA, 'com.priorityqueue.desktop', name))).digest('hex') }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }))
}
const originalUserData = await userDataHashes()
const runFile = promisify(execFile)
const powershell = join(process.env.ProgramFiles, 'PowerShell/7/pwsh.exe')
const startupKey = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const startupApprovalKey = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
async function startupRegistration(keyPath = startupKey) {
  const result = await runFile(powershell, ['-NoProfile', '-Command', `$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${keyPath}'); if ($null -eq $key -or $null -eq $key.GetValue('Priority Queue')) { 'null' } else { @{ value = $key.GetValue('Priority Queue'); kind = [int]$key.GetValueKind('Priority Queue') } | ConvertTo-Json -Compress }; if ($key) { $key.Close() }`])
  return JSON.parse(result.stdout)
}
async function restoreStartupRegistration(keyPath, registration) {
  await runFile(powershell, ['-NoProfile', '-Command', `$registration = $env:PRIORITY_QUEUE_SMOKE_STARTUP | ConvertFrom-Json; $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${keyPath}', $true); if ($null -eq $registration) { if ($key) { $key.DeleteValue('Priority Queue', $false) } } else { if (!$key) { $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('${keyPath}') }; if ($registration.kind -eq 3) { $key.SetValue('Priority Queue', [byte[]]$registration.value, [Microsoft.Win32.RegistryValueKind]::Binary) } else { $key.SetValue('Priority Queue', $registration.value, [Microsoft.Win32.RegistryValueKind]$registration.kind) } }; if ($key) { $key.Close() }`], { env: { ...process.env, PRIORITY_QUEUE_SMOKE_STARTUP: JSON.stringify(registration) } })
}
await runFile(powershell, ['-NoProfile', '-Command', "if (Get-Process -Name priority-queue -ErrorAction SilentlyContinue) { throw 'Close Priority Queue before running the desktop smoke test.' }"])
const originalStartup = await startupRegistration()
const originalApproval = await startupRegistration(startupApprovalKey)
const launchApp = () => spawn(executable, [], {
  env: { ...process.env, PRIORITY_QUEUE_TEST_DATA_DIR: temporaryDirectory, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9223' },
  stdio: 'ignore',
})
let child = launchApp()
let browser
try {
  await expect(async () => {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 2000 })
  }).toPass({ timeout: 30000 })
  const context = browser.contexts()[0]
  await expect(() => expect(context.pages().length).toBeGreaterThan(0)).toPass({ timeout: 10000 })
  let page = context.pages()[0]
  const windowCommand = (command, args = {}) => page.evaluate(({ command, args }) => globalThis.__TAURI_INTERNALS__.invoke(`plugin:window|${command}`, { label: 'main', ...args }), { command, args })
  let expand = page.getByRole('button', { name: 'Expand to full view', exact: true })
  const readPreferences = () => page.evaluate(() => globalThis.__TAURI_INTERNALS__.invoke('read_app_data', { kind: 'preferences' }))
  const simulateFailures = () => {
    const fetch = globalThis.fetch.bind(globalThis)
    globalThis.fetch = (input, options) => {
      const url = typeof input === 'string' ? new URL(input, globalThis.location.href) : null
      if (url?.hostname === 'ipc.localhost') {
        const command = decodeURIComponent(url.pathname.slice(1))
        if (command === `plugin:autostart|${globalThis.__startupFailure}` || (command === 'set_startup_enabled' && globalThis.__startupFailure === 'enable')) {
          return Promise.resolve(new globalThis.Response(JSON.stringify('Simulated startup failure'), { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'error' } }))
        }
      }
      return fetch(input, options)
    }
  }
  await page.addInitScript(simulateFailures)
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'Welcome to Priority Queue' })).toBeVisible()
  for (const path of [queuePath, preferencesPath]) expect((await readFile(path)).subarray(0, 8).toString()).toBe('PQDPAPI\x01')
  for (const kind of ['../queue.json', 'C:\\outside.json', 'queue.json', 'other']) {
    await expect(page.evaluate(kind => globalThis.__TAURI_INTERNALS__.invoke('read_app_data', { kind }), kind)).rejects.toBeTruthy()
  }
  await expect(page.evaluate(() => globalThis.__TAURI_INTERNALS__.invoke('plugin:store|load', { path: 'queue.json' }))).rejects.toBeTruthy()
  await expect(page.evaluate(() => globalThis.__TAURI_INTERNALS__.invoke('save_app_preference', { key: '../outside', value: true }))).rejects.toBeTruthy()
  await expect(page.getByText('Your queue is clear.')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Start with Windows' })).toBeEnabled()
  expect(await startupRegistration()).toEqual(originalStartup)
  await mkdir(screenshotDirectory, { recursive: true })
  await page.screenshot({ path: `${screenshotDirectory}/desktop-welcome.png` })
  await page.getByRole('checkbox', { name: 'Start with Windows' }).uncheck()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('main', { name: 'Compact focus' })).toBeVisible()
  await expect(expand).toBeEnabled()
  expect(await startupRegistration()).toBeNull()
  expect((await readPreferences()).startupChoiceMade).toBe(true)
  const scale = await windowCommand('scale_factor')
  await expect(async () => expect(await windowCommand('inner_size')).toEqual({ width: Math.round(420 * scale), height: Math.round(88 * scale) })).toPass()
  expect(await windowCommand('is_decorated')).toBe(false)
  expect(await windowCommand('is_resizable')).toBe(true)
  expect(await windowCommand('is_always_on_top')).toBe(true)
  await page.mouse.move(-10, -10)
  await expect(page.locator('.focus-overlay')).toHaveCSS('background-color', 'rgba(20, 25, 23, 0.38)')
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await page.screenshot({ path: `${screenshotDirectory}/desktop-startup-overlay.png`, omitBackground: true })
  await expand.click()
  await expect(page.getByRole('button', { name: 'Compact overlay (Ctrl+Shift+M)', exact: true })).toBeEnabled()
  await expect(async () => expect(await windowCommand('inner_size')).toEqual({ width: Math.round(620 * scale), height: Math.round(780 * scale) })).toPass()
  expect(await windowCommand('is_decorated')).toBe(true)
  expect(await windowCommand('is_resizable')).toBe(true)
  await expect(page.getByRole('heading', { name: 'Priority Queue', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Start with Windows' })).not.toBeChecked()
  await page.evaluate(() => { globalThis.__startupFailure = 'enable' })
  await page.getByRole('checkbox', { name: 'Start with Windows' }).check()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Could not save startup settings')
  expect(await startupRegistration()).toBeNull()
  await page.evaluate(() => { globalThis.__startupFailure = '' })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await startupRegistration()).value).toBe(`"${executable}"`)
  await page.reload()
  await expect(page.getByRole('main', { name: 'Compact focus' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expand.click()
  await expect(page.getByRole('button', { name: 'Compact overlay (Ctrl+Shift+M)', exact: true })).toBeEnabled()
  await page.evaluate(() => { globalThis.__startupFailure = 'is_enabled' })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Could not read startup settings')
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await page.evaluate(() => { globalThis.__startupFailure = '' })
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Start with Windows' })).toBeChecked()
  await page.screenshot({ path: `${screenshotDirectory}/desktop-settings.png` })
  await windowCommand('set_size', { value: new Size(new LogicalSize(360, 560)).toJSON() })
  expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true)
  await page.screenshot({ path: `${screenshotDirectory}/desktop-settings-narrow.png` })
  await windowCommand('set_size', { value: new Size(new LogicalSize(620, 780)).toJSON() })
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await runFile(powershell, ['-NoProfile', '-Command', `$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('${startupApprovalKey}'); $key.SetValue('Priority Queue', [byte[]](3,0,0,0,1,0,0,0,0,0,0,0), [Microsoft.Win32.RegistryValueKind]::Binary); $key.Close()`])
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Start with Windows' })).toBeEnabled()
  await expect(page.getByRole('checkbox', { name: 'Start with Windows' })).not.toBeChecked()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await startupRegistration()).toBeNull()
  await page.reload()
  await expect(page.getByRole('main', { name: 'Compact focus' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.overlay-title')).toHaveText('Queue complete')
  await expand.click()
  await expect(page.getByRole('button', { name: 'Compact overlay (Ctrl+Shift+M)', exact: true })).toBeEnabled()
  await expect(page.getByText('Your queue is clear.')).toBeVisible()
  await expect(page.locator('.app-footer').getByRole('status')).toHaveText('Saved locally')
  await page.getByRole('button', { name: 'Unpin window', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Keep window on top', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Keep window on top', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Unpin window', exact: true })).toBeVisible()
  expect(await page.locator('.brand-mark img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.screenshot({ path: `${screenshotDirectory}/desktop-native.png` })
  const normalSize = await windowCommand('inner_size')
  const normalPosition = await windowCommand('outer_position')
  const defaultGeometry = (await readPreferences()).overlayGeometry
  const writeGeometry = geometry => page.evaluate(value => globalThis.__TAURI_INTERNALS__.invoke('save_app_preference', { key: 'overlayGeometry', value }), geometry)
  await page.getByRole('button', { name: 'Compact overlay (Ctrl+Shift+M)', exact: true }).click()
  await expect(expand).toBeEnabled()
  const monitor = await windowCommand('current_monitor')
  const geometry = { x: monitor.workArea.position.x, y: monitor.workArea.position.y, width: 500, height: 140 }
  const physicalSize = { width: Math.round(geometry.width * scale), height: Math.round(geometry.height * scale) }
  await windowCommand('set_size', { value: new Size(new LogicalSize(geometry.width, geometry.height)).toJSON() })
  await windowCommand('set_position', { value: new Position(new PhysicalPosition(geometry.x, geometry.y)).toJSON() })
  await expect(async () => expect((await readPreferences()).overlayGeometry).toEqual(geometry)).toPass()
  await expect(page.locator('.focus-overlay')).toHaveCSS('width', '500px')
  await expect(page.locator('.focus-overlay')).toHaveCSS('height', '140px')
  await page.screenshot({ path: `${screenshotDirectory}/desktop-overlay-resized.png`, omitBackground: true })
  await expand.click()
  await expect(page.getByRole('button', { name: 'Compact overlay (Ctrl+Shift+M)', exact: true })).toBeEnabled()
  expect(await windowCommand('inner_size')).toEqual(normalSize)
  expect(await windowCommand('outer_position')).toEqual(normalPosition)
  await page.getByRole('button', { name: 'Compact overlay (Ctrl+Shift+M)', exact: true }).click()
  await expect(expand).toBeEnabled()
  expect(await windowCommand('inner_size')).toEqual(physicalSize)
  expect(await windowCommand('outer_position')).toEqual({ x: geometry.x, y: geometry.y })
  await page.reload()
  await expect(expand).toBeEnabled()
  expect(await windowCommand('inner_size')).toEqual(physicalSize)
  expect(await windowCommand('outer_position')).toEqual({ x: geometry.x, y: geometry.y })
  const closedForRestart = once(child, 'exit', { signal: globalThis.AbortSignal.timeout(10000) })
  await runFile(powershell, ['-NoProfile', '-Command', `if (!(Get-Process -Id ${child.pid}).CloseMainWindow()) { throw 'Could not request normal app close.' }`])
  await closedForRestart
  await browser.close()
  child = launchApp()
  await expect(async () => { browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 2000 }) }).toPass({ timeout: 30000 })
  await expect(() => expect(browser.contexts()[0].pages().length).toBeGreaterThan(0)).toPass()
  page = browser.contexts()[0].pages()[0]
  await expect(page.locator('.focus-overlay, .app-shell')).toBeVisible()
  expand = page.getByRole('button', { name: 'Expand to full view', exact: true })
  await page.addInitScript(simulateFailures)
  await expect(expand).toBeEnabled()
  expect(await windowCommand('inner_size')).toEqual(physicalSize)
  expect(await windowCommand('outer_position')).toEqual({ x: geometry.x, y: geometry.y })
  await expand.click()
  await expect(page.getByRole('button', { name: 'Compact overlay (Ctrl+Shift+M)', exact: true })).toBeEnabled()
  await writeGeometry({ x: -100000, y: -100000, width: 100000, height: 100000 })
  await page.getByRole('button', { name: 'Compact overlay (Ctrl+Shift+M)', exact: true }).click()
  await expect(expand).toBeEnabled()
  const recoveredPosition = await windowCommand('outer_position')
  const recoveredSize = await windowCommand('inner_size')
  const recoveredMonitor = await windowCommand('current_monitor')
  expect(recoveredPosition.x).toBeGreaterThanOrEqual(recoveredMonitor.workArea.position.x)
  expect(recoveredPosition.y).toBeGreaterThanOrEqual(recoveredMonitor.workArea.position.y)
  expect(recoveredPosition.x + recoveredSize.width).toBeLessThanOrEqual(recoveredMonitor.workArea.position.x + recoveredMonitor.workArea.size.width)
  expect(recoveredPosition.y + recoveredSize.height).toBeLessThanOrEqual(recoveredMonitor.workArea.position.y + recoveredMonitor.workArea.size.height)
  await expand.click()
  await expect(page.getByRole('button', { name: 'Compact overlay (Ctrl+Shift+M)', exact: true })).toBeEnabled()
  await expect(writeGeometry({ x: 'invalid', width: -1 })).rejects.toBeTruthy()
  await writeGeometry(defaultGeometry)
  await page.getByRole('button', { name: 'Compact overlay (Ctrl+Shift+M)', exact: true }).click()
  await expect(expand).toBeEnabled()
  expect(await windowCommand('inner_size')).toEqual({ width: Math.round(420 * scale), height: Math.round(88 * scale) })
  await expand.click()
  await expect(page.getByRole('button', { name: 'Compact overlay (Ctrl+Shift+M)', exact: true })).toBeEnabled()
  await writeGeometry(defaultGeometry)
  expect((await readPreferences()).startupChoiceMade).toBe(true)
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
  await expect(expand).toBeEnabled()
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
  const encryptedQueue = await readFile(queuePath)
  expect(encryptedQueue.subarray(0, 8).toString()).toBe('PQDPAPI\x01')
  expect(encryptedQueue.includes(Buffer.from('Publish the infra plugin'))).toBe(false)
  expect((await readFile(preferencesPath)).includes(Buffer.from('startupChoiceMade'))).toBe(false)
  const corruptedQueue = Buffer.from(encryptedQueue)
  corruptedQueue[corruptedQueue.length - 1] ^= 1
  await writeFile(queuePath, corruptedQueue)
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('could not decrypt app data')
  await expect(page.evaluate(() => globalThis.__TAURI_INTERNALS__.invoke('save_queue_data', { queue: { version: 1, tasks: [], sessions: [] } }))).rejects.toBeTruthy()
  expect(await readFile(queuePath)).toEqual(corruptedQueue)
  const exited = once(child, 'exit', { signal: globalThis.AbortSignal.timeout(10000) })
  await page.evaluate(() => globalThis.__TAURI_INTERNALS__.invoke('plugin:window|destroy', { label: 'main' })).catch(() => undefined)
  await exited
  log('Desktop smoke test passed: encrypted migration, restricted storage commands, corruption rejection, overlay restart persistence, startup settings, transparency and lock/unlock. Used a debug-only isolated profile; original startup entries are restored.')
} finally {
  await browser?.close().catch(() => undefined)
  if (child.exitCode === null) child.kill()
  try {
    await restoreStartupRegistration(startupKey, originalStartup)
  } finally {
    await restoreStartupRegistration(startupApprovalKey, originalApproval)
    await rm(temporaryDirectory, { recursive: true, force: true })
    expect(await userDataHashes()).toEqual(originalUserData)
  }
}