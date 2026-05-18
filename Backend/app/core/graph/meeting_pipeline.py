"""
LangGraph pipeline for meeting lifecycle and post-meeting artifacts.

Flow:
  meeting_start -> realtime_diarization -> postprocess_diarization -> wbs -> minutes

The actual realtime diarization is performed by the ASR/WebSocket service. This
graph coordinates the persisted backend steps around that service.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date
from typing import Any, Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from sqlalchemy.orm import Session

from app.domains.action.models import ActionItem, ActionStatus, Priority
from app.domains.action.mongo_repository import get_meeting_summary, get_meeting_utterances
from app.domains.action.services.minutes_builder import build_and_save_minutes
from app.domains.action.services.wbs_builder import build_wbs_template
from app.domains.meeting.models import MeetingParticipant
from app.domains.meeting.service import MeetingLifecycleService
from app.domains.user.models import User
from app.utils.time_utils import now_kst
from app.utils.redis_utils import r as redis_client

logger = logging.getLogger(__name__)

PipelineMode = Literal["start", "complete"]
_MONGO_UTTERANCE_RETRY_INTERVAL_SEC = 1.0
_MONGO_UTTERANCE_RETRY_COUNT = 15


class MeetingPipelineState(TypedDict, total=False):
    workspace_id: int
    meeting_id: int
    mode: PipelineMode
    realtime_utterance_count: int
    postprocessed_utterance_count: int
    summary: dict[str, Any]
    wbs: dict[str, Any]
    minutes_id: int
    errors: list[str]


def _append_error(state: MeetingPipelineState, message: str) -> dict[str, list[str]]:
    return {"errors": [*(state.get("errors") or []), message]}


async def meeting_start_node(state: MeetingPipelineState) -> dict[str, Any]:
    db = _session()
    try:
        MeetingLifecycleService.start_meeting(
            db,
            int(state["workspace_id"]),
            int(state["meeting_id"]),
        )
        return {}
    finally:
        db.close()


async def realtime_diarization_node(state: MeetingPipelineState) -> dict[str, Any]:
    """Observe realtime ASR output stored in Redis.

    Realtime speaker separation itself is owned by the ASR service. The pipeline
    records whether utterances are available so later nodes can persist them if
    the ASR service has not already written MongoDB utterances.
    """
    meeting_id = int(state["meeting_id"])
    count = await redis_client.llen(f"meeting:{meeting_id}:utterances")
    return {"realtime_utterance_count": int(count)}


async def postprocess_diarization_node(state: MeetingPipelineState) -> dict[str, Any]:
    """Use ASR-processed Mongo utterances and create the structured meeting summary."""
    meeting_id = int(state["meeting_id"])
    workspace_id = int(state["workspace_id"])

    # STT/ASR 서버가 종료 후 후처리를 완료한 utterances를 MongoDB에 저장한다.
    # 파이프라인에서 Redis 값을 다시 저장하면 기존 후처리 결과를 덮어쓸 수 있으므로 읽기만 수행한다.
    utterances = await _wait_for_postprocessed_utterances(meeting_id)
    if not utterances:
        logger.warning(
            "No postprocessed utterances found in MongoDB: meeting_id=%s",
            meeting_id,
        )
        return _append_error(
            state,
            "후처리 발화(MongoDB)가 없어 회의 종료 후처리를 진행할 수 없습니다.",
        )
    elif utterances:
        logger.info(
            "MongoDB utterances already exist; skip Redis fallback save to avoid overwriting postprocessed diarization. meeting_id=%s",
            meeting_id,
        )

    try:
        from app.domains.knowledge.service import process_meeting_end

        await process_meeting_end(meeting_id, workspace_id)
    except Exception as exc:
        logger.exception("process_meeting_end failed: meeting_id=%s", meeting_id)
        return _append_error(state, f"process_meeting_end 실패: {exc}")

    report_state = {
        "meeting_id": meeting_id,
        "workspace_id": workspace_id,
        "past_meeting_ids": None,
        "user_question": "",
        "function_type": "",
        "chat_response": "",
    }
    try:
        from app.domains.knowledge.agent_utils import quick_report_node

        await quick_report_node(report_state)
    except Exception as exc:
        logger.exception(
            "quick_report failed in meeting pipeline: meeting_id=%s", meeting_id
        )
        return _append_error(state, f"quick_report 실패: {exc}")

    summary = get_meeting_summary(meeting_id) or {}
    db = _session()
    try:
        _persist_action_items_from_summary(db, meeting_id, workspace_id, summary)
    finally:
        db.close()

    return {
        "postprocessed_utterance_count": len(utterances),
        "summary": summary,
    }


async def _wait_for_postprocessed_utterances(meeting_id: int) -> list[dict[str, Any]]:
    """
    ASR 서버의 MongoDB 저장이 약간 지연될 수 있어 짧은 재시도 윈도우를 둔다.
    """
    for attempt in range(1, _MONGO_UTTERANCE_RETRY_COUNT + 1):
        utterances = get_meeting_utterances(meeting_id)
        if utterances:
            if attempt > 1:
                logger.info(
                    "Postprocessed utterances loaded after retry: meeting_id=%s attempt=%s",
                    meeting_id,
                    attempt,
                )
            return utterances
        await asyncio.sleep(_MONGO_UTTERANCE_RETRY_INTERVAL_SEC)
    return []


async def wbs_node(state: MeetingPipelineState) -> dict[str, Any]:
    db = _session()
    try:
        wbs = await build_wbs_template(db, int(state["meeting_id"]))
        return {"wbs": wbs}
    except Exception as exc:
        logger.exception(
            "WBS generation failed in meeting pipeline: meeting_id=%s",
            state.get("meeting_id"),
        )
        return _append_error(state, f"WBS 생성 실패: {exc}")
    finally:
        db.close()


async def minutes_node(state: MeetingPipelineState) -> dict[str, Any]:
    db = _session()
    try:
        minute = await build_and_save_minutes(db, int(state["meeting_id"]))
        return {"minutes_id": int(minute.id)}
    except Exception as exc:
        logger.exception(
            "minutes generation failed in meeting pipeline: meeting_id=%s",
            state.get("meeting_id"),
        )
        return _append_error(state, f"회의록 생성 실패: {exc}")
    finally:
        db.close()


def _route_mode(state: MeetingPipelineState) -> str:
    return (
        "meeting_start" if state.get("mode") == "start" else "postprocess_diarization"
    )


def _build_graph():
    builder = StateGraph(MeetingPipelineState)
    builder.add_node("meeting_start", meeting_start_node)
    builder.add_node("realtime_diarization", realtime_diarization_node)
    builder.add_node("postprocess_diarization", postprocess_diarization_node)
    builder.add_node("wbs", wbs_node)
    builder.add_node("minutes", minutes_node)

    builder.add_conditional_edges(
        START,
        _route_mode,
        {
            "meeting_start": "meeting_start",
            "postprocess_diarization": "postprocess_diarization",
        },
    )
    builder.add_edge("meeting_start", "realtime_diarization")
    builder.add_edge("realtime_diarization", END)
    builder.add_edge("postprocess_diarization", "wbs")
    builder.add_edge("wbs", "minutes")
    builder.add_edge("minutes", END)
    return builder.compile()


meeting_pipeline_graph = _build_graph()


async def run_meeting_start_pipeline(
    workspace_id: int,
    meeting_id: int,
) -> MeetingPipelineState:
    return await meeting_pipeline_graph.ainvoke(
        {
            "workspace_id": workspace_id,
            "meeting_id": meeting_id,
            "mode": "start",
            "errors": [],
        }
    )


async def run_meeting_completion_pipeline(
    workspace_id: int,
    meeting_id: int,
) -> MeetingPipelineState:
    return await meeting_pipeline_graph.ainvoke(
        {
            "workspace_id": workspace_id,
            "meeting_id": meeting_id,
            "mode": "complete",
            "errors": [],
        }
    )


def _session() -> Session:
    from app.infra.database.session import SessionLocal

    return SessionLocal()


def _persist_action_items_from_summary(
    db: Session,
    meeting_id: int,
    workspace_id: int,
    summary: dict[str, Any],
) -> None:
    action_items = summary.get("action_items") if isinstance(summary, dict) else None
    if not action_items:
        return

    existing_contents = {
        content
        for (content,) in db.query(ActionItem.content)
        .filter(ActionItem.meeting_id == meeting_id)
        .all()
    }

    participants = (
        db.query(User)
        .join(MeetingParticipant, MeetingParticipant.user_id == User.id)
        .filter(MeetingParticipant.meeting_id == meeting_id)
        .all()
    )
    if not participants:
        participants = db.query(User).filter(User.workspace_id == workspace_id).all()

    user_by_name = {user.name.strip(): user for user in participants if user.name}

    for raw in action_items:
        if not isinstance(raw, dict):
            content = str(raw).strip()
            assignee_name = ""
            deadline = None
            urgency = "normal"
            priority = "medium"
        else:
            content = str(raw.get("content") or "").strip()
            assignee_name = str(raw.get("assignee") or "").strip()
            deadline = raw.get("deadline")
            urgency = str(raw.get("urgency") or "normal")
            priority = _normalize_priority(str(raw.get("priority") or "medium"))

        if not content or content in existing_contents:
            continue

        assignee = user_by_name.get(assignee_name)
        db.add(
            ActionItem(
                meeting_id=meeting_id,
                content=content,
                assignee_id=int(assignee.id) if assignee else None,
                due_date=_parse_date(deadline),
                status=ActionStatus.pending,
                detected_at=now_kst().replace(tzinfo=None),
                priority=Priority(priority),
                urgency=urgency[:20],
            )
        )
        existing_contents.add(content)

    db.commit()


def _normalize_priority(value: str) -> str:
    value = value.lower()
    if value in {"high", "critical", "medium", "low"}:
        return value
    if value == "normal":
        return "medium"
    return "medium"


def _parse_date(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text or text.lower() in {"none", "null", "없음"}:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None
