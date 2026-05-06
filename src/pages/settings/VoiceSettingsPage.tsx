import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle, Mic, Sparkles, Square } from "lucide-react";
import { getCurrentWorkspaceId } from "../../api/client";
import {
  getSpeakerProfiles,
  type SpeakerProfileItem,
} from "../../api/speakerProfiles";
import { useAuth } from "../../context/AuthContext";

const TARGET_SAMPLE_RATE = 16000;
const PREPARE_COUNTDOWN_SECONDS = 5;
const VOICE_GUIDE_TEXT =
  "어른들은 나에게 코끼리를 집어삼킨 보아뱀 그림 따위는 집어치우고 지리나 역사, 수학과 문법을 공부하는 게 더 나을 거라고 충고했다. 그래서 나는 불과 여섯 살에 멋진 화가가 되겠다는 꿈을 포기했다.";

type RecordingModalState = {
  userId: number;
  userName: string;
  countdown: number;
  requestId: number;
  status: "countdown" | "starting" | "recording" | "saving";
};

const ASR_BASE = (() => {
  const raw =
    (import.meta.env.VITE_ASR_SERVER as string | undefined) ??
    "http://localhost:8888";
  const trimmed = raw.trim().replace(/\/+$/, "");
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
})();

const WORKLET_CODE = `
class PCMCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length > 0) this.port.postMessage(ch.slice());
    return true;
  }
}
registerProcessor('pcm-capture', PCMCapture);
`;

function float32ToWav(f32: Float32Array, sr: number): ArrayBuffer {
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768));
  }
  const buf = new ArrayBuffer(44 + i16.byteLength);
  const v = new DataView(buf);
  const txt = (off: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)));
  txt(0, "RIFF");
  v.setUint32(4, 36 + i16.byteLength, true);
  txt(8, "WAVE");
  txt(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  txt(36, "data");
  v.setUint32(40, i16.byteLength, true);
  new Uint8Array(buf, 44).set(new Uint8Array(i16.buffer));
  return buf;
}

const ROLE_LABELS: Record<string, string> = {
  admin: "관리자",
  member: "멤버",
  viewer: "뷰어",
};

function getInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function getAvatarColor(userId: number): string {
  const colors = [
    "#6b78f6",
    "#22c55e",
    "#f97316",
    "#ec4899",
    "#eab308",
    "#14b8a6",
  ];
  return colors[userId % colors.length];
}

