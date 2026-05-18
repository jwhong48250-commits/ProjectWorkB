import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { login, signupMember } from '../../api/auth'
import { setCurrentWorkspaceId } from '../../api/client'
import { validateInviteCode } from '../../api/workspace'
import { useAuth } from '../../context/AuthContext'

type SignupTab = 'admin' | 'member'

interface SignupMemberPageProps {
  embedded?: boolean
  onSelectAdmin?: () => void
}

export default function SignupMemberPage({ embedded = false, onSelectAdmin }: SignupMemberPageProps = {}) {
  const [searchParams] = useSearchParams()
  const [inviteCode, setInviteCode] = useState(() => searchParams.get('invite')?.toUpperCase() ?? '')
  const [verifiedInviteCode, setVerifiedInviteCode] = useState('')
  const [verifiedWorkspaceId, setVerifiedWorkspaceId] = useState<number | null>(null)
  const [workspaceName, setWorkspaceName] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [validatingInvite, setValidatingInvite] = useState(false)
  const navigate = useNavigate()
  const { saveUser } = useAuth()

  function normalizeInviteCode(value: string) {
    return value.trim().toUpperCase()
  }

  async function handleValidateInviteCode() {
    const normalizedCode = normalizeInviteCode(inviteCode)
    if (normalizedCode.length < 6) {
      setError('초대코드를 확인해주세요.')
      return null
    }

    setValidatingInvite(true)
    setError('')

    try {
      const invite = await validateInviteCode(normalizedCode)
      setInviteCode(normalizedCode)
      setVerifiedInviteCode(normalizedCode)
      setVerifiedWorkspaceId(invite.workspace_id)
      setWorkspaceName(invite.workspace_name)
      return invite
    } catch (err) {
      setVerifiedInviteCode('')
      setVerifiedWorkspaceId(null)
      setWorkspaceName('')
      setError(err instanceof Error ? err.message : '유효하지 않은 초대코드입니다.')
      return null
    } finally {
      setValidatingInvite(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteCode || !email || !name || !password || !confirmPassword) { setError('모든 필드를 입력해주세요.'); return }
    if (inviteCode.length < 6) { setError('초대코드를 확인해주세요.'); return }
    if (password !== confirmPassword) { setError('비밀번호가 일치하지 않습니다.'); return }

    setLoading(true)
    setError('')

    try {
      const normalizedCode = normalizeInviteCode(inviteCode)
      const invite = verifiedInviteCode === normalizedCode && verifiedWorkspaceId
        ? { workspace_id: verifiedWorkspaceId, workspace_name: workspaceName, valid: true }
        : await handleValidateInviteCode()

      if (!invite) return

      setCurrentWorkspaceId(invite.workspace_id)
      const member = await signupMember({
        invite_code: normalizedCode,
        email: email.trim(),
        password,
        name: name.trim(),
      })
      await login({ email: email.trim(), password })
      saveUser({
        id: member.id,
        email: member.email,
        name: member.name,
        role: member.role,
        workspace_id: invite.workspace_id,
        birth_date: member.birth_date,
        age: member.age,
        phone_number: member.phone_number,
        gender: member.gender,
      })
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : '멤버 회원가입에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md">
      {!embedded && (
        <>
          <h1 className="text-2xl font-bold text-foreground text-center mb-1">멤버 회원가입</h1>
          <p className="text-sm text-muted-foreground text-center mb-6">관리자에게 받은 초대코드로 가입하세요.</p>

          <div role="tablist" className="flex rounded-lg bg-muted p-1 mb-6">
            {(['admin', 'member'] as SignupTab[]).map((signupTab) => (
              <button
                key={signupTab}
                type="button"
                role="tab"
                aria-selected={signupTab === 'member'}
                onClick={() => {
                  if (signupTab === 'admin') {
                    if (onSelectAdmin) onSelectAdmin()
                    else navigate('/signup/admin')
                  }
                }}
                className={clsx(
                  'flex-1 py-1.5 rounded-md text-sm font-medium transition-colors',
                  signupTab === 'member' ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {signupTab === 'admin' ? '관리자' : '멤버'}
              </button>
            ))}
          </div>
        </>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">초대코드</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => {
                const nextCode = e.target.value.toUpperCase()
                setInviteCode(nextCode)
                if (normalizeInviteCode(nextCode) !== verifiedInviteCode) {
                  setVerifiedInviteCode('')
                  setVerifiedWorkspaceId(null)
                  setWorkspaceName('')
                }
              }}
              placeholder="WORKB-XXXXXX"
              maxLength={20}
              className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 font-mono text-sm tracking-widest outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
            <button
              type="button"
              onClick={handleValidateInviteCode}
              disabled={validatingInvite}
              className="h-10 shrink-0 rounded-lg border border-border px-3 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              {validatingInvite ? '확인 중...' : '코드 확인'}
            </button>
          </div>
          <p className="text-mini text-muted-foreground mt-1">관리자로부터 전달받은 초대코드를 먼저 확인하세요.</p>
          {workspaceName && (
            <p className="text-mini text-accent mt-1">{workspaceName} 워크스페이스에 참여합니다.</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">이메일</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">이름</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="홍길동"
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">비밀번호</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="8자 이상"
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">비밀번호 확인</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="비밀번호를 다시 입력"
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
          />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="h-10 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors mt-1 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? '가입 중...' : '회원가입 완료'}
        </button>
      </form>

      {!embedded && (
        <p className="text-center text-sm text-muted-foreground mt-6">
          초대코드 없이 가입하려면?{' '}
          <Link to="/signup/admin" className="text-accent font-medium hover:underline">관리자로 가입</Link>
        </p>
      )}
    </div>
  )
}
