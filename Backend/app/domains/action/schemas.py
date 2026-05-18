# app\domains\action\schemas.py
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from datetime import date as date_type

# =================================================================
# 공통
# =================================================================
class ExportResponse(BaseModel):
    status:str = "processing"

# =================================================================
# 회의록
# =================================================================
class MinutesResponse(BaseModel):
    meeting_id: int
    content:    Optional[str] = None
    updated_at: datetime

class MinutesPatchRequest(BaseModel):
    content: str

class MinutesPdfPreviewRequest(BaseModel):
    field_values: Optional[dict] = None

class MinutesPdfPreviewResponse(BaseModel):
    preview_b64:   str
    preview_pages: List[str] = []
    field_coords:  dict = {}
    field_values:  dict = {}
    pdf_width:     float = 595.0
    pdf_height:    float = 842.0

# =================================================================
# 보고서
# =================================================================
class ReportResponse(BaseModel):
    id:             int
    format:         str
    title:          str
    thumbnail_url:  Optional[str] = None
    updated_at:     datetime

    class Config:
        from_attributes = True

class ReportGenerateRequest(BaseModel):
    format: str # markdown | excel | wbs | html

class ReportPatchRequest(BaseModel):
    content: str
    
# =================================================================
# slack
# =================================================================
class SlackExportRequest(BaseModel):
    channel_id: Optional[str] = None
    include_action_items: bool = True
    include_reports: bool = False

# =================================================================
# jira
# =================================================================
class JiraSyncItem(BaseModel):
    task_id: int
    jira_key: str
    field: str
    old: str
    new: str

class JiraSyncResponse(BaseModel):
    changed: List[JiraSyncItem]
    unchanged: int
    synced_at: str


# =================================================================
# google calendar
# =================================================================
class TimeSlot(BaseModel):
      start: str
      end: str

class NextMeetingSuggestResponse(BaseModel):
    slots: List[TimeSlot]

class NextMeetingSuggestRequest(BaseModel):
    duration_minutes: int = 60

class NextMeetingRegisterRequest(BaseModel):
    title: str
    scheduled_at: str
    participant_ids: List[int]
    attendee_emails: List[str] = []

class NextMeetingRegisterResponse(BaseModel):
    event_id: str

class NextMeetingUpdateRequest(BaseModel):
    title: str | None = None
    scheduled_at: str | None = None
    duration_minutes: int = 60
    attendee_emails: List[str] | None = None
    description: str | None = None

# =================================================================
# WBS
# =================================================================
class WbsTaskResponse(BaseModel):
    id:             int
    epic_id:        int
    title:          str
    content:        Optional[str] = None
    assignee_id:    Optional[int] = None
    assignee_name:  Optional[str] = None
    priority:       str
    urgency:        Optional[str] = None
    due_date:       Optional[date_type] = None
    progress:       int
    status:         str
    jira_issue_id:  Optional[str] = None
    order_index:    int = 0

    class Config:
        from_attributes = True

class WbsEpicResponse(BaseModel):
    id:          int
    title:       str
    order_index: int
    tasks:       List[WbsTaskResponse] = []

    class Config:
        from_attributes = True

class WbsPageResponse(BaseModel):
    epics: List[WbsEpicResponse]

class WbsEpicCreateRequest(BaseModel):
    title:       str
    order_index: Optional[int] = None

class WbsEpicPatchRequest(BaseModel):
    title:       Optional[str] = None
    order_index: Optional[int] = None

class WbsTaskCreateRequest(BaseModel):
    epic_id:     int
    title:       str
    content:     Optional[str] = None
    assignee_id: Optional[int] = None
    assignee_name: Optional[str] = None
    priority:    Optional[str] = "medium"
    urgency:     Optional[str] = None
    due_date:    Optional[date_type] = None
    order_index: Optional[int] = None

class WbsTaskPatchRequest(BaseModel):
    epic_id:     Optional[int] = None
    title:       Optional[str] = None
    content:     Optional[str] = None
    assignee_id: Optional[int] = None
    assignee_name: Optional[str] = None
    priority:    Optional[str] = None
    urgency:     Optional[str] = None
    due_date:    Optional[date_type] = None
    progress:    Optional[int] = None
    status:      Optional[str] = None
    order_index: Optional[int] = None

# ===============================================================
# WBS 이동 / 순서변경
# ===============================================================
class WbsMoveTaskRequest(BaseModel):
    target_epic_id: int
    order_index:    int = 0

class WbsReorderItem(BaseModel):
    id:         int
    order_index:int

class WbsReorderRequest(BaseModel):
    epics: Optional[List[WbsReorderItem]] = None
    tasks: Optional[List[WbsReorderItem]] = None

# ===============================================================
# JIRA 선택적 동기화 / 프리뷰
# ===============================================================
class JiraSelectiveSyncRequest(BaseModel):
    # None이면 전체 동기화
    epic_ids: Optional[List[int]] = None
    task_ids: Optional[List[int]] = None

class JiraPreviewTask(BaseModel):
    id:     int
    title:  str
    action: str  # "create" | "update"

class JiraPreviewEpic(BaseModel):
    id:     int
    title:  str
    action: str
    tasks:  List[JiraPreviewTask]

class JiraPreviewResponse(BaseModel):
    epics:        List[JiraPreviewEpic]
    epic_create:  int
    epic_update:  int
    task_create:  int
    task_update:  int
    total:        int

class JiraNotifyRequest(BaseModel):
    services: List[str]
    created: int = 0
    updated: int = 0
    
# ===============================================================
# 다중 export
# ===============================================================
class BatchExportRequest(BaseModel):
    services: List[str]
    slack_channel_id: Optional[str] = None
    include_action_items: bool = True
    include_reports: bool = False

class BatchExportServiceResult(BaseModel):
    status: str
    message: str
    error_code: Optional[str] = None

class BatchExportResponse(BaseModel):
    overall_status: str
    results: dict[str, BatchExportServiceResult]