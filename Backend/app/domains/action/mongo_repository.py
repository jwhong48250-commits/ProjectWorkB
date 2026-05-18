# app/domains/action/mongo_repository.py
from pymongo import MongoClient
from app.core.config import settings

mongo_db = MongoClient(settings.MONGODB_URL)['meeting_assistant']


def get_meeting_summary(meeting_id: int) -> dict | None:
    doc = mongo_db['meeting_summaries'].find_one({"meeting_id": meeting_id})
    if not doc:
        return None
    return doc.get('summary') or None


def get_meeting_utterances(meeting_id: int) -> list[dict]:
    """utterances 컬렉션에서 발화 목록을 반환합니다. 없으면 빈 리스트."""
    doc = mongo_db['utterances'].find_one(
        {"$or": [{"meeting_id": meeting_id}, {"meeting_id": str(meeting_id)}]},
        {"_id": 0, "utterances": 1},
    )
    return doc.get("utterances", []) if doc else []


async def get_or_build_meeting_summary(meeting_id: int, workspace_id: int) -> dict | None:
    """
    meeting_summaries에서 요약을 조회하고, 없으면 knowledge quick_report를 실행해 생성 시도 후 재조회합니다.
    """
    summary = get_meeting_summary(meeting_id)
    if summary:
        return summary

    try:
        from app.domains.knowledge.agent_utils import quick_report_node  # noqa: PLC0415

        state = {
            "meeting_id": meeting_id,
            "workspace_id": workspace_id,
            "past_meeting_ids": None,
            "user_question": "",
            "function_type": "",
            "chat_response": "",
        }
        await quick_report_node(state)
    except Exception:
        # quick_report 실패 시에도 기존 폴백(utterances/meeting_minutes) 경로로 진행한다.
        pass

    return get_meeting_summary(meeting_id)