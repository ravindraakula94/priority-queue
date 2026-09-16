import { invoke, isTauri } from '@tauri-apps/api/core'
import { persistedState, restoreState, type QueueState } from './model'

export const desktop = isTauri()
const key = 'priority-queue.v1'
let writes: Promise<void> = Promise.resolve()

export interface AppPreferences {
  startupChoiceMade?: boolean
  overlayGeometry?: unknown
}

export function loadPreferences(): Promise<AppPreferences> {
  return invoke('read_app_data', { kind: 'preferences' })
}

export function savePreference(key: keyof AppPreferences, value: unknown): Promise<void> {
  return invoke('save_app_preference', { key, value })
}

export async function loadQueue(): Promise<QueueState> {
  if (desktop) {
    const saved = await invoke<{ queue?: unknown }>('read_app_data', { kind: 'queue' })
    return restoreState(saved.queue)
  }
  const saved = localStorage.getItem(key)
  return restoreState(saved === null ? null : JSON.parse(saved))
}

export function saveQueue(state: QueueState): Promise<void> {
  const snapshot = persistedState(state)
  writes = writes.catch(() => undefined).then(async () => {
    if (desktop) {
      await invoke('save_queue_data', { queue: snapshot })
    } else {
      localStorage.setItem(key, JSON.stringify(snapshot))
    }
  })
  return writes
}