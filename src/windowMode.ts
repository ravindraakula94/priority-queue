import { availableMonitors, currentMonitor, getCurrentWindow, LogicalSize, PhysicalPosition, type PhysicalSize } from '@tauri-apps/api/window'
import { desktop, loadPreferences, savePreference } from './storage'

interface FullWindow {
  size: PhysicalSize
  position: PhysicalPosition
  maximized: boolean
  pinned: boolean
}

let fullWindow: FullWindow | undefined
let overlayActive = false
let modeVersion = 0
let preferenceWrites: Promise<void> = Promise.resolve()

interface OverlayGeometry {
  x: number
  y: number
  width: number
  height: number
}

function validGeometry(value: unknown): value is OverlayGeometry {
  if (!value || typeof value !== 'object') return false
  const geometry = value as OverlayGeometry
  return [geometry.x, geometry.y, geometry.width, geometry.height].every(Number.isFinite)
    && geometry.width >= 320 && geometry.height >= 88
}

export async function saveOverlayPreferences(): Promise<void> {
  if (!desktop || !overlayActive) return preferenceWrites
  const window = getCurrentWindow()
  const version = modeVersion
  if (await window.isMinimized() || await window.isMaximized()) return preferenceWrites
  const position = await window.outerPosition()
  const size = (await window.innerSize()).toLogical(await window.scaleFactor())
  if (!overlayActive || version !== modeVersion) return preferenceWrites
  const geometry = { x: position.x, y: position.y, width: size.width, height: size.height }
  if (!validGeometry(geometry)) return preferenceWrites
  preferenceWrites = preferenceWrites.catch(() => undefined).then(async () => {
    await savePreference('overlayGeometry', geometry)
  })
  return preferenceWrites
}

export function watchOverlayPreferences(onError: (error: unknown) => void): () => void {
  if (!desktop) return () => undefined
  const window = getCurrentWindow()
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const stops: (() => void)[] = []
  const changed = () => {
    if (!overlayActive || disposed) return
    clearTimeout(timer)
    timer = setTimeout(() => { void saveOverlayPreferences().catch(onError) }, 250)
  }
  for (const subscription of [window.onMoved(changed), window.onResized(changed)]) {
    void subscription.then(stop => { if (disposed) stop(); else stops.push(stop) }).catch(onError)
  }
  return () => {
    disposed = true
    clearTimeout(timer)
    stops.forEach(stop => stop())
  }
}

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
    try {
      await saveOverlayPreferences()
    } finally {
      overlayActive = false
      modeVersion++
      await restoreFullWindow()
    }
    return
  }
  if (overlayActive) return
  const maximized = await window.isMaximized()
  const pinned = await window.isAlwaysOnTop()
  if (maximized) await window.unmaximize()
  fullWindow = { size: await window.innerSize(), position: await window.outerPosition(), maximized, pinned }
  try {
    await preferenceWrites.catch(() => undefined)
    const preferences = await loadPreferences()
    const saved = preferences.overlayGeometry
    const geometry = validGeometry(saved) ? saved : undefined
    const monitors = await availableMonitors()
    const monitor = (geometry && monitors.find(candidate => geometry.x >= candidate.workArea.position.x
      && geometry.x < candidate.workArea.position.x + candidate.workArea.size.width
      && geometry.y >= candidate.workArea.position.y
      && geometry.y < candidate.workArea.position.y + candidate.workArea.size.height))
      || await currentMonitor() || monitors[0]
    await window.setMinSize(new LogicalSize(320, 88))
    await window.setDecorations(false)
    await window.setShadow(false)
    await window.setResizable(true)
    await window.setAlwaysOnTop(true)
    if (monitor) {
      const margin = geometry ? 0 : Math.round(16 * monitor.scaleFactor)
      const logicalWidth = Math.max(320, Math.min(geometry?.width ?? 420, (monitor.workArea.size.width - margin * 2) / monitor.scaleFactor))
      const logicalHeight = Math.max(88, Math.min(geometry?.height ?? 88, (monitor.workArea.size.height - margin * 2) / monitor.scaleFactor))
      const width = Math.round(logicalWidth * monitor.scaleFactor)
      const height = Math.round(logicalHeight * monitor.scaleFactor)
      const left = monitor.workArea.position.x + margin
      const top = monitor.workArea.position.y + margin
      const right = Math.max(left, monitor.workArea.position.x + monitor.workArea.size.width - width - margin)
      const bottom = Math.max(top, monitor.workArea.position.y + monitor.workArea.size.height - height - margin)
      await window.setPosition(new PhysicalPosition(
        Math.max(left, Math.min(right, geometry?.x ?? right)),
        Math.max(top, Math.min(bottom, geometry?.y ?? bottom)),
      ))
      await window.setSize(new LogicalSize(logicalWidth, logicalHeight))
      await window.setPosition(new PhysicalPosition(
        Math.max(left, Math.min(right, geometry?.x ?? right)),
        Math.max(top, Math.min(bottom, geometry?.y ?? bottom)),
      ))
    } else {
      await window.setSize(new LogicalSize(geometry?.width ?? 420, geometry?.height ?? 88))
      if (geometry) await window.setPosition(new PhysicalPosition(geometry.x, geometry.y))
    }
    modeVersion++
    overlayActive = true
  } catch (error) {
    await restoreFullWindow().catch(() => undefined)
    throw error
  }
}

export async function dragOverlay(): Promise<void> {
  if (desktop) await getCurrentWindow().startDragging()
}