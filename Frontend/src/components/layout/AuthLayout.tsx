import { Outlet } from 'react-router-dom'
import WorkbAssistantAvatar from '../chat/WorkbAssistantAvatar'

export default function AuthLayout() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      {/* Logo */}
      <div className="flex items-center gap-2 mb-8">
        <WorkbAssistantAvatar size={32} />
        <span className="text-xl font-bold text-foreground tracking-tight">Workb</span>
      </div>
      <Outlet />
    </div>
  )
}
