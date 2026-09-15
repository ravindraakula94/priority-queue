import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { desktop } from './storage'

export interface SessionState {
  locked: boolean
  lastLock: number
}

export function watchSession(onState: (state: SessionState) => void, onError: (error: unknown) => void): () => void {
  if (!desktop) return () => undefined
  let disposed = false
  let stop: (() => void) | undefined
  const receive = (state: SessionState) => { if (!disposed) onState(state) }
  const refresh = () => { void invoke<SessionState>('get_session_state').then(receive).catch(error => { if (!disposed) onError(error) }) }
  void listen<SessionState>('session-state', event => receive(event.payload)).then(unlisten => {
    if (disposed) unlisten()
    else { stop = unlisten; refresh() }
  }).catch(error => { if (!disposed) onError(error) })
  const timer = window.setInterval(refresh, 2000)
  document.addEventListener('visibilitychange', refresh)
  return () => {
    disposed = true
    stop?.()
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', refresh)
  }
}