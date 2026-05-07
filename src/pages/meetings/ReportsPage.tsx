import { useState, useEffect, type ReactNode } from 'react'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import {
  Sparkles, FileText, Share2, Loader2,
  X, ArrowLeft,
  RefreshCw, Lock, ExternalLink, ChevronRight, Download, Pencil, Check,
} from 'lucide-react'
import clsx from 'clsx'
import { getCurrentWorkspaceId } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import {
  generateMinutes, getMinutes, ensureMinutes,
  getMinutesPdfPreview, downloadMinutesPdf,
  exportSlack, exportGoogleCalendar,
  suggestNextMeeting, registerNextMeeting,
  deleteNextMeeting,
  type MinutesResponse, type TimeSlot,
  type MinutesPdfPreview,
} from '../../api/actions'
import { getIntegrations, type ServiceName } from '../../api/integrations'
import { fetchWorkspaceMeetingDetail } from '../../api/meetings'

async function pollUntil(
  check: () => Promise<boolean>,
  maxAttempts = 10,
  interval = 1500,
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, interval))
    if (await check()) return true
  }
  return false
}

// ── 탭 정의 ──────────────────────────────────────────────────────────
type Tab = 'minutes' | 'export'

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'minutes', label: '회의록', icon: <FileText size={14} /> },
  { id: 'export',  label: '내보내기', icon: <Share2 size={14} /> },
]

// ── 내보내기 서비스 정의 ──────────────────────────────────────────────
const EXPORT_SERVICES = [
  { id: 'slack',           label: 'Slack',           icon: '💬', desc: '선택한 채널에 회의록 공유',      service: 'slack' as ServiceName,           implemented: true },
  { id: 'google-calendar', label: 'Google Calendar', icon: '📅', desc: '캘린더 이벤트에 회의록 첨부',    service: 'google_calendar' as ServiceName, implemented: true },
  { id: 'notion',          label: 'Notion',          icon: '📝', desc: 'Notion 페이지로 자동 저장',      service: 'notion' as ServiceName,          implemented: false },
  { id: 'jira',            label: 'JIRA',            icon: '🔵', desc: 'WBS 태스크를 JIRA 이슈로 생성', service: 'jira' as ServiceName,            implemented: false },
]


// ── 메인 컴포넌트 ──────────────────────────────────────────────────────
export default function ReportsPage() {
  const { meetingId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const workspaceId = getCurrentWorkspaceId()
  const { isAdmin } = useAuth()

  const rawTab = searchParams.get('tab')
  const activeTab: Tab = rawTab === 'export' ? 'export' : 'minutes'

  const stateTitle = (location.state as { meetingTitle?: string } | null)?.meetingTitle
  const [meetingTitle, setMeetingTitle] = useState<string>(stateTitle ?? '')

  useEffect(() => {
    if (stateTitle || !meetingId) return
    fetchWorkspaceMeetingDetail(workspaceId, Number(meetingId))
      .then((m) => setMeetingTitle(m.title))
      .catch(() => setMeetingTitle(`회의 #${meetingId}`))
  }, [meetingId, workspaceId, stateTitle])

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  function setTab(tab: Tab) {
    setSearchParams({ tab }, { replace: true })
  }

  return (
    <div className="flex flex-col h-full">
      {toast && (
        <div className={clsx(
          'fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium',
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-500 text-white',
        )}>
          {toast.type === 'error' && <X size={13} />}
          {toast.message}
        </div>
      )}

      {/* 헤더 */}
      <div className="border-b border-border bg-card px-4 sm:px-6 pt-4 pb-0 shrink-0">
        <button
          onClick={() => navigate('/meetings/post')}
          className="flex items-center gap-1.5 text-mini text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft size={12} /> 회의 목록
        </button>

        <div className="mb-3">
          <h1 className="text-lg font-semibold text-foreground truncate">{meetingTitle}</h1>
        </div>

        <div className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'minutes' && (
          <MinutesTab meetingId={meetingId!} workspaceId={workspaceId} showToast={showToast} />
        )}
        {activeTab === 'export' && (
          <ExportTab meetingId={meetingId!} workspaceId={workspaceId} isAdmin={isAdmin} showToast={showToast} />
        )}
      </div>
    </div>
  )
}

