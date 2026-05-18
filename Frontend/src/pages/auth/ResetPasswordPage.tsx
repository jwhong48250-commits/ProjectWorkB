import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, Mail } from 'lucide-react'
import { confirmPasswordReset, requestPasswordReset } from '../../api/auth'
import { ApiError } from '../../api/client'

function validatePassword(password: string): string | null {
  if (password.length < 8 || password.length > 64) return '비밀번호는 8자 이상 64자 이하여야 합니다.'
  if (!/[a-zA-Z]/.test(password)) return '비밀번호에는 영문자가 최소 1개 이상 포함되어야 합니다.'
  if (!/\d/.test(password)) return '비밀번호에는 숫자가 최소 1개 이상 포함되어야 합니다.'
  return null
}

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [step, setStep] = useState<'email' | 'sent' | 'done'>(token ? 'email' : 'email')
  const [email, setEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleRequestReset(event: FormEvent) {
    event.preventDefault()
    if (!email.trim()) {
      setError('이메일을 입력해주세요.')
      return
    }

    setLoading(true)
    setError('')

    try {
      await requestPasswordReset({ email: email.trim() })
      setStep('sent')
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : '비밀번호 재설정 메일 발송에 실패했습니다.',
      )
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirmReset(event: FormEvent) {
    event.preventDefault()
    setError('')

    const validation = validatePassword(newPassword)
    if (validation) {
      setError(validation)
      return
    }
    if (newPassword !== confirmPassword) {
      setError('새 비밀번호가 일치하지 않습니다.')
      return
    }

    setLoading(true)
    try {
      await confirmPasswordReset({ token, new_password: newPassword })
      setStep('done')
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : '비밀번호 재설정에 실패했습니다.',
      )
    } finally {
      setLoading(false)
    }
  }

  if (step === 'sent') {
    return (
      <div className="w-full max-w-sm text-center">
        <Mail size={42} className="mx-auto mb-4 text-accent" />
        <h1 className="mb-2 text-xl font-bold text-foreground">이메일을 확인하세요</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          <strong>{email}</strong>로 비밀번호 재설정 링크를 보냈습니다.
        </p>
        <Link to="/login" className="text-sm font-medium text-accent hover:underline">
          로그인으로 돌아가기
        </Link>
      </div>
    )
  }

  if (step === 'done') {
    return (
      <div className="w-full max-w-sm text-center">
        <Check size={42} className="mx-auto mb-4 text-accent" />
        <h1 className="mb-2 text-xl font-bold text-foreground">비밀번호가 변경되었습니다</h1>
        <p className="mb-6 text-sm text-muted-foreground">새 비밀번호로 다시 로그인해주세요.</p>
        <Link to="/login" className="text-sm font-medium text-accent hover:underline">
          로그인으로 돌아가기
        </Link>
      </div>
    )
  }

  if (token) {
    return (
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-2xl font-bold text-foreground">새 비밀번호 설정</h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">앞으로 사용할 새 비밀번호를 입력해주세요.</p>

        <form onSubmit={handleConfirmReset} className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">새 비밀번호</label>
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="8자 이상"
              className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">새 비밀번호 확인</label>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="비밀번호를 다시 입력"
              className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="mt-1 h-10 rounded-lg bg-accent text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? '변경 중...' : '비밀번호 변경'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="mb-1 text-center text-2xl font-bold text-foreground">비밀번호 재설정</h1>
      <p className="mb-6 text-center text-sm text-muted-foreground">가입한 이메일 주소를 입력하면 재설정 링크를 보내드립니다.</p>

      <form onSubmit={handleRequestReset} className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">이메일</label>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="your@email.com"
            className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="h-10 rounded-lg bg-accent text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? '발송 중...' : '재설정 링크 보내기'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link to="/login" className="font-medium text-accent hover:underline">로그인으로 돌아가기</Link>
      </p>
    </div>
  )
}
