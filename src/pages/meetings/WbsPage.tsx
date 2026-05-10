import { useState, useEffect, useRef, Fragment } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import {
  Plus, ExternalLink, ChevronDown, ChevronRight,
  Sparkles, Loader2, Trash2, CheckCircle2, Clock3,
  Ban, Circle, Pencil, RefreshCw, GripVertical,
  LayoutList, CalendarDays, CheckSquare, Square, X,
  AlertTriangle,
} from 'lucide-react'
import clsx from 'clsx'
import DatePicker from '../../components/ui/DatePicker'
import { getCurrentWorkspaceId } from '../../api/client'
import {
  getWbs, generateWbs, createEpic, createTask,
  patchEpic, patchTask, deleteEpic, deleteTask,
  reorderWbs, toStatus, fromStatus, toPriority,
  type WbsEpicApi,
} from '../../api/wbs'
import {
  syncJira, shareWbsProgress,
  previewJira, streamJiraExport, jiraNotify,
  exportSlack, exportGoogleCalendar,
  suggestNextMeeting,
  type JiraPreviewResult, type JiraPreviewEpic, type JiraExportResult, type JiraSelectiveBody,
  type TimeSlot,
} from '../../api/actions'
import { getIntegrations, type IntegrationItem } from '../../api/integrations'
import type { WbsEpic, WbsTask, WbsStatus, WbsPriority } from '../../types/wbs'

/** Reports 회의록 PDF 툴바와 동일한 보조 버튼 색·호버 (border + text-foreground + hover:bg-muted) */
function wbsToolBtnOutline(...extra: clsx.Argument[]) {
  return clsx(
    'inline-flex items-center justify-center gap-1 h-7 px-2.5 rounded border border-border text-mini transition-colors',
    'text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40',
    ...extra,
  )
}

function wbsToolBtnPrimary(...extra: clsx.Argument[]) {
  return clsx(
    'inline-flex items-center justify-center gap-1 h-7 px-2.5 rounded border border-accent bg-accent text-mini font-medium text-accent-foreground transition-colors',
    'hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40',
    ...extra,
  )
}

/** 자동 생성 에픽 기본 제목(회의 액션 아이템) 안내 — WBS 테이블·간트 상단 */
function WbsEpicTitleNotice() {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-lg border border-amber-200/70 bg-amber-50/50 px-3 py-2 dark:border-amber-900/45 dark:bg-amber-950/25">
      <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
      <p className="text-mini leading-relaxed text-amber-950 dark:text-amber-100/90">
        WBS를 만들 때 에픽 이름이 <strong className="font-semibold">회의 액션 아이템</strong>처럼 기본 문구로 붙을 수 있습니다.
        에픽 제목을 클릭하면 언제든지 바꿀 수 있으니, JIRA·Slack 등에 올라갈 이름을 원하는 대로 맞춰 주세요.
      </p>
    </div>
  )
}

// ─── 상수 ────────────────────────────────────────────────────────────────────

const PRIORITY_MAP: Record<WbsPriority, { label: string; cls: string }> = {
  urgent: {
    label: '긴급',
    cls: 'border border-red-200/80 bg-red-50/90 text-red-900 dark:border-red-900/55 dark:bg-red-950/40 dark:text-red-300',
  },
  high: {
    label: '높음',
    cls: 'border border-orange-200/80 bg-orange-50/90 text-orange-950 dark:border-orange-900/50 dark:bg-orange-950/40 dark:text-orange-300',
  },
  medium: {
    label: '보통',
    cls: 'border border-amber-200/80 bg-amber-50/85 text-amber-950 dark:border-amber-900/45 dark:bg-amber-950/35 dark:text-amber-200',
  },
  low: {
    label: '낮음',
    cls: 'border border-emerald-200/80 bg-emerald-50/90 text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
}

const STATUS_MAP: Record<WbsStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  todo: {
    label: '할 일',
    cls: 'border border-border bg-muted/70 text-muted-foreground dark:bg-muted/50',
    icon: <Circle size={10} className="shrink-0 opacity-80" />,
  },
  inprogress: {
    label: '진행 중',
    cls: 'border border-blue-200/90 bg-blue-50/90 text-blue-950 dark:border-blue-800/45 dark:bg-blue-950/40 dark:text-blue-300',
    icon: <Clock3 size={10} className="shrink-0 opacity-85" />,
  },
  done: {
    label: '완료',
    cls: 'border border-emerald-200/90 bg-emerald-50/90 text-emerald-950 dark:border-emerald-800/45 dark:bg-emerald-950/40 dark:text-emerald-300',
    icon: <CheckCircle2 size={10} className="shrink-0 opacity-85" />,
  },
  blocked: {
    label: '블록',
    cls: 'border border-red-200/90 bg-red-50/90 text-red-950 dark:border-red-800/45 dark:bg-red-950/40 dark:text-red-300',
    icon: <Ban size={10} className="shrink-0 opacity-85" />,
  },
}

const STATUS_COLOR: Record<WbsStatus, string> = {
  todo: '#94a3b8', inprogress: '#3b82f6', done: '#22c55e', blocked: '#ef4444',
}

// ─── 소형 컴포넌트 ────────────────────────────────────────────────────────────

function StatusSelect({ status, onChange }: { status: WbsStatus; onChange: (s: WbsStatus) => void }) {
  const { label, cls, icon } = STATUS_MAP[status] ?? STATUS_MAP.todo
  return (
    <div className="relative inline-flex min-w-[6.5rem] max-w-full items-center justify-center">
      <span
        className={clsx(
          'inline-flex min-h-[1.625rem] items-center justify-center gap-1.5 rounded-full px-2 py-0.5 text-micro font-medium whitespace-nowrap',
          cls,
        )}
      >
        {icon}
        {label}
      </span>
      <select value={status} onChange={(e) => onChange(e.target.value as WbsStatus)}
        className="absolute inset-0 cursor-pointer opacity-0">
        {Object.entries(STATUS_MAP).map(([val, { label: l }]) => (
          <option key={val} value={val}>{l}</option>
        ))}
      </select>
    </div>
  )
}

