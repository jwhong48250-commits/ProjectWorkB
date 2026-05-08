import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Sparkles, Calendar, ExternalLink, Loader2, X } from 'lucide-react'
import MeetingCard from '../components/home/MeetingCard'
import WeeklyStatsCard from '../components/home/WeeklyStats'
import WorkspaceMembersAside from '../components/home/WorkspaceMembersAside'
import type { MeetingStatus } from '../types/meeting'
import type { Meeting, WeeklyStats } from '../types/meeting'
import { fetchWorkspaceDashboard } from '../api/dashboard'
import { persistMeetingSnapshot } from '../utils/meetingRoutes'
import { suggestNextMeeting, type TimeSlot } from '../api/actions'
import { getCurrentWorkspaceId, WORKSPACE_CHANGED_EVENT } from '../utils/workspace'

type Tab = MeetingStatus

const TABS: { id: Tab; label: string }[] = [
  { id: 'inprogress', label: '진행 중' },
  { id: 'upcoming',   label: '예정' },
  { id: 'completed',  label: '완료' },
]

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<Tab>('inprogress')
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [weeklyStats, setWeeklyStats] = useState<WeeklyStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState(() => getCurrentWorkspaceId())
  const navigate = useNavigate()
  const [aiModalOpen, setAiModalOpen] = useState(false)
  const [aiMeetingId, setAiMeetingId] = useState('')
  const [aiMeetingTitle, setAiMeetingTitle] = useState('')

  useEffect(() => {
    function onWsChanged(e: Event) {
      const id = (e as CustomEvent<{ id: number }>).detail?.id
      if (typeof id === 'number' && Number.isFinite(id)) setWorkspaceId(id)
    }
    window.addEventListener(WORKSPACE_CHANGED_EVENT, onWsChanged)
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, onWsChanged)
  }, [])

  useEffect(() => {
    let mounted = true
    fetchWorkspaceDashboard(workspaceId)
      .then(({ meetings, weeklyStats }) => {
        if (!mounted) return
        setMeetings(meetings)
        setWeeklyStats(weeklyStats)
        setError(null)
      })
      .catch((e) => {
        if (!mounted) return
        setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      mounted = false
    }
  }, [workspaceId])

  const filtered = useMemo(
    () => meetings.filter((m) => m.status === activeTab),
    [meetings, activeTab],
  )

  return (
    <>
    <div className="flex h-full">
      {/* ── Main feed ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-w-0">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">

          {/* Page heading */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
            <div>
              <h1 className="text-xl font-semibold text-foreground">홈</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
              </p>
            </div>
            {/* AI 추천 일정 제안 — placeholder */}
            <button
              onClick={() => {
                const latestDone = meetings.find((m) => m.status === 'completed')
                if (!latestDone) {
                  navigate('/meetings/new')
                  return
                }
                setAiMeetingId(String(latestDone.id))
                setAiMeetingTitle(latestDone.title)
                setAiModalOpen(true)
              }}
              className="self-start flex items-center gap-1.5 h-8 px-3 rounded border border-accent/40 text-sm text-accent font-medium hover:bg-accent-subtle transition-colors"
            >
              <Sparkles size={13} />
              AI 일정 제안
            </button>
          </div>

          {/* Tabs */}
          <div
            role="tablist"
            aria-label="회의 목록 그룹"
            className="flex items-center gap-0.5 mb-4 border-b border-border"
          >
            {TABS.map((tab) => {
              const count = meetings.filter((m) => m.status === tab.id).length
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                    activeTab === tab.id
                      ? 'border-accent text-accent'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tab.label}
                  {count > 0 && (
                    <span className={clsx(
                      'px-1.5 py-0.5 rounded-full text-micro',
                      activeTab === tab.id ? 'bg-accent-subtle text-accent' : 'bg-muted text-muted-foreground',
                    )}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Tab panel */}
          <div
            role="tabpanel"
            aria-label={`${TABS.find((t) => t.id === activeTab)?.label} 회의 목록`}
          >
            {error && (
              <div className="mb-3 p-3 rounded border border-red-500/20 bg-red-500/5 text-sm text-red-600">
                {error}
              </div>
            )}
            {filtered.length === 0 ? (
              <EmptyState status={activeTab} />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {filtered.map((meeting) => (
                  <MeetingCard key={meeting.id} meeting={meeting} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Right aside panel ─────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-72 xl:w-80 shrink-0 border-l border-border overflow-y-auto bg-muted/20">
        <div className="sticky top-0 px-4 py-4 flex flex-col gap-4">

          {/* Next meeting callout */}
          <NextMeetingBanner meetings={meetings} />

          {/* Weekly stats */}
          {weeklyStats && <WeeklyStatsCard stats={weeklyStats} />}

          {/* Workspace members (Slack-style sidebar) */}
          <WorkspaceMembersAside workspaceId={workspaceId} />
        </div>
      </aside>
    </div>
    {aiModalOpen && aiMeetingId && (
      <AiScheduleModal
        meetingId={aiMeetingId}
        meetingTitle={aiMeetingTitle}
        workspaceId={workspaceId}
        onClose={() => setAiModalOpen(false)}
      />
    )}
    </>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────

function EmptyState({ status }: { status: Tab }) {
  const msg: Record<Tab, string> = {
    inprogress: '현재 진행 중인 회의가 없습니다.',
    upcoming:   '예정된 회의가 없습니다. 새 회의를 예약해 보세요.',
    completed:  '완료된 회의가 없습니다.',
  }
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
      <Calendar size={32} className="text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">{msg[status]}</p>
    </div>
  )
}

function NextMeetingBanner({ meetings }: { meetings: Meeting[] }) {
  const next = meetings.find((m) => m.status === 'upcoming')
  if (!next) return null

  const diffMs = new Date(next.startAt).getTime() - Date.now()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
  const label = diffHours > 0 ? `${diffHours}시간 ${diffMins}분 후` : `${diffMins}분 후`

  return (
    <Link
      to={`/meetings/${next.id}/upcoming`}
      onClick={() => persistMeetingSnapshot(next)}
      aria-label={`다음 회의: ${next.title} 상세 보기`}
      className="block p-3 rounded-lg bg-accent-subtle border border-accent/20 hover:border-accent/50 hover:bg-accent/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <div className="flex items-center gap-1.5 mb-1">
        <Sparkles size={12} className="text-accent" />
        <span className="text-mini font-medium text-accent">다음 회의</span>
        <span className="ml-auto text-mini text-accent/70">{label}</span>
      </div>
      <p className="text-sm font-medium text-foreground line-clamp-1">{next.title}</p>
      <p className="text-mini text-muted-foreground mt-0.5">
        {next.participants.length}명 참석 예정
      </p>
    </Link>
  )
}

function AiScheduleModal({
  meetingId, meetingTitle, workspaceId, onClose,
}: {
  meetingId: string
  meetingTitle: string
  workspaceId: number
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [step, setStep] = useState<'suggest' | 'slots'>('suggest')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slots, setSlots] = useState<TimeSlot[]>([])
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null)
  const [title, setTitle] = useState('')

  async function handleSuggest() {
    setError(null)
    setLoading(true)
    try {
      const res = await suggestNextMeeting(meetingId, workspaceId, { duration_minutes: 60 })
      if (!res.slots || res.slots.length === 0) {
        setError('추천 가능한 빈 시간이 없습니다. 참석자 캘린더를 확인해주세요.')
        return
      }
      setSlots(res.slots)
      setSelectedSlot(res.slots[0])
      setStep('slots')
    } catch {
      setError('일정 조회에 실패했습니다. Slack · Google Calendar 연동 상태를 확인해주세요.')
    } finally {
      setLoading(false)
    }
  }

  function formatSlot(slot: TimeSlot) {
    const start = new Date(slot.start)
    const end = new Date(slot.end)
    const date = start.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })
    const startTime = start.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    const endTime = end.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    return `${date}  ${startTime} — ${endTime}`
  }

  function handleNavigate() {
    if (!selectedSlot || !title.trim()) return
    navigate('/meetings/new', {
      state: {
        draftMeeting: {
          id: '',
          title: title.trim(),
          startAt: selectedSlot.start,
          status: 'upcoming',
          participants: [],
          actionItemCount: 0,
          decisionCount: 0,
          tags: [],
        },
      },
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card rounded-xl border border-border shadow-2xl w-full max-w-sm mx-4">
        <div className="flex items-start justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground">AI 일정 제안</h2>
            <p className="text-mini text-muted-foreground mt-0.5">
              {step === 'suggest'
                ? `"${meetingTitle}" 기준으로 분석합니다`
                : '일정을 선택하고 회의 제목을 입력하세요'}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors mt-0.5">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {step === 'suggest' ? (
            <>
              <p className="text-sm text-muted-foreground">
                Slack 채널 멤버의 가용 시간을 분석해 최적의 회의 시간 3개를 추천합니다. Slack · Google Calendar 연동이 필요합니다.
              </p>
              {error && (
                <p className="text-mini text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{error}</p>
              )}
            </>
          ) : (
            <>
              <div>
                <p className="text-sm font-medium text-foreground mb-2">추천 일정 선택</p>
                <div className="space-y-2">
                  {slots.map((slot, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedSlot(slot)}
                      className={clsx(
                        'w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-all',
                        selectedSlot === slot
                          ? 'border-accent bg-accent/10 ring-1 ring-accent/30'
                          : 'border-border hover:bg-muted/30',
                      )}
                    >
                      <div className={clsx(
                        'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0',
                        selectedSlot === slot ? 'border-accent bg-accent' : 'border-muted-foreground/30',
                      )}>
                        {selectedSlot === slot && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                      <span className="text-sm text-foreground flex-1">{formatSlot(slot)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground mb-1.5">회의 제목 <span className="text-red-500">*</span></p>
                <input
                  autoFocus
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleNavigate()}
                  placeholder="예: Q2 2주차 스프린트 회의"
                  className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                />
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex items-center gap-2">
          {step === 'slots' && (
            <button
              onClick={() => { setStep('suggest'); setError(null) }}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors mr-auto"
            >
              ← 다시
            </button>
          )}
          <div className={clsx('flex gap-2', step === 'suggest' && 'ml-auto')}>
            <button
              onClick={onClose}
              className="h-8 px-4 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
            >
              취소
            </button>
            {step === 'suggest' ? (
              <button
                onClick={handleSuggest}
                disabled={loading}
                className="h-8 px-4 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 disabled:opacity-50 flex items-center gap-1.5"
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {loading ? '조회 중...' : 'AI 일정 추천'}
              </button>
            ) : (
              <button
                onClick={handleNavigate}
                disabled={!selectedSlot || !title.trim()}
                className="h-8 px-4 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 disabled:opacity-50 flex items-center gap-1.5"
              >
                <ExternalLink size={12} /> 회의 생성 페이지로
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
