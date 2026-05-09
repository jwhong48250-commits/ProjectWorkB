import type { Meeting, MeetingStatus, WeeklyStats, Participant } from "../types/meeting";
import { apiRequest } from "./client";
import { createAvatarColorMap, pickAvatarColor } from "../utils/avatarColor";

type BackendMeetingStatus = "scheduled" | "in_progress" | "done";

export interface BackendDashboardParticipant {
    user_id: number;
    name: string;
}

/** 대시보드·회의 단건 API 공통 회의 행 형태 */
export interface BackendMeetingItem {
    id: number;
    title: string;
    status: BackendMeetingStatus | string;
    scheduled_at?: string | null;
    started_at?: string | null;
    ended_at?: string | null;
    meeting_type?: string | null;
    room_name?: string | null;
    google_calendar_event_id?: string | null;
    summary?: string | null;
    participants?: BackendDashboardParticipant[];
}

interface BackendDashboardResponse {
    meetings: {
        in_progress: BackendMeetingItem[];
        scheduled: BackendMeetingItem[];
        done: BackendMeetingItem[];
    };
    weekly_summary: {
        total_count: number;
        total_duration_min: number;
        action_items_total?: number;
        action_items_done?: number;
        summary_cards: unknown[];
    };
    pending_action_items: {
        id: number;
        content: string;
        due_date?: string | null;
        meeting_title: string;
    }[];
    next_meeting_suggestion: null | {
        suggested_at: string;
        reason: string;
    };
}

const DEFAULT_TOP_PARTICIPANT: Participant = {
    id: "p0",
    name: "—",
    avatarInitials: "—",
    color: "#64748b",
};

function participantFromDashboard(
    p: BackendDashboardParticipant,
    avatarColorMap: Map<number, string>,
): Participant {
    const color = pickAvatarColor(p.user_id, avatarColorMap);
    const initials = p.name.length >= 2 ? p.name.slice(0, 2) : p.name.length === 1 ? p.name : "?";
    return {
        id: `u${p.user_id}`,
        userId: p.user_id,
        name: p.name,
        avatarInitials: initials,
        color,
    };
}

export function mapApiMeetingStatus(s: string): MeetingStatus {
    if (s === "in_progress") return "inprogress";
    if (s === "scheduled") return "upcoming";
    if (s === "done") return "completed";
    return "upcoming";
}

function pickStartAt(m: BackendMeetingItem): string {
    return m.started_at ?? m.scheduled_at ?? m.ended_at ?? new Date().toISOString();
}

export function mapApiMeetingItemToMeeting(
    m: BackendMeetingItem,
    avatarColorMap: Map<number, string> = createAvatarColorMap((m.participants ?? []).map((p) => p.user_id)),
): Meeting {
    const apiParticipants = m.participants ?? [];
    return {
        id: String(m.id),
        title: m.title,
        meetingType: m.meeting_type ?? undefined,
        roomName: m.room_name ?? undefined,
        status: mapApiMeetingStatus(String(m.status)),
        startAt: pickStartAt(m),
        endAt: m.ended_at ?? undefined,
        googleCalendarEventId: m.google_calendar_event_id ?? undefined,
        participants: apiParticipants.map((p) => participantFromDashboard(p, avatarColorMap)),
        agenda: [],
        summary: m.summary ?? undefined,
        actionItemCount: 0,
        decisionCount: 0,
        tags: [],
    };
}

export async function fetchWorkspaceDashboard(workspaceId: number) {
    const data = await apiRequest<BackendDashboardResponse>(`/workspaces/${workspaceId}/dashboard`);
    const allParticipants = [
        ...data.meetings.in_progress,
        ...data.meetings.scheduled,
        ...data.meetings.done,
    ].flatMap((meeting) => meeting.participants ?? []);
    const avatarColorMap = createAvatarColorMap(allParticipants.map((p) => p.user_id));

    const meetings: Meeting[] = [
        ...data.meetings.in_progress.map((m) => mapApiMeetingItemToMeeting(m, avatarColorMap)),
        ...data.meetings.scheduled.map((m) => mapApiMeetingItemToMeeting(m, avatarColorMap)),
        ...data.meetings.done.map((m) => mapApiMeetingItemToMeeting(m, avatarColorMap)),
    ];

    const weeklyStats: WeeklyStats = {
        totalMeetings: data.weekly_summary.total_count,
        totalMinutes: Math.round(data.weekly_summary.total_duration_min),
        actionItemsTotal: Math.max(0, Number(data.weekly_summary.action_items_total ?? 0)),
        actionItemsDone: Math.max(0, Number(data.weekly_summary.action_items_done ?? 0)),
        topParticipant: DEFAULT_TOP_PARTICIPANT,
    };

    return { raw: data, meetings, weeklyStats };
}