function Avatar({ name }: { name?: string }) {
  if (!name) return null
  const colors = ['bg-violet-500', 'bg-blue-500', 'bg-green-500', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500']
  const color = colors[name.charCodeAt(0) % colors.length]
  return (
    <span className={clsx('w-5 h-5 rounded-full flex items-center justify-center text-white shrink-0 text-micro font-bold', color)}>
      {name.trim()[0]?.toUpperCase()}
    </span>
  )
}

function InlineText({ value, onSave, className, placeholder = '—' }: {
  value: string; onSave: (v: string) => void; className?: string; placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  if (editing) {
    return (
      <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { onSave(draft); setEditing(false) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { onSave(draft); setEditing(false) }
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        className={clsx('min-w-0 max-w-full border-b border-accent bg-transparent outline-none', className)}
      />
    )
  }
  return (
    <span onClick={() => { setDraft(value); setEditing(true) }}
      className={clsx('group/text cursor-pointer transition-colors hover:text-accent', className)}>
      {value || <span className="text-muted-foreground">{placeholder}</span>}
      <Pencil size={10} className="inline ml-1 opacity-0 group-hover/text:opacity-40" />
    </span>
  )
}

// ─── 간트 뷰 ─────────────────────────────────────────────────────────────────

function GanttView({ epics }: { epics: WbsEpic[] }) {
  type Row = WbsTask & { epicTitle: string }
  const rows: Row[] = epics.flatMap(e =>
    e.tasks.filter(t => t.dueDate).map(t => ({ ...t, epicTitle: e.title }))
  )

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
        <CalendarDays size={32} className="opacity-30" />
        <p className="text-sm">기한이 설정된 태스크가 없습니다.</p>
        <p className="text-mini">테이블 뷰에서 각 태스크의 기한을 설정해주세요.</p>
      </div>
    )
  }

  const allMs = rows.map(r => new Date(r.dueDate!).getTime())
  const startMs = Math.min(...allMs) - 3 * 86400000
  const endMs   = Math.max(...allMs) + 7 * 86400000
  const totalMs = endMs - startMs
  const pct = (ms: number) => Math.max(0, Math.min(100, ((ms - startMs) / totalMs) * 100))
  const todayPct = pct(Date.now())

  const weeks: Date[] = []
  const cur = new Date(startMs)
  cur.setDate(cur.getDate() - cur.getDay())
  while (cur.getTime() < endMs) { weeks.push(new Date(cur)); cur.setDate(cur.getDate() + 7) }

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      {/* 헤더 */}
      <div className="flex border-b border-border bg-muted/30">
        <div className="w-56 shrink-0 px-4 py-2 text-micro font-semibold text-muted-foreground uppercase tracking-wide border-r border-border">
          작업
        </div>
        <div className="flex-1 relative h-9">
          {weeks.map((w, i) => (
            <div key={i} className="absolute top-0 bottom-0" style={{ left: `${pct(w.getTime())}%` }}>
              <div className="absolute top-0 bottom-0 w-px bg-border opacity-40" />
              <span className="absolute bottom-1.5 left-1 text-micro text-muted-foreground whitespace-nowrap">
                {w.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
              </span>
            </div>
          ))}
          {todayPct >= 0 && todayPct <= 100 && (
            <div className="absolute top-0 bottom-0 w-0.5 bg-red-400 z-10" style={{ left: `${todayPct}%` }}>
              <span className="absolute -top-0 left-1 text-micro text-red-500 font-semibold whitespace-nowrap">오늘</span>
            </div>
          )}
        </div>
      </div>

      {/* 행 */}
      <div className="divide-y divide-border">
        {rows.map((row) => {
          const duePct = pct(new Date(row.dueDate!).getTime())
          const isPast = new Date(row.dueDate!) < new Date() && row.status !== 'done'
          return (
            <div key={row.id} className="flex items-center h-11 hover:bg-accent/5 transition-colors">
              <div className="w-56 shrink-0 px-4 border-r border-border flex flex-col justify-center min-w-0">
                <span className="text-micro text-muted-foreground truncate">{row.epicTitle}</span>
                <span className="text-mini font-medium text-foreground truncate">{row.title}</span>
              </div>
              <div className="flex-1 relative h-full">
                {todayPct >= 0 && todayPct <= 100 && (
                  <div className="absolute top-0 bottom-0 w-0.5 bg-red-400/15" style={{ left: `${todayPct}%` }} />
                )}
                <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
                  style={{ left: `${duePct}%` }}>
                  <div
                    className="w-3.5 h-3.5 rotate-45 rounded-sm shadow-sm"
                    style={{ backgroundColor: isPast ? '#ef4444' : STATUS_COLOR[row.status] }}
                    title={`${row.title} · 마감: ${row.dueDate}`}
                  />
                </div>
                <span className="absolute top-1/2 -translate-y-1/2 text-micro whitespace-nowrap pl-2.5"
                  style={{ left: `${duePct}%`, color: isPast ? '#ef4444' : '#94a3b8' }}>
                  {row.dueDate}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* 범례 */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 bg-muted/20 border-t border-border text-micro text-muted-foreground">
        <span className="font-semibold">범례</span>
        {(Object.entries(STATUS_COLOR) as [WbsStatus, string][]).map(([k, color]) => (
          <span key={k} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rotate-45 inline-block rounded-sm" style={{ backgroundColor: color }} />
            {STATUS_MAP[k].label}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rotate-45 inline-block rounded-sm bg-red-400" />기한 초과
        </span>
      </div>
    </div>
  )
}

// ─── 프리뷰 모달 ──────────────────────────────────────────────────────────────

const EXTRA_SERVICE_META: Record<string, { label: string; icon: string }> = {
  slack:            { label: 'Slack 알림 전송 (JIRA 링크 포함)', icon: '💬' },
  google_calendar:  { label: 'Google Calendar 업데이트',         icon: '📅' },
}

function PreviewModal({
  data, onClose, onConfirm, loading, connectedServices = [],
}: {
  data: JiraPreviewResult
  onClose: () => void
  onConfirm: (extraServices: string[]) => void
  loading: boolean
  connectedServices?: string[]
}) {
  const [extraServices, setExtraServices] = useState<Set<string>>(new Set())

  function toggleService(svc: string) {
    setExtraServices(prev => {
      const next = new Set(prev)
      next.has(svc) ? next.delete(svc) : next.add(svc)
      return next
    })
  }

  const totalCreate = data.epic_create + data.task_create
  const totalUpdate = data.epic_update + data.task_update

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card rounded-xl border border-border shadow-2xl w-full max-w-md mx-4 overflow-hidden">

        {/* 헤더 */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground">JIRA 내보내기 프리뷰</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-mini text-muted-foreground">
                에픽 <strong className="text-foreground">{data.epics.length}개</strong>
              </span>
              <span className="text-muted-foreground text-mini">·</span>
              <span className="text-mini text-muted-foreground">
                태스크 <strong className="text-foreground">{data.task_create + data.task_update}개</strong>
              </span>
              {totalCreate > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-micro bg-green-100 text-green-700 font-semibold">
                  +{totalCreate} 생성
                </span>
              )}
              {totalUpdate > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-micro bg-blue-100 text-blue-700 font-semibold">
                  ↻{totalUpdate} 업데이트
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors mt-0.5">
            <X size={16} />
          </button>
        </div>

        {/* 에픽별 계층 목록 */}
        <div className="px-4 py-3 max-h-80 overflow-y-auto space-y-3">
          {data.epics.map((epic: JiraPreviewEpic) => (
            <div key={epic.id} className="rounded-lg border border-border overflow-hidden">
              {/* 에픽 행 */}
              <div className="flex items-center gap-2 px-3 py-2 bg-muted/30">
                <span className={clsx(
                  'shrink-0 px-1.5 py-0.5 rounded text-micro font-semibold',
                  epic.action === 'create'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-blue-100 text-blue-700',
                )}>
                  {epic.action === 'create' ? '+ Epic' : '↻ Epic'}
                </span>
                <span className="text-sm font-semibold text-foreground truncate">{epic.title}</span>
                <span className="shrink-0 ml-auto text-micro text-muted-foreground">
                  태스크 {epic.tasks.length}개
                </span>
              </div>
              {/* 태스크 행들 */}
              {epic.tasks.length > 0 && (
                <ul className="divide-y divide-border">
                  {epic.tasks.map((task) => (
                    <li key={task.id} className="flex items-center gap-2 px-3 py-1.5 pl-6">
                      <span className={clsx(
                        'shrink-0 px-1 py-0.5 rounded text-micro font-semibold',
                        task.action === 'create'
                          ? 'bg-green-50 text-green-600'
                          : 'bg-blue-50 text-blue-600',
                      )}>
                        {task.action === 'create' ? '+' : '↻'}
                      </span>
                      <span className="text-mini text-foreground truncate">{task.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {/* 추가 서비스 체크박스 */}
        {connectedServices.length > 0 && (
          <div className="px-6 py-3 border-t border-border bg-muted/20">
            <p className="text-micro font-semibold text-muted-foreground mb-2">JIRA 완료 후 함께 실행</p>
            <div className="flex flex-col gap-1.5">
              {connectedServices.map(svc => {
                const meta = EXTRA_SERVICE_META[svc]
                if (!meta) return null
                return (
                  <label key={svc} className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={extraServices.has(svc)}
                      onChange={() => toggleService(svc)}
                      className="w-3.5 h-3.5 accent-accent"
                    />
                    <span className="text-mini text-foreground">
                      {meta.icon} {meta.label}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        )}

        {/* 푸터 */}
        <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
          <button onClick={onClose} disabled={loading}
            className="h-8 px-4 rounded-lg border border-border text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50">
            취소
          </button>
          <button onClick={() => onConfirm([...extraServices])} disabled={loading}
            className="h-8 px-4 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 disabled:opacity-50 flex items-center gap-1.5">
            {loading && <Loader2 size={12} className="animate-spin" />}
            {extraServices.size > 0 ? `JIRA + ${extraServices.size}개 서비스 내보내기` : 'JIRA로 내보내기'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── SSE 진행률 오버레이 ──────────────────────────────────────────────────────

function ProgressOverlay({ done, total, current }: { done: number; total: number; current: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card rounded-xl border border-border shadow-2xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center gap-3 mb-5">
          <Loader2 size={18} className="animate-spin text-accent shrink-0" />
          <p className="text-sm font-semibold text-foreground">JIRA와 동기화 중...</p>
        </div>
        <div className="mb-1.5 flex justify-between text-mini text-muted-foreground">
          <span className="truncate max-w-[200px]">{current}</span>
          <span className="shrink-0 ml-2">{done} / {total}</span>
        </div>
        <div className="w-full h-1.5 bg-border rounded-full overflow-hidden mb-3">
          <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-mini text-center text-muted-foreground">{pct}% 완료</p>
      </div>
    </div>
  )
}

// ─── 다음 회의 예약 모달 ──────────────────────────────────────────────────────

const DURATION_OPTIONS = [30, 60, 90, 120]

function formatSlotDisplay(slot: TimeSlot) {
  const start = new Date(slot.start)
  const end   = new Date(slot.end)
  const date  = start.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })
  const from  = start.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
  const to    = end.toLocaleTimeString('ko-KR',   { hour: '2-digit', minute: '2-digit', hour12: false })
  const dur   = Math.round((end.getTime() - start.getTime()) / 60000)
  return { date, range: `${from} ~ ${to}`, dur }
}

function NextMeetingModal({
  meetingId, workspaceId, onClose,
}: {
  meetingId: string
  workspaceId: number
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [step, setStep]               = useState<'setup' | 'slots'>('setup')
  const [duration, setDuration]       = useState(60)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [slots, setSlots]             = useState<TimeSlot[]>([])
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null)
  const [title, setTitle]             = useState('')

  async function handleSuggest() {
    setError(null)
    setLoading(true)
    try {
      const res = await suggestNextMeeting(meetingId, workspaceId, { duration_minutes: duration })
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
      <div className="bg-card rounded-xl border border-border shadow-2xl w-full max-w-sm mx-4 overflow-hidden">

        {/* 헤더 */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground">다음 회의 예약</h2>
            <p className="text-mini text-muted-foreground mt-0.5">
              {step === 'setup'
                ? 'AI가 참석자 빈 시간을 분석해 추천합니다'
                : '일정을 선택하고 회의 제목을 입력하세요'}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors mt-0.5">
            <X size={16} />
          </button>
        </div>

        {/* 본문 */}
        <div className="px-6 py-5 space-y-4">
          {step === 'setup' ? (
            <>
              <div>
                <p className="text-sm font-medium text-foreground mb-2">예상 소요 시간</p>
                <div className="grid grid-cols-4 gap-2">
                  {DURATION_OPTIONS.map(min => (
                    <button
                      key={min}
                      onClick={() => setDuration(min)}
                      className={clsx(
                        'py-2 rounded-lg border text-sm transition-colors',
                        duration === min
                          ? 'border-accent bg-accent/10 text-accent font-medium'
                          : 'border-border text-foreground hover:bg-muted',
                      )}
                    >
                      {min}분
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-muted/30 text-mini text-muted-foreground">
                <span className="shrink-0 mt-0.5">💡</span>
                <span>Slack 채널 멤버 이메일 기준으로 Google Calendar 빈 시간을 조회합니다. 두 서비스 모두 연결되어 있어야 합니다.</span>
              </div>

              {error && (
                <p className="text-mini text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{error}</p>
              )}
            </>
          ) : (
            <>
              {/* 슬롯 선택 */}
              <div>
                <p className="text-sm font-medium text-foreground mb-2">추천 일정 선택</p>
                <div className="space-y-2">
                  {slots.map((slot, i) => {
                    const { date, range, dur } = formatSlotDisplay(slot)
                    const isSelected = selectedSlot === slot
                    return (
                      <button
                        key={i}
                        onClick={() => setSelectedSlot(slot)}
                        className={clsx(
                          'w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-all',
                          isSelected
                            ? 'border-accent bg-accent/10 ring-1 ring-accent/30'
                            : 'border-border hover:bg-muted',
                        )}
                      >
                        <div className={clsx(
                          'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0',
                          isSelected ? 'border-accent bg-accent' : 'border-muted-foreground/30',
                        )}>
                          {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">{date}</p>
                          <p className="text-mini text-muted-foreground">{range} · {dur}분</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* 회의 제목 */}
              <div>
                <p className="text-sm font-medium text-foreground mb-1.5">다음 회의 제목 <span className="text-red-500">*</span></p>
                <input
                  autoFocus
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleNavigate()}
                  placeholder="예: Q2 2주차 스프린트 회의"
                  className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                />
              </div>
            </>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-6 py-4 border-t border-border flex items-center gap-2">
          {step === 'slots' && (
            <button
              onClick={() => { setStep('setup'); setError(null) }}
              className="text-sm text-foreground transition-colors hover:opacity-80 mr-auto"
            >
              ← 다시
            </button>
          )}
          <div className={clsx('flex gap-2', step === 'setup' && 'ml-auto')}>
            <button
              onClick={onClose}
              className="h-8 px-4 rounded-lg border border-border text-sm text-foreground transition-colors hover:bg-muted"
            >
              취소
            </button>
            {step === 'setup' ? (
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
                <ExternalLink size={12} />
                회의 생성 페이지로
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── 헬퍼 함수 ────────────────────────────────────────────────────────────────

function fromApi(epics: WbsEpicApi[]): WbsEpic[] {
  return [...epics]
    .sort((a, b) => a.order_index - b.order_index)
    .map((epic) => ({
      id: String(epic.id),
      title: epic.title,
      orderIndex: epic.order_index,
      progress: epic.tasks.length > 0
        ? Math.round(epic.tasks.reduce((s, t) => s + t.progress, 0) / epic.tasks.length)
        : 0,
      tasks: [...epic.tasks]
        .sort((a, b) => a.order_index - b.order_index)
        .map((t) => ({
          id: String(t.id),
          epicId: String(epic.id),
          title: t.title,
          content: t.content ?? undefined,
          assigneeName: t.assignee_name ?? undefined,
          priority: toPriority(t.priority),
          urgency: t.urgency ?? undefined,
          status: toStatus(t.status),
          dueDate: t.due_date ?? undefined,
          progress: t.progress,
          orderIndex: t.order_index,
          jiraIssueId: t.jira_issue_id ?? undefined,
        })),
    }))
}

function formatSyncTime(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diff < 1) return '방금 전'
  if (diff < 60) return `${diff}분 전`
  return `${Math.floor(diff / 60)}시간 전`
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export default function WbsPage() {
  const { meetingId } = useParams()
  const workspaceId = getCurrentWorkspaceId()
  const { state } = useLocation()
  const meetingTitle = (state as any)?.meetingTitle as string | undefined

  // ── 기본 상태
  const [epics, setEpics]           = useState<WbsEpic[]>([])
  const [collapsed, setCollapsed]   = useState<Record<string, boolean>>({})
  const [loading, setLoading]       = useState(true)
  const [generating, setGenerating] = useState(false)
  const [addingEpic, setAddingEpic] = useState(false)
  const [epicInput, setEpicInput]   = useState('')
  const [addingTask, setAddingTask] = useState<string | null>(null)
  const [taskInput, setTaskInput]   = useState('')
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())

  // ── 뷰 모드
  const [viewMode, setViewMode] = useState<'table' | 'gantt'>('table')

  // ── 선택 모드 (부분 동기화)
  const [selectMode, setSelectMode]         = useState(false)
  const [selectedEpics, setSelectedEpics]   = useState<Set<string>>(new Set())
  const [selectedTasks, setSelectedTasks]   = useState<Set<string>>(new Set())

  // ── JIRA
  const [jiraSyncing, setJiraSyncing]       = useState(false)
  const [progressSharing, setProgressSharing] = useState(false)
  const [highlighted, setHighlighted]   = useState<Set<string>>(new Set())
  const [lastSyncAt, setLastSyncAt]     = useState<string | null>(
    () => localStorage.getItem(`jira_sync_${meetingId}`)
  )

  // ── 연동 상태
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([])

  // ── 내보내기 드롭다운
  const [exportMenuOpen, setExportMenuOpen]   = useState(false)
  const [slackExporting, setSlackExporting]   = useState(false)
  const [calendarExporting, setCalendarExporting] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  /** 에픽/태스크 추가 API 중복 호출 방지 (Enter 연타·IME·키 반복) */
  const epicAddInFlightRef = useRef(false)
  const taskAddInFlightRef = useRef(false)

  // ── 다음 회의 예약 모달
  const [nextMeetingOpen, setNextMeetingOpen] = useState(false)

  // ── 프리뷰 모달
  const [previewData, setPreviewData]       = useState<JiraPreviewResult | null>(null)
  const [previewBody, setPreviewBody]       = useState<JiraSelectiveBody>({})
  const [previewLoading, setPreviewLoading] = useState(false)

  // ── SSE 진행률
  const [jiraProgress, setJiraProgress] = useState<{ done: number; total: number; current: string } | null>(null)

  // ── 드래그 앤 드롭
  const [draggedItem, setDraggedItem] = useState<{ type: 'task' | 'epic'; id: string; epicId?: string } | null>(null)
  const [dragOverEpicId, setDragOverEpicId] = useState<string | null>(null)

  // ── 토스트
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  useEffect(() => {
    getWbs(meetingId!, workspaceId)
      .then((d) => setEpics(fromApi(d.epics)))
      .catch(() => setEpics([]))
      .finally(() => setLoading(false))
  }, [meetingId])

  useEffect(() => {
    getIntegrations(workspaceId)
      .then((res) => setIntegrations(res.integrations))
      .catch(() => {})
  }, [workspaceId])

  useEffect(() => {
    if (!exportMenuOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [exportMenuOpen])

  // ── 기본 편집 핸들러

  function toggleEpic(id: string) {
    setCollapsed((p) => ({ ...p, [id]: !p[id] }))
  }

  async function saveEpicTitle(epicId: string, title: string) {
    if (!title.trim()) return
    setEpics((p) => p.map((e) => e.id !== epicId ? e : { ...e, title }))
    await patchEpic(meetingId!, workspaceId, parseInt(epicId), { title }).catch(() => {})
  }

  function updateTask(epicId: string, taskId: string, patch: Partial<WbsTask>) {
    setEpics((p) => p.map((e) => {
      if (e.id !== epicId) return e
      const updatedTasks = e.tasks.map((t) => t.id !== taskId ? t : { ...t, ...patch })
      const progress = updatedTasks.length > 0
        ? Math.round(updatedTasks.reduce((s, t) => s + t.progress, 0) / updatedTasks.length)
        : 0
      return { ...e, tasks: updatedTasks, progress }
    }))
  }

  async function saveTaskField(epicId: string, taskId: string, body: Record<string, unknown>) {
    await patchTask(meetingId!, workspaceId, parseInt(taskId), body).catch(() => {})
  }

  async function handleGenerate() {
    if (!confirm('처음 생성된 WBS로 되돌립니다. 현재 변경사항이 모두 사라집니다. 계속하시겠습니까?')) return
    setGenerating(true)
    try {
      const d = await generateWbs(meetingId!, workspaceId)
      setEpics(fromApi(d.epics))
    } catch {
      showToast('원본 WBS가 없습니다. 회의 종료 후 자동 생성될 때까지 기다려주세요.', 'error')
    } finally { setGenerating(false) }
  }

  async function handleAddEpic() {
    const title = epicInput.trim()
    if (!title) {
      setAddingEpic(false)
      return
    }
    if (epicAddInFlightRef.current) return
    epicAddInFlightRef.current = true
    try {
      const d = await createEpic(meetingId!, workspaceId, title, epics.length)
      setEpics((p) => [...p, { id: String(d.id), title: d.title, orderIndex: d.order_index, progress: 0, tasks: [] }])
      setEpicInput('')
      setAddingEpic(false)
    } finally {
      epicAddInFlightRef.current = false
    }
  }

  function onEpicInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setAddingEpic(false)
      setEpicInput('')
      return
    }
    if (e.key !== 'Enter') return
    if (e.repeat || e.nativeEvent.isComposing) return
    e.preventDefault()
    void handleAddEpic()
  }

  async function handleAddTask(epicId: string) {
    const taskTitle = taskInput.trim()
    if (!taskTitle) {
      setAddingTask(null)
      return
    }
    if (taskAddInFlightRef.current) return
    taskAddInFlightRef.current = true
    try {
      const epic = epics.find(e => e.id === epicId)
      const d = await createTask(meetingId!, workspaceId, parseInt(epicId), taskTitle)
      setEpics((p) => p.map((e) => {
        if (e.id !== epicId) return e
        const newTask = {
          id: String(d.id), epicId, title: d.title,
          assigneeName: d.assignee_name ?? undefined,
          priority: toPriority(d.priority),
          urgency: d.urgency ?? undefined,
          status: toStatus(d.status),
          dueDate: d.due_date ?? undefined,
          progress: d.progress,
          orderIndex: epic?.tasks.length ?? 0,
        }
        const updatedTasks = [...e.tasks, newTask]
        const progress = updatedTasks.length > 0
          ? Math.round(updatedTasks.reduce((s, t) => s + t.progress, 0) / updatedTasks.length)
          : 0
        return { ...e, tasks: updatedTasks, progress }
      }))
      setTaskInput('')
      setAddingTask(null)
    } finally {
      taskAddInFlightRef.current = false
    }
  }

  function onTaskInputKeyDown(epicId: string, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setAddingTask(null)
      return
    }
    if (e.key !== 'Enter') return
    if (e.repeat || e.nativeEvent.isComposing) return
    e.preventDefault()
    void handleAddTask(epicId)
  }

  async function handleDeleteEpic(epicId: string) {
    if (!confirm('에픽과 하위 태스크가 모두 삭제됩니다. 계속하시겠습니까?')) return
    await deleteEpic(meetingId!, workspaceId, parseInt(epicId))
    setEpics((p) => p.filter((e) => e.id !== epicId))
  }

  async function handleDeleteTask(epicId: string, taskId: string) {
    await deleteTask(meetingId!, workspaceId, parseInt(taskId))
    setEpics((p) => p.map((e) => {
      if (e.id !== epicId) return e
      const updatedTasks = e.tasks.filter((t) => t.id !== taskId)
      const progress = updatedTasks.length > 0
        ? Math.round(updatedTasks.reduce((s, t) => s + t.progress, 0) / updatedTasks.length)
        : 0
      return { ...e, tasks: updatedTasks, progress }
    }))
  }

  // ── 드래그 앤 드롭

  function handleDragStart(type: 'task' | 'epic', id: string, epicId?: string) {
    setDraggedItem({ type, id, epicId })
  }

  function handleDragOverEpic(e: React.DragEvent, epicId: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverEpicId(epicId)
  }

  function handleDragEnd() {
    setDraggedItem(null)
    setDragOverEpicId(null)
  }

  async function handleDropOnEpic(targetEpicId: string) {
    if (!draggedItem) return

    if (draggedItem.type === 'task' && draggedItem.epicId !== targetEpicId) {
      const srcEpic = epics.find(e => e.id === draggedItem.epicId)
      const task = srcEpic?.tasks.find(t => t.id === draggedItem.id)
      if (!task) return
      const newOrderIndex = epics.find(e => e.id === targetEpicId)?.tasks.length ?? 0

      setEpics(prev => prev.map(e => {
        if (e.id === draggedItem.epicId) return { ...e, tasks: e.tasks.filter(t => t.id !== draggedItem.id) }
        if (e.id === targetEpicId) return { ...e, tasks: [...e.tasks, { ...task, epicId: targetEpicId, orderIndex: newOrderIndex }] }
        return e
      }))

      try {
        await patchTask(meetingId!, workspaceId, parseInt(draggedItem.id), {
          epic_id: parseInt(targetEpicId),
          order_index: newOrderIndex,
        })
        showToast('태스크를 이동했습니다.')
      } catch {
        showToast('이동에 실패했습니다.', 'error')
        const d = await getWbs(meetingId!, workspaceId)
        setEpics(fromApi(d.epics))
      }
    }

    if (draggedItem.type === 'epic' && draggedItem.id !== targetEpicId) {
      const fromIdx = epics.findIndex(e => e.id === draggedItem.id)
      const toIdx   = epics.findIndex(e => e.id === targetEpicId)
      if (fromIdx === -1 || toIdx === -1) return

      const next = [...epics]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      const reordered = next.map((e, i) => ({ ...e, orderIndex: i }))
      setEpics(reordered)

      try {
        await reorderWbs(meetingId!, workspaceId, {
          epics: reordered.map(e => ({ id: parseInt(e.id), order_index: e.orderIndex })),
        })
      } catch {
        showToast('순서 변경에 실패했습니다.', 'error')
        const d = await getWbs(meetingId!, workspaceId)
        setEpics(fromApi(d.epics))
      }
    }

    setDraggedItem(null)
    setDragOverEpicId(null)
  }

  // ── 선택 모드

  function toggleSelectEpic(epicId: string) {
    const epic = epics.find(e => e.id === epicId)
    if (!epic) return
    const allSelected = epic.tasks.every(t => selectedTasks.has(t.id))
    const nextEpics = new Set(selectedEpics)
    const nextTasks = new Set(selectedTasks)
    if (allSelected && selectedEpics.has(epicId)) {
      nextEpics.delete(epicId)
      epic.tasks.forEach(t => nextTasks.delete(t.id))
    } else {
      nextEpics.add(epicId)
      epic.tasks.forEach(t => nextTasks.add(t.id))
    }
    setSelectedEpics(nextEpics)
    setSelectedTasks(nextTasks)
  }

  function toggleSelectTask(epicId: string, taskId: string) {
    const nextTasks = new Set(selectedTasks)
    if (nextTasks.has(taskId)) nextTasks.delete(taskId)
    else nextTasks.add(taskId)
    setSelectedTasks(nextTasks)

    const epic = epics.find(e => e.id === epicId)
    const nextEpics = new Set(selectedEpics)
    if (epic?.tasks.every(t => nextTasks.has(t.id))) nextEpics.add(epicId)
    else nextEpics.delete(epicId)
    setSelectedEpics(nextEpics)
  }

  function getSelectiveBody(): JiraSelectiveBody {
    if (selectedEpics.size === 0 && selectedTasks.size === 0) return {}

    // 선택된 태스크가 하나라도 있는 에픽도 epic_ids에 포함
    const epicIdsSet = new Set([...selectedEpics])
    epics.forEach(e => {
      if (e.tasks.some(t => selectedTasks.has(t.id))) {
        epicIdsSet.add(e.id)
      }
    })

    return {
      epic_ids: [...epicIdsSet].map(Number),
      task_ids: [...selectedTasks].map(Number),
    }
  }

  // ── JIRA 내보내기 (프리뷰 → SSE 스트림)

  async function openPreview(body: JiraSelectiveBody = {}) {
    setPreviewLoading(true)
    try {
      const data = await previewJira(meetingId!, workspaceId, body)
      setPreviewBody(body)
      setPreviewData(data)
    } catch {
      showToast('프리뷰 조회에 실패했습니다.', 'error')
    } finally {
      setPreviewLoading(false)
    }
  }

  async function handleConfirmExport(extraServices: string[] = []) {
    setPreviewData(null)
    setJiraProgress({ done: 0, total: 1, current: '준비 중...' })
    let exportResult: JiraExportResult | null = null

    try {
      await streamJiraExport(
        meetingId!, workspaceId, previewBody,
        (done, total, current) => setJiraProgress({ done, total, current }),
        (result) => { exportResult = result },
      )
      setJiraProgress(null)

      if (exportResult && (exportResult as JiraExportResult).failed.length > 0) {
        const r = exportResult as JiraExportResult
        showToast(
          `완료 — 생성 ${r.created}개, 업데이트 ${r.updated}개, 실패 ${r.failed.length}개`,
          'error',
        )
      } else {
        const r = exportResult as JiraExportResult | null
        showToast(
          r
            ? `JIRA 내보내기 완료 — 생성 ${r.created}개, 업데이트 ${r.updated}개`
            : 'JIRA 내보내기가 완료되었습니다.',
        )
      }

      // JIRA 완료 후 추가 선택 서비스 — JIRA 완료 알림 / Calendar 링크 첨부
      if (extraServices.length > 0 && exportResult) {
        const r = exportResult as JiraExportResult
        try {
          const notifyResult = await jiraNotify(meetingId!, workspaceId, {
            services: extraServices,
            created: r.created,
            updated: r.updated,
          })
          const failed = Object.entries(notifyResult.results).filter(([, res]) => res.status === 'error')
          if (failed.length > 0) {
            showToast(`일부 실패: ${failed.map(([s]) => s).join(', ')}`, 'error')
          } else {
            showToast('Slack 알림 · Google Calendar 업데이트 완료')
          }
        } catch {
          showToast('알림 전송에 실패했습니다.', 'error')
        }
      }

      setSelectMode(false)
      setSelectedEpics(new Set())
      setSelectedTasks(new Set())

      const d = await getWbs(meetingId!, workspaceId)
      setEpics(fromApi(d.epics))
    } catch {
      setJiraProgress(null)
      showToast('JIRA 내보내기에 실패했습니다.', 'error')
    }
  }

  // ── JIRA 동기화

  async function handleJiraSync() {
    setJiraSyncing(true)
    try {
      const result = await syncJira(meetingId!, workspaceId)
      const now = new Date().toISOString()
      localStorage.setItem(`jira_sync_${meetingId}`, now)
      setLastSyncAt(now)

      if (result.changed.length === 0) { showToast('이미 최신 상태입니다.'); return }

      const changedIds = new Set(result.changed.map((c) => String(c.task_id)))
      const fresh = await getWbs(meetingId!, workspaceId)
      setEpics(fromApi(fresh.epics))
      setHighlighted(changedIds)
      setTimeout(() => setHighlighted(new Set()), 3000)
      showToast(`JIRA에서 ${result.changed.length}개 변경사항을 가져왔습니다.`)
    } catch {
      showToast('JIRA 동기화에 실패했습니다.', 'error')
    } finally {
      setJiraSyncing(false)
    }
  }

  async function handleShareProgress() {
    setProgressSharing(true)
    try {
      await shareWbsProgress(meetingId!, workspaceId)
      showToast('진행률을 Slack에 공유했습니다.')
    } catch {
      showToast('Slack 공유에 실패했습니다.', 'error')
    } finally {
      setProgressSharing(false)
    }
  }

  async function handleExportSlack() {
    setExportMenuOpen(false)
    setSlackExporting(true)
    try {
      await exportSlack(meetingId!, workspaceId)
      showToast('Slack에 회의록을 전송했습니다.')
    } catch {
      showToast('Slack 전송에 실패했습니다.', 'error')
    } finally {
      setSlackExporting(false)
    }
  }

  async function handleExportCalendar() {
    setExportMenuOpen(false)
    setCalendarExporting(true)
    try {
      await exportGoogleCalendar(meetingId!, workspaceId)
      showToast('Google Calendar에 업데이트했습니다.')
    } catch {
      showToast('업데이트에 실패했습니다.', 'error')
    } finally {
      setCalendarExporting(false)
    }
  }

  // ─── 렌더링 ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={22} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  const jiraConnected    = integrations.some(i => i.service === 'jira' && i.is_connected)
  const slackConnected   = integrations.some(i => i.service === 'slack' && i.is_connected)
  const googleConnected  = integrations.some(i => i.service === 'google_calendar' && i.is_connected)

  const selectedCount = selectedTasks.size
  const isEpicChecked = (epic: WbsEpic) =>
    epic.tasks.length > 0 && epic.tasks.every(t => selectedTasks.has(t.id))
  const isEpicIndeterminate = (epic: WbsEpic) =>
    epic.tasks.some(t => selectedTasks.has(t.id)) && !isEpicChecked(epic)

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">

      {/* 토스트 */}
      {toast && (
        <div className={clsx(
          'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium transition-all',
          toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-foreground text-background',
        )}>
          {toast.msg}
        </div>
      )}

      {/* 다음 회의 예약 모달 */}
      {nextMeetingOpen && (
        <NextMeetingModal
          meetingId={meetingId!}
          workspaceId={workspaceId}
          onClose={() => setNextMeetingOpen(false)}
        />
      )}

      {/* 모달 & 오버레이 */}
      {previewData && (
        <PreviewModal
          data={previewData}
          onClose={() => setPreviewData(null)}
          onConfirm={handleConfirmExport}
          loading={previewLoading}
          connectedServices={integrations
            .filter(i => i.is_connected && (i.service === 'slack' || i.service === 'google_calendar'))
            .map(i => i.service)}
        />
      )}
      {jiraProgress && (
        <ProgressOverlay
          done={jiraProgress.done}
          total={jiraProgress.total}
          current={jiraProgress.current}
        />
      )}

      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-3 justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">WBS · 태스크 리스트</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{meetingTitle ?? `회의 #${meetingId}`}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">

          {/* 뷰 모드 토글 */}
          <div className="flex items-center rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setViewMode('table')}
              className={clsx('flex items-center gap-1.5 h-8 px-3 text-sm transition-colors',
                viewMode === 'table' ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-muted')}
            >
              <LayoutList size={13} /> 테이블
            </button>
            <button
              onClick={() => setViewMode('gantt')}
              className={clsx('flex items-center gap-1.5 h-8 px-3 text-sm transition-colors border-l border-border',
                viewMode === 'gantt' ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-muted')}
            >
              <CalendarDays size={13} /> 간트
            </button>
          </div>

          {/* 선택 모드 */}
          {epics.length > 0 && (
            <button
              onClick={() => { setSelectMode(p => !p); setSelectedEpics(new Set()); setSelectedTasks(new Set()) }}
              className={clsx(
                'flex items-center gap-1.5 h-8 px-3 rounded-lg border text-sm transition-colors',
                selectMode
                  ? 'border-accent text-accent bg-accent/10'
                  : 'border-border text-foreground hover:bg-muted',
              )}
            >
              <CheckSquare size={13} />
              {selectMode ? `${selectedCount}개 선택` : '부분 선택'}
            </button>
          )}

          {/* 통합 내보내기 드롭다운 */}
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setExportMenuOpen(p => !p)}
              disabled={epics.length === 0}
              className={clsx(
                'flex items-center gap-1.5 h-8 px-3 rounded-lg border text-sm transition-colors disabled:opacity-50',
                exportMenuOpen
                  ? 'border-accent text-accent bg-accent/10'
                  : 'border-border text-foreground hover:bg-muted',
              )}
            >
              <ExternalLink size={13} />
              {selectMode && selectedCount > 0 ? `내보내기 (${selectedCount})` : '내보내기'}
              <ChevronDown size={11} className={clsx('transition-transform duration-150 ml-0.5', exportMenuOpen && 'rotate-180')} />
            </button>

            {exportMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-30 w-72 bg-card rounded-xl border border-border shadow-xl overflow-hidden">
                {selectMode && selectedCount > 0 && (
                  <div className="px-3 py-2 border-b border-border bg-accent/5">
                    <p className="text-micro font-semibold text-accent">
                      {selectedCount}개 태스크 선택됨 — JIRA는 선택 항목만 내보냅니다
                    </p>
                  </div>
                )}

                <div className="py-1">
                  {/* JIRA 내보내기 */}
                  <button
                    disabled={!jiraConnected || previewLoading}
                    onClick={() => { setExportMenuOpen(false); openPreview(selectMode ? getSelectiveBody() : {}) }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-left"
                  >
                    <span className="text-[15px] shrink-0">🔵</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">JIRA 내보내기</p>
                      <p className="text-micro text-muted-foreground">에픽·태스크를 JIRA 이슈로 생성·업데이트</p>
                    </div>
                    {!jiraConnected
                      ? <span className="text-micro text-red-400 shrink-0">미연결</span>
                      : previewLoading
                        ? <Loader2 size={12} className="animate-spin text-muted-foreground shrink-0" />
                        : <ChevronRight size={12} className="text-muted-foreground/40 shrink-0" />
                    }
                  </button>

                  <div className="mx-4 border-t border-border/50 my-0.5" />

                  {/* Slack 회의록 */}
                  <button
                    disabled={!slackConnected || slackExporting}
                    onClick={handleExportSlack}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-left"
                  >
                    <span className="text-[15px] shrink-0">💬</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">Slack 회의록 전송</p>
                      <p className="text-micro text-muted-foreground">채널에 회의록·액션 아이템 전송</p>
                    </div>
                    {!slackConnected
                      ? <span className="text-micro text-red-400 shrink-0">미연결</span>
                      : slackExporting
                        ? <Loader2 size={12} className="animate-spin text-muted-foreground shrink-0" />
                        : null
                    }
                  </button>

                  {/* Slack 진행률 공유 */}
                  <button
                    disabled={!slackConnected || progressSharing}
                    onClick={() => { setExportMenuOpen(false); handleShareProgress() }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-left"
                  >
                    <span className="text-[15px] shrink-0">📊</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">Slack 진행률 공유</p>
                      <p className="text-micro text-muted-foreground">담당자별 WBS 진행률을 채널에 전송</p>
                    </div>
                    {!slackConnected
                      ? <span className="text-micro text-red-400 shrink-0">미연결</span>
                      : progressSharing
                        ? <Loader2 size={12} className="animate-spin text-muted-foreground shrink-0" />
                        : null
                    }
                  </button>

                  <div className="mx-4 border-t border-border/50 my-0.5" />

                  {/* Google Calendar */}
                  <button
                    disabled={!googleConnected || calendarExporting}
                    onClick={handleExportCalendar}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-left"
                  >
                    <span className="text-[15px] shrink-0">📅</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">Google Calendar</p>
                      <p className="text-micro text-muted-foreground">캘린더 이벤트에 JIRA · WBS 링크 첨부</p>
                    </div>
                    {!googleConnected
                      ? <span className="text-micro text-red-400 shrink-0">미연결</span>
                      : calendarExporting
                        ? <Loader2 size={12} className="animate-spin text-muted-foreground shrink-0" />
                        : null
                    }
                  </button>
                </div>

                {/* 다음 회의 예약 */}
                <div className="border-t border-border mt-1 pt-1">
                  <button
                    disabled={!slackConnected || !googleConnected}
                    onClick={() => { setExportMenuOpen(false); setNextMeetingOpen(true) }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-left"
                  >
                    <span className="text-[15px] shrink-0">🗓️</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">다음 회의 예약</p>
                      <p className="text-micro text-muted-foreground">AI 일정 추천 → 회의 생성 페이지로 이동</p>
                    </div>
                    {(!slackConnected || !googleConnected)
                      ? <span className="text-micro text-red-400 shrink-0">미연결</span>
                      : <ChevronRight size={12} className="text-muted-foreground/40 shrink-0" />
                    }
                  </button>
                </div>

                <div className="px-4 py-2 border-t border-border bg-muted/20">
                  <a href="/settings/integrations" className="text-micro text-accent hover:underline">
                    연동 설정 →
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* JIRA 동기화 — 버튼은 헤더 다른 액션과 동일 높이·스타일, 동기화 시각은 옆에 한 줄 */}
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleJiraSync}
              disabled={jiraSyncing || epics.length === 0 || !jiraConnected}
              title={!jiraConnected ? 'JIRA 연동이 필요합니다' : lastSyncAt ? formatSyncTime(lastSyncAt) : undefined}
              className={clsx(
                'flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors',
                'border-border text-foreground hover:bg-muted',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {jiraSyncing ? <Loader2 size={13} className="animate-spin shrink-0" /> : <RefreshCw size={13} className="shrink-0" />}
              JIRA 동기화
            </button>
            {lastSyncAt ? (
              <span
                className="max-w-[6.5rem] truncate text-micro leading-tight text-muted-foreground sm:max-w-none sm:whitespace-nowrap"
                title={formatSyncTime(lastSyncAt)}
              >
                {formatSyncTime(lastSyncAt)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* 빈 상태 */}
      {epics.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 rounded-xl border border-dashed border-border px-4">
          <Sparkles size={28} className="text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">회의 종료 후 WBS가 자동으로 생성됩니다.</p>
          <p className="text-mini text-muted-foreground/60">파이프라인이 완료되면 이 페이지에서 확인할 수 있습니다.</p>
          {addingEpic ? (
            <div className="mt-2 w-full max-w-md flex items-center gap-2 rounded-lg border border-dashed border-accent/40 px-4 py-3">
              <input
                autoFocus
                value={epicInput}
                onChange={(e) => setEpicInput(e.target.value)}
                onKeyDown={onEpicInputKeyDown}
                placeholder="에픽 제목 입력 후 Enter"
                className="flex-1 text-sm font-semibold bg-transparent outline-none placeholder:text-muted-foreground"
              />
              <button type="button" onClick={handleAddEpic} className="text-mini text-accent shrink-0">추가</button>
              <button type="button" onClick={() => { setAddingEpic(false); setEpicInput('') }} className="text-mini text-foreground shrink-0">취소</button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setAddingEpic(true); setEpicInput('') }}
              className="mt-1 flex items-center gap-1 text-mini text-foreground hover:text-accent transition-colors"
            >
              <Plus size={12} /> 에픽 추가
            </button>
          )}
        </div>
      ) : viewMode === 'gantt' ? (
        <>
          <div className="mb-4">
            <WbsEpicTitleNotice />
          </div>
          <GanttView epics={epics} />
          <div className="mt-4 rounded-xl border border-border overflow-hidden">
            <div className="border-t border-border bg-muted/10 px-4 py-2">
              {addingEpic ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={epicInput}
                    onChange={(e) => setEpicInput(e.target.value)}
                    onKeyDown={onEpicInputKeyDown}
                    placeholder="에픽 제목 입력 후 Enter"
                    className="flex-1 text-sm font-semibold bg-transparent outline-none placeholder:text-muted-foreground"
                  />
                  <button type="button" onClick={handleAddEpic} className="text-mini text-accent">추가</button>
                  <button type="button" onClick={() => { setAddingEpic(false); setEpicInput('') }} className="text-mini text-foreground">취소</button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setAddingEpic(true); setEpicInput('') }}
                  className="flex items-center gap-1 text-mini text-foreground hover:text-accent transition-colors"
                >
                  <Plus size={12} /> 에픽 추가
                </button>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* 안내 배너 + 재생성 (분리) */}
          <div className="mb-5 flex flex-col gap-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2">
              <Sparkles size={13} className="shrink-0 text-accent" />
              <p className="text-mini flex-1 text-accent">
                셀을 클릭하면 바로 편집 · 에픽 행을 드래그하면 순서 변경 · 태스크를 다른 에픽 위로 드래그하면 이동
              </p>
            </div>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className={clsx(
                'flex h-8 shrink-0 items-center gap-1.5 self-end rounded-lg border border-border px-3 text-sm transition-colors sm:self-center',
                'text-foreground hover:bg-muted',
                'disabled:cursor-not-allowed disabled:opacity-40',
              )}
            >
              {generating ? <Loader2 size={13} className="animate-spin shrink-0" /> : <RefreshCw size={13} className="shrink-0" />}
              {generating ? '생성 중...' : '재생성'}
            </button>
            </div>
            <WbsEpicTitleNotice />
          </div>

          {/* 테이블 */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] table-fixed border-collapse text-sm align-middle">
                <colgroup>
                  {selectMode && <col className="w-9" />}
                  <col style={{ width: selectMode ? '34%' : '36%' }} />
                  <col style={{ width: '7.5rem' }} />
                  <col style={{ width: '5.25rem' }} />
                  <col style={{ width: '6.75rem' }} />
                  <col style={{ width: '6.25rem' }} />
                  <col style={{ width: '5.75rem' }} />
                  <col className="w-10" />
                </colgroup>
                <thead className="sticky top-0 z-10 border-b border-border">
                  <tr>
                    {selectMode && <th className="w-9 bg-card px-2 text-center align-middle" />}
                    <th className="min-w-0 bg-card px-4 py-3 text-left align-middle text-micro font-semibold uppercase tracking-wide text-muted-foreground">작업명</th>
                    <th className="bg-card px-3 py-3 text-center align-middle text-micro font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">담당자</th>
                    <th className="bg-card px-2 py-3 text-center align-middle text-micro font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">우선순위</th>
                    <th className="bg-card px-2 py-3 text-center align-middle text-micro font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">상태</th>
                    <th className="bg-card px-2 py-3 text-center align-middle text-micro font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">기한</th>
                    <th className="bg-card px-2 py-3 text-center align-middle text-micro font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">진행률</th>
                    <th className="w-10 bg-card p-0 align-middle" aria-hidden />
                  </tr>
                </thead>
                <tbody>
                  {epics.map((epic) => (
                    <Fragment key={epic.id}>
                      {/* 에픽 행 */}
                      <tr
                        draggable
                        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; handleDragStart('epic', epic.id) }}
                        onDragOver={(e) => handleDragOverEpic(e, epic.id)}
                        onDragLeave={() => setDragOverEpicId(null)}
                        onDrop={() => handleDropOnEpic(epic.id)}
                        onDragEnd={handleDragEnd}
                        className={clsx(
                          'border-b border-border group transition-colors',
                          dragOverEpicId === epic.id && draggedItem?.type === 'task'
                            ? 'bg-accent/15 ring-2 ring-inset ring-accent/40'
                            : 'bg-muted/30',
                          draggedItem?.id === epic.id && draggedItem?.type === 'epic' && 'opacity-40',
                        )}
                      >
                        {selectMode && (
                          <td className="px-2 py-2.5 text-center align-middle">
                            <button
                              type="button"
                              onClick={() => toggleSelectEpic(epic.id)}
                              className="text-muted-foreground hover:text-accent transition-colors"
                            >
                              {isEpicChecked(epic)
                                ? <CheckSquare size={15} className="text-accent" />
                                : isEpicIndeterminate(epic)
                                ? <Square size={15} className="text-accent/60" />
                                : <Square size={15} />
                              }
                            </button>
                          </td>
                        )}
                        <td className="min-w-0 px-4 py-2.5 align-middle">
                          <div className="flex min-w-0 items-center gap-2">
                            <GripVertical size={13} className="shrink-0 cursor-grab text-muted-foreground/40 transition-colors group-hover:text-muted-foreground/70" />
                            <button type="button" onClick={() => toggleEpic(epic.id)} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                              {collapsed[epic.id] ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                            </button>
                            <InlineText value={epic.title} onSave={(v) => saveEpicTitle(epic.id, v)} className="block min-w-0 flex-1 truncate font-semibold text-foreground" />
                            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-micro text-muted-foreground tabular-nums">{epic.tasks.length}개</span>
                          </div>
                        </td>
                        <td className="min-w-0 px-3 py-2.5 text-center align-middle" colSpan={4}>
                          <div className="flex max-w-full items-center justify-center gap-2">
                            <div className="h-1.5 min-w-0 flex-1 max-w-[12rem] overflow-hidden rounded-full bg-border">
                              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${epic.progress}%` }} />
                            </div>
                            <span className="shrink-0 tabular-nums text-micro text-muted-foreground">{epic.progress}%</span>
                          </div>
                        </td>
                        <td className="w-10 p-0 align-middle" aria-hidden />
                        <td className="px-1 py-2.5 text-right align-middle">
                          <button type="button" onClick={() => handleDeleteEpic(epic.id)}
                            className="inline-flex rounded p-1 text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-red-500 group-hover:opacity-100">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>

                      {/* 태스크 행들 */}
                      {!collapsed[epic.id] && epic.tasks.map((task) => (
                        <tr
                          key={task.id}
                          draggable
                          onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; handleDragStart('task', task.id, epic.id) }}
                          onDragEnd={handleDragEnd}
                          className={clsx(
                            'border-b border-border hover:bg-accent/5 transition-all group cursor-grab active:cursor-grabbing',
                            highlighted.has(task.id) && 'bg-yellow-50 dark:bg-yellow-900/20',
                            draggedItem?.id === task.id && 'opacity-40',
                          )}
                        >
                          {/* 선택 체크박스 */}
                          {selectMode && (
                            <td className="px-2 py-2.5 text-center align-middle">
                              <button type="button" onClick={() => toggleSelectTask(epic.id, task.id)}
                                className="text-muted-foreground hover:text-accent transition-colors">
                                {selectedTasks.has(task.id)
                                  ? <CheckSquare size={14} className="text-accent" />
                                  : <Square size={14} />
                                }
                              </button>
                            </td>
                          )}

                          {/* 작업명 + 내용 인라인 */}
                          <td className="min-w-0 px-4 py-2.5 pl-10 align-top">
                            <div className="flex min-w-0 items-start gap-1.5">
                              <GripVertical size={12} className="mt-1 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-muted-foreground/60" />
                              <div className="min-w-0 flex-1 space-y-1">
                                <InlineText
                                  value={task.title}
                                  onSave={(v) => { if (!v.trim()) return; updateTask(epic.id, task.id, { title: v }); saveTaskField(epic.id, task.id, { title: v }) }}
                                  className="block line-clamp-2 break-words text-sm text-foreground"
                                />
                                {expandedTasks.has(task.id) ? (
                                  <textarea
                                    autoFocus
                                    defaultValue={task.content ?? ''}
                                    onBlur={(e) => {
                                      const v = e.target.value.trim() || null
                                      if (v !== (task.content ?? null)) {
                                        updateTask(epic.id, task.id, { content: v ?? undefined })
                                        saveTaskField(epic.id, task.id, { content: v })
                                      }
                                      setExpandedTasks(prev => { const n = new Set(prev); n.delete(task.id); return n })
                                    }}
                                    onKeyDown={(e) => { if (e.key === 'Escape') e.currentTarget.blur() }}
                                    rows={2}
                                    className="w-full min-w-0 resize-none rounded border border-accent/40 bg-muted/40 px-1.5 py-1 text-mini leading-relaxed text-muted-foreground outline-none placeholder:text-muted-foreground/40"
                                    placeholder="내용을 입력하세요..."
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setExpandedTasks(prev => new Set(prev).add(task.id))}
                                    className={clsx(
                                      'max-w-full cursor-text text-left text-mini leading-relaxed transition-colors break-words',
                                      task.content
                                        ? 'text-muted-foreground/70 hover:text-muted-foreground'
                                        : 'text-muted-foreground/0 group-hover:text-muted-foreground/30 italic',
                                    )}
                                  >
                                    {task.content ?? '메모 추가...'}
                                  </button>
                                )}
                                {(task.urgency === 'urgent' || task.urgency === 'low' || task.jiraIssueId) && (
                                  <div className="flex flex-wrap items-center gap-1">
                                    {task.urgency === 'urgent' && (
                                      <span className="rounded bg-red-100 px-1 py-0.5 text-micro font-semibold text-red-600 dark:bg-red-900/30 dark:text-red-400">긴급</span>
                                    )}
                                    {task.urgency === 'low' && (
                                      <span className="rounded bg-green-100 px-1 py-0.5 text-micro text-green-600 dark:bg-green-900/30 dark:text-green-400">여유</span>
                                    )}
                                    {task.jiraIssueId && (
                                      <span className="max-w-full truncate rounded bg-blue-100 px-1 py-0.5 font-mono text-micro text-blue-600 dark:bg-blue-900/30 dark:text-blue-400" title={task.jiraIssueId}>
                                        {task.jiraIssueId}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* 담당자 */}
                          <td className="min-w-0 px-3 py-2.5 text-center align-middle">
                            <div className="flex w-full min-w-0 justify-center">
                              <div className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                                <Avatar name={task.assigneeName} />
                                <InlineText
                                  value={task.assigneeName ?? ''}
                                  onSave={(v) => { updateTask(epic.id, task.id, { assigneeName: v || undefined }); saveTaskField(epic.id, task.id, { assignee_name: v || null }) }}
                                  className="min-w-0 truncate text-mini text-foreground"
                                  placeholder="담당자 없음"
                                />
                              </div>
                            </div>
                          </td>

                          {/* 우선순위 */}
                          <td className="min-w-0 px-2 py-2.5 text-center align-middle">
                            <div className="flex w-full min-w-0 justify-center">
                            <div className="relative inline-flex min-w-[4.5rem] max-w-full items-center justify-center">
                              <span
                                className={clsx(
                                  'inline-flex min-h-[1.625rem] min-w-[2.75rem] items-center justify-center whitespace-nowrap rounded-full px-2 py-0.5 text-micro font-medium',
                                  PRIORITY_MAP[task.priority]?.cls,
                                )}
                              >
                                {PRIORITY_MAP[task.priority]?.label}
                              </span>
                              <select
                                value={task.priority}
                                onChange={(e) => {
                                  const p = e.target.value as WbsPriority
                                  updateTask(epic.id, task.id, { priority: p })
                                  saveTaskField(epic.id, task.id, { priority: p === 'urgent' ? 'high' : p })
                                }}
                                className="absolute inset-0 cursor-pointer opacity-0"
                              >
                                {Object.entries(PRIORITY_MAP).map(([val, { label }]) => (
                                  <option key={val} value={val}>{label}</option>
                                ))}
                              </select>
                            </div>
                            </div>
                          </td>

                          {/* 상태 */}
                          <td className="min-w-0 px-2 py-2.5 text-center align-middle">
                            <div className="flex w-full min-w-0 justify-center">
                              <StatusSelect
                                status={task.status}
                                onChange={(s) => { updateTask(epic.id, task.id, { status: s }); saveTaskField(epic.id, task.id, { status: fromStatus(s) }) }}
                              />
                            </div>
                          </td>

                          {/* 기한 */}
                          <td className="min-w-0 px-2 py-2.5 text-center align-middle">
                            <div className="flex w-full min-w-0 justify-center">
                              <div
                                className={clsx(
                                  'min-w-0 shrink-0',
                                  task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done'
                                    ? '[&_button]:font-medium [&_button]:text-red-500 [&_button_span]:text-red-500'
                                    : '[&_button]:text-muted-foreground [&_button_span]:text-muted-foreground',
                                )}
                              >
                                <DatePicker
                                  value={task.dueDate ?? ''}
                                  onChange={(next) => {
                                    const v = next || undefined
                                    updateTask(epic.id, task.id, { dueDate: v })
                                    saveTaskField(epic.id, task.id, { due_date: v ?? null })
                                  }}
                                  placeholder="—"
                                  displayFormat="iso"
                                  size="compact"
                                  portal
                                  triggerFullWidth={false}
                                />
                              </div>
                            </div>
                          </td>

                          {/* 진행률: 에픽과 동일한 미니 바 + 기한/DatePicker와 맞는 컴팩트 입력 */}
                          <td className="min-w-0 px-2 py-2.5 text-center align-middle">
                            <div className="flex w-full min-w-0 justify-center">
                            <div className="inline-flex max-w-full min-w-0 items-center gap-1.5">
                              <div className="h-1 w-[3.25rem] shrink-0 overflow-hidden rounded-full bg-border">
                                <div
                                  className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out"
                                  style={{ width: `${Math.min(100, Math.max(0, task.progress))}%` }}
                                />
                              </div>
                              <div className="flex shrink-0 items-center gap-px">
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={task.progress}
                                  onChange={(e) => {
                                    const raw = e.target.value
                                    const v = raw === '' ? 0 : Math.max(0, Math.min(100, parseInt(raw, 10) || 0))
                                    updateTask(epic.id, task.id, { progress: v })
                                    saveTaskField(epic.id, task.id, { progress: v })
                                  }}
                                  className={clsx(
                                    'h-7 w-9 min-w-0 rounded-md border border-border bg-background px-0.5 text-center text-mini font-medium tabular-nums text-foreground',
                                    'outline-none transition-shadow hover:border-border/80',
                                    'focus:border-accent focus:ring-2 focus:ring-accent/30',
                                    '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                                  )}
                                />
                                <span className="text-micro font-medium tabular-nums text-muted-foreground">%</span>
                              </div>
                            </div>
                            </div>
                          </td>

                          {/* 삭제 */}
                          <td className="px-1 py-2.5 text-right align-middle">
                            <button type="button" onClick={() => handleDeleteTask(epic.id, task.id)}
                              className="inline-flex rounded p-1 text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-red-500 group-hover:opacity-100">
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}

                      {/* 태스크 추가 행 */}
                      {!collapsed[epic.id] && (
                        <tr className="border-b border-border bg-muted/10">
                          <td colSpan={selectMode ? 8 : 7} className="min-w-0 px-4 py-2 pl-10">
                            {addingTask === epic.id ? (
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <input
                                  autoFocus value={taskInput}
                                  onChange={(e) => setTaskInput(e.target.value)}
                                  onKeyDown={(e) => onTaskInputKeyDown(epic.id, e)}
                                  placeholder="태스크 제목 입력 후 Enter"
                                  className="min-w-0 flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
                                />
                                <button type="button" onClick={() => handleAddTask(epic.id)} className={wbsToolBtnPrimary()}>추가</button>
                                <button type="button" onClick={() => setAddingTask(null)} className={wbsToolBtnOutline()}>취소</button>
                              </div>
                            ) : (
                              <button type="button" onClick={() => { setAddingTask(epic.id); setTaskInput('') }} className={wbsToolBtnOutline()}>
                                <Plus size={11} className="shrink-0" /> 태스크 추가
                              </button>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}

                  {/* 에픽 추가 행 (테이블 맨 아래) */}
                  <tr className="border-b border-border bg-muted/10">
                    <td colSpan={selectMode ? 8 : 7} className="min-w-0 px-4 py-2">
                      {addingEpic ? (
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <input
                            autoFocus
                            value={epicInput}
                            onChange={(e) => setEpicInput(e.target.value)}
                            onKeyDown={onEpicInputKeyDown}
                            placeholder="에픽 제목 입력 후 Enter"
                            className="min-w-0 flex-1 text-sm font-semibold bg-transparent outline-none placeholder:text-muted-foreground"
                          />
                          <button type="button" onClick={handleAddEpic} className={wbsToolBtnPrimary()}>추가</button>
                          <button type="button" onClick={() => { setAddingEpic(false); setEpicInput('') }} className={wbsToolBtnOutline()}>취소</button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setAddingEpic(true); setEpicInput('') }}
                          className={wbsToolBtnOutline()}
                        >
                          <Plus size={11} className="shrink-0" /> 에픽 추가
                        </button>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
