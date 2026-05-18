# app/domains/intelligence/router.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.domains.intelligence.schemas import (
    ContentUpdateRequest,
    ContentUpdateResponse,
    MeetingStatusResponse,
    SpeakerReassignRequest,
    SpeakerReassignResponse,
    UtterancesResponse,
)
from app.domains.intelligence.service import (
    edit_utterance_content,
    fetch_meeting_utterances,
    get_meeting_status,
    update_speaker,
)

router = APIRouter()


@router.get(
    "/meetings/{meeting_id}/status",
    response_model=MeetingStatusResponse,
    summary="회의 상태 조회",
)
def get_meeting_status_endpoint(
    meeting_id: int,
    db: Session = Depends(get_db),
):
    """
    MySQL meetings 테이블에서 해당 회의의 status를 조회합니다.
    WebSocket 연결 전 'done' 여부를 확인하는 데 사용합니다.
    """
    data = get_meeting_status(db, meeting_id)
    if data is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="회의를 찾을 수 없습니다.",
        )
    return MeetingStatusResponse(data=data)


@router.get(
    "/meetings/{meeting_id}/utterances",
    response_model=UtterancesResponse,
    summary="회의 전문 타임라인 조회",
)
async def get_meeting_utterances(meeting_id: str):
    """
    MongoDB utterances 컬렉션에서 meeting_id 기준으로
    발화 전체(전문 타임라인)를 반환합니다.
    """
    data = await fetch_meeting_utterances(meeting_id)
    if data is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="해당 회의의 발화 데이터를 찾을 수 없습니다.",
        )
    return UtterancesResponse(data=data)


@router.patch(
    "/meetings/{meeting_id}/utterances/speaker",
    response_model=SpeakerReassignResponse,
    summary="발화 화자 재지정",
)
async def reassign_utterance_speaker(
    meeting_id: str,
    body: SpeakerReassignRequest,
):
    """
    특정 화자 레이블로 저장된 모든 발화를
    지정한 사용자(new_speaker_id / new_speaker_label)로 일괄 변경합니다.
    """
    data = await update_speaker(
        meeting_id,
        body.old_speaker_label,
        body.new_speaker_id,
        body.new_speaker_label,
        seq=body.seq,
        apply_all=body.apply_all,
    )
    if data.updated_count == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="해당 화자 레이블을 가진 발화를 찾을 수 없습니다.",
        )
    return SpeakerReassignResponse(data=data)


@router.patch(
    "/meetings/{meeting_id}/utterances/{seq}/content",
    response_model=ContentUpdateResponse,
    summary="발화 텍스트 수정",
)
async def update_utterance_content_endpoint(
    meeting_id: str,
    seq: int,
    body: ContentUpdateRequest,
):
    """특정 seq 번호의 발화 텍스트를 수정합니다."""
    data = await edit_utterance_content(meeting_id, seq, body.content)
    if not data.updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="해당 seq의 발화를 찾을 수 없습니다.",
        )
    return ContentUpdateResponse(data=data)
