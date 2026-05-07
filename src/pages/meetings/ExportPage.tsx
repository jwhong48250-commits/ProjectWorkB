import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ExternalLink, Calendar, Sparkles, Check, Lock, X, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { getIntegrations, type ServiceName } from '../../api/integrations'
import {
  exportSlack,
  exportGoogleCalendar,
  suggestNextMeeting,
  registerNextMeeting,
  type TimeSlot,
} from '../../api/actions'
import { fetchWorkspaceMeetingDetail } from '../../api/meetings'
import { useAuth } from '../../context/AuthContext'
import { getCurrentWorkspaceId } from '../../api/client'

type ToastState = { message: string; type: 'success' | 'error' } | null

const EXPORT_TARGETS = [
  { id: 'slack',           label: 'Slack 공유',        desc: '선택한 채널에 회의 요약 공유',        icon: '💬', service: 'slack' as ServiceName,           implemented: true },
  { id: 'google-calendar', label: 'Google Calendar',   desc: '회의록을 캘린더 이벤트에 첨부',       icon: '📅', service: 'google_calendar' as ServiceName, implemented: true },
  { id: 'notion',          label: 'Notion 내보내기',   desc: 'Notion 페이지로 자동 저장',           icon: '📝', service: 'notion' as ServiceName,          implemented: false },
  { id: 'jira',            label: 'JIRA 이슈 생성',    desc: 'WBS 태스크를 JIRA 이슈로 자동 생성', icon: '🔵', service: 'jira' as ServiceName,            implemented: false },
]

