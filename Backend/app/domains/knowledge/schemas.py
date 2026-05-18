# app\domains\knowledge\schemas.py
from pydantic import BaseModel
from datetime import datetime
from typing import Optional, Literal

class ChatbotMessageRequest(BaseModel):
    message: str
    meeting_id: Optional[int] = None # 회의 중일 때만 전달 - 없으면 이전 회의 검색만
    past_meeting_ids: Optional[list[int]] = None  # None = 전체, [1,2] = 선택된 회의만

class ChatbotMessageResponse(BaseModel):
    session_id: str
    function_type: str
    answer: str
    result: dict
    timestamp: datetime

class ChatbotHistoryMessage(BaseModel):
    role: str
    content: str
    function_type: str
    timestamp: datetime

class ChatbotHistoryResponse(BaseModel):
    messages: list[ChatbotHistoryMessage]

class ChatbotReportRequest(BaseModel):
    meeting_id: Optional[int] = None
    past_meeting_ids: Optional[list[int]] = None

# ── 요약 구조화 스키마 (신규) ─────────────────────────────────────────────
class MeetingOverview(BaseModel):
    """회의 기본 정보. STT 발화에서 목적/일시를 추출하지 못하면 None."""
    purpose: Optional[str] = None
    datetime_str: Optional[str] = None # 발화에서 언급된 회의 일시

class DiscussionItem(BaseModel):
    """
    주요 논의 사항 항목 1개.
    topic은 발화 맥락을 대표하는 주제명.
    """
    topic: str
    content: str

class Decision(BaseModel):
    """결정 사항 1개. rationale/opposing_opinion은 발화에 언급됐을 때만 채워짐."""
    decision: str
    citation: Optional[str] = None

class ActionItem(BaseModel):
    """
    액션 아이템 1개.

    priority 판단 기준 (high):
        - 결정 사항과 직접 연결된 액션
        - 다른 액션의 선행 조건
        - 발화에서 "반드시・꼭・최우선" 표현
        - 다수 인원에 영향

    urgency 판단 기준:
        - urgent: 기한 3일 이내 / 다음 회의 전 완료 필요 / "빨리・즉시・오늘까지" 발화
        - normal: 기한 4~7일 이내
        - low: 기한 7일 초과 또는 미언급
    """
    assignee: Optional[str] = None
    content: str
    deadline: Optional[str] = None
    priority: Literal["high", "normal"] = "normal"
    urgency: Literal["urgent", "normal", "low"] = "low"
    citation: Optional[str] = None # 근거 발화 원문 - hallucination 검증용, 사용자 미표시

class PendingItem(BaseModel):
    """미결 사항 1개. 이전 회의에서도 미결이었던 경우 연속 여부 표시."""
    content: str
    carried_over: bool = False # 이전 회의에서도 해결 안 된 사항이면 True
    first_mentioned_meeting: Optional[str] = None # 최초 언급된 회의 ID 또는 날짜

class PreviousMeetingFollowUp(BaseModel):
    """
    이전 회의 액션 아이템 완료 여부 추적.
    search_past_meetings()로 이전 회의 데이터를 조회해 채움.
    """
    previous_action: str # 이전 회의에서 지정된 액션 내용
    completed: bool = False # 이번 회의 발화에서 완료 확인 했는지

class HallucinationFlag(BaseModel):
    """
    요약 항목별 실제 발화 근거 검증 결과.
    요약 내용이 발화에서 확인되면 verified, 근거 없으면 needs_review.
    """
    item: str
    confidence: Literal["verified", "needs_review"] = "verified"

class SummaryResponse(BaseModel):
    """
    summary_node() 반환 타입.
    내용 없는 섹션은 [] 또는 None으로 명시 = "없음" 텍스트 금지.
    """
    attendees: list[str] = []
    overview: MeetingOverview
    discussion_items: list[DiscussionItem] = []
    decisions: list[Decision] = []
    action_items: list[ActionItem] = []
    pending_items: list[PendingItem] = []
    next_meeting: Optional[str] = None
    previous_followups: list[PreviousMeetingFollowUp] = [] # 이전 회의 follow-up 추적
    hallucination_flags: list[HallucinationFlag] = [] # 발화 근거 검증 결과

class DocumentUploadResponse(BaseModel):
    """문서 업로드 성공 응답."""
    doc_id: str         # "{workspace_id}_{filename}" — 재업로드 시 동일 ID로 덮어씀
    chunks: int         # 분할된 청크 수 (임베딩 저장 단위)
    title: str
    uploaded_at: datetime

class ChatbotReportResponse(BaseModel):
    summary: SummaryResponse
    generated_at: datetime

class PastMeetingItem(BaseModel):
    meeting_id: int
    title: str
    started_at: Optional[datetime] = None

class PastMeetingsResponse(BaseModel):
    meetings: list[PastMeetingItem]
    total: int