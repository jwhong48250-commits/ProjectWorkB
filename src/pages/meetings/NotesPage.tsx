import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Share2,
  AlertCircle,
  MessageSquare,
  Clock,
  Sparkles,
  Loader2,
  X,
  Check,
  Pencil,
  Play,
  Pause,
  Square,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import type { Meeting } from "../../types/meeting";
import { AvatarGroup } from "../../components/ui/Avatar";
import { formatDateFull } from "../../utils/format";
import {
  fetchMeetingUtterances,
  reassignSpeaker,
  updateUtteranceContent,
  type UtteranceItem,
} from "../../api/intelligence";
import {
  fetchWorkspaceMembers,
  type WorkspaceMemberApiItem,
} from "../../api/workspaceMembers";
import { getCurrentWorkspaceId } from "../../api/client";
import { fetchWorkspaceMeetingDetail } from "../../api/meetings";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createLabelColorMap, pickLabelColor } from "../../utils/avatarColor";
import { useProfileImage } from "../../utils/profileImage";

/** start(초) → 분:초 포맷 */
function formatTime(seconds: number): string {
  const m = String(Math.floor(seconds / 60)).padStart(2, "0");
  const s = String(Math.floor(seconds % 60)).padStart(2, "0");
  return `${m}:${s}`;
}

const INITIAL_VISIBLE_UTTERANCES = 5;

function SpeakerAvatar({
  userId,
  label,
  color,
}: {
  userId: number | null;
  label: string;
  color: string;
}) {
  const profileImage = useProfileImage(userId ?? undefined);
  const initial = label.trim()[0] ?? "?";

  if (profileImage) {
    return (
      <img
        src={profileImage}
        alt={label}
        className="w-7 h-7 rounded-full object-cover shrink-0 mt-0.5"
      />
    );
  }

  return (
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center text-white text-mini font-bold shrink-0 mt-0.5"
      style={{ backgroundColor: color }}
    >
      {initial}
    </div>
  );
}

