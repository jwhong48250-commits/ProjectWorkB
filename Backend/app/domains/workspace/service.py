"""
워크스페이스 도메인의 비즈니스 로직을 처리하는 파일입니다.

현재는 워크스페이스 조회 기능과 초대코드 검증 기능부터 구현하며,
이후 초대코드 발급/조회 기능과 워크스페이스 설정/멤버/연동/부서 기능이 추가되면
이 파일에 비즈니스 로직을 확장해 나갑니다.
"""

import secrets
from collections import defaultdict
from datetime import date, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.utils.time_utils import KST
from app.core.email import send_workspace_invite_email
from app.domains.action.models import ActionItem, ActionStatus, Report, WbsEpic, WbsTask
from app.domains.integration.models import Integration
from app.domains.intelligence.models import Decision, MeetingMinute, MinutePhoto, ReviewRequest
from app.domains.meeting.models import Meeting, MeetingParticipant, MeetingStatus, SpeakerProfile
from app.domains.user.models import User
from app.domains.user.repository import get_user_by_id
from app.domains.notification.models import NotificationType
from app.domains.notification import service as notification_service
from app.domains.workspace.repository import (
    create_invite_code,
    create_workspace_membership,
    count_workspace_admins,
    count_workspace_members_by_department_id,
    create_department,
    delete_department,
    get_department_by_id,
    get_departments_by_workspace_id,
    get_workspace_membership,
    get_workspace_member_rows,
    get_workspace_by_id,
    get_workspace_by_invite_code,
    get_invite_code_by_code,
    mark_invite_code_used,
    update_workspace_membership_department,
    update_workspace_membership_role,
    update_department,
    update_workspace,
    update_workspace_invite_code,
)

from app.domains.workspace.models import Department, DeviceSetting, InviteCode, MemberRole, Workspace, WorkspaceMember
from app.domains.workspace.schemas import (
    DashboardMeetingOut,
    DashboardMeetingsBundle,
    DashboardParticipantOut,
    DashboardResponse,
    DepartmentCreateRequest,
    DepartmentListResponse,
    DepartmentResponse,
    DepartmentUpdateRequest,
    InviteCodeIssueResponse,
    InviteCodeValidateResponse,
    PendingActionItemOut,
    WeeklySummaryOut,
    WorkspaceJoinResponse,
    WorkspaceListItem,
    WorkspaceListResponse,
    WorkspaceInviteEmailRequest,
    WorkspaceInviteEmailResponse,
    WorkspaceMemberDepartmentUpdateRequest,
    WorkspaceMemberDepartmentUpdateResponse,
    WorkspaceMemberListResponse,
    WorkspaceMemberProfileUpdateRequest,
    WorkspaceMemberProfileUpdateResponse,
    WorkspaceMemberRoleUpdateResponse,
    WorkspaceMemberResponse,
    WorkspaceResponse,
    WorkspaceUpdateRequest,
)
from app.utils.s3_utils import extract_s3_key_from_url, generate_presigned_url


def _resolve_workspace_logo_url(value: str | None) -> str | None:
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    # DB에는 key를 저장하고 응답에서만 presigned URL로 변환
    if text.startswith(("http://", "https://")):
        key = extract_s3_key_from_url(text)
        if key:
            return generate_presigned_url(key)
        return text
    return generate_presigned_url(text)


def _normalize_workspace_logo_key(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    if not text:
        return None
    if text.startswith(("http://", "https://")):
        return extract_s3_key_from_url(text) or text
    return text


def _resolve_profile_image_url(value: str | None) -> str | None:
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    if text.startswith(("http://", "https://")):
        key = extract_s3_key_from_url(text)
        if key:
            return generate_presigned_url(key)
        return text
    return generate_presigned_url(text)


def _generate_invite_code() -> str:
    """
    워크스페이스 초대코드를 생성합니다.

    현재는 대문자 기반 8자리 문자열을 사용합니다.
    워크스페이스 기능에서 초대코드를 재발급할 때 같은 규칙을 사용하기 위해
    service 계층 내부에 별도 함수로 둡니다.
    """
    return secrets.token_hex(4).upper()


def _generate_unique_invite_code(db: Session) -> str:
    while True:
        code = _generate_invite_code()
        if not get_workspace_by_invite_code(db, code) and not get_invite_code_by_code(db, code):
            return code


def _calculate_age(birth_date: date | None) -> int | None:
    if birth_date is None:
        return None
    today = date.today()
    return today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))