export default function ExportPage() {
  const { meetingId } = useParams()
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const workspaceId = getCurrentWorkspaceId()

  const [meetingTitle, setMeetingTitle] = useState('')
  const [exported, setExported] = useState<Record<string, boolean>>({})
  const [exporting, setExporting] = useState<Record<string, boolean>>({})
  const [integrations, setIntegrations] = useState<{ service: ServiceName; is_connected: boolean }[]>([])
  const [toast, setToast] = useState<ToastState>(null)

  const [suggestLoading, setSuggestLoading] = useState(false)
  const [slots, setSlots] = useState<TimeSlot[]>([])
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null)
  const [newMeetingTitle, setNewMeetingTitle] = useState('')
  const [registering, setRegistering] = useState(false)
  const [registeredEventId, setRegisteredEventId] = useState<string | null>(null)

  useEffect(() => {
    if (!meetingId) return
    fetchWorkspaceMeetingDetail(workspaceId, Number(meetingId))
      .then((m) => setMeetingTitle(m.title))
      .catch(() => setMeetingTitle(`회의 #${meetingId}`))
    getIntegrations(workspaceId)
      .then((res) => setIntegrations(res.integrations))
      .catch(() => setIntegrations([]))
  }, [meetingId, workspaceId])

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }

  function isConnected(service: ServiceName) {
    return integrations.find((i) => i.service === service)?.is_connected ?? false
  }

  async function handleExport(targetId: string, label: string) {
    if (!meetingId || !isAdmin) return
    setExporting((prev) => ({ ...prev, [targetId]: true }))
    try {
      if (targetId === 'slack') {
        await exportSlack(meetingId, workspaceId, { include_action_items: true, include_reports: true })
      } else if (targetId === 'google-calendar') {
        await exportGoogleCalendar(meetingId, workspaceId)
      }
      setExported((prev) => ({ ...prev, [targetId]: true }))
      showToast(`${label} 내보내기가 완료되었습니다.`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (targetId === 'google-calendar' && msg.includes('캘린더')) {
        showToast('Google Calendar가 설정되지 않았습니다.', 'error')
        if (confirm('사용할 캘린더가 선택되지 않았습니다.\n설정 페이지로 이동하시겠습니까?')) {
          navigate('/settings/integrations')
        }
      } else {
        showToast('내보내기에 실패했습니다.', 'error')
      }
    } finally {
      setExporting((prev) => ({ ...prev, [targetId]: false }))
    }
  }

  async function handleSuggest() {
    if (!meetingId) return
    if (!isConnected('google_calendar')) {
      if (confirm('Google Calendar 연동이 필요합니다. 설정 페이지로 이동하시겠습니까?')) {
        navigate('/settings/integrations')
      }
      return
    }
    setSuggestLoading(true)
    setSlots([])
    setSelectedSlot(null)
    setRegisteredEventId(null)
    try {
      const res = await suggestNextMeeting(meetingId, workspaceId)
      setSlots(res.slots)
      if (res.slots.length === 0) showToast('가능한 시간대가 없습니다.', 'error')
    } catch {
      showToast('일정 제안에 실패했습니다.', 'error')
    } finally {
      setSuggestLoading(false)
    }
  }

  async function handleRegister() {
    if (!meetingId || !selectedSlot || !newMeetingTitle.trim()) return
    setRegistering(true)
    try {
      const res = await registerNextMeeting(meetingId, workspaceId, {
        title: newMeetingTitle,
        scheduled_at: selectedSlot.start,
        participant_ids: [],
      })
      setRegisteredEventId(res.event_id)
      setSlots([])
      setSelectedSlot(null)
      showToast('Google Calendar에 일정이 등록되었습니다.')
    } catch {
      showToast('일정 등록에 실패했습니다.', 'error')
    } finally {
      setRegistering(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      {toast && (
        <div className={clsx(
          'fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium',
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-500 text-white',
        )}>
          {toast.type === 'success' ? <Check size={15} /> : <X size={15} />}
          {toast.message}
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">내보내기 · 공유</h1>
        {meetingTitle && <p className="text-sm text-muted-foreground mt-0.5">{meetingTitle}</p>}
        {!isAdmin && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-500">
            <Lock size={11} /> 내보내기 기능은 관리자만 실행할 수 있습니다.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2.5 mb-6">
        {EXPORT_TARGETS.map((target) => {
          const connected = isConnected(target.service)
          const isExporting = exporting[target.id]
          const isDone = exported[target.id]

          return (
            <div key={target.id} className="flex items-center gap-3.5 p-4 rounded-xl border border-border bg-card">
              <span className="text-2xl shrink-0">{target.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{target.label}</p>
                  {!target.implemented && (
                    <span className="text-micro px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">준비 중</span>
                  )}
                </div>
                <p className="text-mini text-muted-foreground mt-0.5">{target.desc}</p>
              </div>

              {!target.implemented ? (
                <span className="text-mini text-muted-foreground shrink-0">준비 중</span>
              ) : !connected ? (
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-mini text-muted-foreground">연동 필요</span>
                  <button
                    onClick={() => navigate('/settings/integrations')}
                    className="flex items-center gap-1 h-7 px-2.5 rounded border border-border text-mini hover:border-foreground transition-colors"
                  >
                    연결 <ChevronRight size={10} />
                  </button>
                </div>
              ) : !isAdmin ? (
                <span className="flex items-center gap-1 text-mini text-muted-foreground shrink-0">
                  <Lock size={10} /> 관리자 전용
                </span>
              ) : isDone ? (
                <span className="flex items-center gap-1 text-mini text-green-600 dark:text-green-400 font-medium shrink-0">
                  <Check size={12} /> 완료
                </span>
              ) : (
                <button
                  onClick={() => handleExport(target.id, target.label)}
                  disabled={isExporting}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-accent text-accent-foreground text-mini font-medium hover:bg-accent/90 transition-colors disabled:opacity-60 shrink-0"
                >
                  {isExporting
                    ? <><span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> 전송 중</>
                    : <><ExternalLink size={11} /> 내보내기</>}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* AI 다음 회의 일정 제안 */}
      <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-accent" />
            <p className="text-sm font-medium text-accent">AI 다음 회의 일정 제안</p>
          </div>
          {!registeredEventId && (
            <button
              onClick={handleSuggest}
              disabled={suggestLoading || !isConnected('google_calendar')}
              className="flex items-center gap-1.5 h-7 px-3 rounded-lg bg-accent text-accent-foreground text-mini font-medium hover:bg-accent/90 disabled:opacity-60 transition-colors"
              title={!isConnected('google_calendar') ? 'Google Calendar 연동이 필요합니다' : ''}
            >
              {suggestLoading ? <><span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> 분석 중...</> : '일정 추천받기'}
            </button>
          )}
        </div>

        {!suggestLoading && slots.length === 0 && !registeredEventId && (
          <div className="flex flex-col gap-1">
            <p className="text-mini text-muted-foreground">참석자 가용 시간 분석 → 최적 일정 3개 추천</p>
            <div className="flex items-center gap-3 mt-0.5">
              <span className={clsx('text-micro', isConnected('google_calendar') ? 'text-green-600 dark:text-green-400' : 'text-red-500')}>
                {isConnected('google_calendar') ? '✓' : '✕'} Google Calendar
              </span>
              <span className={clsx('text-micro', isConnected('slack') ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground')}>
                {isConnected('slack') ? '✓' : '○'} Slack <span className="opacity-60">(선택)</span>
              </span>
            </div>
          </div>
        )}

        {slots.length > 0 && !registeredEventId && (
          <div className="flex flex-col gap-2 mt-1">
            <p className="text-mini text-muted-foreground">추천 일정 중 하나를 선택하세요</p>
            {slots.map((slot, i) => (
              <button
                key={i}
                onClick={() => setSelectedSlot(slot)}
                className={clsx(
                  'text-left px-3 py-2 rounded-lg border text-sm transition-all',
                  selectedSlot === slot ? 'border-accent bg-accent/10 text-accent' : 'border-border hover:border-accent/50',
                )}
              >
                {new Date(slot.start).toLocaleString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                {' — '}
                {new Date(slot.end).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
              </button>
            ))}
            {selectedSlot && (
              <div className="flex items-center gap-2 mt-1">
                <input
                  value={newMeetingTitle}
                  onChange={(e) => setNewMeetingTitle(e.target.value)}
                  placeholder="회의 제목"
                  className="flex-1 h-8 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-accent"
                />
                <button
                  onClick={handleRegister}
                  disabled={registering || !newMeetingTitle.trim()}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-accent text-accent-foreground text-mini font-medium hover:bg-accent/90 disabled:opacity-60"
                >
                  {registering ? <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : '캘린더 등록'}
                </button>
              </div>
            )}
          </div>
        )}

        {registeredEventId && (
          <div className="mt-1">
            <p className="text-sm font-medium text-green-600 dark:text-green-400">✓ 일정 등록 완료</p>
          </div>
        )}
      </div>
    </div>
  )
}