// ── 회의록 탭 ─────────────────────────────────────────────────────────
function MinutesTab({
  meetingId, workspaceId, showToast,
}: {
  meetingId: string
  workspaceId: number
  showToast: (m: string, t?: 'success' | 'error') => void
}) {
  const [minutes, setMinutes] = useState<MinutesResponse | null>(null)
  const [loadingMinutes, setLoadingMinutes] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [pdfPreview, setPdfPreview] = useState<MinutesPdfPreview | null>(null)
  const [loadingPdf, setLoadingPdf] = useState(false)

  // 진입 시: 회의록 ensure → 즉시 PDF 자동 생성
  useEffect(() => {
    ensureMinutes(meetingId, workspaceId)
      .then((data) => {
        setMinutes(data)
        setLoadingMinutes(false)
        setLoadingPdf(true)
        return getMinutesPdfPreview(meetingId, workspaceId)
          .then((res) => setPdfPreview(res))
          .catch(() => showToast('PDF 생성에 실패했습니다.', 'error'))
          .finally(() => setLoadingPdf(false))
      })
      .catch(() => {
        showToast('회의록을 불러오는 데 실패했습니다.', 'error')
        setLoadingMinutes(false)
      })
  }, [meetingId, workspaceId])

  async function handleGenerate() {
    setGenerating(true)
    setPdfPreview(null)
    const prevUpdatedAt = minutes?.updated_at
    try {
      await generateMinutes(meetingId, workspaceId)
      const ok = await pollUntil(async () => {
        const data = await getMinutes(meetingId, workspaceId).catch(() => null)
        const isDone = prevUpdatedAt
          ? data?.updated_at != null && data.updated_at !== prevUpdatedAt
          : Boolean(data?.content)
        if (isDone && data) { setMinutes(data); return true }
        return false
      })
      if (ok) {
        showToast('회의록이 생성되었습니다.')
        handlePdfPreview()
      } else {
        showToast('회의록 생성에 실패했습니다. 회의 요약 데이터를 확인해주세요.', 'error')
      }
    } catch {
      showToast('회의록 생성에 실패했습니다.', 'error')
    } finally {
      setGenerating(false)
    }
  }

  async function handlePdfPreview(fieldValues?: Record<string, string>) {
    setLoadingPdf(true)
    try {
      const res = await getMinutesPdfPreview(meetingId, workspaceId, fieldValues)
      setPdfPreview(res)
    } catch {
      showToast('PDF 미리보기 생성에 실패했습니다.', 'error')
    } finally {
      setLoadingPdf(false)
    }
  }

  async function handlePdfDownload() {
    try {
      await downloadMinutesPdf(meetingId, workspaceId)
    } catch {
      showToast('PDF 다운로드에 실패했습니다.', 'error')
    }
  }

  if (loadingMinutes) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
        <Loader2 size={20} className="animate-spin" />
        <p className="text-sm">회의록 불러오는 중...</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      {/* ── 메인: PDF 미리보기 · 필드 편집 ─────────────────────────── */}
      <PdfOverlayEditor
        pdfPreview={pdfPreview}
        loading={loadingPdf}
        generating={generating}
        onRegenerate={handleGenerate}
        onRefresh={(fv) => handlePdfPreview(fv)}
        onDownload={handlePdfDownload}
      />

    </div>
  )
}

