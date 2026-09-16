import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/dm-sans'
import '@fontsource/dm-mono/400.css'
import './theme.css'
import App from './App.tsx'
import { desktop, loadQueue } from './storage'
import { loadStartupSettings } from './startup'

const root = createRoot(document.getElementById('root')!)

async function start() {
  try {
    const initialState = await loadQueue()
    const initialStartup = desktop ? await loadStartupSettings() : null
    root.render(<StrictMode><App initialState={initialState} initialStartup={initialStartup} /></StrictMode>)
  } catch (error) {
    root.render(<main className="startup-error"><h1>Priority Queue</h1><h2>Could not open your queue.</h2><p role="alert">{String(error)}</p><button onClick={() => location.reload()}>Try again</button></main>)
  }
}

if (navigator.locks) {
  void navigator.locks.request('priority-queue-writer', { ifAvailable: true }, async lock => {
    if (!lock) {
      root.render(<main className="startup-error"><h1>Priority Queue</h1><p>This queue is already open in another window.</p><button onClick={() => location.reload()}>Try again</button></main>)
      return
    }
    await start()
    await new Promise(() => undefined)
  })
} else {
  void start()
}
