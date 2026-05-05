import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'

// Layouts
import AppShell from './components/layout/AppShell'
import AuthLayout from './components/layout/AuthLayout'
import FullscreenLayout from './components/layout/FullscreenLayout'
import { PublicOnlyRoute, RequireAuthRoute, RequireMeetingCreatorRoute, RequireWorkspaceAdminRoute } from './components/auth/AuthGuards'

// Auth pages
import LoginPage from './pages/auth/LoginPage'
import OAuthCallbackPage from './pages/auth/OAuthCallbackPage'
import SignupAdminPage from './pages/auth/SignupAdminPage'
import SignupMemberPage from './pages/auth/SignupMemberPage'
import ResetPasswordPage from './pages/auth/ResetPasswordPage'

// Onboarding pages
import OnboardingWorkspacePage from './pages/onboarding/OnboardingWorkspacePage'
import OnboardingIntegrationsPage from './pages/onboarding/OnboardingIntegrationsPage'
import OnboardingInvitePage from './pages/onboarding/OnboardingInvitePage'

// App shell pages
import HomePage from './pages/HomePage'
import HistoryPage from './pages/HistoryPage'
import CalendarPage from './pages/CalendarPage'
import SupportPage from './pages/SupportPage'

// Meeting pages
import NewMeetingPage from './pages/meetings/NewMeetingPage'
import MeetingContextPage from './pages/meetings/MeetingContextPage'
import NotesPage from './pages/meetings/NotesPage'
import NotesEditPage from './pages/meetings/NotesEditPage'
import WbsPage from './pages/meetings/WbsPage'
import ReportsPage from './pages/meetings/ReportsPage'
import ExportPage from './pages/meetings/ExportPage'
import MeetingSelectPage from './pages/meetings/MeetingSelectPage'
import UpcomingMeetingPage from './pages/meetings/UpcomingMeetingPage'
import SimulatePage from './pages/meetings/SimulatePage'
import SimulateSelectPage from './pages/meetings/SimulateSelectPage'

// Live pages
import LivePage from './pages/live/LivePage'

// Settings pages
import WorkspaceSettingsPage from './pages/settings/WorkspaceSettingsPage'
import MembersSettingsPage from './pages/settings/MembersSettingsPage'
import DepartmentsSettingsPage from './pages/settings/DepartmentsSettingsPage'
import VoiceSettingsPage from './pages/settings/VoiceSettingsPage'
import IntegrationsSettingsPage from './pages/settings/IntegrationsSettingsPage'
import DeviceSettingsPage from './pages/settings/DeviceSettingsPage'
import PasswordSettingsPage from './pages/settings/PasswordSettingsPage'
import MyPage from './pages/settings/MyPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ── 인증 라우트 (AppShell 없음) ── */}
        <Route element={<PublicOnlyRoute />}>
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
            <Route path="/signup/admin" element={<SignupAdminPage />} />
            <Route path="/signup/member" element={<SignupMemberPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
          </Route>
        </Route>

        {/* ── 온보딩 라우트 (AppShell 없음) ── */}
        <Route element={<RequireAuthRoute />}>
          <Route element={<AuthLayout />}>
            <Route path="/onboarding/workspace" element={<OnboardingWorkspacePage />} />
            <Route path="/onboarding/integrations" element={<OnboardingIntegrationsPage />} />
            <Route path="/onboarding/invite" element={<OnboardingInvitePage />} />
          </Route>
        </Route>

        {/* ── 실시간 회의 (풀스크린, 사이드바·탑바 없음) ── */}
        <Route element={<RequireAuthRoute />}>
          <Route element={<FullscreenLayout />}>
            <Route path="/live" element={<LivePage />} />
            <Route path="/live/:meetingId" element={<LivePage />} />
            {/* 보조 기능은 LivePage 내 패널로 통합됨 — 이하 리다이렉트 */}
            <Route path="/live/:meetingId/search" element={<Navigate to="/live/:meetingId" replace />} />
            <Route path="/live/:meetingId/screen" element={<Navigate to="/live/:meetingId" replace />} />
            <Route path="/live/:meetingId/speakers" element={<Navigate to="/live/:meetingId" replace />} />
          </Route>
        </Route>

        {/* ── 앱 셸 라우트 ── */}
        <Route path="/" element={<AppShell />}>
          {/* 홈 */}
          <Route index element={<HomePage />} />

          {/* 히스토리 */}
          <Route path="history" element={<HistoryPage />} />

          {/* 전체 캘린더 */}
          <Route path="calendar" element={<CalendarPage />} />

          {/* 고객지원 */}
          <Route path="support" element={<SupportPage />} />

          {/* 회의: 생성(뷰어 제외) & 사전 */}
          <Route element={<RequireMeetingCreatorRoute />}>
            <Route path="meetings/new" element={<NewMeetingPage />} />
          </Route>
          <Route path="meetings/context" element={<MeetingContextPage />} />

          {/* 회의: 예정 */}
          <Route path="meetings/:meetingId/upcoming" element={<UpcomingMeetingPage />} />

          {/* 회의: 사후 */}
          <Route path="meetings/post" element={<MeetingSelectPage />} />
          <Route path="meetings/wbs-select" element={<MeetingSelectPage />} />
          <Route path="meetings/:meetingId/notes" element={<NotesPage />} />
          <Route path="meetings/:meetingId/notes/edit" element={<NotesEditPage />} />
          <Route path="meetings/:meetingId/wbs" element={<WbsPage />} />
          <Route path="meetings/:meetingId/reports" element={<ReportsPage />} />
          <Route path="meetings/:meetingId/export" element={<ExportPage />} />
          <Route path="meetings/simulate-select" element={<SimulateSelectPage />} />
          <Route path="meetings/:meetingId/simulate" element={<SimulatePage />} />

          {/* 설정 */}
          <Route path="settings" element={<Navigate to="/settings/my" replace />} />
          <Route path="settings/my" element={<MyPage />} />
          <Route path="settings/password" element={<PasswordSettingsPage />} />
          <Route element={<RequireWorkspaceAdminRoute />}>
            <Route path="settings/workspace" element={<WorkspaceSettingsPage />} />
            <Route path="settings/members" element={<MembersSettingsPage />} />
            <Route path="settings/departments" element={<DepartmentsSettingsPage />} />
            <Route path="settings/integrations" element={<IntegrationsSettingsPage />} />
            <Route path="settings/device" element={<DeviceSettingsPage />} />
          </Route>
          <Route path="settings/voice" element={<VoiceSettingsPage />} />

          {/* 404 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