def get_workspace_service(db: Session, workspace_id: int) -> WorkspaceResponse:
    """
    워크스페이스 상세 조회를 처리하는 비즈니스 로직입니다.

    처리 순서는 다음과 같습니다.
    1. workspace_id를 기준으로 워크스페이스가 존재하는지 조회합니다.
    2. 워크스페이스가 존재하는지 확인하고, 존재하지 않으면 404 Not Found 예외를 발생시킵니다.
    3. 응답 스키마 형식으로 반환합니다.

    Args:
        db: 데이터베이스 세션입니다.
        workspace_id: 조회할 워크스페이스 ID입니다.

    Returns:
        조회된 워크스페이스 정보를 반환합니다.

    Raises:
        HTTPException: 워크스페이스가 존재하지 않을 경우 404 Not Found 예외를 발생시킵니다.
    """
    workspace = get_workspace_by_id(db, workspace_id)
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="워크스페이스를 찾을 수 없습니다.",
        )

    return WorkspaceResponse(
        workspace_id=workspace.id,
        name=workspace.name,
        invite_code=workspace.invite_code,
        industry=workspace.industry,
        default_language=workspace.default_language,
        summary_style=workspace.summary_style,
        logo_url=_resolve_workspace_logo_url(workspace.logo_url),
    )


def update_workspace_service(
    db: Session,
    workspace_id: int,
    payload: WorkspaceUpdateRequest,
) -> WorkspaceResponse:
    """
    워크스페이스 설정 수정을 처리합니다.
    """
    workspace = get_workspace_by_id(db, workspace_id)
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="워크스페이스를 찾을 수 없습니다.",
        )

    update_values = {
        "db": db,
        "workspace_id": workspace_id,
        "name": payload.name,
        "industry": payload.industry,
        "default_language": payload.default_language,
        "summary_style": payload.summary_style,
    }
    if "logo_url" in payload.model_fields_set:
        update_values["logo_url"] = _normalize_workspace_logo_key(payload.logo_url)

    updated_workspace = update_workspace(**update_values)

    if not updated_workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="워크스페이스를 찾을 수 없습니다.",
        )

    return WorkspaceResponse(
        workspace_id=updated_workspace.id,
        name=updated_workspace.name,
        invite_code=updated_workspace.invite_code,
        industry=updated_workspace.industry,
        default_language=updated_workspace.default_language,
        summary_style=updated_workspace.summary_style,
        logo_url=_resolve_workspace_logo_url(updated_workspace.logo_url),
    )


def delete_workspace_service(db: Session, workspace_id: int) -> None:
    """
    워크스페이스와 워크스페이스에 종속된 데이터를 삭제합니다.

    현재 모델에는 DB cascade 옵션이 없으므로 FK 제약을 피하기 위해
    하위 테이블부터 명시적으로 정리합니다.
    """
    workspace = get_workspace_by_id(db, workspace_id)
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="워크스페이스를 찾을 수 없습니다.",
        )

    meeting_ids = [
        meeting_id
        for (meeting_id,) in db.query(Meeting.id)
        .filter(Meeting.workspace_id == workspace_id)
        .all()
    ]
    minute_ids: list[int] = []
    epic_ids: list[int] = []

    if meeting_ids:
        minute_ids = [
            minute_id
            for (minute_id,) in db.query(MeetingMinute.id)
            .filter(MeetingMinute.meeting_id.in_(meeting_ids))
            .all()
        ]
        epic_ids = [
            epic_id
            for (epic_id,) in db.query(WbsEpic.id)
            .filter(WbsEpic.meeting_id.in_(meeting_ids))
            .all()
        ]

    if minute_ids:
        db.query(ReviewRequest).filter(ReviewRequest.minute_id.in_(minute_ids)).delete(synchronize_session=False)
        db.query(MinutePhoto).filter(MinutePhoto.minute_id.in_(minute_ids)).delete(synchronize_session=False)

    if epic_ids:
        db.query(WbsTask).filter(WbsTask.epic_id.in_(epic_ids)).delete(synchronize_session=False)

    if meeting_ids:
        db.query(MeetingMinute).filter(MeetingMinute.meeting_id.in_(meeting_ids)).delete(synchronize_session=False)
        db.query(Decision).filter(Decision.meeting_id.in_(meeting_ids)).delete(synchronize_session=False)
        db.query(WbsEpic).filter(WbsEpic.meeting_id.in_(meeting_ids)).delete(synchronize_session=False)
        db.query(ActionItem).filter(ActionItem.meeting_id.in_(meeting_ids)).delete(synchronize_session=False)
        db.query(Report).filter(Report.meeting_id.in_(meeting_ids)).delete(synchronize_session=False)
        db.query(MeetingParticipant).filter(MeetingParticipant.meeting_id.in_(meeting_ids)).delete(synchronize_session=False)
        db.query(Meeting).filter(Meeting.id.in_(meeting_ids)).delete(synchronize_session=False)

    db.query(SpeakerProfile).filter(SpeakerProfile.workspace_id == workspace_id).delete(synchronize_session=False)
    db.query(Integration).filter(Integration.workspace_id == workspace_id).delete(synchronize_session=False)
    db.query(InviteCode).filter(InviteCode.workspace_id == workspace_id).delete(synchronize_session=False)
    db.query(DeviceSetting).filter(DeviceSetting.workspace_id == workspace_id).delete(synchronize_session=False)
    db.query(WorkspaceMember).filter(WorkspaceMember.workspace_id == workspace_id).delete(synchronize_session=False)

    (
        db.query(User)
        .filter(User.workspace_id == workspace_id)
        .update(
            {
                User.is_active: False,
                User.workspace_id: None,
                User.department_id: None,
            },
            synchronize_session=False,
        )
    )

    db.query(Department).filter(Department.workspace_id == workspace_id).delete(synchronize_session=False)
    db.delete(workspace)
    db.commit()


