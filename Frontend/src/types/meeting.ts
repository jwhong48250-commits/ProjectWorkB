export type MeetingStatus = 'inprogress' | 'upcoming' | 'completed'

export type Priority = 'urgent' | 'high' | 'medium' | 'low'

export interface Participant {
  id: string
  /** MySQL `users.id` — 목업 UI id(p1…)와 분리 */
  userId?: number
  name: string
  avatarInitials: string
  color: string
  department?: string
}

export interface Department {
  id: string
  name: string
}

export interface ActionItem {
  id: string
  title: string
  assignee: Participant
  dueDate: string
  priority: Priority
  done: boolean
  meetingId: string
  meetingTitle: string
}

export interface Meeting {
  id: string
  title: string
  /** 백엔드 `meeting_type` (예: 일반 회의, 스탠드업) */
  meetingType?: string
  /** 백엔드 `room_name` (예: 회의실 A, Zoom 등) */
  roomName?: string
  status: MeetingStatus
  startAt: string        // ISO 8601
  endAt?: string
  googleCalendarEventId?: string
  participants: Participant[]
  agenda?: string[]
  summary?: string
  actionItemCount: number
  decisionCount: number
  tags: string[]
}

export interface WeeklyStats {
  totalMeetings: number
  totalMinutes: number
  actionItemsTotal: number
  actionItemsDone: number
  topParticipant: Participant
}
