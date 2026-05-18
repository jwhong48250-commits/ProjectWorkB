import { Clock, CheckSquare, MessageSquare, ChevronRight, Users, Tag } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import Badge from '../ui/Badge'
import { AvatarGroup } from '../ui/Avatar'
import type { Meeting } from '../../types/meeting'
import { formatRelativeTime, formatTime } from '../../utils/format'
import { persistMeetingSnapshot } from '../../utils/meetingRoutes'
import { useAuth } from '../../context/AuthContext'

interface MeetingCardProps {
  meeting: Meeting
}

/** 상태에 따라 이동할 라우트를 결정 */
function getMeetingRoute(meeting: Meeting): string {
  if (meeting.status === 'inprogress') return `/live/${meeting.id}`
  if (meeting.status === 'upcoming') return `/meetings/${meeting.id}/upcoming`
  return `/meetings/${meeting.id}/notes`
}

/** 대시보드 참가자(user_id)에 현재 사용자가 포함되는지 — 진행 중 재입장 허용에 사용 */
function userIsMeetingParticipant(meeting: Meeting, userId: number | null | undefined): boolean {
  if (userId == null || !Number.isFinite(userId)) return false
  return meeting.participants.some((p) => p.userId === userId)
}

function goToMeeting(
  navigate: ReturnType<typeof useNavigate>,
  meeting: Meeting,
  userId: number | null | undefined,
) {
  if (meeting.status === 'inprogress' && !userIsMeetingParticipant(meeting, userId)) {
    window.alert('진행 중인 회의라 입장하실 수 없습니다.')
    return
  }
  const route = getMeetingRoute(meeting)
  if (!route.startsWith('/live/')) persistMeetingSnapshot(meeting)
  navigate(route)
}

export default function MeetingCard({ meeting }: MeetingCardProps) {
  const navigate = useNavigate()
  const { user } = useAuth()

  const isInProgress = meeting.status === 'inprogress'
  const canEnterLive = userIsMeetingParticipant(meeting, user?.id)
  const isClickable = !isInProgress || canEnterLive

  return (
    <article
      role="button"
      tabIndex={0}
      aria-disabled={isInProgress && !canEnterLive}
      onClick={() => goToMeeting(navigate, meeting, user?.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          goToMeeting(navigate, meeting, user?.id)
        }
      }}
      className={clsx(
        'group flex flex-col gap-2.5 p-3.5 rounded-lg border bg-card',
        isClickable
          ? 'cursor-pointer hover:shadow-card-hover hover:border-accent/25 transition-all duration-quick border-border'
          : 'cursor-default border-status-inprogress/25 ring-1 ring-status-inprogress/15',
      )}
    >
      {/* Top row: status badge + time */}
      <div className="flex items-center justify-between gap-2">
        <Badge
          variant={meeting.status}
          dot={meeting.status === 'inprogress'}
        />
        <span className="text-mini text-muted-foreground flex items-center gap-1">
          <Clock size={11} />
          {meeting.status === 'inprogress'
            ? `진행 중 · ${formatRelativeTime(meeting.startAt)}`
            : meeting.status === 'upcoming'
            ? formatTime(meeting.startAt)
            : formatTime(meeting.startAt)
          }
        </span>
      </div>

      {/* Title */}
      <h3 className="text-sm font-medium text-foreground leading-snug line-clamp-2 group-hover:text-accent transition-colors">
        {meeting.title}
      </h3>

      {/* 유형 · 참석 직원 (텍스트로 명시) */}
      {(meeting.status === 'upcoming' || meeting.status === 'inprogress' || meeting.status === 'completed') &&
        (meeting.meetingType || meeting.participants.length > 0) && (
          <div className="flex flex-col gap-1.5 text-mini text-muted-foreground">
            {meeting.meetingType && (
              <div className="flex items-start gap-1.5 min-w-0">
                <Tag size={12} className="shrink-0 mt-0.5 opacity-80" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="text-muted-foreground/80">유형 </span>
                  <span className="text-foreground/90">{meeting.meetingType}</span>
                </span>
              </div>
            )}
            {meeting.participants.length > 0 && (
              <div className="flex items-start gap-1.5 min-w-0">
                <Users size={12} className="shrink-0 mt-0.5 opacity-80" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="text-muted-foreground/80">참석 </span>
                  <span className="text-foreground/90 break-words">
                    {meeting.participants.map((p) => p.name).join(', ')}
                  </span>
                </span>
              </div>
            )}
          </div>
        )}

      {/* Tags */}
      {meeting.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {meeting.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 rounded text-micro bg-muted text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Summary (completed only) */}
      {meeting.status === 'completed' && meeting.summary && (
        <p className="text-mini text-muted-foreground line-clamp-2 leading-relaxed">
          {meeting.summary}
        </p>
      )}

      {/* Agenda preview (upcoming) */}
      {meeting.status === 'upcoming' && meeting.agenda && meeting.agenda.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {meeting.agenda.slice(0, 2).map((item, i) => (
            <li key={i} className="flex items-center gap-1.5 text-mini text-muted-foreground">
              <span className="w-1 h-1 rounded-full bg-muted-foreground shrink-0" />
              {item}
            </li>
          ))}
          {meeting.agenda.length > 2 && (
            <li className="text-mini text-muted-foreground/60">+{meeting.agenda.length - 2}개 더</li>
          )}
        </ul>
      )}

      {/* Bottom row: participants + stats */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <AvatarGroup participants={meeting.participants} max={4} />
        <div className="flex items-center gap-3 text-mini text-muted-foreground">
          {meeting.actionItemCount > 0 && (
            <span className="flex items-center gap-1">
              <CheckSquare size={11} />
              {meeting.actionItemCount}
            </span>
          )}
          {meeting.decisionCount > 0 && (
            <span className="flex items-center gap-1">
              <MessageSquare size={11} />
              {meeting.decisionCount}
            </span>
          )}
          <ChevronRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </article>
  )
}