def validate_invite_code_service(
    db: Session,
    invite_code: str,
) -> InviteCodeValidateResponse:
    """
    초대코드 유효성 검증을 처리합니다.

    처리 순서는 다음과 같습니다.
    1. invite_code 기준으로 워크스페이스를 조회합니다.
    2. 코드가 유효한지 확인합니다.
    3. 유효하면 워크스페이스 정보를 포함해 반환합니다.

    Args:
        db: 데이터베이스 세션입니다.
        invite_code: 검증할 초대코드입니다.

    Returns:
        초대코드 검증 결과와 연결된 워크스페이스 정보를 반환합니다.

    Raises:
        HTTPException: 초대코드가 유효하지 않을 경우 400 Bad Request 예외를 발생시킵니다.
    """
    workspace = get_workspace_by_invite_code(db, invite_code)

    if not workspace:
        invite = get_invite_code_by_code(db, invite_code)
        if invite and not invite.is_used and invite.expires_at >= datetime.utcnow():
            workspace = get_workspace_by_id(db, invite.workspace_id)

    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="유효하지 않은 초대코드입니다.",
        )

    return InviteCodeValidateResponse(
        valid=True,
        workspace_id=workspace.id,
        workspace_name=workspace.name,
    )


def join_workspace_by_invite_code_service(
    db: Session,
    user_id: int,
    invite_code: str,
) -> WorkspaceJoinResponse:
    """초대코드로 현재 사용자를 다른 워크스페이스에 멤버로 추가합니다."""
    normalized_code = invite_code.strip().upper()
    if not normalized_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="초대코드를 입력해주세요.",
        )

    user = get_user_by_id(db, user_id)
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="사용자를 찾을 수 없습니다.",
        )

    workspace = get_workspace_by_invite_code(db, normalized_code)
    invite: InviteCode | None = None
    role = MemberRole.member

    if not workspace:
        invite = get_invite_code_by_code(db, normalized_code)
        if invite and not invite.is_used and invite.expires_at >= datetime.utcnow():
            workspace = get_workspace_by_id(db, invite.workspace_id)
            role = invite.role or MemberRole.member

    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="유효하지 않은 초대코드입니다.",
        )

    existing = get_workspace_membership(db, workspace.id, user.id)
    if existing:
        existing_role = existing.role.value if hasattr(existing.role, "value") else str(existing.role)
        return WorkspaceJoinResponse(
            workspace_id=workspace.id,
            workspace_name=workspace.name,
            role=existing_role,
            message="이미 참여 중인 워크스페이스입니다.",
        )

    membership = create_workspace_membership(db, workspace.id, user.id, role)
    if invite:
        mark_invite_code_used(db, invite, user.id)

    joined_role = membership.role.value if hasattr(membership.role, "value") else str(membership.role)
    return WorkspaceJoinResponse(
        workspace_id=workspace.id,
        workspace_name=workspace.name,
        role=joined_role,
        message=f"{workspace.name} 워크스페이스에 참여했습니다.",
    )


