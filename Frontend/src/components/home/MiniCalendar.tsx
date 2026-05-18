import { useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import clsx from 'clsx'
import type { Meeting } from '../../types/meeting'
import { getGoogleCalendarEvents } from '../../api/integrations'
import { getCurrentWorkspaceId } from '../../utils/workspace'

function googleCalendarHomeUrl(): string {
  return 'https://calendar.google.com/calendar/u/0/r'
}

function getMeetingDates(meetings: Meeting[]): Set<string> {
  const s = new Set<string>()
  meetings.forEach((m) => s.add(new Date(m.startAt).toDateString()))
  return s
}

export default function MiniCalendar({ meetings = [] }: { meetings?: Meeting[] }) {
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth()) // 0-indexed
  const [selected, setSelected] = useState<Date | null>(null)
  const htmlLinkByEventIdRef = useRef<Map<string, string>>(new Map())

  const meetingDates = useMemo(() => getMeetingDates(meetings), [meetings])

  // First day of month, number of days
  // 월~일 기준으로 그리드를 맞추기 위해 leading empty cell 수를 변환한다.
  // getDay(): 0=Sun ... 6=Sat
  // Monday-first: 0=Mon ... 6=Sun
  const firstDaySun0 = new Date(viewYear, viewMonth, 1).getDay()
  const firstDay = (firstDaySun0 + 6) % 7
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
  })

  const DOW = ['월', '화', '수', '목', '금', '토', '일']

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1) }
    else setViewMonth((m) => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1) }
    else setViewMonth((m) => m + 1)
  }

  // Meetings on selected day (or today if nothing selected)
  const targetDate = selected ?? today
  const dayMeetings = meetings.filter((m) => {
    const d = new Date(m.startAt)
    return (
      d.getFullYear() === targetDate.getFullYear() &&
      d.getMonth() === targetDate.getMonth() &&
      d.getDate() === targetDate.getDate()
    )
  })

  return (
    <div className="p-4 rounded-lg border bg-card flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Calendar size={14} className="text-accent" />
          <span className="text-sm font-semibold text-foreground">{monthLabel}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={prevMonth}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted transition-colors text-muted-foreground"
            aria-label="이전 달"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()) }}
            className="px-1.5 h-6 rounded text-micro text-muted-foreground hover:bg-muted transition-colors"
          >
            오늘
          </button>
          <button
            onClick={nextMonth}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted transition-colors text-muted-foreground"
            aria-label="다음 달"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 mb-0.5">
        {DOW.map((d, i) => (
          <div
            key={d}
            className={clsx(
              'text-center text-micro font-medium py-0.5',
              i === 6 ? 'text-red-400' : i === 5 ? 'text-blue-400' : 'text-muted-foreground',
            )}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {/* Leading empty cells */}
        {Array.from({ length: firstDay }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}

        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1
          const date = new Date(viewYear, viewMonth, day)
          const isToday =
            day === today.getDate() &&
            viewMonth === today.getMonth() &&
            viewYear === today.getFullYear()
          const isSelected =
            selected &&
            day === selected.getDate() &&
            viewMonth === selected.getMonth() &&
            viewYear === selected.getFullYear()
          const hasMeeting = meetingDates.has(date.toDateString())
          const dow = date.getDay()

          return (
            <button
              key={day}
              onClick={() => setSelected(isSelected ? null : date)}
              className={clsx(
                'relative flex flex-col items-center py-0.5 rounded transition-colors text-sm leading-5',
                isSelected
                  ? 'bg-accent text-accent-foreground'
                  : isToday
                  ? 'bg-accent-subtle text-accent font-semibold'
                  : 'hover:bg-muted',
                !isSelected && dow === 0 && 'text-red-400',
                !isSelected && dow === 6 && 'text-blue-400',
                !isSelected && !isToday && dow !== 0 && dow !== 6 && 'text-foreground',
              )}
              aria-label={`${viewYear}년 ${viewMonth + 1}월 ${day}일${hasMeeting ? ' (회의 있음)' : ''}`}
            >
              {day}
              {hasMeeting && (
                <span
                  className={clsx(
                    'w-1 h-1 rounded-full mt-0.5',
                    isSelected ? 'bg-white/70' : 'bg-accent',
                  )}
                />
              )}
            </button>
          )
        })}
      </div>

      {/* Selected day events */}
      {dayMeetings.length > 0 && (
        <div className="border-t border-border pt-3 flex flex-col gap-1.5">
          <p className="text-micro font-medium text-muted-foreground uppercase tracking-wide mb-0.5">
            {targetDate.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} 일정
          </p>
          {dayMeetings.map((m) => (
            <button
              key={m.id}
              type="button"
              className="flex items-center gap-2 text-left hover:bg-muted/40 rounded px-1 py-1 -mx-1 transition-colors"
              onClick={async () => {
                if (!m.googleCalendarEventId) return
                const cached = htmlLinkByEventIdRef.current.get(m.googleCalendarEventId)
                if (cached) {
                  window.open(cached, '_blank', 'noopener,noreferrer')
                  return
                }

                try {
                  const workspaceId = getCurrentWorkspaceId()
                  // 선택 날짜의 시작 시각 기준으로 이후 이벤트를 넉넉히 가져온다.
                  const timeMin = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()).toISOString()
                  const res = await getGoogleCalendarEvents(workspaceId, timeMin, 250)
                  for (const ev of res.events ?? []) {
                    if (ev?.id && ev?.html_link) htmlLinkByEventIdRef.current.set(ev.id, ev.html_link)
                  }
                  const link = htmlLinkByEventIdRef.current.get(m.googleCalendarEventId)
                  window.open(link ?? googleCalendarHomeUrl(), '_blank', 'noopener,noreferrer')
                } catch {
                  window.open(googleCalendarHomeUrl(), '_blank', 'noopener,noreferrer')
                }
              }}
              disabled={!m.googleCalendarEventId}
              aria-label={
                m.googleCalendarEventId
                  ? `${m.title} Google Calendar에서 열기`
                  : `${m.title} (Google Calendar 미연동)`
              }
              title={m.googleCalendarEventId ? 'Google Calendar에서 열기' : 'Google Calendar 미연동'}
            >
              <span
                className={clsx(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  m.status === 'inprogress'
                    ? 'bg-[hsl(var(--status-inprogress))]'
                    : m.status === 'upcoming'
                    ? 'bg-[hsl(var(--status-upcoming))]'
                    : 'bg-[hsl(var(--status-completed))]',
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-mini text-foreground font-medium truncate">{m.title}</p>
                <p className="text-micro text-muted-foreground">
                  {new Date(m.startAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                  {m.endAt && ` — ${new Date(m.endAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {dayMeetings.length === 0 && selected && (
        <div className="border-t border-border pt-3">
          <p className="text-mini text-muted-foreground text-center">
            {selected.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}에 예정된 회의가 없습니다.
          </p>
        </div>
      )}

      {/* Google Calendar link placeholder */}
      <button
        onClick={() => console.log('TODO: open Google Calendar')}
        className="flex items-center justify-center gap-1.5 text-micro text-muted-foreground hover:text-accent transition-colors mt-0.5"
      >
        <span>🔵</span> Google Calendar에서 보기
        {/* TODO: link to Google Calendar */}
      </button>
    </div>
  )
}
