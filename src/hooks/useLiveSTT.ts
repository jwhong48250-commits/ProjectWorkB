import { useCallback, useEffect, useRef, useState } from "react";
import { checkMeetingStatus } from "../api/intelligence";

export type WsStatus = "idle" | "connecting" | "connected" | "finalizing" | "done" | "error";

export interface DiarizationSegment {
    speaker_id: string;
    speaker: string;
    content: string;
    timestamp: string;
}

interface STTMessage {
    language: string;
    text: string;
    final: boolean;
    timestamps?: { text: string; start: number; end: number }[];
    sentences?: { text: string; start: number; end: number }[];
    diarization?: DiarizationSegment[];
}

interface LiveSTTOptions {
    selectedMicId?: string | null;
    initialMicOn?: boolean;
}

const WS_BASE = (import.meta.env.VITE_WS_BASE as string | undefined) ?? "ws://localhost:8888";

const TARGET_SAMPLE_RATE = 16000;
/** 2초 분량의 청크 크기: 16000 Hz × 2s */
const CHUNK_SMPLS = 32000;

/** AudioWorklet 인라인 코드 — Float32 raw PCM을 메인 스레드로 전달 */
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

/** Float32 mono PCM → 16-bit WAV ArrayBuffer */
function float32ToWav(f32: Float32Array, sr: number): ArrayBuffer {
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
        i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768));
    }
    const buf = new ArrayBuffer(44 + i16.byteLength);
    const v = new DataView(buf);
    const txt = (off: number, s: string) => [...s].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)));
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

function normalizeMicId(deviceId: string | null | undefined): string | null {
    return typeof deviceId === "string" && deviceId.trim() ? deviceId : null;
}

export function buildMicAudioConstraints(selectedMicId?: string | null): MediaTrackConstraints {
    const constraints: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
    };
    const normalizedMicId = normalizeMicId(selectedMicId);

    if (normalizedMicId) {
        constraints.deviceId = { exact: normalizedMicId };
    }

    return constraints;
}

function shouldRetryWithDefaultMic(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return error.name === "OverconstrainedError" || error.name === "NotFoundError";
}

async function getMicrophoneStream(selectedMicId: string | null): Promise<MediaStream> {
    try {
        return await navigator.mediaDevices.getUserMedia({
            audio: buildMicAudioConstraints(selectedMicId),
            video: false,
        });
    } catch (error) {
        if (!selectedMicId || !shouldRetryWithDefaultMic(error)) {
            throw error;
        }

        console.warn("[useLiveSTT] 저장된 마이크를 찾을 수 없어 기본 마이크로 재시도합니다.");
        return navigator.mediaDevices.getUserMedia({
            audio: buildMicAudioConstraints(null),
            video: false,
        });
    }
}

