import { isTauri } from '@tauri-apps/api/core'
import { load, type Store } from '@tauri-apps/plugin-store'
import { persistedState, restoreState, type QueueState } from './model'

export const desktop = isTauri()
const key = 'priority-queue.v1'
let store: Store | undefined
let writes: Promise<void> = Promise.resolve()

export async function loadQueue(): Promise<QueueState> {
  if (desktop) {
    store = await load('queue.json', { autoSave: false, defaults: {} })
    return restoreState(await store.get('queue'))
  }
  const saved = localStorage.getItem(key)
  return restoreState(saved === null ? null : JSON.parse(saved))
}

export function saveQueue(state: QueueState): Promise<void> {
  const snapshot = persistedState(state)
  writes = writes.catch(() => undefined).then(async () => {
    if (desktop) {
      if (!store) throw new Error('Desktop storage is not ready.')
      await store.set('queue', snapshot)
      await store.save()
    } else {
      localStorage.setItem(key, JSON.stringify(snapshot))
    }
  })
  return writes
}