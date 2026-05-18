import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Clock, Users, Calendar, Video, Trash2, Edit2, FlaskConical } from 'lucide-react'
import { formatTime } from '../../utils/format'
import { persistMeetingSnapshot, readMeetingSnapshotForRoute } from '../../utils/meetingRoutes'
import type { Meeting } from '../../types/meeting'
import Tooltip from '../../components/ui/Tooltip'
import { Avatar } from '../../components/ui/Avatar'
import {
  getCurrentWorkspaceId,
  getCurrentWorkspaceRole,
  WORKSPACE_CHANGED_EVENT,
  WORKSPACE_ROLE_CHANGED_EVENT,
} from '../../utils/workspace'
import { fetchWorkspaceMeetingDetail } from '../../api/meetings'
import { startWorkspaceMeeting } from '../../api/meetings'
import { apiRequest } from '../../api/client'

export default function UpcomingMeetingPage() {
  const { meetingId } = useParams()
  const navigate = useNavigate()
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState(() => getCurrentWorkspaceId())
  const [workspaceRole, setWorkspaceRole] = useState(() => getCurrentWorkspaceRole())

  useEffect(() => {
    function onWsChanged(e: Event) {
      const id = (e as CustomEvent<{ id: number }>).detail?.id
      if (typeof id === 'number' && Number.isFinite(id)) setWorkspaceId(id)
    }
    window.addEventListener(WORKSPACE_CHANGED_EVENT, onWsChanged)
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, onWsChanged)
  }, [])

  useEffect(() => {
    function onRoleChanged(e: Event) {
      const role = (e as CustomEvent<{ role: string }>).detail?.role
      if (typeof role === 'string') setWorkspaceRole(role)
    }
    window.addEventListener(WORKSPACE_ROLE_CHANGED_EVENT, onRoleChanged)
    return () => window.removeEventListener(WORKSPACE_ROLE_CHANGED_EVENT, onRoleChanged)
  }, [])

  useEffect(() => {
    if (!meetingId) {
      setLoading(false)
      setMeeting(null)
      setError('회의 ID가 없습니다.')
      return
    }

    const numericId = Number(meetingId)
    if (!Number.isFinite(numericId) || numericId <= 0) {
      setLoading(false)
      setMeeting(null)
      setError('유효하지 않은 회의 ID입니다.')
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    fetchWorkspaceMeetingDetail(workspaceId, numericId)
      .then((m) => {
        if (cancelled) return
        setMeeting(m)
        setError(null)
      })
      .catch(() => {
        if (cancelled) return
        const snap = readMeetingSnapshotForRoute(meetingId)
        if (snap && snap.id === meetingId) {
          setMeeting(snap)
          setError(null)
        } else {
          setMeeting(null)
          setError('회의를 불러오지 못했습니다.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [meetingId, workspaceId])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <p className="text-sm">회의 정보를 불러오는 중…</p>
      </div>
    )
  }

  if (error && !meeting) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <p className="text-sm">{error}</p>
        <button
          onClick={() => navigate('/')}
          className="text-sm text-accent hover:underline"
        >
          홈으로 돌아가기
        </button>
      </div>
    )
  }

  if (!meeting) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <p className="text-sm">회의를 찾을 수 없습니다.</p>
        <button
          onClick={() => navigate('/')}
          className="text-sm text-accent hover:underline"
        >
          홈으로 돌아가기
        </button>
      </div>
    )
  }

  const startDate = new Date(meeting.startAt)
  const diffMs = startDate.getTime() - Date.now()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
  const canEnter = true

  const countdownLabel =
    diffMs <= 0
      ? '지금 시작 가능'
      : diffHours > 0
        ? `${diffHours}시간 ${diffMins}분 후`
        : `${diffMins}분 후`

  const dateLabel = startDate.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft size={15} />
        뒤로
      </button>

      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <span className="px-2 py-0.5 rounded-full text-mini font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
            예정된 회의
          </span>
          <span className="text-mini text-muted-foreground">{countdownLabel}</span>
        </div>
        <h1 className="text-xl font-semibold text-foreground">{meeting.title}</h1>
        {meeting.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {meeting.tags.map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 rounded text-micro bg-muted text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-4 mb-5">
        <div className="flex items-start gap-3">
          <Calendar size={16} className="text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">{dateLabel}</p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Clock size={16} className="text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">{formatTime(meeting.startAt)}</p>
            {meeting.endAt && (
              <p className="text-mini text-muted-foreground mt-0.5">
                ~ {formatTime(meeting.endAt)}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Users size={16} className="text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground mb-1.5">
              {meeting.participants.length}명 참석 예정
            </p>
            <div className="flex flex-wrap gap-1.5">
              {meeting.participants.map((p) => (
                <span
                  key={p.id}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-mini bg-muted text-foreground"
                >
                  <Avatar participant={p} size="sm" className="w-3.5 h-3.5 text-[8px]" />
                  {p.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Tooltip
          label=""
          placement="top"
          block
        >
          <button
            onClick={async () => {
              // Live 페이지가 아직 목업 기반이어서, 실제 회의 정보를 스냅샷으로 전달
              try {
                await startWorkspaceMeeting(workspaceId, Number(meeting.id))
              } catch (err) {
                alert(err instanceof Error ? err.message : '회의 시작에 실패했습니다.')
                return
              }
              persistMeetingSnapshot(meeting)
              navigate(`/live/${meeting.id}`, { state: { meeting } })
            }}
            className={
              canEnter
                ? 'flex items-center justify-center gap-2 flex-1 h-10 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors'
                : 'flex items-center justify-center gap-2 flex-1 h-10 rounded-lg bg-muted text-muted-foreground text-sm font-medium cursor-not-allowed'
            }
          >
            <Video size={15} />
            회의 입장
          </button>
        </Tooltip>
      </div>

      {workspaceRole === 'admin' && (
        <div className="mt-4 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate(`/meetings/${meetingId}/simulate`)}
            className="inline-flex items-center gap-1.5 text-mini text-muted-foreground hover:text-foreground transition-colors"
            title="WAV 파일로 회의 시뮬레이션 (개발·QA 전용)"
          >
            <FlaskConical size={13} aria-hidden="true" />
            WAV 시뮬레이션
          </button>
          <Link
            to="/meetings/new"
            state={{ draftMeeting: meeting }}
            className="inline-flex items-center gap-1.5 text-mini text-muted-foreground hover:text-foreground transition-colors"
          >
            <Edit2 size={13} aria-hidden="true" />
            수정
          </Link>
          <button
            type="button"
            onClick={async () => {
              if (!meetingId) return
              const ok = window.confirm('회의를 삭제하시겠습니까?')
              if (!ok) return

              try {
                await apiRequest<void>(
                  `/meetings/workspaces/${workspaceId}/${meetingId}`,
                  { method: 'DELETE' },
                )
              } catch (err) {
                alert(`회의 삭제 실패\n${err instanceof Error ? err.message : String(err)}`)
                return
              }

              navigate('/')
            }}
            className="inline-flex items-center gap-1.5 text-mini text-red-600 hover:text-red-700 transition-colors"
          >
            <Trash2 size={13} aria-hidden="true" />
            삭제
          </button>
        </div>
      )}
    </div>
  )
}
