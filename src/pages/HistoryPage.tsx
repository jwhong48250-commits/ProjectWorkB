import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, User, ChevronDown, Clock } from 'lucide-react'
import clsx from 'clsx'
import Badge from '../components/ui/Badge'
import { formatDateFull, durationMinutes } from '../utils/format'
import { persistMeetingSnapshot } from '../utils/meetingRoutes'
import { getCurrentWorkspaceId, WORKSPACE_CHANGED_EVENT } from '../utils/workspace'
import type { Meeting, Participant } from '../types/meeting'
import { apiRequest } from '../api/client'
import { fetchWorkspaceMembers } from '../api/workspaceMembers'

type BackendStatus = 'scheduled' | 'in_progress' | 'done'
type UiStatus = 'upcoming' | 'inprogress' | 'completed'

interface MeetingHistoryParticipant {
  user_id: number
  name: string
}

interface MeetingHistoryItem {
  id: number
  title: string
  status: BackendStatus
  scheduled_at?: string | null
  started_at?: string | null
  ended_at?: string | null
  summary?: string | null
  participants?: MeetingHistoryParticipant[]
}

interface MeetingHistoryResponse {
  total: number
  page: number
  meetings: MeetingHistoryItem[]
}

function mapStatus(s: BackendStatus): UiStatus {
  if (s === 'in_progress') return 'inprogress'
  if (s === 'scheduled') return 'upcoming'
  return 'completed'
}

function pickStartAt(m: MeetingHistoryItem): string {
  return (
    m.started_at ??
    m.scheduled_at ??
    m.ended_at ??
    new Date().toISOString()
  )
}

const HISTORY_AVATAR_COLORS = [
  '#6b78f6',
  '#22c55e',
  '#f97316',
  '#ec4899',
  '#eab308',
  '#14b8a6',
  '#8b5cf6',
  '#64748b',
]

function historyParticipantsToAvatars(rows: MeetingHistoryParticipant[] | undefined): Participant[] {
  if (!rows?.length) return []
  return rows.map((p) => {
    const color = HISTORY_AVATAR_COLORS[Math.abs(p.user_id) % HISTORY_AVATAR_COLORS.length]
    const name = p.name.trim()
    const initials =
      name.length >= 2 ? name.slice(0, 2) : name.length === 1 ? name : '?'
    return {
      id: `u${p.user_id}`,
      userId: p.user_id,
      name: p.name,
      avatarInitials: initials,
      color,
    }
  })
}

function historyItemToMeeting(m: MeetingHistoryItem): Meeting {
  return {
    id: String(m.id),
    title: m.title,
    status: mapStatus(m.status) as Meeting['status'],
    startAt: pickStartAt(m),
    endAt: m.ended_at ?? undefined,
    participants: historyParticipantsToAvatars(m.participants),
    agenda: [],
    summary: m.summary ?? undefined,
    actionItemCount: 0,
    decisionCount: 0,
    tags: [],
  }
}

