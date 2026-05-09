import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, User, ChevronDown, Clock, X, ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";
import Badge from "../components/ui/Badge";
import { formatDateFull } from "../utils/format";
import { persistMeetingSnapshot } from "../utils/meetingRoutes";
import { getCurrentWorkspaceId, WORKSPACE_CHANGED_EVENT } from "../utils/workspace";
import type { Meeting, Participant } from "../types/meeting";
import { apiRequest } from "../api/client";
import { fetchWorkspaceMembers } from "../api/workspaceMembers";
import DatePicker from "../components/ui/DatePicker";
import { createAvatarColorMap, pickAvatarColor } from "../utils/avatarColor";

type BackendStatus = "scheduled" | "in_progress" | "done";
type UiStatus = "upcoming" | "inprogress" | "completed";

interface MeetingHistoryParticipant {
    user_id: number;
    name: string;
}

interface MeetingHistoryItem {
    id: number;
    title: string;
    status: BackendStatus;
    scheduled_at?: string | null;
    started_at?: string | null;
    ended_at?: string | null;
    summary?: string | null;
    participants?: MeetingHistoryParticipant[];
}

interface MeetingHistoryResponse {
    total: number;
    page: number;
    meetings: MeetingHistoryItem[];
}

function mapStatus(s: BackendStatus): UiStatus {
    if (s === "in_progress") return "inprogress";
    if (s === "scheduled") return "upcoming";
    return "completed";
}

function pickStartAt(m: MeetingHistoryItem): string {
    return m.started_at ?? m.scheduled_at ?? m.ended_at ?? new Date().toISOString();
}

function historyParticipantsToAvatars(
    rows: MeetingHistoryParticipant[] | undefined,
    avatarColorMap: Map<number, string>,
): Participant[] {
    if (!rows?.length) return [];
    return rows.map((p) => {
        const color = pickAvatarColor(p.user_id, avatarColorMap);
        const name = p.name.trim();
        const initials = name.length >= 2 ? name.slice(0, 2) : name.length === 1 ? name : "?";
        return {
            id: `u${p.user_id}`,
            userId: p.user_id,
            name: p.name,
            avatarInitials: initials,
            color,
        };
    });
}

function isYmd(s: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const t = Date.parse(`${s}T12:00:00`);
    return !Number.isNaN(t);
}

function historyItemToMeeting(
    m: MeetingHistoryItem,
    avatarColorMap: Map<number, string>,
): Meeting {
    return {
        id: String(m.id),
        title: m.title,
        status: mapStatus(m.status) as Meeting["status"],
        startAt: pickStartAt(m),
        endAt: m.ended_at ?? undefined,
        participants: historyParticipantsToAvatars(m.participants, avatarColorMap),
        agenda: [],
        summary: m.summary ?? undefined,
        actionItemCount: 0,
        decisionCount: 0,
        tags: [],
    };
}

const HISTORY_PAGE_SIZE = 10;

function parseSummaryPreview(raw: string | null | undefined): string {
    if (!raw) return "";
    try {
        const parsed = JSON.parse(raw);
        const points: string[] = parsed.key_points ?? [];
        return points.slice(0, 2).join(" ・ ");
    } catch {
        return raw;
    }
}

