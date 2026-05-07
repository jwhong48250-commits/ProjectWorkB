import { useEffect, useState } from 'react'

export const DEFAULT_WORKSPACE_LOGO_URL = '/brand/workb-logo.png'
export const WORKSPACE_LOGO_CHANGED_EVENT = 'workb-workspace-logo-changed'

function getWorkspaceLogoKey(workspaceId: number): string {
  return `workb-workspace-logo-${workspaceId}`
}

function isProfileImageValue(value: string): boolean {
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key?.startsWith('workb-profile-image-') && localStorage.getItem(key) === value) {
      return true
    }
  }

  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index)
    if (key?.startsWith('workb-profile-image-') && sessionStorage.getItem(key) === value) {
      return true
    }
  }

  return false
}

export function removeWorkspaceLogosMatching(value: string): void {
  if (!value) return

  const keysToRemove: string[] = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key?.startsWith('workb-workspace-logo-') && localStorage.getItem(key) === value) {
      keysToRemove.push(key)
    }
  }

  keysToRemove.forEach((key) => localStorage.removeItem(key))
}

export function getStoredWorkspaceLogoUrl(workspaceId: number): string {
  if (!Number.isFinite(workspaceId) || workspaceId <= 0) {
    return ''
  }

  const key = getWorkspaceLogoKey(workspaceId)
  const stored = localStorage.getItem(key) ?? sessionStorage.getItem(key)

  if (stored && stored !== DEFAULT_WORKSPACE_LOGO_URL && !isProfileImageValue(stored)) {
    localStorage.setItem(key, stored)
    sessionStorage.removeItem(key)
    return stored
  }

  localStorage.removeItem(key)
  sessionStorage.removeItem(key)
  return ''
}

export function getWorkspaceLogoUrl(workspaceId: number): string {
  if (!Number.isFinite(workspaceId) || workspaceId <= 0) {
    return DEFAULT_WORKSPACE_LOGO_URL
  }

  return getStoredWorkspaceLogoUrl(workspaceId) || DEFAULT_WORKSPACE_LOGO_URL
}

export function setWorkspaceLogoUrl(workspaceId: number, logoUrl: string | null): void {
  if (!Number.isFinite(workspaceId) || workspaceId <= 0) return

  const key = getWorkspaceLogoKey(workspaceId)
  const nextLogoUrl = logoUrl || DEFAULT_WORKSPACE_LOGO_URL

  if (logoUrl && logoUrl !== DEFAULT_WORKSPACE_LOGO_URL) {
    localStorage.setItem(key, logoUrl)
  } else {
    localStorage.removeItem(key)
  }

  sessionStorage.removeItem(key)
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_LOGO_CHANGED_EVENT, {
      detail: { workspaceId, logoUrl: nextLogoUrl },
    }),
  )
}

export function clearWorkspaceLogoUrl(workspaceId: number): void {
  setWorkspaceLogoUrl(workspaceId, null)
}

export function useWorkspaceLogo(workspaceId: number): string {
  const [logoUrl, setLogoUrl] = useState(() => getWorkspaceLogoUrl(workspaceId))

  useEffect(() => {
    setLogoUrl(getWorkspaceLogoUrl(workspaceId))

    function handleLogoChanged(event: Event) {
      const detail = (event as CustomEvent<{ workspaceId: number; logoUrl: string }>).detail
      if (detail?.workspaceId === workspaceId) {
        setLogoUrl(detail.logoUrl || DEFAULT_WORKSPACE_LOGO_URL)
      }
    }

    window.addEventListener(WORKSPACE_LOGO_CHANGED_EVENT, handleLogoChanged)
    return () => window.removeEventListener(WORKSPACE_LOGO_CHANGED_EVENT, handleLogoChanged)
  }, [workspaceId])

  return logoUrl
}

export function useStoredWorkspaceLogo(workspaceId: number): string {
  const [logoUrl, setLogoUrl] = useState(() => getStoredWorkspaceLogoUrl(workspaceId))

  useEffect(() => {
    setLogoUrl(getStoredWorkspaceLogoUrl(workspaceId))

    function handleLogoChanged(event: Event) {
      const detail = (event as CustomEvent<{ workspaceId: number; logoUrl: string }>).detail
      if (detail?.workspaceId === workspaceId) {
        setLogoUrl(detail.logoUrl === DEFAULT_WORKSPACE_LOGO_URL ? '' : detail.logoUrl || '')
      }
    }

    window.addEventListener(WORKSPACE_LOGO_CHANGED_EVENT, handleLogoChanged)
    return () => window.removeEventListener(WORKSPACE_LOGO_CHANGED_EVENT, handleLogoChanged)
  }, [workspaceId])

  return logoUrl
}
