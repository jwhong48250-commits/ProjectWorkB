import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

export type FontScale = 'sm' | 'md' | 'lg'

const STORAGE_KEY = 'workb-font-scale'

function readStored(): FontScale {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'sm' || raw === 'md' || raw === 'lg') return raw
  } catch {
    /* ignore */
  }
  return 'md'
}

type FontScaleContextValue = {
  fontScale: FontScale
  setFontScale: (next: FontScale) => void
  previewFontScale: (next: FontScale) => void
}

const FontScaleContext = createContext<FontScaleContextValue | null>(null)

export function FontScaleProvider({ children }: { children: ReactNode }) {
  const [fontScale, setFontScaleState] = useState<FontScale>(() =>
    typeof window === 'undefined' ? 'md' : readStored(),
  )

  const setFontScale = useCallback((next: FontScale) => {
    setFontScaleState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const previewFontScale = useCallback((next: FontScale) => {
    setFontScaleState(next)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.fontScale = fontScale
  }, [fontScale])

  return (
    <FontScaleContext.Provider value={{ fontScale, setFontScale, previewFontScale }}>
      {children}
    </FontScaleContext.Provider>
  )
}

export function useFontScale() {
  const ctx = useContext(FontScaleContext)
  if (!ctx) {
    throw new Error('useFontScale must be used within FontScaleProvider')
  }
  return ctx
}
