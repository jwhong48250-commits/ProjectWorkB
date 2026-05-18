import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, Check, UserPlus, Trash2 } from 'lucide-react'
import { getCurrentWorkspaceId } from '../../api/client'
import { getWorkspace, sendWorkspaceInviteEmails, type UserRole } from '../../api/workspace'

const ROLES = ['관리자', '멤버', '뷰어'] as const
type Role = typeof ROLES[number]

const ROLE_TO_BACKEND: Record<Role, UserRole> = {
  관리자: 'admin',
  멤버: 'member',
  뷰어: 'viewer',
}

interface InviteRow {
  id: string
  email: string
  role: Role
}

export default function OnboardingInvitePage() {
  const [inviteCode, setInviteCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [rows, setRows] = useState<InviteRow[]>([{ id: '1', email: '', role: '멤버' }])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const navigate = useNavigate()
  const workspaceId = getCurrentWorkspaceId()

  useEffect(() => {
    let active = true

    async function loadInviteCode() {
      setLoading(true)
      setError('')

      try {
        const workspace = await getWorkspace(workspaceId)
        if (active) setInviteCode(workspace.invite_code)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : '초대코드를 불러오지 못했습니다.')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadInviteCode()

    return () => {
      active = false
    }
  }, [workspaceId])

  function handleCopy() {
    navigator.clipboard.writeText(inviteCode).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function addRow() {
    setRows((prev) => [...prev, { id: Date.now().toString(), email: '', role: '멤버' }])
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  function updateRow(id: string, field: keyof InviteRow, value: string) {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, [field]: value } : r))
  }

  async function handleFinish() {
    setError('')
    setMessage('')

    const invites = rows
      .map((row) => ({
        email: row.email.trim(),
        role: ROLE_TO_BACKEND[row.role],
      }))
      .filter((row) => row.email)

    if (invites.length > 0) {
      setSending(true)
      try {
        const result = await sendWorkspaceInviteEmails(workspaceId, invites)
        setMessage(result.message)
      } catch (err) {
        setError(err instanceof Error ? err.message : '초대 메일 발송에 실패했습니다.')
        setSending(false)
        return
      }
      setSending(false)
    }

    sessionStorage.setItem('workb-auth-mock', 'true')
    localStorage.removeItem('workb-auth-mock')
    navigate('/')
  }

  if (loading) {
    return (
      <div className="w-full max-w-md">
        <p className="text-sm text-muted-foreground">초대코드를 불러오는 중입니다...</p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md">
      {/* Progress */}
      <div className="flex items-center gap-2 mb-8">
        {['워크스페이스', '연동 설정', '멤버 초대'].map((step, i) => (
          <div key={step} className="flex items-center gap-2 flex-1">
            <div className={`flex items-center justify-center w-6 h-6 rounded-full text-mini font-bold ${i === 2 ? 'bg-accent text-accent-foreground' : 'bg-accent/30 text-accent'}`}>
              {i < 2 ? <Check size={12} /> : i + 1}
            </div>
            <span className={`text-mini flex-1 ${i === 2 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{step}</span>
            {i < 2 && <div className="w-4 h-px bg-border" />}
          </div>
        ))}
      </div>

      <h1 className="text-2xl font-bold text-foreground mb-1">멤버 초대</h1>
      <p className="text-sm text-muted-foreground mb-6">초대코드를 공유하거나 이메일로 직접 초대하세요.</p>
      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
      {message && <p className="text-sm text-accent mb-3">{message}</p>}

      {/* Invite code */}
      <div className="p-3 rounded-lg border border-border bg-muted/30 mb-5">
        <p className="text-mini font-medium text-muted-foreground mb-2">초대코드 공유</p>
        <div className="flex items-center gap-2">
          <span className="flex-1 font-mono text-sm tracking-widest text-foreground bg-card px-3 py-2 rounded border border-border">
            {inviteCode}
          </span>
          <button onClick={handleCopy} className="flex items-center gap-1 px-3 py-2 rounded border border-border text-mini hover:bg-muted transition-colors">
            {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
            {copied ? '복사됨' : '복사'}
          </button>
        </div>
      </div>

      {/* Email invite */}
      <div className="mb-4">
        <p className="text-mini font-medium text-muted-foreground mb-2">이메일로 초대</p>
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-2">
              <input
                type="email"
                value={row.email}
                onChange={(e) => updateRow(row.id, 'email', e.target.value)}
                placeholder="email@company.com"
                className="flex-1 h-9 px-3 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
              />
              <select
                value={row.role}
                onChange={(e) => updateRow(row.id, 'role', e.target.value)}
                className="h-9 px-2 rounded-lg border border-border bg-card text-sm outline-none"
              >
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <button onClick={() => removeRow(row.id)} className="text-muted-foreground hover:text-foreground" aria-label="삭제">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <button onClick={addRow} className="flex items-center gap-1.5 mt-2 text-sm text-accent hover:text-accent/80 transition-colors">
          <UserPlus size={14} /> 한 명 더 추가
        </button>
      </div>

      <button
        onClick={handleFinish}
        disabled={sending}
        className="w-full h-10 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      >
        {sending ? '초대 발송 중...' : '초대 발송하고 시작하기'}
      </button>
      <button onClick={() => navigate('/')} disabled={sending} className="w-full h-9 text-sm text-muted-foreground hover:text-foreground transition-colors mt-1 disabled:cursor-not-allowed disabled:opacity-60">
        건너뛰고 시작하기
      </button>
    </div>
  )
}
