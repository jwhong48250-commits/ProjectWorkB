# app/domains/intelligence/schemas.py
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class UtteranceOut(BaseModel):
    seq: int
    speaker_id: Optional[int] = None
    speaker_label: str
    timestamp: str
    content: str
    start: float
    end: float
    confidence: Optional[float] = None


class UtterancesData(BaseModel):
    meeting_id: str
    utterances: list[UtteranceOut]
    total_duration_sec: Optional[int] = None
    meeting_start_time: Optional[datetime] = None


class UtterancesResponse(BaseModel):
    success: bool = True
    data: UtterancesData
    message: str = "OK"


class SpeakerReassignRequest(BaseModel):
    old_speaker_label: str = Field(..., description="변경 전 화자 레이블")
    new_speaker_id: Optional[int] = Field(None, description="새로 지정할 사용자 ID (직접 입력 시 null)")
    new_speaker_label: str = Field(..., description="새로 지정할 화자 이름")
    seq: Optional[int] = Field(None, description="단일 발화 변경 시 seq 번호")
    apply_all: bool = Field(True, description="True면 같은 speaker_label 전체 변경, False면 seq 하나만 변경")


class SpeakerReassignData(BaseModel):
    updated_count: int


class SpeakerReassignResponse(BaseModel):
    success: bool = True
    data: SpeakerReassignData
    message: str = "OK"


class ContentUpdateRequest(BaseModel):
    seq: int = Field(..., description="수정할 발화의 seq 번호")
    content: str = Field(..., description="수정할 발화 텍스트")


class ContentUpdateData(BaseModel):
    updated: bool


class ContentUpdateResponse(BaseModel):
    success: bool = True
    data: ContentUpdateData


class MeetingStatusData(BaseModel):
    meeting_id: int
    status: str
    is_done: bool


class MeetingStatusResponse(BaseModel):
    success: bool = True
    data: MeetingStatusData
    message: str = "OK"
    message: str = "OK"
