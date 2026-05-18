"""
워크스페이스 도메인에서 사용하는 요청/응답 스키마를 정의하는 파일입니다.

현재는 워크스페이스 조회, 초대코드 검증/발급, 멤버 권한 관리,
부서 CRUD 기능에 필요한 요청/응답 스키마를 정의합니다.
"""

from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel, EmailStr, Field

from app.domains.user.schemas import Gender, UserRole


class WorkspaceListItem(BaseModel):
    """내 워크스페이스 목록 한 행."""

    id: int
    name: str
    role: str
    logo_url: str | None = None


class WorkspaceListResponse(BaseModel):
    """현재 사용자가 속한 워크스페이스 목록."""

    success: bool = True
    workspaces: list[WorkspaceListItem]
    message: str = "OK"


class DashboardParticipantOut(BaseModel):
    user_id: int
    name: str


class DashboardMeetingOut(BaseModel):
    id: int
    title: str
    status: str
    scheduled_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    meeting_type: Optional[str] = None
    room_name: Optional[str] = None
    google_calendar_event_id: Optional[str] = None
    participants: list[DashboardParticipantOut] = Field(default_factory=list)


class DashboardMeetingsBundle(BaseModel):
    in_progress: list[DashboardMeetingOut] = Field(default_factory=list)
    scheduled: list[DashboardMeetingOut] = Field(default_factory=list)
    done: list[DashboardMeetingOut] = Field(default_factory=list)


class WeeklySummaryOut(BaseModel):
    total_count: int = 0
    total_duration_min: int = 0
    action_items_total: int = 0
    action_items_done: int = 0
    summary_cards: list[Any] = Field(default_factory=list)


class PendingActionItemOut(BaseModel):
    id: int
    content: str
    due_date: Optional[date] = None
    meeting_title: str


class NextMeetingSuggestionOut(BaseModel):
    suggested_at: datetime
    reason: str


class DashboardResponse(BaseModel):
    meetings: DashboardMeetingsBundle
    weekly_summary: WeeklySummaryOut
    pending_action_items: list[PendingActionItemOut] = Field(default_factory=list)
    next_meeting_suggestion: Optional[NextMeetingSuggestionOut] = None


class WorkspaceResponse(BaseModel):
    """
    워크스페이스 조회 시 사용하는 응답 스키마입니다.
    """

    workspace_id: int
    name: str
    invite_code: str
    industry: str | None
    default_language: str | None
    summary_style: str | None
    logo_url: str | None


class WorkspaceUpdateRequest(BaseModel):
    """
    워크스페이스 설정 수정 요청 시 사용하는 스키마입니다.

    부분 수정이 가능하도록 모든 필드를 optional로 둡니다.
    """

    name: str | None = Field(default=None, min_length=1, max_length=100)
    industry: str | None = Field(default=None, max_length=100)
    default_language: str | None = Field(default=None, max_length=20)
    summary_style: str | None = Field(default=None, max_length=50)
    logo_url: str | None = Field(default=None, max_length=2048)


class InviteCodeValidateRequest(BaseModel):
    """
    초대코드 유효성 검증 요청 시 사용하는 스키마입니다.
    """

    invite_code: str


class InviteCodeValidateResponse(BaseModel):
    """
    초대코드 유효성 검증 응답 시 사용하는 스키마입니다.

    코드가 유효하면 어떤 워크스페이스의 코드인지 함께 반환합니다.
    """

    valid: bool
    workspace_id: int
    workspace_name: str


class WorkspaceJoinRequest(BaseModel):
    invite_code: str


class WorkspaceJoinResponse(BaseModel):
    success: bool = True
    workspace_id: int
    workspace_name: str
    role: UserRole
    message: str


class InviteCodeIssueResponse(BaseModel):
    """
    초대코드 발급(재발급) 응답 시 사용하는 스키마입니다.

    현재 구조에서는 워크스페이스별 기본 초대코드 1개만 유지하므로,
    발급 API는 새 초대코드를 생성해 반환합니다.
    """

    workspace_id: int
    invite_code: str


class WorkspaceInviteEmailItem(BaseModel):
    email: EmailStr
    role: UserRole = UserRole.MEMBER


class WorkspaceInviteEmailRequest(BaseModel):
    invites: list[WorkspaceInviteEmailItem] = Field(min_length=1, max_length=20)


class WorkspaceInviteEmailResponse(BaseModel):
    sent_count: int
    failed_count: int
    message: str


class WorkspaceMemberResponse(BaseModel):
    """
    워크스페이스 소속 멤버 1명을 응답할 때 사용하는 스키마입니다.
    """

    user_id: int
    name: str
    email: str
    role: UserRole
    department_id: int | None
    department: str | None
    birth_date: date | None = None
    age: int | None = None
    gender: Gender | None = None
    profile_image_url: str | None = None


class WorkspaceMemberListResponse(BaseModel):
    """
    워크스페이스 소속 멤버 목록 전체를 응답할 때 사용하는 스키마입니다.
    """

    members: list[WorkspaceMemberResponse]


class WorkspaceMemberRoleUpdateRequest(BaseModel):
    """
    워크스페이스 멤버 역할 변경 요청 시 사용하는 스키마입니다.
    """

    # 허용 가능한 역할은 admin, member, viewer 세 가지로 제한합니다.
    # 이 값을 벗어나면 FastAPI가 422 Validation Error를 반환합니다.
    role: UserRole


class WorkspaceMemberRoleUpdateResponse(BaseModel):
    """
    워크스페이스 멤버 역할 변경 응답 시 사용하는 스키마입니다.
    """

    user_id: int
    role: UserRole


class DepartmentResponse(BaseModel):
    """
    부서 1건을 응답할 때 사용하는 스키마입니다.
    """

    department_id: int
    name: str
    created_at: datetime
    updated_at: datetime


class DepartmentListResponse(BaseModel):
    """
    워크스페이스의 전체 부서 목록을 응답할 때 사용하는 스키마입니다.
    """

    departments: list[DepartmentResponse]


class DepartmentCreateRequest(BaseModel):
    """
    부서 생성 요청 시 사용하는 스키마입니다.
    """

    # 공백 문자열은 피하고 싶기 때문에 최소 길이를 1로 둡니다.
    name: str = Field(min_length=1, max_length=100)


class DepartmentUpdateRequest(BaseModel):
    """
    부서 수정 요청 시 사용하는 스키마입니다.
    """

    name: str = Field(min_length=1, max_length=100)


class WorkspaceMemberDepartmentUpdateRequest(BaseModel):
    """
    워크스페이스 멤버의 부서 변경 요청 시 사용하는 스키마입니다.

    department_id를 None으로 보내면 부서를 해제합니다.
    """

    department_id: int | None = None


class WorkspaceMemberDepartmentUpdateResponse(BaseModel):
    """
    워크스페이스 멤버의 부서 변경 응답 시 사용하는 스키마입니다.
    """

    user_id: int
    department_id: int | None
    department: str | None


class WorkspaceMemberProfileUpdateRequest(BaseModel):
    """
    워크스페이스 관리자가 멤버의 기본 인적 정보를 수정할 때 사용하는 스키마입니다.
    """

    birth_date: date | None = None
    gender: Gender | None = None


class WorkspaceMemberProfileUpdateResponse(BaseModel):
    user_id: int
    birth_date: date | None
    age: int | None
    gender: Gender | None
