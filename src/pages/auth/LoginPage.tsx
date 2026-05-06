import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { getSocialOAuthUrl, login, type SocialProvider } from '../../api/auth'
import { useAuth } from '../../context/AuthContext'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { refreshSession } = useAuth()
  const returnTo = typeof location.state === 'object'
    && location.state
    && 'from' in location.state
    && typeof location.state.from === 'string'
    ? location.state.from
    : '/'

  useEffect(() => {
    const errorMessage = new URLSearchParams(location.search).get('error')
    if (errorMessage) {
      setError(errorMessage)
    }
  }, [location.search])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password) {
      setError('이메일과 비밀번호를 입력해주세요.')
      return
    }
    if (password.length < 8) {
      setError('비밀번호는 8자 이상 입력해주세요.')
      return
    }
    if (password.length > 64) {
      setError('비밀번호는 64자 이하로 입력해주세요.')
      return
    }

    setLoading(true)
    setError('')

    try {
      await login({ email, password })
      await refreshSession()
      navigate(returnTo, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSocialLogin(provider: SocialProvider) {
    setLoading(true)
    setError('')

    try {
      const { auth_url } = await getSocialOAuthUrl(provider)
      window.location.href = auth_url
    } catch (err) {
      setError(err instanceof Error ? err.message : '소셜 로그인을 시작하지 못했습니다.')
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-bold text-foreground text-center mb-1">로그인</h1>
      <p className="text-sm text-muted-foreground text-center mb-6">워크스페이스에 오신 것을 환영합니다.</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1" htmlFor="email">이메일</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1" htmlFor="password">비밀번호</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors"
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="h-10 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors mt-1 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? '로그인 중...' : '로그인'}
        </button>

        {/* Social login */}
        <div className="flex items-center gap-2 my-1">
          <div className="flex-1 border-t border-border" />
          <span className="text-mini text-muted-foreground">또는</span>
          <div className="flex-1 border-t border-border" />
        </div>
        <button
          type="button"
          onClick={() => void handleSocialLogin('google')}
          disabled={loading}
          className="h-10 rounded-lg border border-border bg-card text-sm font-medium hover:bg-muted/50 transition-colors flex items-center justify-center gap-2"
        >
          <img src="/brand/google.webp" alt="" className="h-5 w-5 object-contain" aria-hidden="true" />
          Google로 계속하기
        </button>
        <button
          type="button"
          onClick={() => void handleSocialLogin('kakao')}
          disabled={loading}
          className="h-10 rounded-lg border border-border bg-[#FEE500] text-[#3A1D1D] text-sm font-medium hover:bg-[#FEE500]/90 transition-colors flex items-center justify-center gap-2"
        >
          <img src="/brand/kakaotalk-transparent.png" alt="" className="h-5 w-5 object-contain" aria-hidden="true" />
          카카오로 계속하기
        </button>
      </form>

      <div className="flex flex-col items-center gap-2 mt-6 text-sm text-muted-foreground">
        <Link to="/reset-password" className="hover:text-foreground transition-colors">비밀번호를 잊으셨나요?</Link>
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <span>계정이 없으신가요?</span>
          <Link to="/signup/member" className="text-accent font-medium hover:underline">멤버 회원가입</Link>
          <span className="text-border">|</span>
          <Link to="/signup/admin" className="text-accent font-medium hover:underline">관리자 회원가입</Link>
        </div>
      </div>
    </div>
  )
}