// ── PDF 미리보기 · 필드 편집 ───────────────────────────────────────────
const FIELD_LABEL: Record<string, string> = {
  agenda_items:        '회의 안건',
  discussion_content:  '회의 내용',
  decisions:           '결정 사항',
  action_items:        '액션 아이템',
  special_notes:       '특이 사항',
  datetime:            '회의 일시',
  attendees:           '참석자',
  dept:                '부서',
  author:              '작성자',
  department_author:   '부서 / 작성자',
  title:               '제목',
}

const PDF_PREVIEW_ZOOM_LEVELS = [0.8, 0.9, 1, 1.15, 1.3] as const

function PdfOverlayEditor({
  pdfPreview,
  loading,
  generating,
  onRegenerate,
  onRefresh,
  onDownload,
}: {
  pdfPreview: MinutesPdfPreview | null
  loading: boolean
  generating: boolean
  onRegenerate: () => void
  onRefresh: (fieldValues: Record<string, string>) => void
  onDownload: () => void
}) {
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [isDirty, setIsDirty] = useState(false)
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const [showEditPanel, setShowEditPanel] = useState(false)
  const [zoomIdx, setZoomIdx] = useState(2)

  useEffect(() => {
    if (pdfPreview?.field_values) {
      setEditValues(pdfPreview.field_values)
      setIsDirty(false)
      setShowEditPanel(false)
    }
  }, [pdfPreview])

  const FIELD_ORDER = ['datetime', 'dept', 'author', 'attendees', 'agenda_items', 'discussion_content', 'decisions', 'action_items', 'special_notes']
  const editableFieldKeys: string[] = pdfPreview
    ? FIELD_ORDER.filter(k => k in pdfPreview.field_values).concat(
        Object.keys(pdfPreview.field_values).filter((k) => {
          if (FIELD_ORDER.includes(k)) return false
          if (
            k === 'department_author' &&
            ('dept' in pdfPreview.field_values || 'author' in pdfPreview.field_values)
          ) {
            return false
          }
          return true
        })
      )
    : []

  const uniformRows = Math.max(
    1,
    Math.min(8, (editValues.discussion_content ?? '').split('\n').length),
  )
  const metaFields = new Set(['datetime', 'dept', 'author', 'attendees'])

  function handleApply() {
    onRefresh(editValues)
    setIsDirty(false)
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* 헤더 */}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <FileText size={13} className="text-accent shrink-0" />
            <span className="text-sm font-medium text-foreground">PDF 미리보기 · 직접 편집</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap shrink-0">
          {pdfPreview && (
            <div className="flex items-center h-7 rounded-md border border-border bg-background px-1 text-mini text-muted-foreground">
              <button
                type="button"
                title="축소"
                disabled={zoomIdx <= 0}
                onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
                className="px-1.5 py-0.5 rounded hover:bg-muted disabled:opacity-30"
              >
                −
              </button>
              <span className="tabular-nums px-1 min-w-[2.75rem] text-center text-foreground">
                {Math.round(PDF_PREVIEW_ZOOM_LEVELS[zoomIdx] * 100)}%
              </span>
              <button
                type="button"
                title="확대"
                disabled={zoomIdx >= PDF_PREVIEW_ZOOM_LEVELS.length - 1}
                onClick={() => setZoomIdx((i) => Math.min(PDF_PREVIEW_ZOOM_LEVELS.length - 1, i + 1))}
                className="px-1.5 py-0.5 rounded hover:bg-muted disabled:opacity-30"
              >
                +
              </button>
            </div>
          )}
          {pdfPreview && (
            <button
              onClick={onDownload}
              className="flex items-center gap-1 h-7 px-2.5 rounded border border-border text-mini hover:bg-muted transition-colors"
            >
              <Download size={11} /> PDF 다운로드
            </button>
          )}
          <button
            onClick={onRegenerate}
            disabled={generating}
            className="flex items-center gap-1 h-7 px-2.5 rounded border border-border text-mini hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generating
              ? <><Loader2 size={11} className="animate-spin" /> 생성 중...</>
              : pdfPreview
                ? <><RefreshCw size={11} /> 회의록 재생성</>
                : <><Sparkles size={11} /> 회의록 생성</>}
          </button>
          {loading && (
            <span className="flex items-center gap-1 text-mini text-muted-foreground">
              <Loader2 size={11} className="animate-spin" /> 생성 중...
            </span>
          )}
        </div>
      </div>

      {/* 빈 상태 */}
      {!pdfPreview && !loading && (
        <div className="px-5 py-10 text-center">
          <FileText size={32} className="mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">'회의록 생성' 버튼을 눌러 회의록을 생성하세요.</p>
        </div>
      )}
      {loading && !pdfPreview && (
        <div className="flex justify-center items-center py-16 gap-2 text-muted-foreground text-sm">
          <Loader2 size={18} className="animate-spin" /> PDF 생성 중...
        </div>
      )}

      {pdfPreview && (
        <>
          {/* PDF 이미지 + 인라인 편집 패널 — 배경은 용지 느낌 */}
          <div className="p-3 sm:p-4 bg-stone-200/60 dark:bg-stone-950/50 flex justify-center overflow-auto">
            {/* zoom: 이미지와 오버레이가 한 덩어리로 확대되어 좌표가 어긋나지 않음 (Firefox 미지원 시 100% 유지 권장) */}
            <div
              className="relative inline-block select-none origin-top"
              style={{
                zoom: PDF_PREVIEW_ZOOM_LEVELS[zoomIdx],
              }}
            >
              <img
                src={`data:image/png;base64,${pdfPreview.preview_b64}`}
                alt="PDF 미리보기"
                className="max-w-full rounded-sm shadow-md border border-stone-300/90 dark:border-stone-600 block bg-white"
                draggable={false}
              />

              {editableFieldKeys.length > 0 && (
                <button
                  onClick={() => setShowEditPanel(p => !p)}
                  className="absolute top-2 right-2 z-10 flex items-center gap-1 h-7 px-2.5 rounded-lg bg-background/90 border border-border text-xs font-medium shadow-sm hover:bg-background transition-colors"
                >
                  {showEditPanel ? <X size={10} /> : <Pencil size={10} />}
                  {showEditPanel ? '닫기' : '편집'}
                </button>
              )}

              {showEditPanel && editableFieldKeys.length > 0 && (
                <div className="absolute top-0 right-0 w-56 h-full bg-background border-l border-border flex flex-col z-20 shadow-xl rounded-r overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0 bg-muted/30">
                    <span className="text-xs font-semibold text-foreground">내용 편집</span>
                    <button
                      onClick={() => setShowEditPanel(false)}
                      className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    >
                      <X size={12} />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto px-3 py-2.5 flex flex-col gap-3">
                    {editableFieldKeys.map((fieldKey) => (
                      <div key={fieldKey}>
                        <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                          {FIELD_LABEL[fieldKey] ?? fieldKey}
                        </label>
                        <textarea
                          value={editValues[fieldKey] ?? ''}
                          onFocus={() => setFocusedKey(fieldKey)}
                          onBlur={() => setFocusedKey(null)}
                          onChange={e => {
                            setEditValues(prev => ({ ...prev, [fieldKey]: e.target.value }))
                            setIsDirty(true)
                          }}
                          rows={metaFields.has(fieldKey)
                            ? Math.max(1, Math.min(5, (editValues[fieldKey] ?? '').split('\n').length))
                            : uniformRows}
                          className={clsx(
                            'w-full px-2 py-1 text-[11px] rounded border bg-background text-foreground outline-none resize-none leading-relaxed transition-colors',
                            focusedKey === fieldKey
                              ? 'border-accent ring-1 ring-accent/20'
                              : 'border-border',
                          )}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="px-3 py-2.5 border-t border-border shrink-0">
                    <button
                      onClick={handleApply}
                      disabled={loading || !isDirty}
                      className="w-full h-8 rounded-lg bg-accent text-accent-foreground text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {loading
                        ? <><Loader2 size={11} className="animate-spin" /> 생성 중...</>
                        : <><RefreshCw size={11} /> 반영</>}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 수정 내용 반영 바 — 편집 패널이 닫혀있고 변경사항이 있을 때 */}
          {isDirty && !showEditPanel && (
            <div className="px-4 py-2.5 border-t border-border flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between bg-muted/20">
              <p className="text-xs text-muted-foreground leading-relaxed">
                수정된 내용이 있습니다. 반영 버튼을 눌러 PDF를 업데이트하세요.
              </p>
              <button
                onClick={handleApply}
                disabled={loading}
                className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50 shrink-0"
              >
                {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                수정 내용 반영
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── 내보내기 탭 ───────────────────────────────────────────────────────
function ExportTab({
  meetingId, workspaceId, isAdmin, showToast,
}: {
  meetingId: string
  workspaceId: number
  isAdmin: boolean
  showToast: (m: string, t?: 'success' | 'error') => void
}) {
  const navigate = useNavigate()
  const [integrations, setIntegrations] = useState<{ service: ServiceName; is_connected: boolean }[]>([])
  const [exporting, setExporting] = useState<Record<string, boolean>>({})
  const [exported, setExported] = useState<Record<string, boolean>>({})
  const [suggesting, setSuggesting] = useState(false)
  const [slots, setSlots] = useState<TimeSlot[]>([])
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null)
  const [titleInput, setTitleInput] = useState('다음 회의')
  const [registering, setRegistering] = useState(false)
  const [registeredEvent, setRegisteredEvent] = useState<{ event_id: string; scheduled_at: string } | null>(null)

  useEffect(() => {
    getIntegrations(workspaceId)
      .then((res) => setIntegrations(res.integrations))
      .catch(() => setIntegrations([]))
  }, [workspaceId])

  function isConnected(service: ServiceName) {
    return integrations.find((i) => i.service === service)?.is_connected ?? false
  }

  async function handleExport(serviceId: string) {
    if (!isAdmin) return
    setExporting((p) => ({ ...p, [serviceId]: true }))
    try {
      if (serviceId === 'slack') {
        await exportSlack(meetingId, workspaceId, { include_action_items: true })
      } else if (serviceId === 'google-calendar') {
        await exportGoogleCalendar(meetingId, workspaceId)
      }
      setExported((p) => ({ ...p, [serviceId]: true }))
      showToast('내보내기가 완료되었습니다.')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (serviceId === 'google-calendar' && msg.includes('캘린더')) {
        showToast('Google Calendar가 설정되지 않았습니다.', 'error')
        if (confirm('사용할 캘린더가 선택되지 않았습니다.\n설정 페이지로 이동하시겠습니까?')) {
          navigate('/settings/integrations')
        }
      } else {
        showToast('내보내기에 실패했습니다.', 'error')
      }
    } finally {
      setExporting((p) => ({ ...p, [serviceId]: false }))
    }
  }

  async function handleSuggest() {
    if (!isConnected('google_calendar')) {
      if (confirm('Google Calendar 연동이 필요합니다. 설정 페이지로 이동하시겠습니까?')) {
        navigate('/settings/integrations')
      }
      return
    }
    setSuggesting(true)
    setSlots([])
    setSelectedSlot(null)
    setRegisteredEvent(null)
    try {
      const res = await suggestNextMeeting(meetingId, workspaceId)
      setSlots(res.slots)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      showToast(msg || '일정 제안에 실패했습니다.', 'error')
    } finally {
      setSuggesting(false)
    }
  }

  async function handleRegister() {
    if (!selectedSlot) return
    setRegistering(true)
    try {
      const res = await registerNextMeeting(meetingId, workspaceId, {
        title: titleInput,
        scheduled_at: selectedSlot.start,
        participant_ids: [],
      })
      setRegisteredEvent({ event_id: res.event_id, scheduled_at: selectedSlot.start })
      setSlots([])
      setSelectedSlot(null)
      showToast('구글 캘린더에 일정이 등록되었습니다.')
    } catch {
      showToast('일정 등록에 실패했습니다.', 'error')
    } finally {
      setRegistering(false)
    }
  }

  async function handleDeleteEvent() {
    if (!registeredEvent) return
    if (!confirm('등록된 일정을 삭제하시겠습니까?')) return
    try {
      await deleteNextMeeting(meetingId, workspaceId, registeredEvent.event_id)
      setRegisteredEvent(null)
      showToast('일정이 삭제되었습니다.')
    } catch {
      showToast('삭제에 실패했습니다.', 'error')
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      {!isAdmin && (
        <div className="flex items-center gap-2 px-3 py-2.5 mb-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-mini text-amber-700 dark:text-amber-400">
          <Lock size={11} />
          내보내기 기능은 관리자만 실행할 수 있습니다.
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {EXPORT_SERVICES.map((svc) => {
          const connected = isConnected(svc.service)
          const isExporting = exporting[svc.id]
          const isDone = exported[svc.id]

          return (
            <div
              key={svc.id}
              className="flex items-center gap-3.5 p-4 rounded-xl border border-border bg-card"
            >
              <span className="text-2xl shrink-0">{svc.icon}</span>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{svc.label}</p>
                  {!svc.implemented && (
                    <span className="text-micro px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                      준비 중
                    </span>
                  )}
                </div>
                <p className="text-mini text-muted-foreground mt-0.5">{svc.desc}</p>
              </div>

              {!svc.implemented ? (
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
                  onClick={() => handleExport(svc.id)}
                  disabled={isExporting}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-accent text-accent-foreground text-mini font-medium hover:bg-accent/90 transition-colors disabled:opacity-60 shrink-0"
                >
                  {isExporting
                    ? <><Loader2 size={11} className="animate-spin" /> 전송 중</>
                    : <><ExternalLink size={11} /> 내보내기</>
                  }
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* AI 다음 회의 일정 제안 */}
      <div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-accent" />
            <p className="text-sm font-medium text-accent">AI 다음 회의 일정 제안</p>
          </div>
          {!registeredEvent && (
            <button
              onClick={handleSuggest}
              disabled={suggesting || !isConnected('google_calendar')}
              className="flex items-center gap-1.5 h-7 px-3 rounded-lg bg-accent text-accent-foreground text-mini font-medium hover:bg-accent/90 disabled:opacity-60 transition-colors"
              title={!isConnected('google_calendar') ? 'Google Calendar 연동이 필요합니다' : ''}
            >
              {suggesting ? <><Loader2 size={11} className="animate-spin" /> 분석 중...</> : '일정 추천받기'}
            </button>
          )}
        </div>

        {!suggesting && slots.length === 0 && !registeredEvent && (
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

        {slots.length > 0 && !registeredEvent && (
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
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  placeholder="회의 제목"
                  className="flex-1 h-8 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:border-accent"
                />
                <button
                  onClick={handleRegister}
                  disabled={registering}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-accent text-accent-foreground text-mini font-medium hover:bg-accent/90 disabled:opacity-60"
                >
                  {registering ? <Loader2 size={11} className="animate-spin" /> : '캘린더 등록'}
                </button>
              </div>
            )}
          </div>
        )}

        {registeredEvent && (
          <div className="flex items-center justify-between mt-1">
            <div>
              <p className="text-sm font-medium text-green-600 dark:text-green-400">✓ 일정 등록 완료</p>
              <p className="text-mini text-muted-foreground mt-0.5">
                {new Date(registeredEvent.scheduled_at).toLocaleString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            <button onClick={handleDeleteEvent} className="text-mini text-muted-foreground hover:text-red-500 transition-colors">
              삭제
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
