import { useEffect, useState } from 'react'
import { removeWorkspaceLogosMatching } from './workspaceLogo'

export const PROFILE_IMAGE_CHANGED_EVENT = 'workb-profile-image-changed'

function getProfileImageKey(userId: number | undefined): string {
  return `workb-profile-image-${userId ?? 'guest'}`
}

export function getProfileImage(userId: number | undefined): string {
  const key = getProfileImageKey(userId)
  const stored = localStorage.getItem(key) ?? sessionStorage.getItem(key)

  if (stored) {
    localStorage.setItem(key, stored)
    sessionStorage.removeItem(key)
  }

  return stored ?? ''
}

export function setProfileImage(userId: number | undefined, profileImage: string): void {
  const key = getProfileImageKey(userId)

  if (profileImage) {
    localStorage.setItem(key, profileImage)
    removeWorkspaceLogosMatching(profileImage)
  } else {
    localStorage.removeItem(key)
  }

  sessionStorage.removeItem(key)
  window.dispatchEvent(
    new CustomEvent(PROFILE_IMAGE_CHANGED_EVENT, {
      detail: { userId, profileImage },
    }),
  )
}

export function useProfileImage(userId: number | undefined): string {
  const [profileImage, setProfileImageState] = useState(() => getProfileImage(userId))

  useEffect(() => {
    setProfileImageState(getProfileImage(userId))

    function handleProfileImageChanged(event: Event) {
      const detail = (event as CustomEvent<{ userId: number | undefined; profileImage: string }>).detail
      if (detail?.userId === userId) {
        setProfileImageState(detail.profileImage)
      }
    }

    window.addEventListener(PROFILE_IMAGE_CHANGED_EVENT, handleProfileImageChanged)
    return () => window.removeEventListener(PROFILE_IMAGE_CHANGED_EVENT, handleProfileImageChanged)
  }, [userId])

  return profileImage
}
