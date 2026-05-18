import { useState, useEffect, useRef } from "react";
import { X, Send, Loader2, Paperclip, CheckCircle2, FileText, SquarePen, History, Trash2, Pencil, Check } from "lucide-react";
import clsx from "clsx";
import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "../../types/chat";
import { useLocation } from "react-router-dom";
import { getCurrentWorkspaceId } from "../../api/client";
import {
    sendChatMessage,
    getChatHistory,
    getPastMeetings,
    createChatSession,
    listChatSessions,
    deleteChatSession,
    renameChatSession,
    type PastMeeting,
    type ChatSession,
    analyzeDocument,
} from "../../api/chatbot";
import remarkGfm from "remark-gfm";

// sessionStorge 키 - workspace별로 세션 분리
// 탭 닫으면 자동 만료 -> 새 탭에서 새 대화 시작
const sessionKey = (workspaceId: number) => `chatbot_session_${workspaceId}`;

// 초기 웰컴 메시지 - API 호출 없이 정적으로 표시
function getWelcomeMessage(_meetingId: number | null): ChatMessage {
    const content =
        "안녕하세요! **Workb AI 도우미**입니다.\n\n" +
        "아래 기능을 활용해보세요.\n\n" +
        '- **📋 회의 보고서**\n - "지난 회의 간이보고서 만들어줘"  \n' +
        '- **🔍 내용 검색**\n - "3월 회의에서 결정된 사항 알려줘"  \n' +
        "- **📁 문서 검색**\n - 업로드한 내부 문서 질의응답  \n" +
        "- **🌐 외부 정보**\n - 최신 뉴스, 트렌드 검색  \n" +
        "- **📅 일정 관리**\n - 회의 일정 조회 · 등록 · 수정";

    return {
        id: "welcome",
        role: "assistant",
        content,
        timestamp: new Date().toISOString(),
    };
}

function MeetingSelectorCard({
    meetings,
    onConfirm,
}: {
    meetings: PastMeeting[];
    onConfirm: (ids: number[] | null) => void;
}) {
    const [checked, setChecked] = useState<Set<number>>(new Set());

    if (meetings.length === 0) {
        return (
            <div className="mx-2 p-3 rounded-xl bg-muted border border-border text-xs text-muted-foreground">
                선택할 수 있는 회의가 없습니다.
            </div>
        );
    }

    function fmtDate(dateStr: string) {
        if (!dateStr) return "";
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return "";
        const mo = d.getMonth() + 1;
        const da = d.getDate();
        const hh = d.getHours().toString().padStart(2, "0");
        const mm = d.getMinutes().toString().padStart(2, "0");
        return `${mo}/${da} ${hh}:${mm}`;
    }

    return (
        <div className="mx-2 rounded-xl border border-border text-sm" style={{ backgroundColor: "var(--card)" }}>
            <div className="px-3 py-2 border-b border-border">
                <p className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>회의를 선택해주세요</p>
                <p className="text-xs opacity-60 mt-0.5" style={{ color: "var(--foreground)" }}>복수 선택 가능</p>
            </div>
            <div className="flex flex-col">
                {/* 전체 선택 버튼 */}
                <div className="px-3 py-2 border-b border-border flex justify-end">
                    <button
                        onClick={() => setChecked(
                            checked.size === meetings.length
                                ? new Set()
                                : new Set(meetings.map((m) => m.meeting_id))
                        )}
                        className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-accent/10 transition-colors"
                        style={{ color: "var(--foreground)" }}
                    >
                        {checked.size === meetings.length ? "전체 해제" : "전체 선택"}
                    </button>
                </div>
                {meetings.map((m, i) => (
                    <label
                        key={m.meeting_id}
                        className={clsx(
                            "flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors",
                            i < meetings.length - 1 && "border-b border-border",
                            checked.has(m.meeting_id) ? "bg-accent/10" : "hover:bg-accent/5",
                        )}
                    >
                        <input
                            type="checkbox"
                            checked={checked.has(m.meeting_id)}
                            onChange={(e) => {
                                const next = new Set(checked);
                                e.target.checked ? next.add(m.meeting_id) : next.delete(m.meeting_id);
                                setChecked(next);
                            }}
                            className="accent-accent shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate" style={{ color: "var(--foreground)" }}>{m.title}</p>
                            {m.started_at && (
                                <p className="text-xs opacity-50 mt-0.5" style={{ color: "var(--foreground)" }}>{fmtDate(m.started_at)}</p>
                            )}
                        </div>
                    </label>
                ))}
            </div>
            <div className="px-3 py-2 border-t border-border">
                <button
                    disabled={checked.size === 0}
                    onClick={() => onConfirm([...checked])}
                    className="w-full py-1.5 rounded-lg bg-accent text-accent-foreground text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/90 transition-colors"
                >
                    {checked.size > 0 ? `${checked.size}개 선택 완료` : "선택 후 확인"}
                </button>
            </div>
        </div>
    );
}