export default function HistoryPage() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const initialKeyword = (searchParams.get("keyword") ?? "").trim();
    const initialDateRaw = (searchParams.get("date") ?? "").trim();
    const initialDate = isYmd(initialDateRaw) ? initialDateRaw : "";

    const [searchKeyword, setSearchKeyword] = useState(initialKeyword);
    const [filterDate, setFilterDate] = useState(initialDate);
    const [participantFilter, setParticipantFilter] = useState<string | null>(null);
    const [workspaceMembers, setWorkspaceMembers] = useState<{ user_id: number; name: string }[]>([]);
    const [membersLoading, setMembersLoading] = useState(false);
    const [meetingsHistory, setMeetingsHistory] = useState<MeetingHistoryItem[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [workspaceId, setWorkspaceId] = useState(() => getCurrentWorkspaceId());

    // Keep state in sync when user lands via TopBar (/history?keyword=...&date=...)
    useEffect(() => {
        setSearchKeyword(initialKeyword);
        setPage(1);
    }, [initialKeyword]);

    useEffect(() => {
        setFilterDate(initialDate);
        setPage(1);
    }, [initialDate]);

    useEffect(() => {
        function onWsChanged(e: Event) {
            const id = (e as CustomEvent<{ id: number }>).detail?.id;
            if (typeof id === "number" && Number.isFinite(id)) setWorkspaceId(id);
        }
        window.addEventListener(WORKSPACE_CHANGED_EVENT, onWsChanged);
        return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, onWsChanged);
    }, []);

    useEffect(() => {
        let cancelled = false;
        setMembersLoading(true);
        fetchWorkspaceMembers(workspaceId)
            .then((members) => {
                if (cancelled) return;
                const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name, "ko"));
                setWorkspaceMembers(sorted.map((m) => ({ user_id: m.user_id, name: m.name })));
            })
            .catch(() => {
                if (!cancelled) setWorkspaceMembers([]);
            })
            .finally(() => {
                if (!cancelled) setMembersLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [workspaceId]);

    const avatarColorMap = createAvatarColorMap(
        meetingsHistory.flatMap((meeting) => (meeting.participants ?? []).map((p) => p.user_id)),
    );

    // Debounced fetch
    useEffect(() => {
        const keyword = searchKeyword.trim();
        const controller = new AbortController();
        const handle = setTimeout(() => {
            const qs = new URLSearchParams();
            if (keyword) qs.set("keyword", keyword);
            const pid = participantFilter ? Number(participantFilter) : NaN;
            if (Number.isFinite(pid) && pid > 0) qs.set("participant_user_id", String(pid));
            if (filterDate && isYmd(filterDate)) qs.set("date", filterDate);
            qs.set("page", String(page));
            qs.set("size", String(HISTORY_PAGE_SIZE));

            setLoading(true);
            setError(null);

            apiRequest<MeetingHistoryResponse>(`/meetings/workspaces/${workspaceId}/history?${qs.toString()}`, {
                signal: controller.signal,
            })
                .then((data) => {
                    setMeetingsHistory(data.meetings);
                    setTotal(data.total);
                })
                .catch((e) => {
                    if (e instanceof DOMException && e.name === "AbortError") return;
                    setError(e instanceof Error ? e.message : String(e));
                    setMeetingsHistory([]);
                    setTotal(0);
                })
                .finally(() => setLoading(false));
        }, 400);

        return () => {
            clearTimeout(handle);
            controller.abort();
        };
    }, [searchKeyword, workspaceId, participantFilter, filterDate, page]);

    useEffect(() => {
        setPage(1);
    }, [workspaceId]);

    const totalPages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
            {/* Page heading */}
            <div className="mb-5">
                <h1 className="text-xl font-semibold text-foreground">회의 히스토리</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                    키워드, 참석자, 일자 기준으로 이전 회의를 검색할 수 있습니다.
                </p>
            </div>

            {/* Filter bar — sticky */}
            <div className="sticky top-0 z-10 -mx-4 px-4 sm:-mx-6 sm:px-6 py-2.5 mb-4 bg-background border-b border-border flex flex-wrap items-center gap-2">
                {/* Keyword search */}
                <div className="flex items-center gap-2 h-8 px-3 rounded border border-border bg-card flex-1 min-w-[200px] max-w-sm">
                    <Search size={13} className="text-muted-foreground shrink-0" />
                    <input
                        type="search"
                        placeholder="회의 제목, 회의록 내용 검색..."
                        value={searchKeyword}
                        onChange={(e) => {
                            const next = e.target.value;
                            setSearchKeyword(next);
                            setPage(1);
                            const params = new URLSearchParams(searchParams);
                            if (next.trim()) params.set("keyword", next);
                            else params.delete("keyword");
                            setSearchParams(params, { replace: true });
                        }}
                        className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground min-w-0"
                    />
                </div>

                {/* Participant filter */}
                <div className="relative">
                    <select
                        value={participantFilter ?? ""}
                        onChange={(e) => {
                            setParticipantFilter(e.target.value || null);
                            setPage(1);
                        }}
                        className={clsx(
                            "appearance-none h-8 pl-8 pr-7 rounded border text-sm bg-card cursor-pointer",
                            "border-border hover:border-muted-foreground transition-colors outline-none",
                            participantFilter ? "text-foreground" : "text-muted-foreground",
                        )}
                    >
                        <option value="">{membersLoading ? "참석자 목록 불러오는 중…" : "모든 참석자"}</option>
                        {workspaceMembers.map((m) => (
                            <option key={m.user_id} value={String(m.user_id)}>
                                {m.name}
                            </option>
                        ))}
                    </select>
                    <User
                        size={13}
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <ChevronDown
                        size={12}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    <DatePicker
                        value={filterDate}
                        onChange={(next) => {
                            setFilterDate(next);
                            setPage(1);
                            const params = new URLSearchParams(searchParams);
                            if (next && isYmd(next)) params.set("date", next);
                            else params.delete("date");
                            setSearchParams(params, { replace: true });
                        }}
                        placeholder="일자 선택"
                        className="w-[11rem] min-w-0 [&_button]:h-8 [&_button]:px-2 [&_button]:text-xs [&_button]:rounded-md"
                    />
                    {filterDate ? (
                        <button
                            type="button"
                            onClick={() => {
                                setFilterDate("");
                                setPage(1);
                                const params = new URLSearchParams(searchParams);
                                params.delete("date");
                                setSearchParams(params, { replace: true });
                            }}
                            className="h-8 w-8 shrink-0 flex items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                            aria-label="일자 필터 해제"
                        >
                            <X size={14} />
                        </button>
                    ) : null}
                </div>
            </div>

            {/* Meeting list */}
            {error ? (
                <div className="mb-4 p-3 rounded border border-red-500/20 bg-red-500/5 text-sm text-red-600">
                    {error}
                </div>
            ) : null}

            {meetingsHistory.length === 0 && !loading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-2">
                    <Search size={32} className="text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">검색 결과가 없습니다.</p>
                </div>
            ) : (
                <div className="flex flex-col divide-y divide-border border border-border rounded-lg overflow-hidden bg-card">
                    {/* Table header */}
                    <div className="hidden md:grid grid-cols-[1fr_auto] gap-4 px-4 py-2 bg-muted/60 font-medium text-muted-foreground uppercase tracking-wide border-b border-border">
                        <span className="text-sm">회의 리스트</span>
                        <span className="text-micro text-muted-foreground ml-auto self-end">
                            {loading ? "불러오는 중..." : `${total}개 회의`}
                        </span>
                    </div>

                    {meetingsHistory.map((meeting) => (
                        <MeetingRow
                            key={meeting.id}
                            meeting={meeting}
                            onClick={() => {
                                persistMeetingSnapshot(historyItemToMeeting(meeting, avatarColorMap));
                                const path =
                                    meeting.status === "scheduled"
                                        ? `/meetings/${meeting.id}/upcoming`
                                        : `/meetings/${meeting.id}/notes`;
                                navigate(path);
                            }}
                        />
                    ))}
                </div>
            )}

            {meetingsHistory.length > 0 && totalPages > 1 ? (
                <div className="flex items-center justify-center gap-3 mt-6">
                    <button
                        type="button"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1 || loading}
                        className="flex items-center gap-1 h-8 px-3 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted/50 transition-colors disabled:opacity-40"
                    >
                        <ChevronLeft size={14} /> 이전
                    </button>
                    <span className="text-sm text-muted-foreground">
                        {page} / {totalPages}
                    </span>
                    <button
                        type="button"
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages || loading}
                        className="flex items-center gap-1 h-8 px-3 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted/50 transition-colors disabled:opacity-40"
                    >
                        다음 <ChevronRight size={14} />
                    </button>
                </div>
            ) : null}

            {/* Chatbot placeholder */}
            {/* <div className="mt-6 mb-6 p-4 rounded-lg border border-dashed border-border bg-muted/20 text-center">
        <MessageSquare size={18} className="text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground font-medium">챗봇으로 과거 회의 내용 질문하기</p>
        <p className="text-mini text-muted-foreground/70 mt-0.5">
          TODO: implement chatbot panel for history search
          예: "지난 달 투자 관련 회의에서 결정된 사항을 알려줘"
        </p>
      </div> */}
        </div>
    );
}

