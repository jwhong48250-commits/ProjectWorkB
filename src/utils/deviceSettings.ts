export const DEVICE_SETTINGS_STORAGE_KEY = 'workb-device-settings'

export interface StoredDeviceSettings {
  selectedMicId: string
  selectedCameraId: string
  micEnabled: boolean
  cameraEnabled: boolean
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null

  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function normalizeDeviceId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export function readStoredDeviceSettings(): Partial<StoredDeviceSettings> {
  const storage = getStorage()
  if (!storage) return {}

  try {
    const raw = storage.getItem(DEVICE_SETTINGS_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object'
      ? parsed as Partial<StoredDeviceSettings>
      : {}
  } catch {
    storage.removeItem(DEVICE_SETTINGS_STORAGE_KEY)
    return {}
  }
}

export function getSelectedMicId(): string | null {
  return normalizeDeviceId(readStoredDeviceSettings().selectedMicId)
}

export function getSelectedCameraId(): string | null {
  return normalizeDeviceId(readStoredDeviceSettings().selectedCameraId)
}

export function getMicEnabled(defaultValue = true): boolean {
  const value = readStoredDeviceSettings().micEnabled
  return typeof value === 'boolean' ? value : defaultValue
}
