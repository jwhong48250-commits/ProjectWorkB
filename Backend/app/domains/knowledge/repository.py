# app\domains\knowledge\repository.py
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime
from sqlalchemy import text
from typing import Optional
import json

from app.core.config import settings
from app.infra.database.session import SessionLocal
from app.utils.time_utils import now_kst

mongo_db = AsyncIOMotorClient(settings.MONGODB_URL)["meeting_assistant"]


# -------------------------------------------------------------
# MongoDB
# -------------------------------------------------------------
async def save_chat_log(
    workspace_id: int,
    user_id: int,
    session_id: str,
    role: str,
    content: str,
    function_type: str,
    active_meeting_ids: list[int] | None = None,
) -> None:
    message: dict = {
        "role": role,
        "content": content,
        "function_type": function_type,
        "timestamp": now_kst(),
    }
    if active_meeting_ids:
        message["active_meeting_ids"] = active_meeting_ids
    await mongo_db["chatbot_logs"].update_one(
        {"session_id": session_id},
        {
            "$setOnInsert": {
                "workspace_id": workspace_id,
                "user_id": user_id,
                "session_id": session_id,
                "created_at": now_kst(),
            },
            "$push": {"messages": message},
        },
        upsert=True,
    )


# get_chat_sessions 신설
async def get_chat_sessions(workspace_id: int) -> list[dict]:
    cursor = (
        mongo_db["chatbot_logs"]
        .find(
            {"workspace_id": workspace_id},
            {
                "_id": 0,
                "session_id": 1,
                "created_at": 1,
                "title": 1,
                "messages": {"$slice": 1},
            },
        )
        .sort("created_at", -1)
    )
    docs = await cursor.to_list(length=None)

    return [
        {
            "session_id": doc["session_id"],
            "created_at": doc.get("created_at"),
            "title": doc.get("title") or None,
            "preview": (
                doc["messages"][0]["content"][:50] if doc.get("messages") else ""
            ),
        }
        for doc in docs
    ]


async def rename_chat_session(workspace_id: int, session_id: str, title: str) -> bool:
    result = await mongo_db["chatbot_logs"].update_one(
        {"workspace_id": workspace_id, "session_id": session_id},
        {"$set": {"title": title}},
    )
    return result.matched_count > 0


async def delete_chat_session(workspace_id: int, session_id: str) -> bool:
    result = await mongo_db["chatbot_logs"].delete_one(
        {"workspace_id": workspace_id, "session_id": session_id}
    )
    return result.deleted_count > 0


async def get_chat_history(workspace_id: int, session_id: str) -> list[dict]:
    doc = await mongo_db["chatbot_logs"].find_one(
        {"workspace_id": workspace_id, "session_id": session_id},
        {"_id": 0, "messages": 1},
    )
    return doc.get("messages", []) if doc else []


async def get_active_meeting_ids(workspace_id: int, session_id: str) -> list[int]:
    """세션의 가장 최근 assistant 메시지에서 active_meeting_ids 복원."""
    doc = await mongo_db["chatbot_logs"].find_one(
        {"workspace_id": workspace_id, "session_id": session_id},
        {"_id": 0, "messages": 1},
    )
    if not doc:
        return []
    for msg in reversed(doc.get("messages", [])):
        if msg.get("role") == "assistant" and msg.get("active_meeting_ids"):
            return msg["active_meeting_ids"]
    return []


# -------------------------------------------------------------
# MySQL
# -------------------------------------------------------------
async def get_past_meetings_by_ids(meeting_ids: list[int]) -> list[dict]:
    """선택된 meeting_id 목록으로 회의 요약 조회."""
    if not meeting_ids:
        return []
    from app.domains.intelligence.models import MeetingMinute
    from app.domains.meeting.models import Meeting

    db = SessionLocal()
    try:
        rows = (
            db.query(MeetingMinute, Meeting.title, Meeting.scheduled_at)
            .join(Meeting, MeetingMinute.meeting_id == Meeting.id)
            .filter(MeetingMinute.meeting_id.in_(meeting_ids))
            .order_by(Meeting.scheduled_at.asc())
            .all()
        )
        result = []
        for minute, title, scheduled_at in rows:
            try:
                summary_dict = json.loads(minute.summary) if minute.summary else {}
            except Exception:
                summary_dict = {}
            key_points_text = "\n".join(
                f"- {p}" for p in summary_dict.get("key_points", [])
            )
            result.append(
                {
                    "meeting_id": minute.meeting_id,
                    "title": title,
                    "summary": key_points_text,
                    "created_at": scheduled_at,
                }
            )
        return result
    finally:
        db.close()


async def get_past_meeting_ids(
    workspace_id: int, user_id: Optional[int] = None
) -> list[dict]:
    """전체 완료 회의 ID. workspace_id 기준 완료된 회의 ID 목록 반환. user_id 있으면 참여 회의만."""
    from app.domains.meeting.models import Meeting, MeetingStatus, MeetingParticipant

    db = SessionLocal()
    try:
        q = db.query(Meeting.id).filter(
            Meeting.workspace_id == workspace_id,
            Meeting.status == MeetingStatus.done,
        )
        if user_id is not None:
            q = q.join(
                MeetingParticipant, Meeting.id == MeetingParticipant.meeting_id
            ).filter(MeetingParticipant.user_id == user_id)
        return [r.id for r in q.order_by(Meeting.scheduled_at.desc()).all()]

    finally:
        db.close()