def get_workspace_members_service(
    db: Session,
    workspace_id: int,
    department_id: int | None = None,
) -> WorkspaceMemberListResponse:
    """
    워크스페이스 소속 멤버 목록 조회를 처리합니다.

    처리 순서는 다음과 같습니다.
    1. workspace_id 기준으로 워크스페이스가 존재하는지 확인합니다.
    2. 해당 워크스페이스 소속 사용자 목록을 조회합니다.
    3. 응답 스키마 형식으로 변환하여 반환합니다.

    Args:
        db: 데이터베이스 세션입니다.
        workspace_id: 조회할 워크스페이스 ID입니다.

    Returns:
        해당 워크스페이스 소속 멤버 목록을 반환합니다.

    Raises:
        HTTPException: 워크스페이스가 존재하지 않을 경우 404 에러를 발생시킵니다.
    """
    workspace = get_workspace_by_id(db, workspace_id)
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="워크스페이스를 찾을 수 없습니다.",
        )

    # 부서 필터가 전달된 경우, 해당 부서가 같은 워크스페이스 소속인지 먼저 검증합니다.
    # 잘못된 department_id를 넣고도 조용히 빈 목록이 내려가는 상황을 막기 위한 처리입니다.
    if department_id is not None:
        department = get_department_by_id(db, workspace_id, department_id)
        if not department:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="부서를 찾을 수 없습니다.",
            )

    member_rows = get_workspace_member_rows(db, workspace_id, department_id)
    departments = get_departments_by_workspace_id(db, workspace_id)

    # 사용자 응답에 부서 이름을 함께 넣기 위해 부서 ID -> 이름 매핑을 만듭니다.
    department_name_map = {
        department.id: department.name
        for department in departments
    }

    return WorkspaceMemberListResponse(
        members=[
            WorkspaceMemberResponse(
                user_id=user.id,
                name=user.name,
                email=user.email,
                role=membership.role.value if hasattr(membership.role, "value") else str(membership.role),
                department_id=membership.department_id,
                department=department_name_map.get(membership.department_id),
                birth_date=user.birth_date,
                age=_calculate_age(user.birth_date),
                gender=user.gender,
                profile_image_url=_resolve_profile_image_url(user.profile_image_url),
            )
            for membership, user in member_rows
        ]
    )


def update_workspace_member_role_service(
    db: Session,
    workspace_id: int,
    user_id: int,
    role: str,
) -> WorkspaceMemberRoleUpdateResponse:
    """
    워크스페이스 소속 멤버의 역할 변경을 처리합니다.

    처리 순서는 다음과 같습니다.
    1. workspace_id 기준으로 워크스페이스가 존재하는지 확인합니다.
    2. user_id 기준으로 사용자가 존재하는지 확인합니다.
    3. 해당 사용자가 요청한 워크스페이스 소속인지 확인합니다.
    4. 역할을 변경하고 저장한 뒤 응답 형식으로 반환합니다.

    Args:
        db: 데이터베이스 세션입니다.
        workspace_id: 사용자가 속한 워크스페이스 ID입니다.
        user_id: 역할을 변경할 사용자 ID입니다.
        role: 새로 저장할 역할 문자열입니다.

    Returns:
        역할이 변경된 사용자 정보를 반환합니다.

    Raises:
        HTTPException: 워크스페이스나 사용자가 존재하지 않거나, 사용자가 해당 워크스페이스 소속이 아닐 경우 예외를 발생시킵니다.
    """
    workspace = get_workspace_by_id(db, workspace_id)
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="워크스페이스를 찾을 수 없습니다.",
        )

    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="사용자를 찾을 수 없습니다.",
        )

    membership = get_workspace_membership(db, workspace_id, user_id)
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="해당 워크스페이스 소속 사용자가 아닙니다.",
        )

    prev_role = str(membership.role.value if hasattr(membership.role, "value") else membership.role)
    next_role = role.value if hasattr(role, "value") else str(role)

    if prev_role == MemberRole.admin.value and next_role != MemberRole.admin.value:
        if count_workspace_admins(db, workspace_id) <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="워크스페이스에는 최소 1명의 관리자가 필요합니다.",
            )

    updated_membership = update_workspace_membership_role(db, workspace_id, user_id, MemberRole(next_role))
    if not updated_membership:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="워크스페이스 멤버를 찾을 수 없습니다.",
        )

    updated_role = (
        updated_membership.role.value
        if hasattr(updated_membership.role, "value")
        else str(updated_membership.role)
    )

    # 알림: 권한 변경 (본인에게)
    try:
        if updated_role != prev_role:
            notification_service.create_notification(
                db,
                workspace_id=workspace_id,
                user_id=int(user.id),
                type_=NotificationType.role_changed,
                title="권한 변경",
                body=f"워크스페이스 내 내 역할이 변경되었습니다. ({prev_role} → {updated_role})",
                link="/settings/profile",
                dedupe_key=f"role_changed:{user.id}:{prev_role}->{updated_role}",
            )
    except Exception:
        pass

    return WorkspaceMemberRoleUpdateResponse(
        user_id=user.id,
        role=updated_role,
    )

