import type { Meeting, ActionItem, WeeklyStats, Participant, Department } from '../types/meeting'

// ── Departments ───────────────────────────────────────────────────────────
export const DEPARTMENTS: Department[] = [
  { id: 'd1', name: '제품팀' },
  { id: 'd2', name: '개발팀' },
  { id: 'd3', name: '마케팅팀' },
  { id: 'd4', name: '디자인팀' },
]

// ── Participants ──────────────────────────────────────────────────────────
// userId: `scripts/seed_mysql.sql` 의 `users.id` 와 동일 (1–6).
export const PARTICIPANTS: Participant[] = [
  { id: 'p1', userId: 1, name: '김수민', avatarInitials: '수민', color: '#6b78f6', department: '제품팀' },
  { id: 'p2', userId: 2, name: '이지현', avatarInitials: '지현', color: '#22c55e', department: '디자인팀' },
  { id: 'p3', userId: 3, name: '박준혁', avatarInitials: '준혁', color: '#f97316', department: '개발팀' },
  { id: 'p4', userId: 4, name: '최은영', avatarInitials: '은영', color: '#ec4899', department: '마케팅팀' },
  { id: 'p5', userId: 5, name: '정민준', avatarInitials: '민준', color: '#eab308', department: '개발팀' },
  { id: 'p6', userId: 6, name: '오서연', avatarInitials: '서연', color: '#14b8a6', department: '마케팅팀' },
]

// ── Meetings ──────────────────────────────────────────────────────────────
// `workspace_id = 1` 기준 `seed_mysql.sql` 의 `meetings` 3행과 동일한 id·제목·타입·상태·시각.
// (참석자는 시드의 `meeting_participants` 처럼 호스트 1명만 — 김수민)
const HOST = [PARTICIPANTS[0]]

export const MEETINGS: Meeting[] = [
  {
    id: '1',
    title: 'WS1 Scheduled: Kickoff',
    meetingType: 'kickoff',
    status: 'upcoming',
    startAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
    participants: HOST,
    agenda: ['Kickoff: scope & timeline'],
    actionItemCount: 1,
    decisionCount: 1,
    tags: [],
  },
  {
    id: '2',
    title: 'WS1 In Progress: Daily Sync',
    meetingType: 'daily',
    status: 'inprogress',
    startAt: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
    participants: HOST,
    agenda: ['Daily: blockers and next steps'],
    actionItemCount: 1,
    decisionCount: 1,
    tags: [],
  },
  {
    id: '3',
    title: 'WS1 Done: Product Review',
    meetingType: 'review',
    status: 'completed',
    startAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 - 50 * 60 * 1000).toISOString(),
    endAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    participants: HOST,
    agenda: ['Review: decisions & action items'],
    summary: 'Review: MVP timeline confirmed.',
    actionItemCount: 1,
    decisionCount: 1,
    tags: [],
  },
]

// ── Action Items ──────────────────────────────────────────────────────────
// `seed_mysql.sql` 의 `action_items` 3행 (회의 id / 담당자 id 매칭).
export const ACTION_ITEMS: ActionItem[] = [
  {
    id: 'a1',
    title: 'Create initial project plan',
    assignee: PARTICIPANTS[1],
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    priority: 'high',
    done: false,
    meetingId: '1',
    meetingTitle: 'WS1 Scheduled: Kickoff',
  },
  {
    id: 'a2',
    title: 'Fix CI build on main',
    assignee: PARTICIPANTS[0],
    dueDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
    priority: 'urgent',
    done: false,
    meetingId: '2',
    meetingTitle: 'WS1 In Progress: Daily Sync',
  },
  {
    id: 'a3',
    title: 'Write release checklist',
    assignee: PARTICIPANTS[2],
    dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    priority: 'medium',
    done: true,
    meetingId: '3',
    meetingTitle: 'WS1 Done: Product Review',
  },
]

// ── Weekly Stats ──────────────────────────────────────────────────────────
export const WEEKLY_STATS: WeeklyStats = {
  totalMeetings: 3,
  totalMinutes: 120,
  actionItemsTotal: 3,
  actionItemsDone: 1,
  topParticipant: PARTICIPANTS[0],
}
