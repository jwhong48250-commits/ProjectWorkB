import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import type { Meeting } from '../types/meeting'
import { fetchWorkspaceMeetingsByDateRange } from '../api/meetings'
import { getCurrentWorkspaceId, WORKSPACE_CHANGED_EVENT } from '../utils/workspace'
import { getGoogleCalendarEvents, type GoogleCalendarEvent } from '../api/integrations'

const DOW = ['일', '월', '화', '수', '목', '금', '토']
const STATUS_LABEL: Record<Meeting['status'], string> = {
  inprogress: '진행 중',
  upcoming: '예정',
  completed: '완료',
}

interface CalendarItem {
  id: string
  title: string
  startAt: string
  endAt?: string
  source: 'workb' | 'google'
  status?: Meeting['status']
  htmlLink?: string
}

export default function CalendarPage() {
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selected, setSelected] = useState<Date | null>(null)
  const [items, setItems] = useState<CalendarItem[]>([])
  const [loading, setLoading] = useState(true)
  const [googleConnected, setGoogleConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState(() => getCurrentWorkspaceId())
  const navigate = useNavigate()

  // Listen to workspace changes event
  useEffect(() => {
    function onWsChanged(e: Event) {
      const id = (e as CustomEvent<{ id: number }>).detail?.id
      if (typeof id === 'number' && Number.isFinite(id)) setWorkspaceId(id)
    }
    window.addEventListener(WORKSPACE_CHANGED_EVENT, onWsChanged)
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, onWsChanged)
  }, [])

  // Load workb meetings for given workspace and month
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const from = new Date(viewYear, viewMonth, 1)
        const to = new Date(viewYear, viewMonth + 1, 0)
        const [rows] = await Promise.all([
          fetchWorkspaceMeetingsByDateRange(workspaceId, from, to),
        ])
        const workbItems: CalendarItem[] = (rows ?? [])
          .filter((r) => r.status !== 'in_progress')
          .map((r) => {
            const startAt = r.scheduled_at ?? r.started_at ?? r.ended_at ?? from.toISOString()
            const status: Meeting['status'] =
              r.status === 'done' ? 'completed' : 'upcoming'
            return {
              id: String(r.meeting_id),
              title: r.title,
              status,
              startAt,
              source: 'workb',
            }
          })
        if (!cancelled) {
          setItems(workbItems)
        }
      } catch (e) {
        if (!cancelled) {
          setItems([])
          setError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [workspaceId, viewYear, viewMonth])

  // Load Google Calendar events for given workspace and month.
  // 요구사항: Google 연동이 되어 있으면 Google 캘린더만 사용, 아니면 WorkB DB 회의 사용.
  useEffect(() => {
    let cancelled = false
    async function loadGoogle() {
      const timeMin = new Date(viewYear, viewMonth, 1).toISOString()
      try {
        const res = await getGoogleCalendarEvents(workspaceId, timeMin, 250)
        if (!cancelled) {
          setGoogleConnected(true)
          const googleItems: CalendarItem[] = (Array.isArray(res.events) ? res.events : []).map(
            (e: GoogleCalendarEvent) => ({
              id: `gcal-${e.id}`,
              title: e.title,
              startAt: e.start,
              endAt: e.end,
              source: 'google',
              htmlLink: e.html_link ?? undefined,
            }),
          )
          // Google이 연동된 경우: WorkB 회의 대신 Google 일정만 사용
          setItems(googleItems)
        }
      } catch {
        if (!cancelled) {
          // Google 연동/호출 실패: WorkB DB 회의만 사용 (위 useEffect 결과 유지)
          setGoogleConnected(false)
        }
      }
    }
    loadGoogle()
    return () => {
      cancelled = true
    }
  }, [viewYear, viewMonth, workspaceId])
  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
  })

  const totalCells = firstDay + daysInMonth
  const trailingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7)

  function getItemsByDate(date: Date): CalendarItem[] {
    const key = date.toDateString()
    return items.filter((item) => new Date(item.startAt).toDateString() === key)
  }

  function handleWorkbClick(item: CalendarItem & { status?: Meeting['status'] }) {
    const idNum = Number(item.id)
    if (!Number.isFinite(idNum)) return
    if (item.status === 'completed') {
      navigate(`/meetings/${idNum}/notes`)
    } else {
      navigate(`/meetings/${idNum}/upcoming`)
    }
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1) }
    else setViewMonth((m) => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1) }
    else setViewMonth((m) => m + 1)
  }

  const selectedItems = selected ? getItemsByDate(selected) : []
  const selectedWorkbItems = selectedItems.filter((i) => i.source === 'workb') as (CalendarItem & { status: Meeting['status'] })[]
  const selectedGoogleItems = selectedItems.filter((i) => i.source === 'google')

  return (
    <div className="flex flex-col h-full">
      {/* 상단 헤더 */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-accent" />
          <h1 className="text-lg font-semibold text-foreground">{monthLabel}</h1>
          {googleConnected && (
            <span className="ml-1 flex items-center gap-1 text-mini text-green-600 dark:text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
              Google 연동
            </span>
          )}
        </div>
        {error && (
          <span className="text-xs text-red-600 truncate max-w-[40%]" title={error}>
            {error}
          </span>
        )}
        <div className="flex items-center gap-1">
          <button
            onClick={prevMonth}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-muted text-muted-foreground transition-colors"
            aria-label="이전 달"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => {
              setViewYear(today.getFullYear())
              setViewMonth(today.getMonth())
              setSelected(null)
            }}
            className="px-3 h-8 rounded text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            오늘
          </button>
          <button
            onClick={nextMonth}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-muted text-muted-foreground transition-colors"
            aria-label="다음 달"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* 본문 */}
      <div className="flex flex-1 min-h-0">
        {/* 캘린더 그리드 */}
        <div className="flex-1 flex flex-col min-w-0 overflow-auto">
          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 border-b border-border shrink-0">
            {DOW.map((d, i) => (
              <div
                key={d}
                className={clsx(
                  'text-center text-xs font-medium py-2 border-r border-border last:border-r-0',
                  i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-muted-foreground',
                )}
              >
                {d}
              </div>
            ))}
          </div>

          {loading ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              <span className="inline-block w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin mr-2" />
              불러오는 중...
            </div>
          ) : (
            <div className="grid grid-cols-7 flex-1">
              {Array.from({ length: firstDay }).map((_, i) => (
                <div key={`lead${i}`} className="border-r border-b border-border last:border-r-0 bg-muted/10" />
              ))}

              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1
                const date = new Date(viewYear, viewMonth, day)
                const dow = date.getDay()

                const isToday =
                  day === today.getDate() &&
                  viewMonth === today.getMonth() &&
                  viewYear === today.getFullYear()
                const isSelected =
                  selected != null &&
                  day === selected.getDate() &&
                  viewMonth === selected.getMonth() &&
                  viewYear === selected.getFullYear()

                const dayItems = getItemsByDate(date)
                const meetings = dayItems.filter((x) => x.source === 'workb')
                const events = dayItems.filter((x) => x.source === 'google')

                return (
                  <button
                    key={day}
                    onClick={() => setSelected(isSelected ? null : date)}
                    className={clsx(
                      'flex flex-col items-start p-1.5 min-h-[80px] border-r border-b border-border',
                      'last:border-r-0 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
                      isSelected ? 'bg-accent-subtle' : 'hover:bg-muted/40',
                    )}
                    aria-label={`${viewYear}년 ${viewMonth + 1}월 ${day}일${dayItems.length > 0 ? ` (${dayItems.length}건)` : ''}`}
                    aria-pressed={isSelected}
                  >
                    <span
                      className={clsx(
                        'w-6 h-6 flex items-center justify-center rounded-full text-sm mb-0.5 shrink-0',
                        isToday ? 'bg-accent text-accent-foreground font-bold' : '',
                        !isToday && dow === 0 && 'text-red-400',
                        !isToday && dow === 6 && 'text-blue-400',
                        !isToday && dow !== 0 && dow !== 6 && 'text-foreground',
                      )}
                    >
                      {day}
                    </span>

                    {/* 일정 칩 (최대 2개: WorkB 우선, 그 다음 Google) */}
                    {meetings.slice(0, 2).map((m) => (
                      <span
                        key={m.id}
                        className="w-full truncate text-[10px] px-1 py-0.5 rounded mb-0.5 bg-accent/15 text-accent font-medium leading-tight"
                        title="WorkB"
                      >
                        {m.title}
                      </span>
                    ))}
                    {meetings.length < 2 &&
                      events.slice(0, 2 - meetings.length).map((ev) => (
                        <span
                          key={ev.id}
                          className="w-full truncate text-[10px] px-1 py-0.5 rounded mb-0.5 bg-green-500/15 text-green-700 dark:text-green-400 font-medium leading-tight"
                          title="Google Calendar"
                        >
                          {ev.title}
                        </span>
                      ))}

                    {meetings.length + events.length > 2 && (
                      <span className="text-[10px] text-muted-foreground px-1">
                        +{meetings.length + events.length - 2}개 더
                      </span>
                    )}
                  </button>
                )
              })}

              {Array.from({ length: trailingCells }).map((_, i) => (
                <div key={`trail${i}`} className="border-r border-b border-border last:border-r-0 bg-muted/10" />
              ))}
            </div>
          )}
        </div>

        {/* 날짜 상세 패널 */}
        {selected && (
          <div className="w-64 shrink-0 border-l border-border flex flex-col">
            <div className="px-4 py-3 border-b border-border shrink-0">
              <p className="text-sm font-semibold text-foreground">
                {selected.toLocaleDateString('ko-KR', {
                  month: 'long',
                  day: 'numeric',
                  weekday: 'short',
                })}
              </p>
            </div>

            {selectedItems.length > 0 ? (
              <ul className="flex-1 overflow-y-auto divide-y divide-border">
                {/* WorkB 회의 */}
                {selectedWorkbItems.map((m) => (
                  <li
                    key={m.id}
                    className="px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors"
                    onClick={() => handleWorkbClick(m)}
                  >
                    <p className="text-sm font-medium text-foreground truncate">{m.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(m.startAt).toLocaleTimeString('ko-KR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {m.endAt &&
                        ` — ${new Date(m.endAt).toLocaleTimeString('ko-KR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}`}
                    </p>
                    <span
                      className={clsx(
                        'inline-block mt-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium',
                        m.status === 'inprogress' &&
                          'bg-[hsl(var(--status-inprogress))]/15 text-[hsl(var(--status-inprogress))]',
                        m.status === 'upcoming' &&
                          'bg-[hsl(var(--status-upcoming))]/15 text-[hsl(var(--status-upcoming))]',
                        m.status === 'completed' &&
                          'bg-[hsl(var(--status-completed))]/15 text-[hsl(var(--status-completed))]',
                      )}
                    >
                      {STATUS_LABEL[m.status]}
                    </span>
                  </li>
                ))}

                {/* Google Calendar 이벤트 */}
                {selectedGoogleItems.map((e) => (
                  <li key={e.id} className="px-4 py-3">
                    <div className="flex items-start gap-1.5">
                      <span className="text-green-600 dark:text-green-400 mt-0.5 shrink-0">📅</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{e.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(e.startAt).toLocaleTimeString('ko-KR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {e.endAt &&
                            ` — ${new Date(e.endAt).toLocaleTimeString('ko-KR', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}`}
                        </p>
                        {e.htmlLink && (
                          <a
                            href={e.htmlLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-green-600 dark:text-green-400 hover:underline mt-0.5 inline-block"
                          >
                            Google Calendar에서 보기
                          </a>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex-1 flex items-center justify-center px-4">
                <p className="text-sm text-muted-foreground text-center">
                  이 날에 예정된 일정이 없습니다.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