export default function HistoryPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const initialKeyword = (searchParams.get('keyword') ?? '').trim()

  const [searchKeyword, setSearchKeyword] = useState(initialKeyword)
  const [participantFilter, setParticipantFilter] = useState<string | null>(null)
  const [workspaceMembers, setWorkspaceMembers] = useState<
    { user_id: number; name: string }[]
  >([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [meetingsHistory, setMeetingsHistory] = useState<MeetingHistoryItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState(() => getCurrentWorkspaceId())

  // Keep state in sync when user lands via TopBar (/history?keyword=...)
  useEffect(() => {
    setSearchKeyword(initialKeyword)
  }, [initialKeyword])

  useEffect(() => {
    function onWsChanged(e: Event) {
      const id = (e as CustomEvent<{ id: number }>).detail?.id
      if (typeof id === 'number' && Number.isFinite(id)) setWorkspaceId(id)
    }
    window.addEventListener(WORKSPACE_CHANGED_EVENT, onWsChanged)
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, onWsChanged)
  }, [])

  useEffect(() => {
    let cancelled = false
    setMembersLoading(true)
    fetchWorkspaceMembers(workspaceId)
      .then((members) => {
        if (cancelled) return
        const sorted = [...members].sort((a, b) =>
          a.name.localeCompare(b.name, 'ko'),
        )
        setWorkspaceMembers(sorted.map((m) => ({ user_id: m.user_id, name: m.name })))
      })
      .catch(() => {
        if (!cancelled) setWorkspaceMembers([])
      })
      .finally(() => {
        if (!cancelled) setMembersLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  // Debounced fetch
  useEffect(() => {
    const keyword = searchKeyword.trim()
    const controller = new AbortController()
    const handle = setTimeout(() => {
      const qs = new URLSearchParams()
      if (keyword) qs.set('keyword', keyword)
      const pid = participantFilter ? Number(participantFilter) : NaN
      if (Number.isFinite(pid) && pid > 0) qs.set('participant_user_id', String(pid))
      qs.set('page', '1')
      qs.set('size', '20')

      setLoading(true)
      setError(null)

      apiRequest<MeetingHistoryResponse>(
        `/meetings/workspaces/${workspaceId}/history?${qs.toString()}`,
        { signal: controller.signal },
      )
        .then((data) => {
          setMeetingsHistory(data.meetings)
          setTotal(data.total)
        })
        .catch((e) => {
          if (e instanceof DOMException && e.name === 'AbortError') return
          setError(e instanceof Error ? e.message : String(e))
          setMeetingsHistory([])
          setTotal(0)
        })
        .finally(() => setLoading(false))
    }, 400)

    return () => {
      clearTimeout(handle)
      controller.abort()
    }
  }, [searchKeyword, workspaceId, participantFilter])

  const filtered = useMemo(() => meetingsHistory, [meetingsHistory])

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-6">

      {/* Page heading */}
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-foreground">회의 히스토리</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          키워드, 참석자 기준으로 이전 회의를 검색할 수 있습니다.
        </p>
      </div>

      {/* Filter bar — sticky */}
      <div className="sticky top-0 z-10 -mx-4 px-4 sm:-mx-6 sm:px-6 py-2.5 mb-4 bg-background border-b border-border flex flex-wrap items-center gap-2">
        {/* Keyword search */}
        <div className="flex items-center gap-2 h-8 px-3 rounded border border-border bg-card flex-1 min-w-[200px] max-w-sm">
          <Search size={13} className="text-muted-foreground shrink-0" />
          <input
            type="search"
            placeholder="회의 제목, 회의록 내용 검색..."
            value={searchKeyword}
            onChange={(e) => {
              const next = e.target.value
              setSearchKeyword(next)
              const params = new URLSearchParams(searchParams)
              if (next.trim()) params.set('keyword', next)
              else params.delete('keyword')
              setSearchParams(params, { replace: true })
            }}
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground min-w-0"
          />
        </div>

        {/* Participant filter */}
        <div className="relative">
          <select
            value={participantFilter ?? ''}
            onChange={(e) => setParticipantFilter(e.target.value || null)}
            className={clsx(
              'appearance-none h-8 pl-8 pr-7 rounded border text-sm bg-card cursor-pointer',
              'border-border hover:border-muted-foreground transition-colors outline-none',
              participantFilter ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <option value="">
              {membersLoading ? '참석자 목록 불러오는 중…' : '모든 참석자'}
            </option>
            {workspaceMembers.map((m) => (
              <option key={m.user_id} value={String(m.user_id)}>
                {m.name}
              </option>
            ))}
          </select>
          <User size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        </div>

        {/* Result count */}
        <span className="text-sm text-muted-foreground ml-auto">
          {loading ? '불러오는 중...' : `${total}개 회의`}
        </span>
      </div>

      {/* Meeting list */}
      {error ? (
        <div className="mb-4 p-3 rounded border border-red-500/20 bg-red-500/5 text-sm text-red-600">
          {error}
        </div>
      ) : null}

      {filtered.length === 0 && !loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-2">
          <Search size={32} className="text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">검색 결과가 없습니다.</p>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-border border border-border rounded-lg overflow-hidden bg-card">
          {/* Table header */}
          <div className="hidden md:grid grid-cols-[1fr_auto] gap-4 px-4 py-2 bg-muted/60 text-micro font-medium text-muted-foreground uppercase tracking-wide border-b border-border">
            <span>회의</span>
            <span className="text-right">일시</span>
          </div>

          {filtered.map((meeting) => (
            <MeetingRow
              key={meeting.id}
              meeting={meeting}
              onClick={() => {
                persistMeetingSnapshot(historyItemToMeeting(meeting))
                const path =
                  meeting.status === 'scheduled'
                    ? `/meetings/${meeting.id}/upcoming`
                    : `/meetings/${meeting.id}/notes`
                navigate(path)
              }}
            />
          ))}
        </div>
      )}

      {/* Chatbot placeholder */}
      {/* <div className="mt-6 mb-6 p-4 rounded-lg border border-dashed border-border bg-muted/20 text-center">
        <MessageSquare size={18} className="text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground font-medium">챗봇으로 과거 회의 내용 질문하기</p>
        <p className="text-mini text-muted-foreground/70 mt-0.5">
          TODO: implement chatbot panel for history search
          예: "지난 달 투자 관련 회의에서 결정된 사항을 알려줘"
        </p>
      </div> */}
    </div>
  )
}

// ── MeetingRow ────────────────────────────────────────────────────────────
function MeetingRow({
  meeting,
  onClick,
}: {
  meeting: MeetingHistoryItem
  onClick: () => void
}) {
  const startAt = pickStartAt(meeting)
  const endAt = meeting.ended_at ?? undefined
  const duration = endAt ? durationMinutes(startAt, endAt) : null

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 md:gap-4 px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors"
    >
      {/* Title + tags */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <Badge variant={mapStatus(meeting.status)} dot={meeting.status === 'in_progress'} />
          <h3 className="text-sm font-medium text-foreground truncate">{meeting.title}</h3>
        </div>
        {meeting.summary && (
          <p className="text-mini text-muted-foreground line-clamp-2">
            {meeting.summary}
          </p>
        )}
      </div>

      {/* Date + duration */}
      <div className="flex flex-col items-end justify-center gap-0.5 text-right">
        <span className="text-sm text-foreground whitespace-nowrap">
          {formatDateFull(startAt)}
        </span>
        {duration && (
          <span className="flex items-center gap-1 text-mini text-muted-foreground">
            <Clock size={10} />
            {duration}분
          </span>
        )}
      </div>

    </div>
  )
}
