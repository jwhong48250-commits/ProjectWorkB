import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { setAuthTokens, syncStoredUserFromToken } from '../../api/client'
import { completeSocialSignup, type SocialLoginRole } from '../../api/auth'
import { useAuth } from '../../context/AuthContext'

type PendingSocialSignup = {
  token: string
  email: string
  name: string
}

export default function OAuthCallbackPage() {
  const [searchParams] = useSearchParams()
  const [error, setError] = useState('')
  const [pendingSignup, setPendingSignup] = useState<PendingSocialSignup | null>(null)
  const [selectedRole, setSelectedRole] = useState<SocialLoginRole | null>(null)
  const [inviteCode, setInviteCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()
  const { refreshSession } = useAuth()

  async function finishWithTokens(accessToken: string, refreshToken: string, nextPath: string) {
    setAuthTokens(accessToken, refreshToken)
    syncStoredUserFromToken()
    await refreshSession()
    navigate(nextPath, { replace: true })
  }

  useEffect(() => {
    async function completeSocialLogin() {
      const accessToken = searchParams.get('access_token')
      const refreshToken = searchParams.get('refresh_token')
      const errorMessage = searchParams.get('error')
      const signupToken = searchParams.get('signup_token')

      if (errorMessage) {
        setError(errorMessage)
        return
      }

      if (searchParams.get('social_signup') === '1' && signupToken) {
        setPendingSignup({
          token: signupToken,
          email: searchParams.get('email') ?? '',
          name: searchParams.get('name') ?? '',
        })
        return
      }

      if (!accessToken || !refreshToken) {
        setError('소셜 로그인 응답이 올바르지 않습니다.')
        return
      }

      await finishWithTokens(accessToken, refreshToken, '/')
    }

    void completeSocialLogin()
  }, [searchParams])

  async function handleCompleteSignup(role: SocialLoginRole) {
    if (!pendingSignup) return
    const normalizedInviteCode = inviteCode.trim().toUpperCase()
    if (role === 'member' && normalizedInviteCode.length < 6) {
      setError('올바르지 않은 초대코드입니다.')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const tokens = await completeSocialSignup({
        signup_token: pendingSignup.token,
        role,
        invite_code: role === 'member' ? normalizedInviteCode : undefined,
      })
      await finishWithTokens(
        tokens.access_token,
        tokens.refresh_token,
        role === 'admin' ? '/onboarding/workspace' : '/',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : '소셜 회원가입에 실패했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  if (pendingSignup) {
    return (
      <div className="w-full max-w-sm">
        <h1 className="mb-2 text-center text-2xl font-bold text-foreground">소셜 회원가입</h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">
          {pendingSignup.email} 계정의 가입 유형을 선택하세요.
        </p>

        <div role="dialog" aria-modal="true" aria-label="소셜 회원가입 유형 선택" className="rounded-lg border border-border bg-card p-4">
          {!selectedRole ? (
            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => void handleCompleteSignup('admin')}
                disabled={submitting}
                className="h-10 rounded-lg bg-accent text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                관리자 회원가입
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedRole('member')
                  setError('')
                }}
                disabled={submitting}
                className="h-10 rounded-lg border border-border text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                멤버 회원가입
              </button>
            </div>
          ) : (
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                void handleCompleteSignup('member')
              }}
            >
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground" htmlFor="social-invite-code">
                  초대코드
                </label>
                <input
                  id="social-invite-code"
                  type="text"
                  value={inviteCode}
                  onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                  placeholder="WORKB-XXXXXX"
                  maxLength={20}
                  className="h-10 w-full rounded-lg border border-border bg-card px-3 font-mono text-sm tracking-widest outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRole(null)
                    setError('')
                  }}
                  disabled={submitting}
                  className="h-10 rounded-lg border border-border text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  이전
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="h-10 rounded-lg bg-accent text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? '가입 중...' : '가입 완료'}
                </button>
              </div>
            </form>
          )}
        </div>

        {error && <p className="mt-3 text-center text-sm text-red-500">{error}</p>}
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm text-center">
      <h1 className="mb-2 text-2xl font-bold text-foreground">소셜 로그인</h1>
      {error ? (
        <>
          <p className="mb-6 text-sm text-red-500">{error}</p>
          <Link to="/login" className="text-sm font-medium text-accent hover:underline">
            로그인으로 돌아가기
          </Link>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">로그인 정보를 확인하는 중입니다...</p>
      )}
    </div>
  )
}
