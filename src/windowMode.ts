import { currentMonitor, getCurrentWindow, LogicalSize, PhysicalPosition, type PhysicalSize } from '@tauri-apps/api/window'
import { desktop } from './storage'

interface FullWindow {
  size: PhysicalSize
  position: PhysicalPosition
  maximized: boolean
  pinned: boolean
}

let fullWindow: FullWindow | undefined
let overlayPosition: PhysicalPosition | undefined

async function restoreFullWindow() {
  if (!fullWindow) return
  const window = getCurrentWindow()
  await window.setDecorations(true)
  await window.setShadow(true)
  await window.setResizable(true)
  await window.setMinSize(new LogicalSize(360, 560))
  await window.setSize(fullWindow.size)
  await window.setPosition(fullWindow.position)
  await window.setAlwaysOnTop(fullWindow.pinned)
  if (fullWindow.maximized) await window.maximize()
}

export async function setCompactWindow(compact: boolean): Promise<void> {
  if (!desktop) return
  const window = getCurrentWindow()
  if (!compact) {
    overlayPosition = await window.outerPosition()
    await restoreFullWindow()
    return
  }
  const maximized = await window.isMaximized()
  const pinned = await window.isAlwaysOnTop()
  if (maximized) await window.unmaximize()
  fullWindow = { size: await window.innerSize(), position: await window.outerPosition(), maximized, pinned }
  try {
    await window.setMinSize(new LogicalSize(320, 88))
    await window.setDecorations(false)
    await window.setShadow(false)
    await window.setResizable(false)
    await window.setAlwaysOnTop(true)
    await window.setSize(new LogicalSize(420, 88))
    const monitor = await currentMonitor()
    if (monitor) {
      const margin = Math.round(16 * monitor.scaleFactor)
      const width = Math.round(420 * monitor.scaleFactor)
      const height = Math.round(88 * monitor.scaleFactor)
      const left = monitor.workArea.position.x + margin
      const top = monitor.workArea.position.y + margin
      const right = Math.max(left, monitor.workArea.position.x + monitor.workArea.size.width - width - margin)
      const bottom = Math.max(top, monitor.workArea.position.y + monitor.workArea.size.height - height - margin)
      await window.setPosition(new PhysicalPosition(
        Math.max(left, Math.min(right, overlayPosition?.x ?? right)),
        Math.max(top, Math.min(bottom, overlayPosition?.y ?? bottom)),
      ))
    }
  } catch (error) {
    await restoreFullWindow().catch(() => undefined)
    throw error
  }
}

export async function dragOverlay(): Promise<void> {
  if (desktop) await getCurrentWindow().startDragging()
}