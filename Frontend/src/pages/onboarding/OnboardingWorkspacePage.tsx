import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, Check } from 'lucide-react'
import { getCurrentWorkspaceId } from '../../api/client'
import { getWorkspace, updateWorkspace } from '../../api/workspace'

const INDUSTRIES = ['IT/소프트웨어', '금융/핀테크', '마케팅/광고', '제조업', '의료/헬스케어', '교육', '기타']
const LANGUAGES = ['한국어', 'English', '日本語', '中文']

export default function OnboardingWorkspacePage() {
  const [teamName, setTeamName] = useState('')
  const [industry, setIndustry] = useState('')
  const [language, setLanguage] = useState('한국어')
  const [inviteCode, setInviteCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const workspaceId = getCurrentWorkspaceId()

  useEffect(() => {
    let active = true

    async function loadWorkspace() {
      setLoading(true)
      setError('')

      try {
        const workspace = await getWorkspace(workspaceId)
        if (!active) return
        setTeamName(workspace.name)
        setIndustry(workspace.industry ?? '')
        setLanguage(workspace.default_language ?? '한국어')
        setInviteCode(workspace.invite_code)
      } catch (err) {
        if (!active) return
        setError(err instanceof Error ? err.message : '워크스페이스 정보를 불러오지 못했습니다.')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadWorkspace()

    return () => {
      active = false
    }
  }, [workspaceId])

  function handleCopy() {
    navigator.clipboard.writeText(inviteCode).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    try {
      await updateWorkspace(workspaceId, {
        name: teamName,
        industry: industry || null,
        default_language: language,
      })
      navigate('/onboarding/integrations')
    } catch (err) {
      setError(err instanceof Error ? err.message : '워크스페이스 설정에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="w-full max-w-md">
        <p className="text-sm text-muted-foreground">워크스페이스 정보를 불러오는 중입니다...</p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md">
      {/* Progress */}
      <div className="flex items-center gap-2 mb-8">
        {['워크스페이스', '연동 설정', '멤버 초대'].map((step, i) => (
          <div key={step} className="flex items-center gap-2 flex-1">
            <div className={`flex items-center justify-center w-6 h-6 rounded-full text-mini font-bold ${i === 0 ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'}`}>
              {i + 1}
            </div>
            <span className={`text-mini flex-1 ${i === 0 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{step}</span>
            {i < 2 && <div className="w-4 h-px bg-border" />}
          </div>
        ))}
      </div>

      <h1 className="text-2xl font-bold text-foreground mb-1">워크스페이스 만들기</h1>
      <p className="text-sm text-muted-foreground mb-6">팀 정보를 입력하고 초대코드를 멤버에게 공유하세요.</p>
      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">팀 이름 <span className="text-red-500">*</span></label>
          <input
            type="text"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="예: Workb 팀"
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">업종</label>
          <select
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
          >
            <option value="">업종 선택</option>
            {INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">주요 회의 언어</label>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => setLanguage(lang)}
                className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${language === lang ? 'border-accent bg-accent-subtle text-accent' : 'border-border text-muted-foreground hover:border-foreground'}`}
              >
                {lang}
              </button>
            ))}
          </div>
        </div>

        {/* Invite code */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">초대코드</label>
          <div className="flex items-center gap-2 h-10 px-3 rounded-lg border border-border bg-muted/50">
            <span className="flex-1 font-mono text-sm tracking-widest text-foreground">{inviteCode}</span>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 text-mini text-accent hover:text-accent/80 transition-colors"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? '복사됨' : '복사'}
            </button>
          </div>
          <p className="text-mini text-muted-foreground mt-1">이 코드를 멤버에게 공유하면 워크스페이스에 참여할 수 있습니다.</p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="h-10 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {saving ? '저장 중...' : '다음 → 연동 설정'}
        </button>
      </form>
    </div>
  )
}
