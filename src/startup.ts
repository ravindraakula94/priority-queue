import { invoke } from '@tauri-apps/api/core'
import { isEnabled } from '@tauri-apps/plugin-autostart'
import { loadPreferences, savePreference } from './storage'

export interface StartupSettings {
  enabled: boolean
  choiceMade: boolean
  error?: string
}

export async function loadStartupSettings(): Promise<StartupSettings> {
  try {
    const preferences = await loadPreferences()
    return { enabled: await isEnabled(), choiceMade: preferences.startupChoiceMade === true }
  } catch (error) {
    return { enabled: false, choiceMade: false, error: `Could not read startup settings: ${String(error)}` }
  }
}

export async function saveStartupSettings(enabled: boolean): Promise<void> {
  await invoke('set_startup_enabled', { enabled })
  if (await isEnabled() !== enabled) throw new Error('Windows did not apply the startup setting.')
  await savePreference('startupChoiceMade', true)
}