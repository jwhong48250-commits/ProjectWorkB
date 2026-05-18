# app/domains/intelligence/repository.py
from motor.motor_asyncio import AsyncIOMotorClient
from app.core.config import settings

mongo_db = AsyncIOMotorClient(settings.MONGODB_URL)["meeting_assistant"]


def _meeting_id_query(meeting_id: str) -> list[dict]:
    """meeting_id가 문자열/정수 두 타입으로 저장될 수 있어 OR 조건을 만든다."""
    conditions: list[dict] = [{"meeting_id": meeting_id}]
    try:
        conditions.append({"meeting_id": int(meeting_id)})
    except (ValueError, TypeError):
        pass
    return conditions


async def save_utterances(meeting_id: str, doc: dict) -> None:
    """utterances 문서를 upsert합니다 (WAV 시뮬레이션·외부 STT 결과 저장용)."""
    col = mongo_db["utterances"]
    await col.update_one(
        {"$or": _meeting_id_query(meeting_id)},
        {"$set": doc},
        upsert=True,
    )


async def get_utterances_by_meeting_id(meeting_id: str) -> dict | None:
    """meeting_id로 utterances 문서 1건 조회 (MongoDB)."""
    return await mongo_db["utterances"].find_one(
        {"$or": _meeting_id_query(meeting_id)},
        {"_id": 0},
    )


async def reassign_speaker(
    meeting_id: str,
    old_speaker_label: str,
    new_speaker_id: int | None,
    new_speaker_label: str,
    seq: int | None = None,
    apply_all: bool = True,
) -> int:
    """
    apply_all=True  → old_speaker_label 과 일치하는 모든 발화 변경.
    apply_all=False → seq 와 일치하는 단일 발화만 변경.
    업데이트된 utterance 수를 반환한다.
    """
    col = mongo_db["utterances"]
    doc = await col.find_one({"$or": _meeting_id_query(meeting_id)})
    if not doc:
        return 0

    utterances: list[dict] = doc.get("utterances", [])
    updated_count = 0
    for u in utterances:
        if apply_all:
            if u.get("speaker_label") == old_speaker_label:
                u["speaker_id"] = new_speaker_id
                u["speaker_label"] = new_speaker_label
                updated_count += 1
        else:
            if u.get("seq") == seq:
                u["speaker_id"] = new_speaker_id
                u["speaker_label"] = new_speaker_label
                updated_count += 1
                break

    if updated_count == 0:
        return 0

    await col.update_one(
        {"$or": _meeting_id_query(meeting_id)},
        {"$set": {"utterances": utterances}},
    )
    return updated_count


async def update_utterance_content(
    meeting_id: str,
    seq: int,
    content: str,
) -> bool:
    """seq 와 일치하는 발화의 content 를 수정한다. 성공 여부 반환."""
    col = mongo_db["utterances"]
    doc = await col.find_one({"$or": _meeting_id_query(meeting_id)})
    if not doc:
        return False

    utterances: list[dict] = doc.get("utterances", [])
    updated = False
    for u in utterances:
        if u.get("seq") == seq:
            u["content"] = content
            updated = True
            break

    if not updated:
        return False

    await col.update_one(
        {"$or": _meeting_id_query(meeting_id)},
        {"$set": {"utterances": utterances}},
    )
    return True
