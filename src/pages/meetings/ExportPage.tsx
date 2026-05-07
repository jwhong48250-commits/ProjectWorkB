import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import {
  ExternalLink, Calendar, Sparkles, Check, Lock, X,
  ChevronRight, Loader2, RefreshCw, AlertTriangle,
} from 'lucide-react'
import clsx from 'clsx'
import { getIntegrations, type IntegrationItem, type ServiceName } from '../../api/integrations'
import {
  exportBatch, suggestNextMeeting, registerNextMeeting,
  type BatchExportServiceResult, type TimeSlot,
} from '../../api/actions'
import { useAuth } from '../../context/AuthContext'
import { getCurrentWorkspaceId } from '../../api/client'

// ── 타입 ─────────────────────────────────────────────────────────────────────

type ServiceExportStatus = 'idle' | 'loading' | 'ok' | 'error'

interface ServiceState extends Partial<BatchExportServiceResult> {
  status: ServiceExportStatus
}

type ToastState = { message: string; type: 'success' | 'error' } | null

// ── 서비스 메타 ───────────────────────────────────────────────────────────────

const SERVICE_META: Record<string, { label: string; desc: string; icon: string; key: ServiceName }> = {
  slack: {
    label: 'Slack 공유',
    desc: '선택한 채널에 회의 요약 공유',
    icon: '💬',
    key: 'slack',
  },
  jira: {
    label: 'JIRA 이슈 생성',
    desc: 'WBS 태스크를 JIRA 이슈로 자동 생성',
    icon: '🔵',
    key: 'jira',
  },
  google_calendar: {
    label: 'Google Calendar',
    desc: '회의록을 캘린더 이벤트에 첨부',
    icon: '📅',
    key: 'google_calendar',
  },
}

const BATCH_SERVICES = ['slack', 'jira', 'google_calendar']

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────

