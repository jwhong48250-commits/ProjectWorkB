import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../../api/auth', () => ({
  getSocialOAuthUrl: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  signupAdmin: vi.fn(),
  signupMember: vi.fn(),
}))

vi.mock('../../api/client', () => ({
  ApiError: class ApiError extends Error {},
  setCurrentWorkspaceId: vi.fn(),
}))

vi.mock('../../api/workspace', () => ({
  validateInviteCode: vi.fn(),
}))

const mockRefreshSession = vi.hoisted(() => vi.fn())
const mockSignOut = vi.hoisted(() => vi.fn())

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    refreshSession: mockRefreshSession,
    signOut: mockSignOut,
  }),
}))

import LoginPage from '../../pages/auth/LoginPage'
import SignupPage from '../../pages/auth/SignupPage'
import { getSocialOAuthUrl, login } from '../../api/auth'

function renderLoginPage(initialPath = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/" element={<div>홈 페이지</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('로그인 플로우 통합 테스트', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    window.history.replaceState(null, '', '/')
    mockRefreshSession.mockResolvedValue(null)
    mockSignOut.mockResolvedValue(undefined)
  })

  describe('로그인 성공', () => {
    it('관리자로 로그인하면 홈으로 이동합니다', async () => {
      vi.mocked(login).mockResolvedValueOnce({
        access_token: 'fake-token',
        refresh_token: 'fake-refresh',
        token_type: 'bearer',
      })
      mockRefreshSession.mockResolvedValueOnce({ id: 'u1', email: 'admin@test.com', role: 'admin' })

      renderLoginPage()

      await userEvent.type(screen.getByLabelText('이메일'), 'admin@test.com')
      await userEvent.type(screen.getByLabelText('비밀번호'), 'Admin1234')
      await userEvent.click(screen.getByRole('button', { name: '로그인' }))

      await waitFor(() => {
        expect(screen.getByText('홈 페이지')).toBeInTheDocument()
      })
      expect(login).toHaveBeenCalledWith({ email: 'admin@test.com', password: 'Admin1234' })
    })
  })

  describe('로그인 실패', () => {
    it('소셜 로그인 콜백 에러 쿼리를 표시합니다', async () => {
      renderLoginPage('/login?error=%EA%B4%80%EB%A6%AC%EC%9E%90%20%EA%B3%84%EC%A0%95%EC%9C%BC%EB%A1%9C%20%EB%A1%9C%EA%B7%B8%EC%9D%B8%ED%95%B4%EC%A3%BC%EC%84%B8%EC%9A%94.')

      expect(await screen.findByText('관리자 계정으로 로그인해주세요.')).toBeInTheDocument()
    })

    it('잘못된 자격증명으로 로그인하면 에러 메시지가 표시됩니다', async () => {
      vi.mocked(login).mockRejectedValueOnce(new Error('아이디 또는 비밀번호가 틀렸습니다.'))

      renderLoginPage()

      await userEvent.type(screen.getByLabelText('이메일'), 'wrong@test.com')
      await userEvent.type(screen.getByLabelText('비밀번호'), 'Wrong1234')
      await userEvent.click(screen.getByRole('button', { name: '로그인' }))

      await waitFor(() => {
        expect(screen.getByText('아이디 또는 비밀번호가 틀렸습니다.')).toBeInTheDocument()
      })
    })
  })

  describe('회원가입 진입', () => {
    it('로그인 화면에서 멤버/관리자 회원가입 링크를 표시합니다', async () => {
      renderLoginPage()

      expect(screen.getByRole('link', { name: '멤버/관리자 회원가입' })).toHaveAttribute('href', '/signup')
    })

    it('회원가입 화면은 기본으로 멤버 가입 폼을 표시합니다', async () => {
      renderLoginPage('/signup')

      expect(screen.getByRole('heading', { name: '멤버 회원가입' })).toBeInTheDocument()
      expect(screen.getByPlaceholderText('WORKB-XXXXXX')).toBeInTheDocument()
    })

    it('회원가입 화면에서 관리자 탭으로 전환할 수 있습니다', async () => {
      renderLoginPage('/signup')

      await userEvent.click(screen.getByRole('tab', { name: '관리자' }))

      expect(screen.getByRole('heading', { name: '관리자 회원가입' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /워크스페이스 생성/ })).toBeInTheDocument()
    })
  })

  describe('소셜 로그인', () => {
    it('Google 소셜 로그인 URL로 이동합니다', async () => {
      vi.mocked(getSocialOAuthUrl).mockResolvedValueOnce({
        auth_url: '#google-oauth',
      })

      renderLoginPage()

      await userEvent.click(screen.getByRole('button', { name: /Google로 계속하기/ }))

      await waitFor(() => {
        expect(getSocialOAuthUrl).toHaveBeenCalledWith('google')
      })
      expect(window.location.hash).toBe('#google-oauth')
    })

    it('카카오 소셜 로그인 URL을 요청합니다', async () => {
      vi.mocked(getSocialOAuthUrl).mockResolvedValueOnce({
        auth_url: '#kakao-oauth',
      })

      renderLoginPage()
      await userEvent.click(screen.getByRole('button', { name: /카카오로 계속하기/ }))

      await waitFor(() => {
        expect(getSocialOAuthUrl).toHaveBeenCalledWith('kakao')
      })
    })
  })

  describe('로딩 상태', () => {
    it('로그인 요청 중에는 버튼이 비활성화됩니다', async () => {
      vi.mocked(login).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 10_000)),
      )

      renderLoginPage()

      await userEvent.type(screen.getByLabelText('이메일'), 'admin@test.com')
      await userEvent.type(screen.getByLabelText('비밀번호'), 'Admin1234')
      await userEvent.click(screen.getByRole('button', { name: '로그인' }))

      expect(screen.getByRole('button', { name: '로그인 중...' })).toBeDisabled()
    })
  })
})
