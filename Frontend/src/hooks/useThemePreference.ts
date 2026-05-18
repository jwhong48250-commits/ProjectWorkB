import { useCallback, useEffect, useMemo, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'workb-theme-preference'

function readStoredPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch {
    /* ignore */
  }
  return 'system'
}

function getMediaQuery(): MediaQueryList | null {
  if (typeof window === 'undefined') return null
  return window.matchMedia('(prefers-color-scheme: dark)')
}

export function useThemePreference() {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    typeof window === 'undefined' ? 'system' : readStoredPreference(),
  )

  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    const mq = getMediaQuery()
    return mq?.matches ?? false
  })

  // Keep in sync when OS appearance changes (always listen — cheap)
  useEffect(() => {
    const mq = getMediaQuery()
    if (!mq) return
    const onChange = () => setSystemPrefersDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const isDark = useMemo(() => {
    if (preference === 'dark') return true
    if (preference === 'light') return false
    return systemPrefersDark
  }, [preference, systemPrefersDark])

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const cyclePreference = useCallback(() => {
    setPreferenceState((prev) => {
      const order: ThemePreference[] = ['system', 'light', 'dark']
      const next = order[(order.indexOf(prev) + 1) % order.length]
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'
  }, [isDark])

  return { preference, isDark, setPreference, cyclePreference }
}