def update_workspace_member_department_service(
    db: Session,
    workspace_id: int,
    user_id: int,
    payload: WorkspaceMemberDepartmentUpdateRequest,
) -> WorkspaceMemberDepartmentUpdateResponse:
    """
    워크스페이스 소속 멤버의 부서를 변경합니다.

    처리 순서는 다음과 같습니다.
    1. workspace_id 기준으로 워크스페이스가 존재하는지 확인합니다.
    2. user_id 기준으로 사용자가 존재하는지 확인합니다.
    3. 해당 사용자가 요청한 워크스페이스 소속인지 확인합니다.
    4. department_id가 전달된 경우, 해당 부서가 같은 워크스페이스 소속인지 확인합니다.
    5. 사용자 department_id를 갱신하고 응답 형식으로 반환합니다.

    Args:
        db: 데이터베이스 세션입니다.
        workspace_id: 사용자가 속한 워크스페이스 ID입니다.
        user_id: 부서를 변경할 사용자 ID입니다.
        payload: 새 부서 ID 요청 데이터입니다.

    Returns:
        부서가 변경된 사용자 정보를 반환합니다.

    Raises:
        HTTPException: 워크스페이스, 사용자, 부서가 유효하지 않을 경우 예외를 발생시킵니다.
    """
    workspace = get_workspace_by_id(db, workspace_id)
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="워크스페이스를 찾을 수 없습니다.",
        )

    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="사용자를 찾을 수 없습니다.",
        )

    membership = get_workspace_membership(db, workspace_id, user_id)
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="해당 워크스페이스 소속 사용자가 아닙니다.",
        )

    department_name = None

    # department_id가 None이면 부서 해제로 처리합니다.
    if payload.department_id is not None:
        department = get_department_by_id(db, workspace_id, payload.department_id)
        if not department:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="부서를 찾을 수 없습니다.",
            )
        department_name = department.name

    updated_membership = update_workspace_membership_department(
        db=db,
        workspace_id=workspace_id,
        user_id=user_id,
        department_id=payload.department_id,
    )
    if not updated_membership:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="워크스페이스 멤버를 찾을 수 없습니다.",
        )

    return WorkspaceMemberDepartmentUpdateResponse(
        user_id=user.id,
        department_id=updated_membership.department_id,
        department=department_name,
    )


def update_workspace_member_profile_service(
    db: Session,
    workspace_id: int,
    user_id: int,
    payload: WorkspaceMemberProfileUpdateRequest,
) -> WorkspaceMemberProfileUpdateResponse:
    workspace = get_workspace_by_id(db, workspace_id)
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="워크스페이스를 찾을 수 없습니다.",
        )

    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="사용자를 찾을 수 없습니다.",
        )

    membership = get_workspace_membership(db, workspace_id, user_id)
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="해당 워크스페이스 소속 사용자가 아닙니다.",
        )

    user.birth_date = payload.birth_date
    user.gender = payload.gender.value if payload.gender else None
    db.commit()
    db.refresh(user)

    return WorkspaceMemberProfileUpdateResponse(
        user_id=user.id,
        birth_date=user.birth_date,
        age=_calculate_age(user.birth_date),
        gender=user.gender,
    )


