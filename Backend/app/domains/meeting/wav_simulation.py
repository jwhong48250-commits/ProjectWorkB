"""
WAV 파일을 OpenAI Whisper로 전사(transcription)해 MongoDB utterances에 저장하고
meeting status를 done으로 전환하는 개발·QA 전용 서비스.

화자분리: Whisper는 화자분리를 지원하지 않으므로 모든 발화를 "Speaker 1"으로 저장.
실제 회의 종료 후와 동일한 utterances 스키마(seq, speaker_id, speaker_label,
timestamp, content, start, end, confidence)를 유지하므로 하위 파이프라인이
그대로 동작한다.

실제 회의 종료 흐름 재현:
  1. Whisper 전사 → MongoDB utterances 저장
  2. Redis meeting:{id}:utterances 에 동일 발화 push  ← quick_report_node가 읽는 곳
  3. end_meeting() → MySQL status = done
  4. LangGraph 후처리 파이프라인 → 요약/WBS/회의록 생성
"""
import asyncio
import io
import json
import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.domains.intelligence.repository import save_utterances
from app.domains.meeting.service import MeetingLifecycleService
from app.utils.redis_utils import r as redis_client

logger = logging.getLogger(__name__)

_MAX_WAV_BYTES = 300 * 1024 * 1024  # 300 MB
_REDIS_TTL_SEC = 60 * 60 * 24       # 24h — 실제 회의와 동일


async def run_wav_simulation(
    db: Session,
    workspace_id: int,
    meeting_id: int,
    wav_bytes: bytes,
    openai_api_key: str,
) -> int:
    """
    WAV bytes를 전사해 utterances를 저장하고 회의를 종료합니다.
    실제 회의 종료 흐름과 동일하게 quick_report_node까지 실행합니다.
    반환값: 저장된 utterance 수
    """
    try:
        from openai import AsyncOpenAI
    except ImportError as exc:
        raise ImportError("openai 패키지가 필요합니다: pip install openai") from exc

    client = AsyncOpenAI(api_key=openai_api_key)

    logger.info("WAV 시뮬레이션 시작 (meeting_id=%d, bytes=%d)", meeting_id, len(wav_bytes))

    # ── 1. Whisper 전사 ────────────────────────────────────────────────
    transcript = await client.audio.transcriptions.create(
        model="whisper-1",
        file=("audio.wav", io.BytesIO(wav_bytes), "audio/wav"),
        response_format="verbose_json",
        timestamp_granularities=["segment"],
    )

    segments = getattr(transcript, "segments", None) or []
    now_str = datetime.now(timezone.utc).isoformat()

    utterances: list[dict] = []
    for i, seg in enumerate(segments):
        text = (seg.text or "").strip()
        if not text:
            continue
        utterances.append({
            "seq": i,
            "speaker_id": None,
            "speaker_label": "Speaker 1",
            "timestamp": now_str,
            "content": text,
            "start": float(getattr(seg, "start", 0.0)),
            "end": float(getattr(seg, "end", 0.0)),
            "confidence": None,
        })

    if not utterances:
        full_text = (getattr(transcript, "text", "") or "").strip()
        if full_text:
            utterances.append({
                "seq": 0,
                "speaker_id": None,
                "speaker_label": "Speaker 1",
                "timestamp": now_str,
                "content": full_text,
                "start": 0.0,
                "end": 0.0,
                "confidence": None,
            })

    total_sec = int(utterances[-1]["end"]) if utterances else 0

    # ── 2. MongoDB utterances 저장 ─────────────────────────────────────
    await save_utterances(str(meeting_id), {
        "meeting_id": meeting_id,
        "utterances": utterances,
        "total_duration_sec": total_sec,
        "meeting_start_time": datetime.now(timezone.utc),
    })

    # ── 3. Redis push — quick_report_node가 읽는 포맷과 동일 ──────────
    # 실제 STT 서비스는 {"speaker_id": "spk_01", "content": "..."} 형태로 push함
    # 시뮬레이션에서는 speaker_id=None → get_meeting_context가 "알 수 없음"으로 표기
    redis_key = f"meeting:{meeting_id}:utterances"
    await redis_client.delete(redis_key)  # 이전 데이터 클리어
    if utterances:
        redis_payloads = [
            json.dumps({"speaker_id": None, "content": u["content"]}, ensure_ascii=False).encode()
            for u in utterances
        ]
        await redis_client.rpush(redis_key, *redis_payloads)
        await redis_client.expire(redis_key, _REDIS_TTL_SEC)

    # ── 4. 회의 종료 (MySQL status = done) ────────────────────────────
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None,
        lambda: MeetingLifecycleService.end_meeting(db, workspace_id, meeting_id),
    )

    # ── 5. LangGraph 후처리 — 실제 회의 종료와 동일한 경로 ───────────
    # fire-and-forget: 실패해도 시뮬레이션 자체는 성공으로 처리
    asyncio.ensure_future(_run_completion_pipeline(workspace_id, meeting_id))

    logger.info(
        "WAV 시뮬레이션 완료 (meeting_id=%d, utterances=%d, duration=%ds)",
        meeting_id, len(utterances), total_sec,
    )
    return len(utterances)


async def _run_completion_pipeline(workspace_id: int, meeting_id: int) -> None:
    """회의 후처리 LangGraph 파이프라인을 fire-and-forget으로 실행."""
    try:
        from app.core.graph.meeting_pipeline import run_meeting_completion_pipeline

        await run_meeting_completion_pipeline(workspace_id, meeting_id)
        logger.info("회의 후처리 파이프라인 완료 (meeting_id=%d)", meeting_id)
    except Exception as exc:
        logger.warning("회의 후처리 파이프라인 실패 (meeting_id=%d): %s", meeting_id, exc)