async def get_past_meetings(
    workspace_id: int, user_id: Optional[int] = None
) -> list[dict]:
    """ChatFAB 선택기용. user_id 있으면 참여 회의만."""
    from app.domains.meeting.models import Meeting, MeetingParticipant, MeetingStatus

    db = SessionLocal()
    try:
        q = db.query(Meeting.id, Meeting.title, Meeting.started_at, Meeting.scheduled_at).filter(
            Meeting.workspace_id == workspace_id,
            Meeting.status == MeetingStatus.done,
        )
        if user_id is not None:
            q = q.join(
                MeetingParticipant, Meeting.id == MeetingParticipant.meeting_id
            ).filter(MeetingParticipant.user_id == user_id)
        rows = q.order_by(Meeting.scheduled_at.desc()).all()
        return [
            {"meeting_id": r.id, "title": r.title, "started_at": r.started_at or r.scheduled_at}
            for r in rows
        ]

    finally:
        db.close()


async def get_all_past_meetings_by_workspace(
    workspace_id: int, user_id: Optional[int] = None
) -> list[dict]:
    """_get_meetings_by_question 날짜 필터 fallback용. user_id 있으면 참여 회의만."""
    from app.domains.meeting.models import Meeting, MeetingStatus, MeetingParticipant
    from app.domains.intelligence.models import MeetingMinute

    db = SessionLocal()

    try:
        q = (
            db.query(
                MeetingMinute,
                Meeting.title,
                Meeting.scheduled_at,
                Meeting.started_at,
                Meeting.ended_at,
                Meeting.created_at,
            )
            .join(Meeting, MeetingMinute.meeting_id == Meeting.id)
            .filter(
                Meeting.workspace_id == workspace_id,
                Meeting.status == MeetingStatus.done,
            )
        )
        if user_id is not None:
            q = q.join(
                MeetingParticipant, Meeting.id == MeetingParticipant.meeting_id
            ).filter(MeetingParticipant.user_id == user_id)
        rows = q.order_by(Meeting.scheduled_at.asc()).all()
        result = []
        for minute, title, scheduled_at, started_at, ended_at, created_at in rows:
            try:
                summary_dict = json.loads(minute.summary) if minute.summary else {}
            except Exception:
                summary_dict = {}
            result.append(
                {
                    "meeting_id": minute.meeting_id,
                    "title": title,
                    "summary": "\n".join(
                        f"- {p}" for p in summary_dict.get("key_points", [])
                    ),
                    "scheduled_at": scheduled_at,
                    "started_at": started_at,
                    "ended_at": ended_at,
                    "created_at": created_at,
                }
            )
        return result
    finally:
        db.close()


# -------------------------------------------------------------
# MySQL
# -------------------------------------------------------------
def get_meeting_participants(meeting_id: int) -> list[str]:
    """
    meeting_participants JOIN users로 참석자 이름 목록 반환

    is_host=True인 참석자를 앞에 정렬해
      "김철수(호스트), 이민준, 박지수" 형태로 표시 가능하게 함
    """
    db = SessionLocal()
    try:
        rows = db.execute(
            text("""
                SELECT u.name, mp.is_host
                FROM meeting_participants mp
                JOIN users u ON mp.user_id = u.id
                WHERE mp.meeting_id = :meeting_id
                ORDER BY mp.is_host DESC, u.name ASC
            """),
            {"meeting_id": int(meeting_id)},
        ).fetchall()
        return [row.name for row in rows]
    finally:
        db.close()


def get_workspace_id(meeting_id: int) -> int:
    db = SessionLocal()
    try:
        row = db.execute(
            text("""
                SELECT workspace_id
                FROM meetings
                WHERE id = :meeting_id
            """),
            {"meeting_id": int(meeting_id)},
        ).fetchone()
        return row.workspace_id if row else None
    finally:
        db.close()


def get_meeting_report_data(meeting_id: int) -> dict:
    """meeting_id로 간이보고서 구성에 필요한 DB 데이터 조회.

    반환: {participants, decisions, action_items}
    """
    from app.domains.intelligence.models import Decision
    from app.domains.action.models import WbsTask, WbsEpic

    db = SessionLocal()
    try:
        # 참석자
        participants = get_meeting_participants(meeting_id)

        # 결정사항
        decisions = [
            row.content
            for row in db.query(Decision.content)
            .filter(Decision.meeting_id == meeting_id)
            .all()
        ]

        # WBS 태스크 (WbsEpic 경유)
        urgency_map = {"urgent": "urgent", "high": "urgent", "normal": "normal", "low": "low"}
        tasks = (
            db.query(WbsTask)
            .join(WbsEpic, WbsTask.epic_id == WbsEpic.id)
            .filter(WbsEpic.meeting_id == meeting_id)
            .all()
        )
        action_items = [
            {
                "assignee": t.assignee_name or "미정",
                "content": t.title,
                "deadline": t.due_date.strftime("%Y-%m-%d") if t.due_date else None,
                "urgency": urgency_map.get(t.urgency or "", "normal"),
            }
            for t in tasks
        ]

        return {"participants": participants, "decisions": decisions, "action_items": action_items}
    finally:
        db.close()


def get_user_name_by_id(user_id: int) -> str | None:
    db = SessionLocal()
    try:
        row = db.execute(
            text("SELECT name FROM users WHERE id = :user_id"), {"user_id": user_id}
        ).fetchone()
        return row.name if row else None
    finally:
        db.close()
