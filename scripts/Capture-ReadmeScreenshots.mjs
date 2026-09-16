import { Buffer } from 'node:buffer'
import { execFile, spawn } from 'node:child_process'
import { log } from 'node:console'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { promisify } from 'node:util'
import { chromium, expect } from '@playwright/test'
import { LogicalSize, Size } from '@tauri-apps/api/dpi'

if (process.platform !== 'win32') throw new Error('Screenshot capture requires Windows.')
const executable = fileURLToPath(new URL('../src-tauri/target/debug/priority-queue.exe', import.meta.url))
if (!(await readFile(executable)).includes(Buffer.from('PRIORITY_QUEUE_TEST_DATA_DIR'))) throw new Error('Run npm run desktop:test-build first.')
await promisify(execFile)(join(process.env.ProgramFiles, 'PowerShell/7/pwsh.exe'), ['-NoProfile', '-Command', "if (Get-Process -Name priority-queue -ErrorAction SilentlyContinue) { throw 'Close Priority Queue before capturing screenshots.' }"])
const outputDirectory = fileURLToPath(new URL('../docs/images', import.meta.url))
const directory = await mkdtemp(join(tmpdir(), 'priority-queue-docs-'))
const timestamp = value => new Date(value).getTime()
const task = (id, title, tags, due, status = 'queued') => ({ id, title, tags, due, status, createdAt: timestamp('2026-09-10T08:00:00'), completedAt: status === 'completed' ? timestamp('2026-09-16T10:00:00') : null })
const session = (task, start, minutes) => ({ taskId: task.id, title: task.title, start: timestamp(start), end: timestamp(start) + minutes * 60000 })
const tasks = [
  task('proposal', 'Draft the project proposal', ['work', 'writing'], '2026-09-16'),
  task('feedback', 'Review customer feedback', ['work', 'research'], '2026-09-17'),
  task('agenda', 'Prepare the Friday meeting agenda', ['work'], '2026-09-18'),
  task('weekend', 'Plan a weekend hike', ['personal'], ''),
  task('inbox', 'Clear the weekly inbox', ['work'], '2026-09-16', 'completed'),
  task('reading', 'Read a chapter', ['personal'], '2026-09-16', 'completed'),
  task('archive', 'Collect ideas for the next project', ['planning'], '', 'archived'),
]
const sessions = [
  session(tasks[6], '2026-09-10T09:00:00', 25),
  session(tasks[1], '2026-09-11T10:00:00', 45),
  session(tasks[5], '2026-09-12T08:00:00', 20),
  session(tasks[3], '2026-09-13T11:00:00', 30),
  session(tasks[0], '2026-09-14T09:00:00', 50),
  session(tasks[2], '2026-09-15T10:00:00', 40),
  session(tasks[4], '2026-09-16T09:00:00', 20),
  session(tasks[5], '2026-09-16T11:00:00', 25),
  session(tasks[0], '2026-09-16T13:00:00', 35),
]
async function userDataHashes() {
  return Promise.all(['queue.json', 'preferences.json'].map(async filename => {
    try { return createHash('sha256').update(await readFile(join(process.env.APPDATA, 'com.priorityqueue.desktop', filename))).digest('hex') }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }))
}
const originalData = await userDataHashes()
let child
let browser
try {
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(join(directory, 'queue.json'), JSON.stringify({ queue: { version: 1, tasks, sessions, focusId: 'proposal', runningSince: null } }))
  await writeFile(join(directory, 'preferences.json'), JSON.stringify({ startupChoiceMade: true }))
  child = spawn(executable, [], { env: { ...process.env, PRIORITY_QUEUE_TEST_DATA_DIR: directory, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9225' }, stdio: 'ignore' })
  await expect(async () => { browser = await chromium.connectOverCDP('http://127.0.0.1:9225', { timeout: 2000 }) }).toPass({ timeout: 30000 })
  await expect(() => expect(browser.contexts()[0].pages().length).toBeGreaterThan(0)).toPass()
  const page = browser.contexts()[0].pages()[0]
  const windowCommand = (command, args = {}) => page.evaluate(({ command, args }) => globalThis.__TAURI_INTERNALS__.invoke(`plugin:window|${command}`, { label: 'main', ...args }), { command, args })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('button', { name: 'Expand to full view', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Compact overlay (Ctrl+Shift+M)', exact: true })).toBeEnabled()
  await windowCommand('set_size', { value: new Size(new LogicalSize(780, 920)).toJSON() })
  await page.clock.install({ time: new Date('2026-09-16T14:25:00') })
  await page.clock.pauseAt(new Date('2026-09-16T14:25:00'))
  await page.reload()
  await page.getByRole('button', { name: 'Expand to full view', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Compact overlay (Ctrl+Shift+M)', exact: true })).toBeEnabled()
  await page.evaluate(() => globalThis.document.fonts.ready)
  await expect(page.locator('.task-title')).toHaveCount(4)
  await expect(page.getByRole('button', { name: 'Keep window on top', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await page.clock.fastForward(25000)
  await page.mouse.move(0, 0)
  await page.screenshot({ path: join(outputDirectory, 'queue.png') })

  await page.getByRole('button', { name: 'Review customer feedback', exact: true }).click()
  await page.clock.runFor(200)
  const editor = page.getByRole('dialog', { name: 'Edit task', exact: true })
  await expect(editor.getByLabel('Task', { exact: true })).toHaveValue('Review customer feedback')
  await editor.screenshot({ path: join(outputDirectory, 'task-editor.png') })
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()

  await page.getByRole('button', { name: 'Activity', exact: true }).click()
  await expect(page.locator('.breakdown-list li')).toHaveCount(3)
  await page.mouse.move(0, 0)
  await page.locator('.activity-section').screenshot({ path: join(outputDirectory, 'activity.png') })
  await page.getByRole('button', { name: 'Queue 4', exact: true }).click()

  await page.getByRole('button', { name: 'Compact overlay (Ctrl+Shift+M)', exact: true }).click()
  const expand = page.getByRole('button', { name: 'Expand to full view', exact: true })
  await expect(expand).toBeEnabled()
  await page.mouse.move(-10, -10)
  await page.clock.runFor(300)
  await expect(page.locator('.overlay-controls')).toHaveCSS('opacity', '0')
  await page.screenshot({ path: join(outputDirectory, 'overlay-idle.png'), omitBackground: true })
  await page.locator('.focus-overlay').hover()
  await page.clock.runFor(300)
  await expect(page.locator('.overlay-controls')).toHaveCSS('opacity', '1')
  await page.screenshot({ path: join(outputDirectory, 'overlay-controls.png'), omitBackground: true })
  await expand.click()
  await expect(page.getByRole('button', { name: 'Compact overlay (Ctrl+Shift+M)', exact: true })).toBeEnabled()

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.clock.runFor(200)
  await expect(page.getByRole('checkbox', { name: 'Start with Windows' })).toBeEnabled()
  await page.getByRole('dialog', { name: 'Settings', exact: true }).screenshot({ path: join(outputDirectory, 'settings.png') })
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()

  await page.getByRole('button', { name: 'Actions for Plan a weekend hike', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Delete task', exact: true }).click()
  await page.clock.runFor(200)
  const confirmation = page.getByRole('dialog', { name: 'Delete task', exact: true })
  await expect(confirmation.getByRole('heading', { name: 'Delete task and history?' })).toBeVisible()
  await confirmation.screenshot({ path: join(outputDirectory, 'delete-confirmation.png') })
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(errors).toEqual([])
  const exited = once(child, 'exit', { signal: globalThis.AbortSignal.timeout(10000) })
  await windowCommand('destroy').catch(() => undefined)
  await exited
  log('Captured seven native app screenshots with fictional data. Startup registration was not changed.')
} finally {
  await browser?.close().catch(() => undefined)
  if (child && child.exitCode === null) child.kill()
  await rm(directory, { recursive: true, force: true })
  expect(await userDataHashes()).toEqual(originalData)
}