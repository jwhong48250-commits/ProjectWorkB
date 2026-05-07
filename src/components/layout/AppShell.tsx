import { useState } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import ChatFAB from '../chat/ChatFAB'
import { useThemePreference } from '../../hooks/useThemePreference'
import { useAuth } from '../../context/AuthContext'

export default function AppShell() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { preference, isDark, cyclePreference } = useThemePreference()
  const { loading, isAuthenticated, signOut } = useAuth()

  async function handleLogout() {
    await signOut()
    navigate('/login', { replace: true })
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">로그인 상태를 확인하는 중입니다...</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar
          themePreference={preference}
          resolvedDark={isDark}
          onCycleTheme={cyclePreference}
          onMenuOpen={() => setMobileOpen(true)}
          onLogout={handleLogout}
        />
        <main id="main" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <Outlet />
        </main>
      </div>
      {/* Global chatbot FAB — visible on all authenticated pages */}
      <ChatFAB />
    </div>
  )
}