def issue_workspace_invite_code_service(
    db: Session,
    workspace_id: int,
) -> InviteCodeIssueResponse:
    """
    워크스페이스 초대코드 발급(재발급)을 처리합니다.

    처리 순서는 다음과 같습니다.
    1. workspace_id 기준으로 워크스페이스가 존재하는지 확인합니다.
    2. 새 초대코드를 생성합니다.
    3. 워크스페이스의 기본 초대코드를 새 값으로 갱신합니다.
    4. 갱신 결과를 응답 형식으로 반환합니다.

    Args:
        db: 데이터베이스 세션입니다.
        workspace_id: 초대코드를 발급할 워크스페이스 ID입니다.

    Returns:
        새로 발급된 초대코드 정보를 반환합니다.

    Raises:
        HTTPException: 워크스페이스가 존재하지 않을 경우 404 에러를 발생시킵니다.
    """
    workspace = get_workspace_by_id(db, workspace_id)
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="워크스페이스를 찾을 수 없습니다.",
        )

    new_invite_code = _generate_invite_code()

    # 현재 구조에서는 기본 초대코드 1개만 유지하므로,
    # 새 코드를 발급하면 기존 코드를 새 값으로 덮어씁니다.
    updated_workspace = update_workspace_invite_code(
        db=db,
        workspace_id=workspace_id,
        invite_code=new_invite_code,
    )

    if not updated_workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="워크스페이스를 찾을 수 없습니다.",
        )

    return InviteCodeIssueResponse(
        workspace_id=updated_workspace.id,
        invite_code=updated_workspace.invite_code,
    )


def send_workspace_invite_emails_service(
    db: Session,
    workspace_id: int,
    payload: WorkspaceInviteEmailRequest,
) -> WorkspaceInviteEmailResponse:
    workspace = get_workspace_by_id(db, workspace_id)
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="워크스페이스를 찾을 수 없습니다.",
        )
    role_labels = {
        "admin": "관리자",
        "member": "멤버",
        "viewer": "뷰어",
    }
    seen: set[str] = set()
    sent_count = 0
    failed_count = 0

    for invite in payload.invites:
        email = str(invite.email).strip().lower()
        if email in seen:
            continue
        seen.add(email)
        code = _generate_unique_invite_code(db)
        create_invite_code(
            db=db,
            workspace_id=workspace.id,
            code=code,
            role=MemberRole(invite.role.value),
            expires_at=datetime.utcnow() + timedelta(days=7),
        )

        sent = send_workspace_invite_email(
            to_email=email,
            workspace_name=workspace.name,
            invite_code=code,
            role_label=role_labels.get(invite.role.value, invite.role.value),
        )
        if sent:
            sent_count += 1
        else:
            failed_count += 1

    message = (
        f"초대 메일 {sent_count}건을 발송했습니다."
        if sent_count > 0
        else "초대 메일을 발송하지 못했습니다."
    )
    return WorkspaceInviteEmailResponse(
        sent_count=sent_count,
        failed_count=failed_count,
        message=message,
    )


def get_workspace_departments_service(
    db: Session,
    workspace_id: int,
) -> DepartmentListResponse:
    """
    워크스페이스별 부서 목록 조회를 처리합니다.

    먼저 워크스페이스 존재 여부를 확인한 뒤,
    해당 워크스페이스 소속 부서 목록을 반환합니다.
    """
    workspace = get_workspace_by_id(db, workspace_id)
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="워크스페이스를 찾을 수 없습니다.",
        )

    departments = get_departments_by_workspace_id(db, workspace_id)

    return DepartmentListResponse(
        departments=[
            DepartmentResponse(
                department_id=department.id,
                name=department.name,
                created_at=department.created_at,
                updated_at=department.updated_at,
            )
            for department in departments
        ]
    )


def create_workspace_department_service(
    db: Session,
    workspace_id: int,
    payload: DepartmentCreateRequest,
) -> DepartmentResponse:
    """
    워크스페이스에 새 부서를 생성합니다.
    """
    workspace = get_workspace_by_id(db, workspace_id)
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="워크스페이스를 찾을 수 없습니다.",
        )

    department = create_department(
        db=db,
        workspace_id=workspace_id,
        name=payload.name.strip(),
    )

    return DepartmentResponse(
        department_id=department.id,
        name=department.name,
        created_at=department.created_at,
        updated_at=department.updated_at,
    )


def update_workspace_department_service(
    db: Session,
    workspace_id: int,
    department_id: int,
    payload: DepartmentUpdateRequest,
) -> DepartmentResponse:
    """
    특정 부서 이름을 수정합니다.
    """
    workspace = get_workspace_by_id(db, workspace_id)
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="워크스페이스를 찾을 수 없습니다.",
        )

    department = get_department_by_id(db, workspace_id, department_id)
    if not department:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="부서를 찾을 수 없습니다.",
        )

    updated_department = update_department(
        db=db,
        workspace_id=workspace_id,
        department_id=department_id,
        name=payload.name.strip(),
    )

    if not updated_department:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="부서를 찾을 수 없습니다.",
        )

    return DepartmentResponse(
        department_id=updated_department.id,
        name=updated_department.name,
        created_at=updated_department.created_at,
        updated_at=updated_department.updated_at,
    )