export default function VoiceSettingsPage() {
  const { isAdmin } = useAuth();
  const [profiles, setProfiles] = useState<SpeakerProfileItem[]>([]);
  const [recordingUserId, setRecordingUserId] = useState<number | null>(null);
  const [recordingModal, setRecordingModal] =
    useState<RecordingModalState | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const workspaceId = getCurrentWorkspaceId();
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcmBufRef = useRef<number[]>([]);
  const recordingRequestIdRef = useRef(0);
  const startingRequestIdRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;

    async function loadProfiles() {
      setLoading(true);
      setError("");
      try {
        const rows = await getSpeakerProfiles(workspaceId);
        if (!active) return;
        setProfiles(rows);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : "화자 프로필을 불러오지 못했습니다.",
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    loadProfiles();

    return () => {
      active = false;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (!recordingModal || recordingModal.status !== "countdown") return;

    if (recordingModal.countdown === 0) {
      setRecordingModal((current) =>
        current &&
        current.requestId === recordingModal.requestId &&
        current.status === "countdown"
          ? { ...current, status: "starting" }
          : current,
      );
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setRecordingModal((current) =>
        current &&
        current.requestId === recordingModal.requestId &&
        current.status === "countdown"
          ? { ...current, countdown: Math.max(0, current.countdown - 1) }
          : current,
      );
    }, 1000);

    return () => window.clearTimeout(timeoutId);
  }, [recordingModal]);

  useEffect(() => {
    if (!recordingModal || recordingModal.status !== "starting") return;
    if (startingRequestIdRef.current === recordingModal.requestId) return;

    startingRequestIdRef.current = recordingModal.requestId;
    void startRecording(recordingModal.userId, recordingModal.requestId);
  }, [recordingModal]);

  useEffect(() => {
    return () => {
      cleanupCapture();
    };
  }, []);

  function cleanupCapture() {
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;

    void audioCtxRef.current?.close();
    audioCtxRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function openRecordingModal(userId: number, userName: string) {
    recordingRequestIdRef.current += 1;
    const requestId = recordingRequestIdRef.current;

    setError("");
    setMessage("");
    setRecordingModal({
      userId,
      userName,
      countdown: PREPARE_COUNTDOWN_SECONDS,
      requestId,
      status: "countdown",
    });
  }

  function closeRecordingModal() {
    if (savingUserId !== null) return;

    recordingRequestIdRef.current += 1;
    startingRequestIdRef.current = null;
    cleanupCapture();
    pcmBufRef.current = [];
    setRecordingUserId(null);
    setRecordingModal(null);
  }

  async function startRecording(userId: number, requestId: number) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      if (recordingRequestIdRef.current !== requestId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      pcmBufRef.current = [];

      const audioCtx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      audioCtxRef.current = audioCtx;

      const blobUrl = URL.createObjectURL(
        new Blob([WORKLET_CODE], { type: "application/javascript" }),
      );

      try {
        await audioCtx.audioWorklet.addModule(blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }

      if (recordingRequestIdRef.current !== requestId) {
        cleanupCapture();
        return;
      }

      const source = audioCtx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(audioCtx, "pcm-capture");
      workletNodeRef.current = worklet;

      worklet.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
        for (const sample of data) pcmBufRef.current.push(sample);
      };

      source.connect(worklet);
      worklet.connect(audioCtx.destination);

      setRecordingUserId(userId);
      setRecordingModal((current) =>
        current && current.requestId === requestId
          ? { ...current, status: "recording" }
          : current,
      );
    } catch {
      cleanupCapture();
      pcmBufRef.current = [];
      setRecordingUserId(null);
      setRecordingModal(null);
      setError(
        "마이크 접근 권한이 필요합니다. 브라우저 설정에서 허용해주세요.",
      );
    } finally {
      if (startingRequestIdRef.current === requestId) {
        startingRequestIdRef.current = null;
      }
    }
  }

  async function sendEmbedding(userId: number, wavBuf: ArrayBuffer) {
    setSavingUserId(userId);
    try {
      const formData = new FormData();
      formData.append(
        "audio",
        new Blob([wavBuf], { type: "audio/wav" }),
        "recording.wav",
      );

      const response = await fetch(`${ASR_BASE}/meeting/embedding/${userId}`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`서버 오류 (${response.status}): ${text}`);
      }

      const data = (await response.json()) as { message: string };
      setMessage(data.message);
      setProfiles((prev) =>
        prev.map((p) =>
          p.user_id === userId ? { ...p, is_verified: true } : p,
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "임베딩 등록에 실패했습니다.",
      );
    } finally {
      setSavingUserId(null);
      setRecordingUserId(null);
      setRecordingModal((current) =>
        current && current.userId === userId ? null : current,
      );
    }
  }

  function stopRecording(userId: number) {
    setRecordingModal((current) =>
      current && current.userId === userId
        ? { ...current, status: "saving" }
        : current,
    );

    const pcm = new Float32Array(pcmBufRef.current);
    pcmBufRef.current = [];

    cleanupCapture();

    const wavBuf = float32ToWav(pcm, TARGET_SAMPLE_RATE);
    void sendEmbedding(userId, wavBuf);
  }

  function handleRecordClick(userId: number, userName: string) {
    if (recordingUserId === userId) {
      stopRecording(userId);
      return;
    }

    openRecordingModal(userId, userName);
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
        <p className="text-sm text-muted-foreground">
          화자 프로필을 불러오는 중입니다...
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <div className="mb-1 flex items-center gap-2">
        <Sparkles size={14} className="text-accent" />
        <span className="text-mini font-medium text-accent">AI 기능</span>
      </div>
      <h1 className="mb-1 text-xl font-semibold text-foreground">
        성문(음성) 수집 · 화자 등록
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {isAdmin
          ? "관리자는 워크스페이스 멤버의 화자 프로필을 등록할 수 있습니다."
          : "멤버는 본인 화자 프로필만 등록할 수 있습니다."}
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {message && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-accent/25 bg-accent-subtle px-3 py-2 text-sm text-accent">
          <CheckCircle size={15} className="mt-0.5 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          {isAdmin ? "팀원 화자 프로필" : "내 화자 프로필"}
        </h2>
        <div className="flex flex-col gap-2">
          {profiles.map((profile) => {
            const recording = recordingUserId === profile.user_id;
            const saving = savingUserId === profile.user_id;
            return (
              <div
                key={profile.user_id}
                className="rounded-lg border border-border bg-card p-3"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                      style={{
                        backgroundColor: getAvatarColor(profile.user_id),
                      }}
                    >
                      {getInitial(profile.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {profile.name}
                      </p>
                      <p className="truncate text-mini text-muted-foreground">
                        {profile.email}
                      </p>
                      <p className="text-micro text-muted-foreground">
                        {ROLE_LABELS[profile.role] ?? profile.role}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    {profile.is_verified ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-1 text-mini font-medium text-green-600 dark:bg-green-950/30 dark:text-green-400">
                        <CheckCircle size={12} />
                        등록됨
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-mini font-medium text-muted-foreground">
                        <AlertCircle size={12} />
                        미등록
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        handleRecordClick(profile.user_id, profile.name)
                      }
                      disabled={saving || recordingModal !== null}
                      className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        recording
                          ? "bg-red-500 text-white hover:bg-red-600"
                          : "bg-accent text-accent-foreground hover:bg-accent/90"
                      }`}
                    >
                      {recording ? (
                        <>
                          <Square size={13} fill="currentColor" />
                          {saving ? "저장 중..." : "녹음 중지 및 저장"}
                        </>
                      ) : (
                        <>
                          <Mic size={13} />
                          {profile.is_verified ? "재등록" : "등록"}
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {recording && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
                    <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                    <span>
                      음성 샘플 녹음 중입니다. 안내 문장을 5초 이상 읽은 뒤
                      저장하세요.
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {recordingModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="voice-recording-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h2
                  id="voice-recording-title"
                  className="text-base font-semibold text-foreground"
                >
                  음성 샘플 등록
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {recordingModal.userName}님의 화자 프로필을 등록합니다.
                </p>
              </div>
              <span className="inline-flex min-w-20 items-center justify-center rounded-full bg-accent-subtle px-3 py-1 text-xs font-semibold text-accent">
                {recordingModal.status === "countdown"
                  ? `${recordingModal.countdown}초 전`
                  : recordingModal.status === "starting"
                    ? "준비 중"
                    : recordingModal.status === "saving"
                      ? "저장 중"
                      : "녹음 중"}
              </span>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="rounded-xl bg-muted/50 px-4 py-4">
                {recordingModal.status === "countdown" && (
                  <>
                    <p className="text-lg font-semibold text-foreground">
                      {recordingModal.countdown}초 뒤 녹음을 시작합니다.
                    </p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      마이크 앞에서 준비해 주세요. 카운트다운이 끝나면 아래 예시
                      문구를 따라 읽으면 됩니다.
                    </p>
                  </>
                )}

                {recordingModal.status === "starting" && (
                  <>
                    <p className="text-lg font-semibold text-foreground">
                      마이크를 연결하고 있습니다.
                    </p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      브라우저 권한 요청이 보이면 허용해 주세요.
                    </p>
                  </>
                )}

                {recordingModal.status === "recording" && (
                  <div className="flex items-start gap-3">
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
                    <div>
                      <p className="text-lg font-semibold text-foreground">
                        지금부터 예시 문구를 읽어주세요.
                      </p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        자연스럽게 5초 이상 읽은 뒤 저장 버튼을 눌러주세요.
                      </p>
                    </div>
                  </div>
                )}

                {recordingModal.status === "saving" && (
                  <>
                    <p className="text-lg font-semibold text-foreground">
                      음성 샘플을 저장하고 있습니다.
                    </p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      잠시만 기다려 주세요.
                    </p>
                  </>
                )}
              </div>

              <div className="rounded-xl border border-border bg-background px-4 py-4">
                <p className="mb-2 text-mini font-semibold text-muted-foreground">
                  예시 문구
                </p>
                <p className="break-keep text-sm leading-7 text-foreground">
                  {VOICE_GUIDE_TEXT}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
              <button
                type="button"
                onClick={closeRecordingModal}
                disabled={recordingModal.status === "saving"}
                className="h-9 rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {recordingModal.status === "recording" ? "녹음 취소" : "닫기"}
              </button>
              <button
                type="button"
                onClick={() => stopRecording(recordingModal.userId)}
                disabled={recordingModal.status !== "recording"}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Square size={13} fill="currentColor" />
                녹음 중지 및 저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
