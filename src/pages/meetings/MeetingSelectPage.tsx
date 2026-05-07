import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Search, Clock, Users, ChevronRight, ChevronLeft, FileText, CalendarDays } from 'lucide-react'
import clsx from 'clsx'
import { getCurrentWorkspaceId } from '../../api/client'
import { fetchDoneMeetings, type MeetingHistoryItem } from '../../api/meetings'

const PAGE_SIZE = 10

function pickDate(m: MeetingHistoryItem) {
  return m.started_at ?? m.scheduled_at ?? m.ended_at ?? new Date().toISOString()
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

function parseSummaryPreview(raw: string | null | undefined): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    const points: string[] = parsed.key_points ?? []
    return points.slice(0, 2).join(' ・ ')
  } catch {
    return raw
  }
}

export default function MeetingSelectPage() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const isWbs = pathname === '/meetings/wbs-select'
  const workspaceId = getCurrentWorkspaceId()

  const [meetings, setMeetings] = useState<MeetingHistoryItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [inputValue, setInputValue] = useState('')

  useEffect(() => {
    fetchDoneMeetings(workspaceId, page, PAGE_SIZE, keyword)
      .then((d) => { setMeetings(d.meetings); setTotal(d.total) })
      .catch(() => { setMeetings([]); setTotal(0) })
  }, [workspaceId, page, keyword])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setPage(1)
    setKeyword(inputValue)
  }

  function handleSelect(meeting: MeetingHistoryItem) {
    const date = pickDate(meeting)
    if (isWbs) {
      navigate(`/meetings/${meeting.id}/wbs`, { state: { meetingTitle: meeting.title } })
    } else {
      navigate(`/meetings/${meeting.id}/reports?tab=minutes`, {
        state: { meetingTitle: meeting.title, meetingDate: date },
      })
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      {/* 헤더 — 기존 동일 */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <FileText size={15} className="text-accent" />
          <span className="text-mini text-accent font-medium">회의 후 작업</span>
        </div>
        <h1 className="text-xl font-semibold text-foreground">회의 선택</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {isWbs ? 'WBS 태스크를 확인할 완료된 회의를 선택하세요.' : '회의록·보고서를 작성할 완료된 회의를 선택하세요.'}
        </p>
      </div>

      {/* 검색 — 기존 동일 */}
      <form
        onSubmit={handleSearch}
        className="flex items-center gap-2 h-10 px-3.5 rounded-xl border border-border bg-card mb-5 focus-within:ring-2 focus-within:ring-accent/30 focus-within:border-accent transition-all"
      >
        <Search size={14} className="text-muted-foreground shrink-0" />
        <input
          type="search"
          placeholder="회의 제목 검색..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
        />
      </form>

      {/* 회의 목록 — 기존 카드 구조 동일 */}
      {meetings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
          <Search size={32} className="opacity-20" />
          <p className="text-sm">{keyword ? '검색 결과가 없습니다.' : '완료된 회의가 없습니다.'}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {meetings.map((meeting) => {
            const date = pickDate(meeting)
            return (
              <button
                key={meeting.id}
                onClick={() => handleSelect(meeting)}
                className={clsx(
                  'group flex items-start gap-4 p-4 rounded-xl border border-border bg-card text-left',
                  'hover:border-accent/60 hover:bg-accent/5 hover:shadow-sm transition-all duration-150',
                )}
              >
                <div className="flex flex-col items-center justify-center w-11 h-11 rounded-lg bg-muted shrink-0">
                  <CalendarDays size={18} className="text-muted-foreground mb-0.5" />
                  <span className="text-micro text-muted-foreground font-medium">{new Date(date).getDate()}일</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate group-hover:text-accent transition-colors">
                    {meeting.title}
                  </p>
                  {meeting.summary && (
                    <p className="text-mini text-muted-foreground mt-0.5 line-clamp-1">{parseSummaryPreview(meeting.summary)}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-mini text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <CalendarDays size={10} />
                      {formatDate(date)} {formatTime(date)}
                    </span>
                    {meeting.started_at && meeting.ended_at && (
                      <span className="flex items-center gap-1">
                        <Clock size={10} />
                        {Math.round((new Date(meeting.ended_at).getTime() - new Date(meeting.started_at).getTime()) / 60000)}분
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight
                  size={16}
                  className="text-muted-foreground shrink-0 mt-3 group-hover:text-accent group-hover:translate-x-0.5 transition-all"
                />
              </button>
            )
          })}
        </div>
      )}

      {/* 페이징 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="flex items-center gap-1 h-8 px-3 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted/50 transition-colors disabled:opacity-40"
          >
            <ChevronLeft size={14} /> 이전
          </button>
          <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="flex items-center gap-1 h-8 px-3 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted/50 transition-colors disabled:opacity-40"
          >
            다음 <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
