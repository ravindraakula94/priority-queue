import { invoke } from '@tauri-apps/api/core'
import { isEnabled } from '@tauri-apps/plugin-autostart'
import { load } from '@tauri-apps/plugin-store'

export interface StartupSettings {
  enabled: boolean
  choiceMade: boolean
  error?: string
}

export async function loadStartupSettings(): Promise<StartupSettings> {
  try {
    const preferences = await load('preferences.json', { autoSave: false, defaults: {} })
    return { enabled: await isEnabled(), choiceMade: await preferences.get('startupChoiceMade') === true }
  } catch (error) {
    return { enabled: false, choiceMade: false, error: `Could not read startup settings: ${String(error)}` }
  }
}

export async function saveStartupSettings(enabled: boolean): Promise<void> {
  await invoke('set_startup_enabled', { enabled })
  if (await isEnabled() !== enabled) throw new Error('Windows did not apply the startup setting.')
  const preferences = await load('preferences.json', { autoSave: false, defaults: {} })
  await preferences.set('startupChoiceMade', true)
  await preferences.save()
}