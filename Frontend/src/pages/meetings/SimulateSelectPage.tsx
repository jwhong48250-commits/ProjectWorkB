import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Clock, CalendarDays, ChevronRight, FlaskConical } from 'lucide-react'
import clsx from 'clsx'
import { getCurrentWorkspaceId } from '../../api/client'
import { fetchScheduledMeetings, type MeetingHistoryItem } from '../../api/meetings'

function pickDate(m: MeetingHistoryItem) {
  return m.scheduled_at ?? m.started_at ?? new Date().toISOString()
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

export default function SimulateSelectPage() {
  const navigate = useNavigate()
  const workspaceId = getCurrentWorkspaceId()

  const [meetings, setMeetings] = useState<MeetingHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [inputValue, setInputValue] = useState('')

  useEffect(() => {
    setLoading(true)
    fetchScheduledMeetings(workspaceId, 1, 50, keyword)
      .then((d) => setMeetings(d.meetings))
      .catch(() => setMeetings([]))
      .finally(() => setLoading(false))
  }, [workspaceId, keyword])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setKeyword(inputValue)
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <FlaskConical size={15} className="text-accent" />
          <span className="text-mini text-accent font-medium">개발·QA 전용</span>
        </div>
        <h1 className="text-xl font-semibold text-foreground">WAV 시뮬레이션</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          WAV 파일로 처리할 예정된 회의를 선택하세요.
        </p>
      </div>

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

      {loading ? (
        <div className="flex justify-center py-20 text-sm text-muted-foreground">불러오는 중…</div>
      ) : meetings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
          <CalendarDays size={32} className="opacity-20" />
          <p className="text-sm">{keyword ? '검색 결과가 없습니다.' : '예정된 회의가 없습니다.'}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {meetings.map((meeting) => {
            const date = pickDate(meeting)
            return (
              <button
                key={meeting.id}
                onClick={() => navigate(`/meetings/${meeting.id}/simulate`)}
                className={clsx(
                  'group flex items-start gap-4 p-4 rounded-xl border border-border bg-card text-left',
                  'hover:border-accent/60 hover:bg-accent/5 hover:shadow-sm transition-all duration-150',
                )}
              >
                <div className="flex flex-col items-center justify-center w-11 h-11 rounded-lg bg-muted shrink-0">
                  <CalendarDays size={18} className="text-muted-foreground mb-0.5" />
                  <span className="text-micro text-muted-foreground font-medium">
                    {new Date(date).getDate()}일
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate group-hover:text-accent transition-colors">
                    {meeting.title}
                  </p>
                  <div className="flex items-center gap-3 mt-1.5 text-mini text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <CalendarDays size={10} />
                      {formatDate(date)} {formatTime(date)}
                    </span>
                    <span className={clsx(
                      'px-1.5 py-0.5 rounded-full text-micro font-medium',
                      meeting.status === 'in_progress'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
                    )}>
                      {meeting.status === 'in_progress' ? '진행 중' : '예정'}
                    </span>
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
    </div>
  )
}