export default function ExportPage() {
  const { meetingId } = useParams()
  const navigate = useNavigate()
  const { state } = useLocation()
  const meetingTitle = (state as any)?.meetingTitle as string | undefined
  const { isAdmin } = useAuth()
  const workspaceId = getCurrentWorkspaceId()

  const [integrations, setIntegrations] = useState<IntegrationItem[]>([])
  const [serviceStates, setServiceStates] = useState<Record<string, ServiceState>>(
    Object.fromEntries(BATCH_SERVICES.map((s) => [s, { status: 'idle' }]))
  )
  const [toast, setToast] = useState<ToastState>(null)

  // AI 다음 회의 제안
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [slots, setSlots] = useState<TimeSlot[]>([])
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null)
  const [newMeetingTitle, setNewMeetingTitle] = useState('')
  const [registering, setRegistering] = useState(false)
  const [registeredEventId, setRegisteredEventId] = useState<string | null>(null)

  useEffect(() => {
    getIntegrations(workspaceId)
      .then((res) => setIntegrations(res.integrations))
      .catch(console.error)
  }, [workspaceId])

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }

  function isConnected(service: ServiceName) {
    return integrations.find((i) => i.service === service)?.is_connected ?? false
  }

  // ── 배치 내보내기 ──────────────────────────────────────────────────────────

  async function handleBatchExport(targetServices: string[]) {
    if (!meetingId || !isAdmin) return

    // 타겟 서비스를 로딩 상태로
    setServiceStates((prev) => {
      const next = { ...prev }
      targetServices.forEach((s) => { next[s] = { status: 'loading' } })
      return next
    })

    try {
      const result = await exportBatch(meetingId, workspaceId, {
        services: targetServices,
        include_action_items: true,
        include_reports: false,
      })

      // 결과를 서비스별로 반영
      setServiceStates((prev) => {
        const next = { ...prev }
        Object.entries(result.results).forEach(([svc, res]) => {
          next[svc] = { status: res.status, message: res.message, error_code: res.error_code }
        })
        return next
      })

      if (result.overall_status === 'success') {
        showToast('모든 서비스에 성공적으로 내보냈습니다.')
      } else if (result.overall_status === 'partial_success') {
        showToast('일부 서비스에서 실패가 발생했습니다.', 'error')
      } else {
        showToast('내보내기에 실패했습니다.', 'error')
      }
    } catch {
      // 요청 자체 실패 — 타겟 서비스 모두 error
      setServiceStates((prev) => {
        const next = { ...prev }
        targetServices.forEach((s) => {
          next[s] = { status: 'error', message: '요청 실패', error_code: 'unknown' }
        })
        return next
      })
      showToast('내보내기 요청에 실패했습니다.', 'error')
    }
  }

  function getConnectedServices() {
    return BATCH_SERVICES.filter((s) => isConnected(SERVICE_META[s].key))
  }

  function getFailedServices() {
    return BATCH_SERVICES.filter((s) => serviceStates[s]?.status === 'error')
  }

  const isAnyLoading = BATCH_SERVICES.some((s) => serviceStates[s]?.status === 'loading')
  const failedServices = getFailedServices()
  const hasExported = BATCH_SERVICES.some((s) =>
    serviceStates[s]?.status === 'ok' || serviceStates[s]?.status === 'error'
  )

  // ── AI 다음 회의 제안 ──────────────────────────────────────────────────────

  async function handleSuggest() {
    if (!meetingId) return
    setSuggestLoading(true)
    setSlots([])
    setSelectedSlot(null)
    setRegisteredEventId(null)
    try {
      const res = await suggestNextMeeting(meetingId, workspaceId, { duration_minutes: 60 })
      setSlots(res.slots)
      if (res.slots.length === 0) showToast('가능한 시간대가 없습니다.', 'error')
    } catch {
      showToast('일정 제안 실패. 다시 시도해주세요.', 'error')
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
      })
      setRegisteredEventId(res.event_id)
      showToast('Google Calendar에 일정이 등록되었습니다.')
    } catch {
      showToast('일정 등록 실패. 다시 시도해주세요.', 'error')
    } finally {
      setRegistering(false)
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

  const googleConnected = isConnected('google_calendar')

  // ── 렌더링 ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">

      {/* 토스트 */}
      {toast && (
        <div className={clsx(
          'fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium',
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-500 text-white',
        )}>
          {toast.type === 'success' ? <Check size={15} /> : <X size={15} />}
          {toast.message}
        </div>
      )}

      {/* 헤더 */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">내보내기 · 공유</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{meetingTitle ?? `회의 #${meetingId}`}</p>
        {!isAdmin && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-500">
            <Lock size={11} /> 내보내기 기능은 관리자만 실행할 수 있습니다.
          </p>
        )}
      </div>

      {/* 전체 내보내기 / 재시도 버튼 */}
      {isAdmin && (
        <div className="flex items-center gap-3 mb-4">
          {failedServices.length > 0 ? (
            <button
              onClick={() => handleBatchExport(failedServices)}
              disabled={isAnyLoading}
              className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} />
              실패한 {failedServices.length}건 재시도
            </button>
          ) : (
            <button
              onClick={() => handleBatchExport(getConnectedServices())}
              disabled={isAnyLoading || getConnectedServices().length === 0}
              className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {isAnyLoading
                ? <><Loader2 size={13} className="animate-spin" /> 내보내는 중...</>
                : <><ExternalLink size={13} /> 전체 내보내기</>
              }
            </button>
          )}
          {hasExported && !isAnyLoading && (
            <button
              onClick={() => handleBatchExport(getConnectedServices())}
              className="text-mini text-muted-foreground hover:text-foreground transition-colors"
            >
              전체 다시 내보내기
            </button>
          )}
        </div>
      )}

      {/* 서비스 카드 목록 */}
      <div className="flex flex-col gap-3 mb-6">
        {BATCH_SERVICES.map((serviceKey) => {
          const meta = SERVICE_META[serviceKey]
          const connected = isConnected(meta.key)
          const svcState = serviceStates[serviceKey]

          return (
            <div
              key={serviceKey}
              className={clsx(
                'flex items-start gap-3 p-4 rounded-xl border bg-card transition-colors',
                svcState.status === 'error' ? 'border-red-300 dark:border-red-800' : 'border-border',
              )}
            >
              <span className="text-2xl shrink-0 mt-0.5">{meta.icon}</span>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-medium text-foreground">{meta.label}</p>

                  {/* 상태 뱃지 */}
                  {svcState.status === 'loading' && (
                    <span className="flex items-center gap-1 text-micro text-muted-foreground">
                      <Loader2 size={10} className="animate-spin" /> 전송 중...
                    </span>
                  )}
                  {svcState.status === 'ok' && (
                    <span className="flex items-center gap-1 text-micro text-green-600 dark:text-green-400 font-medium">
                      <Check size={11} /> 완료
                    </span>
                  )}
                  {svcState.status === 'error' && (
                    <span className="flex items-center gap-1 text-micro text-red-500 font-medium">
                      <X size={11} /> 실패
                    </span>
                  )}
                </div>

                <p className="text-mini text-muted-foreground">{meta.desc}</p>

                {/* 성공 메시지 */}
                {svcState.status === 'ok' && svcState.message && (
                  <p className="text-micro text-green-600 dark:text-green-400 mt-1">{svcState.message}</p>
                )}

                {/* 실패 사유 + 복구 버튼 */}
                {svcState.status === 'error' && (
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    <span className="flex items-center gap-1 text-micro text-red-500">
                      <AlertTriangle size={10} />
                      {svcState.message ?? '알 수 없는 오류'}
                    </span>
                    {svcState.error_code === 'token_expired' ? (
                      <button
                        onClick={() => navigate('/settings/integrations')}
                        className="flex items-center gap-1 text-micro text-accent hover:underline"
                      >
                        재연동 <ChevronRight size={10} />
                      </button>
                    ) : (
                      isAdmin && (
                        <button
                          onClick={() => handleBatchExport([serviceKey])}
                          disabled={isAnyLoading}
                          className="flex items-center gap-1 text-micro text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
                        >
                          <RefreshCw size={10} /> 재시도
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>

              {/* 우측 액션 영역 */}
              <div className="shrink-0 flex flex-col items-end gap-1">
                {!connected ? (
                  <button
                    onClick={() => navigate('/settings/integrations')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded border border-border text-mini text-muted-foreground hover:border-foreground transition-colors"
                  >
                    연결 <ChevronRight size={11} />
                  </button>
                ) : !isAdmin ? (
                  <span className="flex items-center gap-1 text-mini text-muted-foreground">
                    <Lock size={11} /> 관리자 전용
                  </span>
                ) : svcState.status === 'idle' ? (
                  <button
                    onClick={() => handleBatchExport([serviceKey])}
                    disabled={isAnyLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-accent text-accent text-mini font-medium hover:bg-accent/10 transition-colors disabled:opacity-50"
                  >
                    <ExternalLink size={12} /> 내보내기
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      {/* AI 다음 회의 일정 제안 */}
      <div className="p-4 rounded-xl border border-accent/30 bg-accent/5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-accent" />
            <span className="text-sm font-semibold text-accent">AI 다음 회의 일정 제안</span>
          </div>
          {!googleConnected && (
            <span className="text-mini text-muted-foreground">Google Calendar 연동 필요</span>
          )}
        </div>

        {!googleConnected ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Google Calendar를 연동하면 참석자의 빈 시간을 자동으로 찾아 최적의 회의 시간을 제안합니다.
            </p>
            <button
              onClick={() => navigate('/settings/integrations')}
              className="shrink-0 flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-mini font-medium hover:bg-muted transition-colors"
            >
              <Calendar size={13} /> 연결
            </button>
          </div>
        ) : registeredEventId ? (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 font-medium">
            <Check size={16} /> Google Calendar에 다음 회의 일정이 등록되었습니다.
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-3">
              Slack 채널 멤버의 가용 시간을 분석해 최적의 회의 시간 3개를 추천합니다.
            </p>

            {slots.length === 0 ? (
              <button
                onClick={handleSuggest}
                disabled={suggestLoading || !isAdmin}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-accent text-accent-foreground text-mini font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
              >
                {suggestLoading ? (
                  <><Loader2 size={13} className="animate-spin" /> 분석 중...</>
                ) : (
                  <><Calendar size={13} />{isAdmin ? '일정 제안 받기' : '관리자 전용'}</>
                )}
              </button>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-xs font-medium text-foreground">추천 시간대를 선택하세요</p>
                <div className="flex flex-col gap-2">
                  {slots.map((slot, i) => (
                    <button
                      key={i}
                      onClick={() => { setSelectedSlot(slot); setNewMeetingTitle('') }}
                      className={clsx(
                        'flex items-center gap-2.5 p-2.5 rounded-lg border text-left text-sm transition-colors',
                        selectedSlot === slot
                          ? 'border-accent bg-accent/10 text-accent font-medium'
                          : 'border-border hover:border-accent/50 hover:bg-muted/40 text-foreground',
                      )}
                    >
                      <Calendar size={13} className="shrink-0" />
                      <span className="flex-1">{formatSlot(slot)}</span>
                      {selectedSlot === slot && <Check size={13} className="shrink-0" />}
                    </button>
                  ))}
                </div>

                {selectedSlot && (
                  <div className="flex gap-2 pt-1">
                    <input
                      type="text"
                      value={newMeetingTitle}
                      onChange={(e) => setNewMeetingTitle(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
                      placeholder="다음 회의 제목 입력"
                      className="flex-1 h-9 px-3 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors"
                    />
                    <button
                      onClick={handleRegister}
                      disabled={registering || !newMeetingTitle.trim()}
                      className="shrink-0 flex items-center gap-1.5 h-9 px-3 rounded-lg bg-accent text-accent-foreground text-mini font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
                    >
                      {registering ? '등록 중...' : '캘린더에 등록'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
