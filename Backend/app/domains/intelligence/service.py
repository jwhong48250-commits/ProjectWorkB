# app/domains/intelligence/service.py
from sqlalchemy.orm import Session

from app.domains.intelligence.repository import get_utterances_by_meeting_id, reassign_speaker, update_utterance_content
from app.domains.intelligence.schemas import UtterancesData, UtteranceOut, SpeakerReassignData, ContentUpdateData, MeetingStatusData
from app.domains.meeting.models import Meeting, MeetingStatus


async def fetch_meeting_utterances(meeting_id: str) -> UtterancesData | None:
    """meeting_id에 해당하는 발화 목록을 MongoDB에서 조회해 반환."""
    doc = await get_utterances_by_meeting_id(meeting_id)
    if not doc:
        return None

    utterances = [
        UtteranceOut(
            seq=u.get("seq", idx + 1),
            speaker_id=u.get("speaker_id"),
            speaker_label=u.get("speaker_label", "알 수 없음"),
            timestamp=str(u.get("timestamp", "")),
            content=u.get("content", ""),
            start=float(u.get("start", 0)),
            end=float(u.get("end", 0)),
            confidence=u.get("confidence"),
        )
        for idx, u in enumerate(doc.get("utterances", []))
    ]

    meeting_start_time = doc.get("meeting_start_time")
    # motor returns datetime objects for $date fields
    if hasattr(meeting_start_time, "isoformat"):
        meeting_start_time = meeting_start_time

    return UtterancesData(
        meeting_id=str(doc["meeting_id"]),
        utterances=utterances,
        total_duration_sec=doc.get("total_duration_sec"),
        meeting_start_time=meeting_start_time,
    )


async def update_speaker(
    meeting_id: str,
    old_speaker_label: str,
    new_speaker_id: int | None,
    new_speaker_label: str,
    seq: int | None = None,
    apply_all: bool = True,
) -> SpeakerReassignData:
    updated_count = await reassign_speaker(
        meeting_id, old_speaker_label, new_speaker_id, new_speaker_label,
        seq=seq, apply_all=apply_all,
    )
    return SpeakerReassignData(updated_count=updated_count)


async def edit_utterance_content(
    meeting_id: str,
    seq: int,
    content: str,
) -> ContentUpdateData:
    updated = await update_utterance_content(meeting_id, seq, content)
    return ContentUpdateData(updated=updated)


def get_meeting_status(db: Session, meeting_id: int) -> MeetingStatusData | None:
    """MySQL에서 meeting_id에 해당하는 회의 status를 조회해 반환."""
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    if meeting is None:
        return None
    return MeetingStatusData(
        meeting_id=meeting.id,
        status=meeting.status.value,
        is_done=meeting.status == MeetingStatus.done,
    )
