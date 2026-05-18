import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

export type AccentPreset = 'pink' | 'yellow' | 'green' | 'blue' | 'purple'

const STORAGE_KEY = 'workb-accent-preset'
const STORAGE_MAIN_KEY = 'workb-accent-as-main'

type AccentTokenSet = {
  accent: string
  accentForeground: string
  accentSubtle: string
  sidebarActive: string
}

type AccentPalette = {
  label: string
  swatch: string
  hue: number
  light: AccentTokenSet
  dark: AccentTokenSet
}

/** 메인 톤 켜질 때 덮어쓰는 변수 — 끌 때 전부 제거 */
const BOLD_MAIN_KEYS = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--muted',
  '--muted-foreground',
  '--border',
  '--sidebar',
  '--sidebar-foreground',
  '--sidebar-border',
  '--sidebar-hover',
  '--accent',
  '--accent-foreground',
  '--accent-subtle',
  '--sidebar-active',
] as const

export const ACCENT_PALETTES: Record<AccentPreset, AccentPalette> = {
  pink: {
    label: '핑크',
    swatch: '#EC4899',
    hue: 330,
    light: {
      accent: '330 81% 60%',
      accentForeground: '0 0% 100%',
      accentSubtle: '330 86% 95%',
      sidebarActive: '330 70% 95%',
    },
    dark: {
      accent: '330 81% 60%',
      accentForeground: '0 0% 100%',
      accentSubtle: '330 34% 18%',
      sidebarActive: '330 35% 22%',
    },
  },
  yellow: {
    label: '노랑',
    swatch: '#FFB703',
    hue: 43,
    light: {
      accent: '43 100% 51%',
      accentForeground: '220 20% 12%',
      accentSubtle: '43 100% 94%',
      sidebarActive: '43 90% 93%',
    },
    dark: {
      accent: '43 100% 51%',
      accentForeground: '220 25% 8%',
      accentSubtle: '43 45% 14%',
      sidebarActive: '43 55% 16%',
    },
  },
  green: {
    label: '초록',
    swatch: '#22C55E',
    hue: 142,
    light: {
      accent: '142 71% 45%',
      accentForeground: '0 0% 100%',
      accentSubtle: '142 60% 94%',
      sidebarActive: '142 52% 93%',
    },
    dark: {
      accent: '142 71% 45%',
      accentForeground: '0 0% 100%',
      accentSubtle: '142 40% 15%',
      sidebarActive: '142 38% 20%',
    },
  },
  blue: {
    label: '파랑',
    swatch: '#5668F3',
    hue: 237,
    light: {
      accent: '237 84% 63%',
      accentForeground: '0 0% 100%',
      accentSubtle: '237 84% 95%',
      sidebarActive: '237 85% 95%',
    },
    dark: {
      accent: '237 84% 63%',
      accentForeground: '0 0% 100%',
      accentSubtle: '237 28% 18%',
      sidebarActive: '237 30% 22%',
    },
  },
  purple: {
    label: '보라',
    swatch: '#8B5CF6',
    hue: 258,
    light: {
      accent: '258 90% 66%',
      accentForeground: '0 0% 100%',
      accentSubtle: '258 86% 95%',
      sidebarActive: '258 72% 94%',
    },
    dark: {
      accent: '258 90% 66%',
      accentForeground: '0 0% 100%',
      accentSubtle: '258 33% 19%',
      sidebarActive: '258 35% 23%',
    },
  },
}

function readStoredPreset(): AccentPreset {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw && raw in ACCENT_PALETTES) return raw as AccentPreset
  } catch {
    /* ignore */
  }
  return 'blue'
}

function readStoredAccentAsMain(): boolean {
  try {
    return localStorage.getItem(STORAGE_MAIN_KEY) === 'true'
  } catch {
    return false
  }
}

function clearBoldMainOverrides(root: HTMLElement) {
  for (const key of BOLD_MAIN_KEYS) {
    root.style.removeProperty(key)
  }
}

function applyAccentTokens(
  preset: AccentPreset,
  isDark: boolean,
  accentAsMain: boolean,
) {
  const palette = ACCENT_PALETTES[preset]
  const tokens = isDark ? palette.dark : palette.light
  const root = document.documentElement

  clearBoldMainOverrides(root)

  if (accentAsMain) {
    root.dataset.accentAsMain = 'true'
    root.style.setProperty('--accent', tokens.accent)
    root.style.setProperty('--accent-foreground', tokens.accentForeground)
    root.style.setProperty(
      '--accent-subtle',
      isDark ? `${palette.hue} 34% 20%` : `${palette.hue} 76% 92%`,
    )
    root.style.setProperty(
      '--sidebar-active',
      isDark ? `${palette.hue} 38% 24%` : `${palette.hue} 70% 90%`,
    )
    return
  }

  delete root.dataset.accentAsMain

  root.style.setProperty('--accent', tokens.accent)
  root.style.setProperty('--accent-foreground', tokens.accentForeground)
  root.style.setProperty('--accent-subtle', tokens.accentSubtle)
  root.style.setProperty('--sidebar-active', tokens.sidebarActive)
}

type AccentColorContextValue = {
  accentPreset: AccentPreset
  setAccentPreset: (next: AccentPreset) => void
  previewAccentPreset: (next: AccentPreset) => void
  accentPalettes: typeof ACCENT_PALETTES
  accentAsMain: boolean
  setAccentAsMain: (value: boolean) => void
  previewAccentAsMain: (value: boolean) => void
}

const AccentColorContext = createContext<AccentColorContextValue | null>(null)

export function AccentColorProvider({ children }: { children: ReactNode }) {
  const [accentPreset, setAccentPresetState] = useState<AccentPreset>(() =>
    typeof window === 'undefined' ? 'blue' : readStoredPreset(),
  )

  const [accentAsMain, setAccentAsMainState] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : readStoredAccentAsMain(),
  )

  const setAccentPreset = useCallback((next: AccentPreset) => {
    setAccentPresetState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const previewAccentPreset = useCallback((next: AccentPreset) => {
    setAccentPresetState(next)
  }, [])

  const setAccentAsMain = useCallback((value: boolean) => {
    setAccentAsMainState(value)
    try {
      localStorage.setItem(STORAGE_MAIN_KEY, value ? 'true' : 'false')
    } catch {
      /* ignore */
    }
  }, [])

  const previewAccentAsMain = useCallback((value: boolean) => {
    setAccentAsMainState(value)
  }, [])

  const syncToDocument = useCallback(() => {
    const isDark = document.documentElement.classList.contains('dark')
    applyAccentTokens(accentPreset, isDark, accentAsMain)
  }, [accentPreset, accentAsMain])

  useEffect(() => {
    syncToDocument()
  }, [syncToDocument])

  useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() => syncToDocument())
    obs.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [syncToDocument])

  const value: AccentColorContextValue = {
    accentPreset,
    setAccentPreset,
    previewAccentPreset,
    accentPalettes: ACCENT_PALETTES,
    accentAsMain,
    setAccentAsMain,
    previewAccentAsMain,
  }

  return (
    <AccentColorContext.Provider value={value}>{children}</AccentColorContext.Provider>
  )
}

export function useAccentColor() {
  const ctx = useContext(AccentColorContext)
  if (!ctx) {
    throw new Error('useAccentColor must be used within AccentColorProvider')
  }
  return ctx
}
