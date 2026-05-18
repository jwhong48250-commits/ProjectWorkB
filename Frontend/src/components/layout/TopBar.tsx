import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Plus, Sun, Moon, Bell, Monitor, Menu, LogOut } from 'lucide-react'
import clsx from 'clsx'
import type { ThemePreference } from '../../hooks/useThemePreference'
import NotificationsPanel from './NotificationsPanel'
import Tooltip from '../ui/Tooltip'
import { getCurrentWorkspaceRole, WORKSPACE_ROLE_CHANGED_EVENT } from '../../utils/workspace'
import { apiRequest } from '../../api/client'
import { getCurrentWorkspaceId } from '../../utils/workspace'

interface TopBarProps {
  themePreference: ThemePreference
  /** 실제 적용 중인 다크 여부 (시스템 모드면 OS와 동기) */
  resolvedDark: boolean
  onCycleTheme: () => void
  onMenuOpen?: () => void
  onLogout?: () => void
}

const THEME_CYCLE_HINT: Record<ThemePreference, string> = {
  system: '테마: 시스템에 맞춤. 클릭하면 라이트 고정',
  light: '테마: 라이트 고정. 클릭하면 다크 고정',
  dark: '테마: 다크 고정. 클릭하면 시스템에 맞춤',
}

export default function TopBar({
  themePreference,
  resolvedDark,
  onCycleTheme,
  onMenuOpen,
  onLogout,
}: TopBarProps) {
  const navigate = useNavigate()
  const [searchFocused, setSearchFocused] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [workspaceRole, setWorkspaceRole] = useState(() => getCurrentWorkspaceRole())
  const searchInputRef = useRef<HTMLInputElement>(null)

  const refreshUnreadCount = useCallback(async () => {
    const workspaceId = getCurrentWorkspaceId()
    try {
      const res = await apiRequest<{ unread_count: number }>(
        `/notifications/workspaces/${workspaceId}?limit=1`,
      )
      setUnreadCount(Number(res.unread_count ?? 0) || 0)
    } catch {
      setUnreadCount(0)
    }
  }, [])

  const shortcutKbd =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent)
      ? '⌘K'
      : 'Ctrl+K'

  useEffect(() => {
    function onGlobalKeyDown(e: KeyboardEvent) {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key.toLowerCase() !== 'k') return
      e.preventDefault()
      const input = searchInputRef.current
      if (!input) return
      input.focus()
      input.select()
    }
    window.addEventListener('keydown', onGlobalKeyDown)
    return () => window.removeEventListener('keydown', onGlobalKeyDown)
  }, [])

  useEffect(() => {
    if (!notifOpen) return

    function handleDown(event: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotifOpen(false)
      }
    }

    document.addEventListener('mousedown', handleDown)
    return () => document.removeEventListener('mousedown', handleDown)
  }, [notifOpen])

  useEffect(() => {
    function onRoleChanged(e: Event) {
      const role = (e as CustomEvent<{ role: string }>).detail?.role
      if (typeof role === 'string') setWorkspaceRole(role)
    }
    window.addEventListener(WORKSPACE_ROLE_CHANGED_EVENT, onRoleChanged)
    return () => window.removeEventListener(WORKSPACE_ROLE_CHANGED_EVENT, onRoleChanged)
  }, [])

  useEffect(() => {
    let mounted = true
    async function safeRefresh() {
      if (!mounted) return
      await refreshUnreadCount()
    }

    safeRefresh()
    const id = window.setInterval(safeRefresh, 30000)
    return () => {
      mounted = false
      window.clearInterval(id)
    }
  }, [refreshUnreadCount])

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const q = searchQuery.trim()
    if (q) navigate(`/history?keyword=${encodeURIComponent(q)}`)
  }

  return (
    <header className="flex items-center gap-2 px-3 sm:px-4 h-11 border-b border-border bg-background shrink-0">
      <Tooltip label="메뉴 열기" placement="bottom">
        <button
          className="md:hidden flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
          aria-label="메뉴 열기"
          aria-expanded={false}
          onClick={onMenuOpen}
        >
          <Menu size={18} aria-hidden="true" />
        </button>
      </Tooltip>

      <div
        className={clsx(
          'flex items-center gap-2 flex-1 max-w-xs h-7 px-2.5 rounded border text-sm transition-colors',
          searchFocused
            ? 'border-accent bg-card ring-1 ring-accent/20'
            : 'border-border bg-muted hover:border-muted-foreground/60',
        )}
      >
        <Search size={13} className="text-muted-foreground shrink-0" aria-hidden="true" />
        <input
          ref={searchInputRef}
          type="search"
          placeholder="회의 검색..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground min-w-0"
          aria-label="회의 검색"
        />
        {!searchFocused && (
          <kbd className="hidden sm:flex items-center gap-0.5 text-micro text-muted-foreground pointer-events-none">
            <span>{shortcutKbd}</span>
          </kbd>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        {workspaceRole === 'admin' && (
          <Tooltip label="새 회의 생성" placement="bottom">
            <button
              onClick={() => navigate('/meetings/new')}
              className={clsx(
                'flex items-center gap-1.5 h-7 px-3 rounded text-sm font-medium transition-colors',
                'bg-accent text-accent-foreground hover:opacity-90',
              )}
              aria-label="새 회의 생성"
            >
              <Plus size={13} aria-hidden="true" />
              <span className="hidden sm:inline">새 회의</span>
            </button>
          </Tooltip>
        )}

        <div ref={notifRef} className="relative">
          <Tooltip label="알림" placement="bottom">
            <button
              onClick={() => setNotifOpen((open) => !open)}
              className="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors relative"
              aria-label="알림"
              aria-haspopup="dialog"
              aria-expanded={notifOpen}
            >
              <Bell size={15} aria-hidden="true" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent" aria-hidden="true" />
              )}
            </button>
          </Tooltip>

          {notifOpen && (
            <NotificationsPanel
              onClose={() => setNotifOpen(false)}
              onUnreadCountChange={(count) => setUnreadCount(count)}
            />
          )}
        </div>

        <Tooltip label={THEME_CYCLE_HINT[themePreference]} placement="bottom">
          <button
            type="button"
            onClick={onCycleTheme}
            className="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label={THEME_CYCLE_HINT[themePreference]}
          >
            {themePreference === 'system' ? (
              <Monitor size={15} aria-hidden="true" />
            ) : resolvedDark ? (
              <Moon size={15} aria-hidden="true" />
            ) : (
              <Sun size={15} aria-hidden="true" />
            )}
          </button>
        </Tooltip>

        <Tooltip label="로그아웃" placement="bottom">
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="로그아웃"
          >
            <LogOut size={15} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    </header>
  )
}