// ── MeetingRow ────────────────────────────────────────────────────────────
function MeetingRow({ meeting, onClick }: { meeting: MeetingHistoryItem; onClick: () => void }) {
    const startAt = pickStartAt(meeting);
    const endAt = meeting.ended_at ?? undefined;
    // 히스토리: 1분 미만은 0분으로 보여주기 위해 "내림" 기준 사용
    const duration = endAt
        ? Math.max(0, Math.floor((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000))
        : null;

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick();
                }
            }}
            className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 md:gap-4 px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors"
        >
            {/* Title + tags */}
            <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Badge variant={mapStatus(meeting.status)} dot={meeting.status === "in_progress"} />
                    <h3 className="text-sm font-medium text-foreground truncate">{meeting.title}</h3>
                </div>
                {meeting.summary && (
                    <p className="text-mini text-muted-foreground line-clamp-2">
                        {parseSummaryPreview(meeting.summary)}
                    </p>
                )}
            </div>

            {/* Date + duration */}
            <div className="flex flex-col items-end justify-center gap-0.5 text-right">
                <span className="text-sm text-foreground whitespace-nowrap">{formatDateFull(startAt)}</span>
                {duration !== null && (
                    <span className="flex items-center gap-1 text-mini text-muted-foreground">
                        <Clock size={10} />
                        {duration}분
                    </span>
                )}
            </div>
        </div>
    );
}