export default function NotesPage() {
  const { meetingId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const passedMeeting =
    (location.state as { meeting?: Meeting } | null)?.meeting ?? null;
  const [meeting, setMeeting] = useState<Meeting | null>(passedMeeting);
  const [meetingLoading, setMeetingLoading] = useState(passedMeeting === null);

  const [utterances, setUtterances] = useState<UtteranceItem[]>([]);
  const [utterancesLoading, setUtterancesLoading] = useState(true);
  const [utterancesError, setUtterancesError] = useState<string | null>(null);
  const [showAllUtterances, setShowAllUtterances] = useState(false);
  const [pendingScrollTarget, setPendingScrollTarget] = useState<
    "top" | "bottom" | null
  >(null);
  const transcriptTopRef = useRef<HTMLDivElement | null>(null);
  const transcriptBottomRef = useRef<HTMLDivElement | null>(null);

  // 오디오 구간 재생
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingSeq, setPlayingSeq] = useState<number | null>(null);

  // 전체 오디오 재생
  const fullAudioRef = useRef<HTMLAudioElement | null>(null);
  const [fullPlaying, setFullPlaying] = useState(false);
  const [fullCurrentTime, setFullCurrentTime] = useState(0);
  const [fullDuration, setFullDuration] = useState(0);

  const ASR_BASE =
    (import.meta.env.VITE_ASR_SERVER as string | undefined) ??
    "http://localhost:8888";
  const visibleUtterances = showAllUtterances
    ? utterances
    : utterances.slice(0, INITIAL_VISIBLE_UTTERANCES);
  const hiddenUtteranceCount = Math.max(
    0,
    utterances.length - visibleUtterances.length,
  );
  /** 발화 목록을 정상 로드했는데 비어 있음 → 실질적 회의 진행·전사 없음 */
  const noTranscriptAfterLoad =
    !utterancesLoading && !utterancesError && utterances.length === 0;

  useEffect(() => {
    if (!meetingId || passedMeeting !== null) return;
    const wsId = getCurrentWorkspaceId();
    if (!wsId) return;
    fetchWorkspaceMeetingDetail(wsId, Number(meetingId))
      .then(setMeeting)
      .catch(() => setMeeting(null))
      .finally(() => setMeetingLoading(false));
  }, [meetingId]);

  function moveTranscript(position: "top" | "bottom") {
    if (utterances.length === 0) return;

    if (
      position === "bottom" &&
      !showAllUtterances &&
      utterances.length > INITIAL_VISIBLE_UTTERANCES
    ) {
      setShowAllUtterances(true);
    }

    setPendingScrollTarget(position);
  }

  function playUtterance(u: UtteranceItem) {
    const audioUrl = `${ASR_BASE}/meeting/${meetingId}/audio`;
    let audio = audioRef.current;
    if (!audio) {
      audio = new Audio();
      audioRef.current = audio;
    }
    // 재생 중인 항목 클릭 → 정지
    if (playingSeq === u.seq) {
      audio.pause();
      setPlayingSeq(null);
      return;
    }
    // 전체 재생 중이면 정지
    if (fullPlaying) {
      fullAudioRef.current?.pause();
      setFullPlaying(false);
    }
    if (audio.src !== audioUrl) {
      audio.src = audioUrl;
    }
    audio.ontimeupdate = () => {
      if (audio!.currentTime >= u.end) {
        audio!.pause();
        setPlayingSeq(null);
      }
    };
    audio.onended = () => setPlayingSeq(null);
    audio.currentTime = u.start;
    audio.play().catch(() => setPlayingSeq(null));
    setPlayingSeq(u.seq);
  }

  // 전체 오디오 초기화
  useEffect(() => {
    const audio = new Audio();
    audio.src = `${ASR_BASE}/meeting/${meetingId}/audio`;
    audio.preload = "metadata";
    fullAudioRef.current = audio;
    const onMeta = () => setFullDuration(audio.duration);
    const onTime = () => setFullCurrentTime(audio.currentTime);
    const onEnded = () => setFullPlaying(false);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
      audio.pause();
      audio.src = "";
    };
  }, [meetingId, ASR_BASE]);

  function toggleFullAudio() {
    const audio = fullAudioRef.current;
    if (!audio) return;
    if (fullPlaying) {
      audio.pause();
      setFullPlaying(false);
    } else {
      // 구간 재생 중이면 정지
      audioRef.current?.pause();
      setPlayingSeq(null);
      audio.play().catch(() => setFullPlaying(false));
      setFullPlaying(true);
    }
  }

  function seekFullAudio(e: React.MouseEvent<HTMLDivElement>) {
    const audio = fullAudioRef.current;
    if (!audio || !fullDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * fullDuration;
  }

  // 언마운트 시 오디오 정리
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (!pendingScrollTarget) return;

    const target =
      pendingScrollTarget === "top"
        ? transcriptTopRef.current
        : transcriptBottomRef.current;

    target?.scrollIntoView({
      behavior: "smooth",
      block: pendingScrollTarget === "top" ? "start" : "end",
    });
    setPendingScrollTarget(null);
  }, [pendingScrollTarget, showAllUtterances, utterances.length]);

  // 워크스페이스 멤버
  const [members, setMembers] = useState<WorkspaceMemberApiItem[]>([]);
  useEffect(() => {
    const wsId = getCurrentWorkspaceId();
    if (wsId)
      fetchWorkspaceMembers(wsId)
        .then(setMembers)
        .catch(() => {});
  }, []);
  const speakerColorMap = useMemo(
    () =>
      createLabelColorMap([
        ...utterances.map((u) => u.speaker_label),
        ...members.map((m) => m.name),
      ]),
    [utterances, members],
  );
  const memberById = useMemo(
    () => new Map(members.map((member) => [member.user_id, member])),
    [members],
  );
  const memberByName = useMemo(
    () =>
      new Map(
        members.map((member) => [member.name.trim().toLowerCase(), member]),
      ),
    [members],
  );

  // 화자 수정 모달 상태
  interface SpeakerModal {
    seq: number;
    currentLabel: string;
    selectedMemberId: number | null;
    selectedMemberName: string;
    customName: string;
    activeTab: "member" | "custom";
    applyAll: boolean;
  }
  const [speakerModal, setSpeakerModal] = useState<SpeakerModal | null>(null);
  const [modalSaving, setModalSaving] = useState(false);

  function openSpeakerModal(u: UtteranceItem) {
    if (!isEditMode) return;
    setSpeakerModal({
      seq: u.seq,
      currentLabel: u.speaker_label,
      selectedMemberId: null,
      selectedMemberName: "",
      customName: "",
      activeTab: "member",
      applyAll: true,
    });
  }

  async function handleModalSave() {
    if (!meetingId || !speakerModal) return;
    const newLabel =
      speakerModal.activeTab === "custom"
        ? speakerModal.customName.trim()
        : speakerModal.selectedMemberName.trim();
    const newId =
      speakerModal.activeTab === "custom"
        ? null
        : speakerModal.selectedMemberId;
    if (!newLabel) return;

    setModalSaving(true);
    try {
      await reassignSpeaker(meetingId, {
        old_speaker_label: speakerModal.currentLabel,
        new_speaker_id: newId,
        new_speaker_label: newLabel,
        seq: speakerModal.applyAll ? undefined : speakerModal.seq,
        apply_all: speakerModal.applyAll,
      });
      setUtterances((prev) =>
        prev.map((u) => {
          if (speakerModal.applyAll) {
            return u.speaker_label === speakerModal.currentLabel
              ? { ...u, speaker_id: newId, speaker_label: newLabel }
              : u;
          } else {
            return u.seq === speakerModal.seq
              ? { ...u, speaker_id: newId, speaker_label: newLabel }
              : u;
          }
        }),
      );
      setSpeakerModal(null);
    } finally {
      setModalSaving(false);
    }
  }

  function refreshUtterances() {
    if (!meetingId) return;
    setUtterancesLoading(true);
    setUtterancesError(null);
    setShowAllUtterances(false);
    setPendingScrollTarget(null);
    fetchMeetingUtterances(meetingId)
      .then((data) => setUtterances(data.utterances))
      .catch(() => setUtterancesError("발화 데이터를 불러오지 못했습니다."))
      .finally(() => setUtterancesLoading(false));
  }

  // 수정 모드 토글
  const [isEditMode, setIsEditMode] = useState(false);

  function enterEditMode() {
    setIsEditMode(true);
  }

  function exitEditMode() {
    setIsEditMode(false);
    // 편집 중인 항목 있으면 취소
    cancelEditContent();
  }

  // 발화 텍스트 인라인 편집 상태: { seq → editingText }
  const [editingSeq, setEditingSeq] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [contentSaving, setContentSaving] = useState(false);

  function startEditContent(u: UtteranceItem) {
    if (!isEditMode) return;
    setEditingSeq(u.seq);
    setEditingText(u.content);
  }

  function cancelEditContent() {
    setEditingSeq(null);
    setEditingText("");
  }

  async function saveEditContent(seq: number) {
    if (!meetingId) return;
    const trimmed = editingText.trim();
    if (!trimmed) return;
    setContentSaving(true);
    try {
      await updateUtteranceContent(meetingId, seq, trimmed);
      setUtterances((prev) =>
        prev.map((u) => (u.seq === seq ? { ...u, content: trimmed } : u)),
      );
      setEditingSeq(null);
      setEditingText("");
    } finally {
      setContentSaving(false);
    }
  }

  useEffect(() => {
    refreshUtterances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  if (meetingLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground gap-2">
        <Loader2 size={16} className="animate-spin" />
        회의 정보 로딩 중...
      </div>
    );
  }
  if (!meeting) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        회의 정보를 불러오지 못했습니다.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 pb-40 sm:pb-32">
      {/* 화자 수정 모달 */}
      {speakerModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm px-4 dark:bg-black/45"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSpeakerModal(null);
          }}
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-2xl ring-1 ring-black/5 overflow-hidden dark:ring-white/10">
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Pencil size={14} className="text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">
                  화자 수정
                </span>
                <span className="px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground text-xs">
                  {speakerModal.currentLabel}
                </span>
              </div>
              <button
                onClick={() => setSpeakerModal(null)}
                className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-muted/60 transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            {/* 탭 */}
            <div className="flex border-b border-border">
              {(["member", "custom"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() =>
                    setSpeakerModal((prev) =>
                      prev ? { ...prev, activeTab: tab } : prev,
                    )
                  }
                  className={[
                    "flex-1 py-2 text-sm font-medium transition-colors",
                    speakerModal.activeTab === tab
                      ? "border-b-2 border-accent text-accent"
                      : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  {tab === "member" ? "멤버 선택" : "직접 입력"}
                </button>
              ))}
            </div>

            {/* 탭 내용 */}
            <div className="px-4 py-3 max-h-60 overflow-y-auto">
              {speakerModal.activeTab === "member" ? (
                members.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    워크스페이스 멤버가 없습니다.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {members.map((m) => {
                      const isSelected =
                        speakerModal.selectedMemberId === m.user_id;
                      return (
                        <button
                          key={m.user_id}
                          type="button"
                          onClick={() =>
                            setSpeakerModal((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    selectedMemberId: m.user_id,
                                    selectedMemberName: m.name,
                                  }
                                : prev,
                            )
                          }
                          className={[
                            "flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-sm transition-colors text-left",
                            isSelected
                              ? "bg-accent/15 border border-accent/40"
                              : "hover:bg-muted/60 border border-transparent",
                          ].join(" ")}
                        >
                          <SpeakerAvatar
                            userId={m.user_id}
                            label={m.name}
                            color={pickLabelColor(m.name, speakerColorMap)}
                          />
                          <span className="flex-1 font-medium text-foreground">
                            {m.name}
                          </span>
                          {m.department && (
                            <span className="text-muted-foreground text-xs">
                              {m.department}
                            </span>
                          )}
                          {isSelected && (
                            <Check size={14} className="text-accent shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )
              ) : (
                <div className="py-2">
                  <input
                    type="text"
                    value={speakerModal.customName}
                    onChange={(e) =>
                      setSpeakerModal((prev) =>
                        prev ? { ...prev, customName: e.target.value } : prev,
                      )
                    }
                    placeholder="화자 이름을 입력하세요"
                    className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
                    autoFocus
                  />
                </div>
              )}
            </div>

            {/* 전체 변경 체크박스 + 하단 버튼 */}
            <div className="px-4 pb-4 pt-2 border-t border-border space-y-3">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <div
                  onClick={() =>
                    setSpeakerModal((prev) =>
                      prev ? { ...prev, applyAll: !prev.applyAll } : prev,
                    )
                  }
                  className={[
                    "w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0",
                    speakerModal.applyAll
                      ? "bg-accent border-accent"
                      : "bg-background border-border",
                  ].join(" ")}
                >
                  {speakerModal.applyAll && (
                    <Check size={10} className="text-white" />
                  )}
                </div>
                <span className="text-sm text-foreground">전체 변경</span>
                <span className="text-xs text-muted-foreground">
                  (같은 화자의 모든 발화 변경)
                </span>
              </label>

              <div className="flex gap-2">
                <button
                  onClick={() => setSpeakerModal(null)}
                  className="flex-1 h-9 rounded-lg border border-border text-sm hover:bg-muted/50 transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={handleModalSave}
                  disabled={
                    modalSaving ||
                    (speakerModal.activeTab === "member"
                      ? !speakerModal.selectedMemberName
                      : !speakerModal.customName.trim())
                  }
                  className="flex-1 h-9 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
                >
                  {modalSaving ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Check size={13} />
                  )}
                  변경 저장
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-foreground">
            {meeting.title}
          </h1>
          <div className="flex items-center gap-3 mt-2 text-mini text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1">
              <Clock size={11} /> {formatDateFull(meeting.startAt)}
            </span>
            <span>{meeting.participants.length}명 참석</span>
            <AvatarGroup participants={meeting.participants} max={4} />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => navigate(`/meetings/${meetingId}/export`)}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-sm hover:bg-muted/50 transition-colors"
          >
            <Share2 size={13} /> 공유
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {noTranscriptAfterLoad && (
          <div
            role="status"
            className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/80 dark:bg-amber-950/30 px-4 py-3.5"
          >
            <p className="text-sm font-semibold text-foreground">
              회의가 진행된 기록이 없습니다
            </p>
            <p className="text-mini text-muted-foreground mt-1.5 leading-relaxed">
              녹음·전사된 발화가 없습니다. 입장만 하고 종료했거나, 마이크·수집
              설정으로 음성이 저장되지 않았을 수 있습니다. 아래 회의록·요약도
              실제 논의가 없으면 비어 있거나 안내 문구만 표시됩니다.
            </p>
          </div>
        )}

        {/* Summary — 발화 없음(정상 로드)이면 백엔드 요약이 남아 있어도 숨김 */}
        {meeting.summary && !noTranscriptAfterLoad && (
          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              요약
            </h2>
            <div className="text-sm text-foreground leading-relaxed bg-muted/30 px-4 py-3 rounded-lg border border-border prose prose-sm     dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {meeting.summary}
              </ReactMarkdown>
            </div>
          </section>
        )}

        {/* Navigation */}
        <div className="flex gap-3 pt-4 border-t border-border">
          <Link
            to={`/meetings/${meetingId}/wbs`}
            className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/50 transition-colors flex items-center justify-center"
          >
            WBS 보기
          </Link>
          <Link
            to={`/meetings/${meetingId}/reports`}
            className="flex-1 h-10 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors flex items-center justify-center gap-1.5"
          >
            <Sparkles size={14} /> 보고서 생성
          </Link>
        </div>

        {/* Full transcript */}
        <section>
          <div ref={transcriptTopRef} />
          <div className="mb-2">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <MessageSquare size={15} className="text-muted-foreground" /> 전문
              타임라인
            </h2>
          </div>

          {/* 수정 모드 안내 배너 */}
          {isEditMode && !utterancesLoading && utterances.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-accent bg-accent/10 border border-accent/20 rounded-lg px-3 py-2 mb-3">
              <Pencil size={11} className="shrink-0" />
              수정 모드 — 화자 이름 또는 발화 텍스트를 클릭해 편집하세요.
            </div>
          )}

          {utterancesLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
              <Loader2 size={16} className="animate-spin" /> 발화 데이터 로딩
              중...
            </div>
          )}

          {!utterancesLoading && utterancesError && (
            <div className="flex items-center gap-2 text-sm text-yellow-600 dark:text-yellow-400 py-4 px-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
              <AlertCircle size={14} className="shrink-0" /> {utterancesError}
            </div>
          )}

          {!utterancesLoading &&
            !utterancesError &&
            utterances.length === 0 && (
              <div
                role="status"
                className="rounded-xl border border-border bg-muted/25 px-4 py-6 text-center"
              >
                <MessageSquare
                  size={22}
                  className="mx-auto text-muted-foreground/70 mb-2"
                  aria-hidden
                />
                <p className="text-sm font-semibold text-foreground">
                  진행된 회의 내용이 없습니다
                </p>
                <p className="text-mini text-muted-foreground mt-2 leading-relaxed max-w-md mx-auto">
                  저장된 발화·전사 데이터가 없습니다. 회의 중 음성이 수집되지
                  않았거나, 마이크가 꺼져 있었거나, 전사 결과가 아직 반영되지
                  않았을 수 있습니다.
                </p>
              </div>
            )}

          {!utterancesLoading && !utterancesError && utterances.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {visibleUtterances.map((u) => {
                const color = pickLabelColor(u.speaker_label, speakerColorMap);
                const normalizedLabel = u.speaker_label.trim().toLowerCase();
                const matchedMember =
                  (u.speaker_id !== null ? memberById.get(u.speaker_id) : undefined) ??
                  memberByName.get(normalizedLabel);
                const speakerUserId = matchedMember?.user_id ?? null;
                const isPlaying = playingSeq === u.seq;
                const isActive =
                  fullPlaying &&
                  fullCurrentTime >= u.start &&
                  fullCurrentTime < u.end;
                return (
                  <div
                    key={u.seq}
                    className={[
                      "flex gap-3 group rounded-lg px-2 -mx-2 transition-colors",
                      isActive ? "bg-accent/10 ring-1 ring-accent/20" : "",
                    ].join(" ")}
                  >
                    <SpeakerAvatar
                      userId={speakerUserId}
                      label={u.speaker_label}
                      color={color}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        {/* 화자 이름 — 수정 모드일 때만 클릭 가능 */}
                        {isEditMode ? (
                          <button
                            type="button"
                            onClick={() => openSpeakerModal(u)}
                            className="text-sm font-medium flex items-center gap-1 rounded px-1 -mx-1 transition-colors hover:bg-muted/60 cursor-pointer text-foreground group-hover:text-accent"
                            title="클릭해서 화자 수정"
                          >
                            <Pencil
                              size={11}
                              className="opacity-0 group-hover:opacity-60 transition-opacity shrink-0"
                            />
                            {u.speaker_label}
                          </button>
                        ) : (
                          <span className="text-sm font-medium text-foreground">
                            {u.speaker_label}
                          </span>
                        )}
                        <span className="text-mini text-muted-foreground">
                          {formatTime(u.start)}
                        </span>
                        <button
                          type="button"
                          onClick={() => playUtterance(u)}
                          className={[
                            "transition-opacity flex items-center gap-1 h-5 px-1.5 rounded text-micro font-medium",
                            isEditMode
                              ? "opacity-100 bg-muted/60 text-muted-foreground hover:text-foreground border border-transparent hover:border-border"
                              : "opacity-0 group-hover:opacity-100 bg-muted/60 text-muted-foreground hover:text-foreground border border-transparent hover:border-border",
                            isPlaying
                              ? "opacity-100 bg-accent/15 text-accent border border-accent/30"
                              : "",
                          ].join(" ")}
                          title={isPlaying ? "정지" : "이 구간 재생"}
                        >
                          {isPlaying ? (
                            <Square size={9} className="fill-current" />
                          ) : (
                            <Play size={9} className="fill-current" />
                          )}
                          {isPlaying ? "정지" : "재생"}
                        </button>
                      </div>
                      {/* 발화 텍스트 — 수정 모드일 때만 인라인 편집 */}
                      {isEditMode && editingSeq === u.seq ? (
                        <div className="mt-0.5">
                          <textarea
                            className="w-full text-sm text-foreground leading-relaxed bg-muted/30 border border-accent/40 rounded-md px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-accent/40"
                            rows={Math.max(
                              2,
                              Math.ceil(editingText.length / 60),
                            )}
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={(e) => {
                              if (
                                e.key === "Enter" &&
                                (e.metaKey || e.ctrlKey)
                              ) {
                                saveEditContent(u.seq);
                              }
                              if (e.key === "Escape") cancelEditContent();
                            }}
                            autoFocus
                          />
                          <div className="flex items-center gap-1.5 mt-1">
                            <button
                              onClick={() => saveEditContent(u.seq)}
                              disabled={contentSaving || !editingText.trim()}
                              className="flex items-center gap-1 h-6 px-2 rounded bg-accent text-accent-foreground text-xs font-medium hover:bg-accent/90 disabled:opacity-40 transition-colors"
                            >
                              {contentSaving ? (
                                <Loader2 size={10} className="animate-spin" />
                              ) : (
                                <Check size={10} />
                              )}
                              저장
                            </button>
                            <button
                              onClick={cancelEditContent}
                              className="flex items-center gap-1 h-6 px-2 rounded border border-border text-xs hover:bg-muted/50 transition-colors"
                            >
                              <X size={10} /> 취소
                            </button>
                            <span className="text-xs text-muted-foreground ml-1">
                              ⌘Enter로 저장
                            </span>
                          </div>
                        </div>
                      ) : (
                        <p
                          className={[
                            "text-sm text-foreground leading-relaxed rounded px-1 -mx-1 transition-colors",
                            isEditMode
                              ? "cursor-text hover:bg-muted/30"
                              : "cursor-default",
                          ].join(" ")}
                          title={
                            isEditMode ? "클릭해서 텍스트 수정" : undefined
                          }
                          onClick={
                            isEditMode ? () => startEditContent(u) : undefined
                          }
                        >
                          {u.content}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
              {hiddenUtteranceCount > 0 && (
                <div className="flex justify-center pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAllUtterances(true)}
                    className="h-9 px-4 rounded-lg border border-border text-sm font-medium hover:bg-muted/50 transition-colors"
                  >
                    더보기 {hiddenUtteranceCount}개
                  </button>
                </div>
              )}
              <div ref={transcriptBottomRef} />
            </div>
          )}
        </section>
      </div>

      {!utterancesLoading && !utterancesError && utterances.length > 0 && (
        <div className="fixed left-4 right-24 sm:left-1/2 sm:right-auto sm:w-[min(44rem,calc(100vw-14rem))] sm:-translate-x-1/2 bottom-4 z-20">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card/95 px-3 py-2.5 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80">
            <div className="flex flex-1 items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={toggleFullAudio}
                className="w-8 h-8 rounded-full flex items-center justify-center bg-accent/10 hover:bg-accent/20 text-accent transition-colors shrink-0"
                title={fullPlaying ? "일시정지" : "전체 재생"}
              >
                {fullPlaying ? (
                  <Pause size={13} className="fill-current" />
                ) : (
                  <Play size={13} className="fill-current" />
                )}
              </button>
              <span className="text-micro text-muted-foreground shrink-0 w-10 text-right tabular-nums">
                {formatTime(fullCurrentTime)}
              </span>
              <div
                className="flex-1 h-1.5 bg-muted rounded-full cursor-pointer relative overflow-hidden"
                onClick={seekFullAudio}
                title="클릭해서 이동"
              >
                <div
                  className="absolute left-0 top-0 h-full bg-accent rounded-full"
                  style={{
                    width: `${fullDuration ? (fullCurrentTime / fullDuration) * 100 : 0}%`,
                  }}
                />
              </div>
              <span className="text-micro text-muted-foreground shrink-0 w-10 tabular-nums">
                {fullDuration ? formatTime(fullDuration) : "--:--"}
              </span>
            </div>
            {isEditMode ? (
              <button
                onClick={exitEditMode}
                disabled={utterancesLoading}
                className="shrink-0 flex items-center gap-1.5 h-9 px-3 rounded-lg bg-accent text-accent-foreground text-xs font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
              >
                {utterancesLoading ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Check size={11} />
                )}
                수정완료
              </button>
            ) : (
              <button
                onClick={enterEditMode}
                disabled={utterancesLoading || utterances.length === 0}
                className="shrink-0 flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-xs font-medium hover:bg-muted/50 transition-colors disabled:opacity-40"
              >
                <Pencil size={11} />
                수정하기
              </button>
            )}
          </div>
        </div>
      )}

      {!utterancesLoading && !utterancesError && utterances.length > 0 && (
        <div
          className="fixed right-4 sm:right-6 z-30"
          style={{
            bottom: "max(6.75rem, calc(env(safe-area-inset-bottom) + 6rem))",
          }}
        >
          <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80">
            <button
              type="button"
              onClick={() => moveTranscript("top")}
              className="flex items-center justify-center gap-1.5 h-11 px-3 text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
              title="전문 상단으로 이동"
            >
              <ArrowUp size={13} /> 위로
            </button>
            <button
              type="button"
              onClick={() => moveTranscript("bottom")}
              className="flex items-center justify-center gap-1.5 h-11 px-3 text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors border-t border-border"
              title="전문 하단으로 이동"
            >
              <ArrowDown size={13} /> 아래로
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
