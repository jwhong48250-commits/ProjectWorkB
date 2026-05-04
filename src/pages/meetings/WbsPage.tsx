import { useState, useEffect, Fragment } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import {
  Plus, ExternalLink, ChevronDown, ChevronRight,
  Sparkles, Loader2, Trash2, CheckCircle2, Clock3,
  Ban, Circle, Pencil, RefreshCw, GripVertical,
  LayoutList, CalendarDays, CheckSquare, Square, X,
} from 'lucide-react'
import clsx from 'clsx'
import { getCurrentWorkspaceId } from '../../api/client'
import {
  getWbs, generateWbs, createEpic, createTask,
  patchEpic, patchTask, deleteEpic, deleteTask,
  reorderWbs, toStatus, fromStatus, toPriority,
  type WbsEpicApi,
} from '../../api/wbs'
import {
  syncJira,
  previewJira, streamJiraExport,
  type JiraPreviewResult, type JiraPreviewEpic, type JiraExportResult, type JiraSelectiveBody,
} from '../../api/actions'
import type { WbsEpic, WbsTask, WbsStatus, WbsPriority } from '../../types/wbs'

// ─── 상수 ────────────────────────────────────────────────────────────────────

const PRIORITY_MAP: Record<WbsPriority, { label: string; cls: string }> = {
  urgent: { label: '긴급', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  high:   { label: '높음', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  medium: { label: '보통', cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
  low:    { label: '낮음', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
}

const STATUS_MAP: Record<WbsStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  todo:       { label: '할 일',   cls: 'bg-muted text-muted-foreground', icon: <Circle size={10} /> },
  inprogress: { label: '진행 중', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', icon: <Clock3 size={10} /> },
  done:       { label: '완료',    cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300', icon: <CheckCircle2 size={10} /> },
  blocked:    { label: '블록',    cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', icon: <Ban size={10} /> },
}

const STATUS_COLOR: Record<WbsStatus, string> = {
  todo: '#94a3b8', inprogress: '#3b82f6', done: '#22c55e', blocked: '#ef4444',
}

// ─── 소형 컴포넌트 ────────────────────────────────────────────────────────────

function StatusSelect({ status, onChange }: { status: WbsStatus; onChange: (s: WbsStatus) => void }) {
  const { label, cls, icon } = STATUS_MAP[status] ?? STATUS_MAP.todo
  return (
    <div className="relative inline-flex items-center">
      <span className={clsx('inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-micro font-semibold whitespace-nowrap', cls)}>
        {icon}{label}
      </span>
      <select value={status} onChange={(e) => onChange(e.target.value as WbsStatus)}
        className="absolute inset-0 opacity-0 cursor-pointer w-full">
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
        className={clsx('bg-transparent outline-none border-b border-accent w-full', className)}
      />
    )
  }
  return (
    <span onClick={() => { setDraft(value); setEditing(true) }}
      className={clsx('cursor-pointer hover:text-accent transition-colors group/text', className)}>
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

function PreviewModal({
  data, onClose, onConfirm, loading,
}: {
  data: JiraPreviewResult
  onClose: () => void
  onConfirm: () => void
  loading: boolean
}) {
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

        {/* 푸터 */}
        <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
          <button onClick={onClose} disabled={loading}
            className="h-8 px-4 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted/50 disabled:opacity-50">
            취소
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="h-8 px-4 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 disabled:opacity-50 flex items-center gap-1.5">
            {loading && <Loader2 size={12} className="animate-spin" />}
            JIRA로 내보내기
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

  // ── 뷰 모드
  const [viewMode, setViewMode] = useState<'table' | 'gantt'>('table')

  // ── 선택 모드 (부분 동기화)
  const [selectMode, setSelectMode]         = useState(false)
  const [selectedEpics, setSelectedEpics]   = useState<Set<string>>(new Set())
  const [selectedTasks, setSelectedTasks]   = useState<Set<string>>(new Set())

  // ── JIRA
  const [jiraSyncing, setJiraSyncing]   = useState(false)
  const [highlighted, setHighlighted]   = useState<Set<string>>(new Set())
  const [lastSyncAt, setLastSyncAt]     = useState<string | null>(
    () => localStorage.getItem(`jira_sync_${meetingId}`)
  )

  // ── 프리뷰 모달
  const [previewData, setPreviewData]     = useState<JiraPreviewResult | null>(null)
  const [previewBody, setPreviewBody]     = useState<JiraSelectiveBody>({})
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
    if (epics.length > 0) {
      if (!confirm('기존 WBS가 모두 삭제되고 새로 생성됩니다. 계속하시겠습니까?')) return
    }
    setGenerating(true)
    try {
      const d = await generateWbs(meetingId!, workspaceId)
      setEpics(fromApi(d.epics))
    } finally { setGenerating(false) }
  }

  async function handleAddEpic() {
    if (!epicInput.trim()) { setAddingEpic(false); return }
    const d = await createEpic(meetingId!, workspaceId, epicInput.trim(), epics.length)
    setEpics((p) => [...p, { id: String(d.id), title: d.title, orderIndex: d.order_index, progress: 0, tasks: [] }])
    setEpicInput(''); setAddingEpic(false)
  }

  async function handleAddTask(epicId: string) {
    if (!taskInput.trim()) { setAddingTask(null); return }
    const epic = epics.find(e => e.id === epicId)
    const d = await createTask(meetingId!, workspaceId, parseInt(epicId), taskInput.trim())
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
    setTaskInput(''); setAddingTask(null)
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

  async function handleConfirmExport() {
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

      const newHighlighted = new Set<string>()
      result.changed.forEach(({ task_id, field, new: newVal }) => {
        const id = String(task_id)
        newHighlighted.add(id)
        setEpics((prev) => prev.map((epic) => ({
          ...epic,
          tasks: epic.tasks.map((t) => {
            if (t.id !== id) return t
            if (field === 'status') return { ...t, status: toStatus(newVal) }
            if (field === 'title') return { ...t, title: newVal }
            return t
          }),
        })))
      })
      setHighlighted(newHighlighted)
      setTimeout(() => setHighlighted(new Set()), 3000)
      showToast(`JIRA에서 ${result.changed.length}개 변경사항을 가져왔습니다.`)
    } catch {
      showToast('JIRA 동기화에 실패했습니다.', 'error')
    } finally {
      setJiraSyncing(false)
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

      {/* 모달 & 오버레이 */}
      {previewData && (
        <PreviewModal
          data={previewData}
          onClose={() => setPreviewData(null)}
          onConfirm={handleConfirmExport}
          loading={previewLoading}
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
                viewMode === 'table' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted/50')}
            >
              <LayoutList size={13} /> 테이블
            </button>
            <button
              onClick={() => setViewMode('gantt')}
              className={clsx('flex items-center gap-1.5 h-8 px-3 text-sm transition-colors border-l border-border',
                viewMode === 'gantt' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted/50')}
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
                  : 'border-border text-muted-foreground hover:bg-muted/50',
              )}
            >
              <CheckSquare size={13} />
              {selectMode ? `${selectedCount}개 선택됨` : '선택 동기화'}
            </button>
          )}

          {/* JIRA 내보내기 */}
          {selectMode ? (
            <button
              onClick={() => openPreview(getSelectiveBody())}
              disabled={selectedCount === 0 || previewLoading}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {previewLoading ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
              선택 내보내기
            </button>
          ) : (
            <button
              onClick={() => openPreview()}
              disabled={previewLoading || epics.length === 0}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-sm hover:bg-muted/50 transition-colors disabled:opacity-50"
            >
              {previewLoading ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
              JIRA 내보내기
            </button>
          )}

          {/* JIRA 동기화 */}
          <div className="flex flex-col items-end">
            <button
              onClick={handleJiraSync}
              disabled={jiraSyncing || epics.length === 0}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-sm hover:bg-muted/50 transition-colors disabled:opacity-50"
            >
              {jiraSyncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              JIRA 동기화
            </button>
            {lastSyncAt && (
              <span className="text-micro text-muted-foreground mt-0.5">
                마지막: {formatSyncTime(lastSyncAt)}
              </span>
            )}
          </div>

          {/* 에픽 추가 */}
          <button
            onClick={() => { setAddingEpic(true); setEpicInput('') }}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors"
          >
            <Plus size={13} /> 에픽 추가
          </button>
        </div>
      </div>

      {/* 빈 상태 */}
      {epics.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4 rounded-xl border border-dashed border-border">
          <Sparkles size={28} className="text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">WBS가 아직 없습니다. AI로 자동 생성하세요.</p>
          <button onClick={handleGenerate} disabled={generating}
            className="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 disabled:opacity-60">
            {generating ? <><Loader2 size={13} className="animate-spin" /> 생성 중...</> : <><Sparkles size={13} /> AI WBS 생성</>}
          </button>
        </div>
      ) : viewMode === 'gantt' ? (
        <GanttView epics={epics} />
      ) : (
        <>
          {/* AI 배너 */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/5 border border-accent/20 mb-5">
            <Sparkles size={13} className="text-accent shrink-0" />
            <p className="text-mini text-accent flex-1">
              셀을 클릭하면 바로 편집 · 에픽 행을 드래그하면 순서 변경 · 태스크를 다른 에픽 위로 드래그하면 이동
            </p>
            <button onClick={handleGenerate} disabled={generating}
              className="text-mini text-accent hover:underline disabled:opacity-60 shrink-0">
              {generating ? '생성 중...' : '재생성'}
            </button>
          </div>

          {/* 테이블 */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-card border-b border-border">
                  <tr>
                    {selectMode && <th className="w-8 px-2" />}
                    <th className="text-left px-4 py-3 text-micro font-semibold text-muted-foreground uppercase tracking-wide">작업명</th>
                    <th className="text-left px-4 py-3 text-micro font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap min-w-[120px]">담당자</th>
                    <th className="text-left px-4 py-3 text-micro font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap min-w-[80px]">우선순위</th>
                    <th className="text-left px-4 py-3 text-micro font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap min-w-[110px]">상태</th>
                    <th className="text-left px-4 py-3 text-micro font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap min-w-[90px]">기한</th>
                    <th className="text-left px-4 py-3 text-micro font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap min-w-[70px]">진행률</th>
                    <th className="w-10" />
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
                          <td className="px-2 py-2.5 text-center">
                            <button
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
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <GripVertical size={13} className="shrink-0 text-muted-foreground/40 cursor-grab group-hover:text-muted-foreground/70 transition-colors" />
                            <button onClick={() => toggleEpic(epic.id)} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                              {collapsed[epic.id] ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                            </button>
                            <InlineText value={epic.title} onSave={(v) => saveEpicTitle(epic.id, v)} className="font-semibold text-foreground" />
                            <span className="shrink-0 text-micro text-muted-foreground px-1.5 py-0.5 rounded-full bg-muted">{epic.tasks.length}개</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5" colSpan={4}>
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-1.5 rounded-full bg-border overflow-hidden">
                              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${epic.progress}%` }} />
                            </div>
                            <span className="text-micro text-muted-foreground">{epic.progress}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5" />
                        <td className="px-4 py-2.5 text-right">
                          <button onClick={() => handleDeleteEpic(epic.id)}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all">
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
                            <td className="px-2 py-2.5 text-center">
                              <button onClick={() => toggleSelectTask(epic.id, task.id)}
                                className="text-muted-foreground hover:text-accent transition-colors">
                                {selectedTasks.has(task.id)
                                  ? <CheckSquare size={14} className="text-accent" />
                                  : <Square size={14} />
                                }
                              </button>
                            </td>
                          )}

                          {/* 작업명 */}
                          <td className="px-4 py-2.5 pl-10">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <GripVertical size={12} className="shrink-0 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
                              <InlineText
                                value={task.title}
                                onSave={(v) => { if (!v.trim()) return; updateTask(epic.id, task.id, { title: v }); saveTaskField(epic.id, task.id, { title: v }) }}
                                className="text-sm text-foreground"
                              />
                              {task.urgency === 'urgent' && (
                                <span className="shrink-0 text-micro px-1 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 font-semibold">긴급</span>
                              )}
                              {task.urgency === 'low' && (
                                <span className="shrink-0 text-micro px-1 py-0.5 rounded bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400">여유</span>
                              )}
                              {task.jiraIssueId && (
                                <span className="shrink-0 text-micro px-1 py-0.5 rounded bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 font-mono">
                                  {task.jiraIssueId}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 담당자 */}
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <Avatar name={task.assigneeName} />
                              <InlineText
                                value={task.assigneeName ?? ''}
                                onSave={(v) => { updateTask(epic.id, task.id, { assigneeName: v || undefined }); saveTaskField(epic.id, task.id, { assignee_name: v || null }) }}
                                className="text-mini text-foreground"
                                placeholder="담당자 없음"
                              />
                            </div>
                          </td>

                          {/* 우선순위 */}
                          <td className="px-4 py-2.5">
                            <div className="relative inline-flex items-center">
                              <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-micro font-semibold whitespace-nowrap', PRIORITY_MAP[task.priority]?.cls)}>
                                {PRIORITY_MAP[task.priority]?.label}
                              </span>
                              <select
                                value={task.priority}
                                onChange={(e) => {
                                  const p = e.target.value as WbsPriority
                                  updateTask(epic.id, task.id, { priority: p })
                                  saveTaskField(epic.id, task.id, { priority: p === 'urgent' ? 'high' : p })
                                }}
                                className="absolute inset-0 opacity-0 cursor-pointer w-full"
                              >
                                {Object.entries(PRIORITY_MAP).map(([val, { label }]) => (
                                  <option key={val} value={val}>{label}</option>
                                ))}
                              </select>
                            </div>
                          </td>

                          {/* 상태 */}
                          <td className="px-4 py-2.5">
                            <StatusSelect
                              status={task.status}
                              onChange={(s) => { updateTask(epic.id, task.id, { status: s }); saveTaskField(epic.id, task.id, { status: fromStatus(s) }) }}
                            />
                          </td>

                          {/* 기한 */}
                          <td className="px-4 py-2.5">
                            <input
                              type="date"
                              value={task.dueDate ?? ''}
                              onChange={(e) => {
                                const v = e.target.value || undefined
                                updateTask(epic.id, task.id, { dueDate: v })
                                saveTaskField(epic.id, task.id, { due_date: v ?? null })
                              }}
                              className={clsx(
                                'text-mini bg-transparent outline-none cursor-pointer w-24',
                                task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done'
                                  ? 'text-red-500 font-medium'
                                  : 'text-muted-foreground',
                              )}
                            />
                          </td>

                          {/* 진행률 */}
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1">
                              <input
                                type="number" min={0} max={100}
                                value={task.progress}
                                onChange={(e) => {
                                  const v = Math.max(0, Math.min(100, parseInt(e.target.value) || 0))
                                  updateTask(epic.id, task.id, { progress: v })
                                  saveTaskField(epic.id, task.id, { progress: v })
                                }}
                                className="w-10 text-mini text-center bg-transparent outline-none border-b border-transparent hover:border-border focus:border-accent text-muted-foreground"
                              />
                              <span className="text-micro text-muted-foreground">%</span>
                            </div>
                          </td>

                          {/* 삭제 */}
                          <td className="px-4 py-2.5 text-right">
                            <button onClick={() => handleDeleteTask(epic.id, task.id)}
                              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all">
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}

                      {/* 태스크 추가 행 */}
                      {!collapsed[epic.id] && (
                        <tr className="border-b border-border bg-muted/10">
                          <td colSpan={selectMode ? 8 : 7} className="px-4 py-2 pl-10">
                            {addingTask === epic.id ? (
                              <div className="flex items-center gap-2">
                                <input
                                  autoFocus value={taskInput}
                                  onChange={(e) => setTaskInput(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleAddTask(epic.id)
                                    if (e.key === 'Escape') setAddingTask(null)
                                  }}
                                  placeholder="태스크 제목 입력 후 Enter"
                                  className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
                                />
                                <button onClick={() => handleAddTask(epic.id)} className="text-mini text-accent">추가</button>
                                <button onClick={() => setAddingTask(null)} className="text-mini text-muted-foreground">취소</button>
                              </div>
                            ) : (
                              <button onClick={() => { setAddingTask(epic.id); setTaskInput('') }}
                                className="flex items-center gap-1 text-mini text-muted-foreground hover:text-accent transition-colors">
                                <Plus size={12} /> 태스크 추가
                              </button>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* 에픽 추가 인풋 */}
      {addingEpic && (
        <div className="mt-3 rounded-lg border border-dashed border-accent/40 px-4 py-3 flex items-center gap-2">
          <input
            autoFocus value={epicInput}
            onChange={(e) => setEpicInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddEpic()
              if (e.key === 'Escape') setAddingEpic(false)
            }}
            placeholder="에픽 제목 입력 후 Enter"
            className="flex-1 text-sm font-semibold bg-transparent outline-none placeholder:text-muted-foreground"
          />
          <button onClick={handleAddEpic} className="text-mini text-accent">추가</button>
          <button onClick={() => setAddingEpic(false)} className="text-mini text-muted-foreground">취소</button>
        </div>
      )}
    </div>
  )
}
