import { useState, type FormEvent } from 'react'
import { Check, KeyRound, LockKeyhole, Save } from 'lucide-react'
import { ApiError } from '../../api/client'
import { changePassword } from '../../api/auth'

function validatePassword(password: string): string | null {
  if (password.length < 8 || password.length > 64) {
    return '비밀번호는 8자 이상 64자 이하여야 합니다.'
  }
  if (!/[a-zA-Z]/.test(password)) {
    return '비밀번호에는 영문자가 최소 1개 이상 포함되어야 합니다.'
  }
  if (!/\d/.test(password)) {
    return '비밀번호에는 숫자가 최소 1개 이상 포함되어야 합니다.'
  }
  return null
}

export default function PasswordSettingsPage() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setMessage('')

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('모든 필드를 입력해주세요.')
      return
    }

    const validation = validatePassword(newPassword)
    if (validation) {
      setError(validation)
      return
    }

    if (newPassword !== confirmPassword) {
      setError('새 비밀번호가 일치하지 않습니다.')
      return
    }

    setSaving(true)
    try {
      const response = await changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setMessage(response.message)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : '비밀번호 변경에 실패했습니다.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <div className="mb-6">
        <h1 className="mb-1 text-xl font-semibold text-foreground">비밀번호 변경</h1>
        <p className="text-sm text-muted-foreground">계정 로그인에 사용하는 비밀번호를 변경합니다.</p>
      </div>

      <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-card p-4">
        <div className="mb-4 flex items-start gap-3">
          <KeyRound size={20} className="mt-0.5 shrink-0 text-accent" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">계정 보안</h2>
            <p className="text-mini text-muted-foreground">새 비밀번호는 영문과 숫자를 포함해야 합니다.</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground" htmlFor="current-password">
              현재 비밀번호
            </label>
            <div className="relative">
              <LockKeyhole size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground" htmlFor="new-password">
              새 비밀번호
            </label>
            <div className="relative">
              <LockKeyhole size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground" htmlFor="confirm-password">
              새 비밀번호 확인
            </label>
            <div className="relative">
              <LockKeyhole size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </div>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        {message && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent">
            <Check size={14} />
            {message}
          </p>
        )}

        <div className="mt-5 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save size={15} />
            {saving ? '변경 중...' : '비밀번호 변경'}
          </button>
        </div>
      </form>
    </div>
  )
}