export function useLiveSTT(meetingId: string, options: LiveSTTOptions = {}) {
    const selectedMicId = normalizeMicId(options.selectedMicId);
    const initialMicOn = options.initialMicOn ?? true;
    const [wsStatus, setWsStatus] = useState<WsStatus>("idle");
    const [liveText, setLiveText] = useState("");
    const [diarization, setDiarization] = useState<DiarizationSegment[]>([]);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [micOn, setMicOn] = useState(initialMicOn);

    const wsRef = useRef<WebSocket | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const workletNodeRef = useRef<AudioWorkletNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const pcmBufRef = useRef<number[]>([]);
    const isStoppingRef = useRef(false);
    const isDoneRef = useRef(false);

    useEffect(() => {
        let unmounted = false;

        async function connect() {
            setWsStatus("connecting");
            setErrorMsg(null);

            // 0. 회의 상태 사전 체크 — done임이 확실할 때만 연결 차단 (fail-open)
            try {
                const statusData = await checkMeetingStatus(meetingId);
                if (statusData.is_done) {
                    setWsStatus("done");
                    setErrorMsg("이미 종료된 회의입니다. 회의록 페이지에서 내용을 확인하세요.");
                    return;
                }
            } catch {
                // 상태 조회 실패(네트워크 오류, 인증 만료 등) → 연결은 계속 진행
                // WebSocket 서버에서 최종 유효성 검증을 수행하므로 여기서 차단하지 않음
                console.warn("[useLiveSTT] 회의 상태 사전 확인 실패 — WebSocket 연결을 계속 시도합니다.");
            }

            // 1. 장비 설정에서 선택한 마이크로 권한 요청
            let stream: MediaStream;
            try {
                stream = await getMicrophoneStream(selectedMicId);
                stream.getAudioTracks().forEach((track) => {
                    track.enabled = initialMicOn;
                });
                setMicOn(initialMicOn);
                streamRef.current = stream;
            } catch {
                if (!unmounted) {
                    setWsStatus("error");
                    setErrorMsg("마이크 접근 권한이 필요합니다.");
                }
                return;
            }

            if (unmounted) {
                stream.getTracks().forEach((t) => t.stop());
                return;
            }

            // 2. WebSocket 연결
            const ws = new WebSocket(`${WS_BASE}/meeting/ws/stream/${meetingId}`);
            wsRef.current = ws;

            ws.onopen = () => {
                if (unmounted) {
                    ws.close();
                    return;
                }

                // 언어 설정 JSON을 가장 먼저 전송
                ws.send(JSON.stringify({ language: "Korean" }));
                setWsStatus("connected");

                // AudioContext @ 16 kHz
                const audioCtx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
                audioCtxRef.current = audioCtx;

                const blobUrl = URL.createObjectURL(new Blob([WORKLET_CODE], { type: "application/javascript" }));
                audioCtx.audioWorklet.addModule(blobUrl).then(() => {
                    URL.revokeObjectURL(blobUrl);

                    const source = audioCtx.createMediaStreamSource(stream);
                    const worklet = new AudioWorkletNode(audioCtx, "pcm-capture");
                    workletNodeRef.current = worklet;

                    worklet.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
                        // 128 샘플씩 수신 → 버퍼에 누적
                        for (const s of data) pcmBufRef.current.push(s);

                        // CHUNK_SMPLS(2초)마다 WAV 인코딩 후 전송
                        while (pcmBufRef.current.length >= CHUNK_SMPLS) {
                            const chunk = new Float32Array(pcmBufRef.current.splice(0, CHUNK_SMPLS));
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(float32ToWav(chunk, TARGET_SAMPLE_RATE));
                            }
                        }
                    };

                    source.connect(worklet);
                });
            };

            ws.onmessage = (e) => {
                if (unmounted) return;
                try {
                    const msg = JSON.parse(e.data as string) as STTMessage & {
                        message?: string;
                    };

                    // 회의 처리 완료 신호
                    if (msg.message === "Meeting processing complete") {
                        isDoneRef.current = true;
                        setWsStatus("done");
                        ws.close(1000);
                        return;
                    }

                    setLiveText(msg.text ?? "");
                    if (msg.diarization && msg.diarization.length > 0) {
                        setDiarization(msg.diarization);
                    }
                    if (msg.final) {
                        isDoneRef.current = true;
                        setWsStatus("finalizing");
                    }
                } catch {
                    console.error("STT 메시지 파싱 오류:", e.data);
                }
            };

            ws.onerror = () => {
                if (unmounted) return;
                setWsStatus("error");
                setErrorMsg("WebSocket 연결 오류가 발생했습니다.");
            };

            ws.onclose = (e) => {
                if (unmounted || isDoneRef.current || isStoppingRef.current) {
                    if (!isDoneRef.current) {
                        isDoneRef.current = true;
                        setWsStatus("done");
                    }
                    return;
                }
                if (e.code === 4004) {
                    setWsStatus("error");
                    setErrorMsg("회의를 찾을 수 없습니다. (4004)");
                } else if (e.code === 4009) {
                    setWsStatus("done");
                    setErrorMsg("이미 종료된 회의입니다. 회의록 페이지에서 내용을 확인하세요.");
                } else if (e.code !== 1000 && e.code !== 1001) {
                    setWsStatus("error");
                    setErrorMsg(`연결이 끊어졌습니다. (코드: ${e.code})`);
                }
            };
        }

        connect();

        return () => {
            unmounted = true;
            workletNodeRef.current?.disconnect();
            audioCtxRef.current?.close();
            streamRef.current?.getTracks().forEach((t) => t.stop());
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.close(1000);
            }
        };
    }, [meetingId, selectedMicId, initialMicOn]);

    /** 마이크 트랙 enable/disable 토글 */
    const toggleMic = useCallback(() => {
        setMicOn((prev) => {
            const next = !prev;
            streamRef.current?.getAudioTracks().forEach((t) => {
                t.enabled = next;
            });
            return next;
        });
    }, []);

    /** 종료 버튼 핸들러: 남은 PCM 버퍼 WAV 전송 → 빈 바이트로 종료 신호 (WebSocket 연결 유지) */
    const stopMeeting = useCallback(() => {
        isStoppingRef.current = true;
        const ws = wsRef.current;

        // 남은 버퍼 플러시
        if (pcmBufRef.current.length > 0 && ws?.readyState === WebSocket.OPEN) {
            const chunk = new Float32Array(pcmBufRef.current.splice(0));
            ws.send(float32ToWav(chunk, TARGET_SAMPLE_RATE));
        }

        workletNodeRef.current?.disconnect();
        audioCtxRef.current?.close();
        streamRef.current?.getTracks().forEach((t) => t.stop());

        if (ws && ws.readyState === WebSocket.OPEN) {
            setWsStatus("finalizing");
            ws.send(new ArrayBuffer(0)); // 종료 신호 — WebSocket 연결은 유지
        }
    }, []);

    return {
        wsStatus,
        liveText,
        diarization,
        errorMsg,
        micOn,
        toggleMic,
        stopMeeting,
    };
}