export default function ChatFAB() {
    const [open, setOpen] = useState(false);
    const location = useLocation();
    // URL /meetings/live/{id} 에서 meeting_id 파싱
    // 회의 중일 때만 존재 -> 없으면 null (이전 회의 검색만 가능)
    const liveMatch = location.pathname.match(/\/live\/([^/]+)/);
    const meetingMatch = location.pathname.match(/\/meetings\/(\d+)\//);
    const meetingId = liveMatch ? Number(liveMatch[1]) : meetingMatch ? Number(meetingMatch[1]) : null;

    const [messages, setMessages] = useState<ChatMessage[]>([getWelcomeMessage(meetingId)]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
    const fileInputRef = useRef<HTMLInputElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const [pastMeetings, setPastMeetings] = useState<PastMeeting[]>([]);
    const [pastMeetingsLoaded, setPastMeetingsLoaded] = useState(false);
    const [pendingMessage, setPendingMessage] = useState<string | null>(null);
    const [showMeetingSelector, setShowMeetingSelector] = useState(false);
    const [candidateMeetings, setCandidateMeetings] = useState<PastMeeting[]>([]);

    const [inputHistory, setInputHistory] = useState<string[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    const [showHistory, setShowHistory] = useState(false);
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [sessionsLoading, setSessionsLoading] = useState(false);
    const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState("");

    const [showChips, setShowChips] = useState(true);
    // 웰컴 메시지만 있으면 최초 대화 전 → 칩 항상 표시
    const isFirstChat = messages.length === 1 && messages[0].id === "welcome";

    const workspaceId = getCurrentWorkspaceId();

    // 새 대화 시작
    async function handleNewChat() {
        const { session_id } = await createChatSession(workspaceId);
        sessionStorage.setItem(sessionKey(workspaceId), session_id);
        setMessages([getWelcomeMessage(meetingId)]);
        setShowHistory(false);
        setShowMeetingSelector(false);
        setShowChips(true);
    }

    // 히스토리 패널 열기
    async function handleOpenHistory() {
        setShowHistory(true);
        setSessionsLoading(true);
        try {
            const { sessions: list } = await listChatSessions(workspaceId);
            setSessions(list);
        } finally {
            setSessionsLoading(false);
        }
    }

    // 세션 선택 → 해당 대화 복원
    async function handleSelectSession(sessionId: string) {
        sessionStorage.setItem(sessionKey(workspaceId), sessionId);
        const { messages: history } = await getChatHistory(workspaceId, sessionId);
        setMessages(
            history.length
                ? history.map((m, i) => ({
                      id: `h-${i}`,
                      role: m.role,
                      content: m.content,
                      timestamp: m.timestamp,
                      function_type: m.function_type,
                  }))
                : [getWelcomeMessage(meetingId)],
        );
        setShowHistory(false);
    }

    // 세션 이름 편집 시작
    function handleStartRename(s: ChatSession) {
        setEditingSessionId(s.session_id);
        setEditingTitle(s.title || s.preview || "");
    }

    // 세션 이름 저장
    async function handleSaveRename(sessionId: string) {
        const title = editingTitle.trim();
        if (!title) { setEditingSessionId(null); return; }
        await renameChatSession(workspaceId, sessionId, title);
        setSessions((prev) => prev.map((s) => s.session_id === sessionId ? { ...s, title } : s));
        setEditingSessionId(null);
    }

    // 세션 삭제
    async function handleDeleteSession(sessionId: string) {
        await deleteChatSession(workspaceId, sessionId);
        setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
        // 현재 세션이 삭제된 경우 새 대화로
        if (sessionStorage.getItem(sessionKey(workspaceId)) === sessionId) {
            sessionStorage.removeItem(sessionKey(workspaceId));
            setMessages([getWelcomeMessage(meetingId)]);
        }
    }

    // 챗봇 첫 오픈 시 sessionStorage에 session_id 있으면 히스토리 복원
    useEffect(() => {
        if (!open) return;

        // 이전 회의 목록 로드 - 2개 이상이면 선택 UI 사용
        getPastMeetings(workspaceId)
            .then(({ meetings }) => {
                setPastMeetings(meetings);
                setPastMeetingsLoaded(true);
            })
            .catch(() => setPastMeetingsLoaded(true)); // 실패해도 block 안 함

        // 세션 복원 - 세션 없으면 웰컴 메시지 유지
        const existingSessionId = sessionStorage.getItem(sessionKey(workspaceId));
        if (!existingSessionId) return;

        getChatHistory(workspaceId, existingSessionId)
            .then(({ messages: history }) => {
                if (!history.length) return;
                // 히스토리가 있으면 웰컴 메시지 대신 실제 대화로 교체
                setMessages(
                    history.map((m, i) => ({
                        id: `h-${i}`,
                        role: m.role,
                        content: m.content,
                        timestamp: m.timestamp,
                        function_type: m.function_type,
                    })),
                );
            })
            .catch(() => {
                // 히스토리 조회 실패 시 웰컴 메시지 유지 (세션 만료 등)
                sessionStorage.removeItem(sessionKey(workspaceId));
            });
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    // ESC로 닫기
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [open]);

    // Scroll to bottom when opened or new message
    useEffect(() => {
        if (open) {
            setTimeout(() => {
                bottomRef.current?.scrollIntoView({ behavior: "smooth" });
                inputRef.current?.focus();
            }, 100);
        }
    }, [open, messages]);

    // 선택창 등장 시 스크롤 내리기
    useEffect(() => {
        if (showMeetingSelector) {
            setTimeout(() => {
                bottomRef.current?.scrollIntoView({ behavior: "smooth" });
            }, 50);
        }
    }, [showMeetingSelector]);

    // 실제 API 전송 - handleSend와 MeetingSelectorCard 확인 후 공통 사용
    async function sendMessage(text: string, meetingIds: number[] | null) {
        setIsLoading(true);
        try {
            const sessionId = sessionStorage.getItem(sessionKey(workspaceId));
            const res = await sendChatMessage(workspaceId, text, meetingId, sessionId, meetingIds);

            // 서버 발급 session_id를 sessionStorage에 저장
            sessionStorage.setItem(sessionKey(workspaceId), res.session_id);

            setMessages((prev) => [
                ...prev,
                {
                    id: `a-${Date.now()}`,
                    role: "assistant",
                    content: res.answer,
                    timestamp: res.timestamp,
                    sources: res.result?.sources ?? [],
                    function_type: res.function_type,
                },
            ]);

            // 백엔드가 candidate_meetings를 내려주면 선택 UI 표시 (function_type 무관)
            const candidates: PastMeeting[] | undefined = res.result?.candidate_meetings;
            if (candidates && candidates.length > 0) {
                setCandidateMeetings(candidates);
                setPendingMessage(text);
                setShowMeetingSelector(true);
            } else if (res.answer.includes("선택해주세요") && pastMeetings.length > 0) {
                // agent 경로로 왔지만 선택이 필요한 경우 → pastMeetings로 fallback
                setCandidateMeetings(pastMeetings);
                setPendingMessage(text);
                setShowMeetingSelector(true);
            }
        } catch {
            // 에러 시 인라인 메시지로 표시 - 토스트 없이 대화 흐름 안에서 처리
            setMessages((prev) => [
                ...prev,
                {
                    id: `err-${Date.now()}`,
                    role: "assistant",
                    content: "요청 처리 중 오류가 발생했습니다. 다시 시도해주세요.",
                    timestamp: new Date().toISOString(),
                },
            ]);
        } finally {
            setIsLoading(false);
        }
    }

    async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = "";

        // 업로드 시작 메시지 즉시 표시
        const msgId = `upload-${Date.now()}`;
        setMessages((prev) => [
            ...prev,
            {
                id: msgId,
                role: "assistant",
                content: `📎 **${file.name}** 업로드 중...`,
                timestamp: new Date().toISOString(),
            },
        ]);
        setUploadStatus("uploading");

        try {
            await analyzeDocument(workspaceId, file);
            setUploadStatus("done");
            setTimeout(() => setUploadStatus("idle"), 2000);
            setMessages((prev) =>
                prev.map((m) =>
                    m.id === msgId
                        ? { ...m, content: `✅ **${file.name}** 업로드 완료!\n요약 및 검색이 가능합니다.` }
                        : m,
                ),
            );
        } catch (err) {
            setUploadStatus("error");
            setTimeout(() => setUploadStatus("idle"), 2000);
            const detail = err instanceof Error ? err.message : String(err);
            setMessages((prev) =>
                prev.map((m) => (m.id == msgId ? { ...m, content: `❌ **${file.name}** 업로드 실패: ${detail}` } : m)),
            );
        }
    }

    async function handleSend() {
        const text = input.trim();
        if (!text || isLoading) return;

        setShowHistory(false); // 히스토리 패널 열려있으면 닫고 대화 이어서

        // 사용자 메시지 즉시 표시
        setMessages((prev) => [
            ...prev,
            {
                id: `u-${Date.now()}`,
                role: "user",
                content: text,
                timestamp: new Date().toISOString(),
            },
        ]);
        setInput("");
        setHistoryIndex(-1);
        setInputHistory((prev) => [text, ...prev].slice(0, 50));
        setShowChips(false); // 첫 메시지 전송 후 칩 숨기기

        await sendMessage(text, null);
    }

    // 회의 중일 때만 "현재 회의 요약" 찹 표시
    const CHIPS = ["지난 회의 요약", "간이보고서", "오늘 일정", "문서 검색", "담당 업무", "결정사항 확인"];

    return (
        <>
            {/* FAB button */}
            <button
                onClick={() => setOpen((v) => !v)}
                aria-label="AI 도우미 열기"
                className={clsx(
                    "fixed right-4 sm:right-6 z-40 flex items-center justify-center w-14 h-14 rounded-full shadow-lg",
                    "bg-accent hover:bg-accent/90 transition-all duration-200",
                    "hover:scale-105 hover:shadow-xl active:scale-95",
                    open && "scale-95 shadow-md",
                )}
                style={{ bottom: "max(1.5rem, calc(env(safe-area-inset-bottom) + 1rem))" }}
            >
                {open ? (
                    <X size={22} className="text-accent-foreground" />
                ) : (
                    <img src="/brand/chatbot_ts.png" alt="AI 도우미" className="w-9 h-9 object-contain" />
                )}
            </button>

            {/* Chat panel */}
            {open && (
                <div
                    className={clsx(
                        "fixed right-4 sm:right-6 z-40 rounded-2xl shadow-2xl border border-border",
                        "bg-card flex flex-row overflow-hidden",
                        "animate-in slide-in-from-bottom-4 duration-200",
                        showHistory ? "w-[calc(100vw-2rem)] sm:w-[640px]" : "w-[calc(100vw-2rem)] sm:w-96",
                    )}
                    style={{
                        bottom: "max(5.5rem, calc(env(safe-area-inset-bottom) + 5rem))",
                        maxHeight: "70vh",
                    }}
                    role="dialog"
                    aria-label="Workb AI 도우미"
                >
                    {/* 히스토리 사이드바 */}
                    {showHistory && (
                        <div className="w-52 shrink-0 border-r border-border flex flex-col bg-muted/30">
                            <div className="flex items-center justify-between px-3 py-3 border-b border-border">
                                <p className="text-sm font-semibold text-foreground">대화 기록</p>
                                <button
                                    onClick={() => setShowHistory(false)}
                                    className="text-muted-foreground hover:text-foreground transition-colors"
                                    aria-label="닫기"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto">
                                {sessionsLoading ? (
                                    <div className="flex items-center justify-center py-8">
                                        <Loader2 size={15} className="animate-spin text-muted-foreground" />
                                    </div>
                                ) : sessions.length === 0 ? (
                                    <p className="text-mini text-muted-foreground text-center py-8 px-3">
                                        대화 기록이 없습니다.
                                    </p>
                                ) : (
                                    <div className="flex flex-col py-1">
                                        {sessions.map((s) => (
                                            <div
                                                key={s.session_id}
                                                className={clsx(
                                                    "group flex items-center gap-1 px-3 py-2 cursor-pointer transition-colors",
                                                    sessionStorage.getItem(sessionKey(workspaceId)) === s.session_id
                                                        ? "bg-accent/10 text-accent"
                                                        : "hover:bg-muted text-foreground",
                                                )}
                                                onClick={() => editingSessionId !== s.session_id && void handleSelectSession(s.session_id)}
                                            >
                                                {editingSessionId === s.session_id ? (
                                                    <input
                                                        autoFocus
                                                        value={editingTitle}
                                                        onChange={(e) => setEditingTitle(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter") void handleSaveRename(s.session_id);
                                                            if (e.key === "Escape") setEditingSessionId(null);
                                                        }}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="flex-1 text-xs bg-background border border-accent rounded px-1 py-0.5 outline-none min-w-0"
                                                    />
                                                ) : (
                                                    <p className="flex-1 text-xs truncate">{s.title || s.preview || "새 대화"}</p>
                                                )}
                                                <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                                                    {editingSessionId === s.session_id ? (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); void handleSaveRename(s.session_id); }}
                                                            className="text-accent hover:text-accent/80 p-0.5"
                                                            aria-label="저장"
                                                        >
                                                            <Check size={11} />
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleStartRename(s); }}
                                                            className="text-muted-foreground hover:text-foreground p-0.5"
                                                            aria-label="이름 변경"
                                                        >
                                                            <Pencil size={11} />
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            void handleDeleteSession(s.session_id);
                                                        }}
                                                        className="text-muted-foreground hover:text-red-500 p-0.5"
                                                        aria-label="삭제"
                                                    >
                                                        <Trash2 size={11} />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* 채팅 영역 */}
                    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-accent/5">
                            <div className="w-7 h-7 rounded-md bg-accent flex items-center justify-center shrink-0">
                                <img
                                    src="/brand/chatbot_ts.png"
                                    alt="AI 도우미"
                                    width={24}
                                    height={24}
                                    className="object-contain"
                                />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-foreground">Workb 도우미</p>
                                <p className="text-mini text-muted-foreground">AI 어시스턴트 · 항상 대기 중</p>
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={handleOpenHistory}
                                    className={clsx(
                                        "transition-colors p-1",
                                        showHistory ? "text-accent" : "text-muted-foreground hover:text-foreground",
                                    )}
                                    aria-label="대화 히스토리"
                                    title="대화 히스토리"
                                >
                                    <History size={15} />
                                </button>
                                <button
                                    onClick={handleNewChat}
                                    className="text-muted-foreground hover:text-foreground transition-colors p-1"
                                    aria-label="새 대화"
                                    title="새 대화"
                                >
                                    <SquarePen size={15} />
                                </button>
                            </div>
                            <button
                                onClick={() => setOpen(false)}
                                className="text-muted-foreground hover:text-foreground transition-colors"
                                aria-label="닫기"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* Chip hints */}
                        {(isFirstChat || showChips) && (
                            <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-border bg-muted/30">
                                {CHIPS.map((chip) => (
                                    <button
                                        key={chip}
                                        onClick={() => setInput(chip)}
                                        className="px-2.5 py-1 rounded-full text-mini bg-accent-subtle text-accent border border-accent/20 hover:bg-accent/10 transition-colors"
                                    >
                                        {chip}
                                    </button>
                                ))}
                            </div>
                        )}
                        {!isFirstChat && (
                            <button
                                onClick={() => setShowChips((v) => !v)}
                                className="text-micro text-muted-foreground hover:text-foreground transition-colors px-3 py-1 border-b border-border bg-muted/10 text-left"
                            >
                                {showChips ? "▲ 빠른 질문 숨기기" : "▼ 빠른 질문"}
                            </button>
                        )}

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2.5 min-h-0">
                            {messages.map((msg) => (
                                <div
                                    key={msg.id}
                                    className={clsx(
                                        "flex gap-2 items-end",
                                        msg.role === "user" ? "flex-row-reverse" : "flex-row",
                                    )}
                                >
                                    {msg.role === "assistant" && (
                                        <div className="shrink-0">
                                            <div className="w-[22px] h-[22px] rounded-md bg-accent flex items-center justify-center">
                                                <img
                                                    src="/brand/chatbot_ts.png"
                                                    alt="AI 도우미"
                                                    width={18}
                                                    height={18}
                                                    className="object-contain"
                                                />
                                            </div>
                                        </div>
                                    )}
                                    <div
                                        className={clsx(
                                            "max-w-[80%] px-3 py-2 rounded-2xl text-sm",
                                            msg.role === "user"
                                                ? "bg-accent text-accent-foreground rounded-br-sm"
                                                : "bg-muted text-foreground rounded-bl-sm",
                                        )}
                                    >
                                        {msg.role === "assistant" ? (
                                            // 어시스턴트 답변은 마크다운 렌더링
                                            // 고지문, 근거 발화 blockquote, **볼드** 등 처리
                                            <div className="prose prose-sm max-w-none dark:prose-invert [&_table]:block [&_table]:overflow-x-auto [&_table]:whitespace-nowrap">
                                                <ReactMarkdown
                                                    remarkPlugins={[remarkGfm]}
                                                    components={{ hr: () => <></> }}
                                                >
                                                    {msg.content}
                                                </ReactMarkdown>
                                            </div>
                                        ) : (
                                            msg.content
                                        )}
                                        {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                                            <div className="mt-2 pt-2 border-t border-border flex flex-col gap-1.5">
                                                <p className="text-micro text-muted-foreground font-medium">
                                                    🌐 참고 자료
                                                </p>
                                                {msg.sources
                                                    .filter((s, i, arr) => arr.findIndex((x) => x.url === s.url) === i) // URL 중복 제거
                                                    .map((s, i) => (
                                                        <a
                                                            key={i}
                                                            href={s.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="flex flex-col gap-0.5 p-2 rounded-lg bg-muted/60 hover:bg-muted transition-colors"
                                                        >
                                                            <span className="text-mini font-medium text-foreground line-clamp-1">
                                                                {s.title}
                                                            </span>
                                                            <span className="text-micro text-muted-foreground line-clamp-1">
                                                                {new URL(s.url).hostname}
                                                            </span>
                                                        </a>
                                                    ))}
                                            </div>
                                        )}
                                        {msg.role === "assistant" && (
                                            <div>
                                                {msg.function_type === "quick_report" && meetingId && (
                                                    <a
                                                        href={`/meetings/${meetingId}/reports?tab=minutes`}
                                                        className="mt-2 flex items-center gap-1.5 h-8 px-3 rounded-lg bg-accent text-accent-foreground text-mini font-medium hover:bg-accent/90 transition-colors w-fit"
                                                    >
                                                        <FileText size={12} /> 회의록에서 보기
                                                    </a>
                                                )}
                                                {msg.function_type === "report_guide" && meetingId && (
                                                    <a
                                                        href={`/meetings/${meetingId}/reports?tab=minutes`}
                                                        className="mt-2 flex items-center gap-1.5 h-8 px-3 rounded-lg bg-accent text-accent-foreground text-mini font-medium hover:bg-accent/90 transition-colors w-fit"
                                                    >
                                                        <FileText size={12} /> 회의록 페이지로 이동
                                                    </a>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {/* 이전 회의 선택 UI - 2개 이상일 때 메시지 보류 후 표시 */}
                            {showMeetingSelector && (
                                <MeetingSelectorCard
                                    meetings={candidateMeetings.length > 0 ? candidateMeetings : pastMeetings}
                                    onConfirm={(ids) => {
                                        setShowMeetingSelector(false);
                                        setCandidateMeetings([]);
                                        void sendMessage(pendingMessage ?? "", ids);
                                        setPendingMessage("");
                                    }}
                                />
                            )}

                            {/* 로딩 인디케이터 - 응답 대기 중 표시 */}
                            {isLoading && (
                                <div className="flex gap-2 items-end">
                                    <div className="shrink-0">
                                        <div className="w-[22px] h-[22px] rounded-md bg-accent flex items-center justify-center">
                                            <img
                                                src="/brand/chatbot_ts.png"
                                                alt="AI 도우미"
                                                width={18}
                                                height={18}
                                                className="object-contain"
                                            />
                                        </div>
                                    </div>
                                    <div className="bg-muted text-muted-foreground px-3 py-2 rounded-2xl rounded-bl-sm text-sm flex items-center gap-1.5">
                                        <Loader2 size={13} className="animate-spin" />
                                        <span>답변 생성 중...</span>
                                    </div>
                                </div>
                            )}
                            <div ref={bottomRef} />
                        </div>

                        {/* 파일 첨부 버튼 */}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,.pptx,.ppt,.html,.htm,.md,.markdown,.docx,.doc,.xlsx,.xls"
                            className="hidden"
                            onChange={handleFileUpload}
                        />

                        {/* Input */}
                        <form
                            className="flex items-center gap-2 px-3 py-2.5 border-t border-border"
                            onSubmit={(e) => {
                                e.preventDefault();
                                void handleSend();
                            }}
                        >
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploadStatus === "uploading"}
                                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                                aria-label="파일 첨부"
                            >
                                {uploadStatus === "uploading" ? (
                                    <Loader2 size={16} className="animate-spin" />
                                ) : uploadStatus === "done" ? (
                                    <CheckCircle2 size={16} className="text-green-500" />
                                ) : (
                                    <Paperclip size={16} />
                                )}
                            </button>
                            <input
                                ref={inputRef}
                                type="text"
                                value={input}
                                onChange={(e) => { setInput(e.target.value); setHistoryIndex(-1); }}
                                onKeyDown={(e) => {
                                    if (e.key === "ArrowUp" && inputHistory.length > 0) {
                                        e.preventDefault();
                                        const next = Math.min(historyIndex + 1, inputHistory.length - 1);
                                        setHistoryIndex(next);
                                        setInput(inputHistory[next]);
                                    } else if (e.key === "ArrowDown") {
                                        e.preventDefault();
                                        if (historyIndex <= 0) {
                                            setHistoryIndex(-1);
                                            setInput("");
                                        } else {
                                            const next = historyIndex - 1;
                                            setHistoryIndex(next);
                                            setInput(inputHistory[next]);
                                        }
                                    }
                                }}
                                placeholder="무엇이든 물어보세요..."
                                disabled={isLoading}
                                className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground disabled:opacity-50"
                            />
                            <button
                                type="submit"
                                disabled={!input.trim()}
                                className="flex items-center justify-center w-8 h-8 rounded-full bg-accent text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/90 transition-colors"
                                aria-label="전송"
                            >
                                <Send size={14} />
                            </button>
                        </form>
                    </div>
                    {/* 채팅 영역 끝 */}
                </div>
            )}
        </>
    );
}