def delete_workspace_department_service(
    db: Session,
    workspace_id: int,
    department_id: int,
) -> None:
    """
    특정 부서를 삭제합니다.

    현재 정책은 소속 사용자가 남아 있으면 삭제를 막고 409를 반환합니다.
    """
    workspace = get_workspace_by_id(db, workspace_id)
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="워크스페이스를 찾을 수 없습니다.",
        )

    department = get_department_by_id(db, workspace_id, department_id)
    if not department:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="부서를 찾을 수 없습니다.",
        )

    member_count = count_workspace_members_by_department_id(db, department_id)
    if member_count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="소속 사용자가 있는 부서는 삭제할 수 없습니다.",
        )

    deleted = delete_department(
        db=db,
        workspace_id=workspace_id,
        department_id=department_id,
    )
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="부서를 찾을 수 없습니다.",
        )


def list_my_workspaces_service(db: Session, user_id: int) -> WorkspaceListResponse:
    """현재 사용자가 속한 워크스페이스 목록."""
    rows = (
        db.query(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .filter(WorkspaceMember.user_id == user_id)
        .order_by(Workspace.id.asc())
        .all()
    )
    items = [
        WorkspaceListItem(
            id=int(ws.id),
            name=ws.name,
            role=str(role.value if hasattr(role, "value") else role),
            logo_url=_resolve_workspace_logo_url(ws.logo_url),
        )
        for ws, role in rows
    ]
    return WorkspaceListResponse(success=True, workspaces=items, message="OK")


def _dashboard_meeting_status_value(m: Meeting) -> str:
    s = m.status
    return s.value if hasattr(s, "value") else str(s)


def _dashboard_week_start_local(d: date) -> datetime:
    # 주 시작: 월요일 00:00 (로컬 naive datetime)
    # date.weekday(): Monday=0 ... Sunday=6
    monday = d - timedelta(days=d.weekday())
    return datetime.combine(monday, datetime.min.time())


class DashboardService:
    """워크스페이스 홈 대시보드 집계."""

    @staticmethod
    def get_dashboard(db: Session, workspace_id: int) -> DashboardResponse:
        ws = db.query(Workspace).filter(Workspace.id == workspace_id).one_or_none()
        if ws is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="워크스페이스를 찾을 수 없습니다.",
            )

        meetings = (
            db.query(Meeting).filter(Meeting.workspace_id == workspace_id).all()
        )
        m_ids = [int(m.id) for m in meetings]
        parts_by_mid: dict[int, list[DashboardParticipantOut]] = defaultdict(list)
        if m_ids:
            rows = (
                db.query(MeetingParticipant, User)
                .join(User, User.id == MeetingParticipant.user_id)
                .filter(MeetingParticipant.meeting_id.in_(m_ids))
                .all()
            )
            for mp, u in rows:
                parts_by_mid[int(mp.meeting_id)].append(
                    DashboardParticipantOut(user_id=int(u.id), name=str(u.name))
                )

        def to_kst_aware(dt: datetime | None) -> datetime | None:
            if dt is None:
                return None
            if dt.tzinfo is None:
                return dt.replace(tzinfo=KST)
            return dt.astimezone(KST)

        def to_out(m: Meeting) -> DashboardMeetingOut:
            return DashboardMeetingOut(
                id=int(m.id),
                title=str(m.title),
                status=_dashboard_meeting_status_value(m),
                scheduled_at=to_kst_aware(m.scheduled_at),
                started_at=to_kst_aware(m.started_at),
                ended_at=to_kst_aware(m.ended_at),
                meeting_type=m.meeting_type,
                room_name=getattr(m, "room_name", None),
                google_calendar_event_id=m.google_calendar_event_id,
                participants=parts_by_mid.get(int(m.id), []),
            )

        today = date.today()
        # "이번주" 기준: 로컬 기준 월요일 00:00 ~ 일요일 23:59:59 (inclusive)
        week_start_naive = _dashboard_week_start_local(today)
        week_end_naive = week_start_naive + timedelta(days=6, hours=23, minutes=59, seconds=59)

        def in_this_week(dt: datetime | None) -> bool:
            if dt is None:
                return False
            dt_cmp = dt.replace(tzinfo=None) if dt.tzinfo else dt
            return week_start_naive <= dt_cmp <= week_end_naive

        def meeting_in_this_week(m: Meeting, status_str: str) -> bool:
            """
            대시보드에는 "이번주에 해당하는 회의만" 노출한다.
            상태별로 기준 시간이 다르므로 기존 집계 로직과 동일한 규칙을 사용한다.
            """
            if status_str == MeetingStatus.scheduled.value:
                return in_this_week(m.scheduled_at)
            if status_str == MeetingStatus.in_progress.value:
                return in_this_week(m.started_at or m.scheduled_at)
            if status_str == MeetingStatus.done.value:
                return in_this_week(m.ended_at or m.started_at or m.scheduled_at)
            return False

        in_progress: list[DashboardMeetingOut] = []
        scheduled: list[DashboardMeetingOut] = []
        done: list[DashboardMeetingOut] = []
        for m in meetings:
            st = _dashboard_meeting_status_value(m)
            if not meeting_in_this_week(m, st):
                continue
            if st == MeetingStatus.in_progress.value:
                in_progress.append(to_out(m))
            elif st == MeetingStatus.scheduled.value:
                scheduled.append(to_out(m))
            elif st == MeetingStatus.done.value:
                done.append(to_out(m))

        _min = datetime(1970, 1, 1)
        _max = datetime(9999, 12, 31, 23, 59, 59)
        in_progress.sort(
            key=lambda x: x.started_at or x.scheduled_at or _min,
            reverse=True,
        )
        scheduled.sort(key=lambda x: (x.scheduled_at is None, x.scheduled_at or _max))
        done.sort(
            key=lambda x: x.ended_at or x.started_at or _min,
            reverse=True,
        )

        # NOTE: 메인(Home) "회의 수"는 이번주 scheduled + in_progress + done을 모두 합산합니다.
        week_meeting_count = 0
        total_minutes = 0
        for m in meetings:
            st = _dashboard_meeting_status_value(m)

            # 이번주 회의 수: 상태별로 기준 시간이 다르므로 그에 맞게 판정
            if st == MeetingStatus.scheduled.value:
                if in_this_week(m.scheduled_at):
                    week_meeting_count += 1
            elif st == MeetingStatus.in_progress.value:
                if in_this_week(m.started_at or m.scheduled_at):
                    week_meeting_count += 1
            elif st == MeetingStatus.done.value:
                if in_this_week(m.ended_at or m.started_at or m.scheduled_at):
                    week_meeting_count += 1

                # 총 소요시간은 기존대로 "이번주 완료된 회의"만 계산
                if m.ended_at is None:
                    continue
                ended = m.ended_at
                ended_cmp = ended.replace(tzinfo=None) if ended.tzinfo else ended
                if ended_cmp < week_start_naive or ended_cmp > week_end_naive:
                    continue
                if m.started_at:
                    start = m.started_at
                    start_cmp = start.replace(tzinfo=None) if start.tzinfo else start
                    delta = ended_cmp - start_cmp
                    total_minutes += max(0, int(delta.total_seconds() // 60))

        weekly = WeeklySummaryOut(
            total_count=week_meeting_count,
            total_duration_min=total_minutes,
            action_items_total=0,
            action_items_done=0,
            summary_cards=[],
        )

        # 액션 아이템 완료율: 워크스페이스 전체(모든 회의)의 액션 아이템 기준 집계
        action_total = (
            db.query(ActionItem.id)
            .join(Meeting, Meeting.id == ActionItem.meeting_id)
            .filter(Meeting.workspace_id == workspace_id)
            .count()
        )
        action_done = (
            db.query(ActionItem.id)
            .join(Meeting, Meeting.id == ActionItem.meeting_id)
            .filter(
                Meeting.workspace_id == workspace_id,
                ActionItem.status == ActionStatus.done,
            )
            .count()
        )
        weekly.action_items_total = int(action_total)
        weekly.action_items_done = int(action_done)

        pending_rows = (
            db.query(ActionItem, Meeting.title)
            .join(Meeting, Meeting.id == ActionItem.meeting_id)
            .filter(
                Meeting.workspace_id == workspace_id,
                ActionItem.status == ActionStatus.pending,
            )
            .order_by(ActionItem.id.asc())
            .all()
        )
        pending_items = [
            PendingActionItemOut(
                id=int(ai.id),
                content=str(ai.content),
                due_date=ai.due_date,
                meeting_title=str(title),
            )
            for ai, title in pending_rows
        ]

        return DashboardResponse(
            meetings=DashboardMeetingsBundle(
                in_progress=in_progress,
                scheduled=scheduled,
                done=done,
            ),
            weekly_summary=weekly,
            pending_action_items=pending_items,
            next_meeting_suggestion=None,
        )
