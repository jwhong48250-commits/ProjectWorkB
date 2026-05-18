"""
워크스페이스 도메인의 API 엔드포인트를 정의하는 파일입니다.

현재는 워크스페이스 조회 기능과 초대코드 검증 기능부터 먼저 구현합니다.
이후 초대코드 발급, 초대코드 목록 조회, 설정 수정 기능을
이 router에 이어서 추가할 수 있습니다.
"""

from pathlib import Path

from fastapi import APIRouter, Depends, File, UploadFile, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user_id
from app.db.session import get_db
from app.domains.workspace.schemas import (
    DashboardResponse,
    DepartmentCreateRequest,
    DepartmentListResponse,
    DepartmentResponse,
    DepartmentUpdateRequest,
    InviteCodeIssueResponse,
    InviteCodeValidateRequest,
    InviteCodeValidateResponse,
    WorkspaceJoinRequest,
    WorkspaceJoinResponse,
    WorkspaceInviteEmailRequest,
    WorkspaceInviteEmailResponse,
    WorkspaceListResponse,
    WorkspaceMemberDepartmentUpdateRequest,
    WorkspaceMemberDepartmentUpdateResponse,
    WorkspaceMemberListResponse,
    WorkspaceMemberProfileUpdateRequest,
    WorkspaceMemberProfileUpdateResponse,
    WorkspaceMemberRoleUpdateRequest,
    WorkspaceMemberRoleUpdateResponse,
    WorkspaceResponse,
    WorkspaceUpdateRequest,
)
from app.domains.user.schemas import MessageResponse

from app.domains.workspace.service import (
    DashboardService,
    create_workspace_department_service,
    delete_workspace_service,
    delete_workspace_department_service,
    get_workspace_members_service,
    get_workspace_departments_service,
    get_workspace_service,
    issue_workspace_invite_code_service,
    join_workspace_by_invite_code_service,
    send_workspace_invite_emails_service,
    update_workspace_department_service,
    update_workspace_member_department_service,
    update_workspace_member_profile_service,
    update_workspace_member_role_service,
    update_workspace_service,
    validate_invite_code_service,
    list_my_workspaces_service,
)
from app.domains.workspace.deps import require_workspace_admin, require_workspace_member
from app.utils.local_images import save_local_image
from app.utils.s3_utils import generate_presigned_url


router = APIRouter()


@router.get("", response_model=WorkspaceListResponse, status_code=status.HTTP_200_OK)
async def list_my_workspaces(
    db: Session = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> WorkspaceListResponse:
    """현재 사용자가 속한 워크스페이스 목록."""
    return list_my_workspaces_service(db, current_user_id)


@router.post(
    "/{workspace_id}/logo-file",
    status_code=status.HTTP_200_OK,
)
async def upload_workspace_logo_file(
    workspace_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _admin=Depends(require_workspace_admin),
) -> dict[str, str]:
    logo_key = await save_local_image(
        file=file,
        directory=Path("teamlogo"),
        stem=f"workspace-{workspace_id}",
    )
    update_workspace_service(
        db,
        workspace_id,
        WorkspaceUpdateRequest(logo_url=logo_key),
    )
    return {"logo_url": generate_presigned_url(logo_key)}


@router.post("/join", response_model=WorkspaceJoinResponse, status_code=status.HTTP_200_OK)
async def join_workspace(
    payload: WorkspaceJoinRequest,
    db: Session = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> WorkspaceJoinResponse:
    """초대코드로 현재 계정을 워크스페이스에 추가합니다."""
    return join_workspace_by_invite_code_service(db, current_user_id, payload.invite_code)


@router.get(
    "/{workspace_id}/dashboard",
    response_model=DashboardResponse,
    status_code=status.HTTP_200_OK,
)
async def get_workspace_dashboard(
    workspace_id: int,
    db: Session = Depends(get_db),
) -> DashboardResponse:
    """워크스페이스 홈 대시보드 (상태별 회의, 주간 요약, 미결 액션)."""
    return DashboardService.get_dashboard(db, workspace_id)


@router.get(
    "/{workspace_id}",
    response_model=WorkspaceResponse,
    status_code=status.HTTP_200_OK,
)
async def get_workspace(
    workspace_id: int,
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
) -> WorkspaceResponse:
    """
    워크스페이스 정보를 조회하는 API 엔드포인트입니다.

    Args:
        workspace_id: 조회할 워크스페이스 ID입니다.
        db: 요청에 사용되는 데이터베이스 세션입니다.

    Returns:
        조회된 워크스페이스 정보를 반환합니다.
    """
    return get_workspace_service(db, workspace_id)


@router.patch(
    "/{workspace_id}",
    response_model=WorkspaceResponse,
    status_code=status.HTTP_200_OK,
)
async def patch_workspace(
    workspace_id: int,
    payload: WorkspaceUpdateRequest,
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
) -> WorkspaceResponse:
    """
    워크스페이스 기본 설정을 수정하는 API 엔드포인트입니다.
    """
    return update_workspace_service(db, workspace_id, payload)


@router.delete(
    "/{workspace_id}",
    response_model=MessageResponse,
    status_code=status.HTTP_200_OK,
)
async def delete_workspace(
    workspace_id: int,
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
) -> MessageResponse:
    """
    워크스페이스와 관련 데이터를 삭제합니다. 워크스페이스 관리자만 수행할 수 있습니다.
    """
    delete_workspace_service(db, workspace_id)
    return MessageResponse(message="워크스페이스가 삭제되었습니다.")


@router.post(
    "/invite-codes/validate",
    response_model=InviteCodeValidateResponse,
    status_code=status.HTTP_200_OK,
)
async def validate_invite_code(
    payload: InviteCodeValidateRequest,
    db: Session = Depends(get_db),
) -> InviteCodeValidateResponse:
    """
    초대코드 유효성 검증을 처리하는 API 엔드포인트입니다.

    Args:
        payload: 검증할 초대코드 요청 데이터입니다.
        db: 요청에 사용되는 데이터베이스 세션입니다.

    Returns:
        초대코드 검증 결과와 연결된 워크스페이스 정보를 반환합니다.
    """
    return validate_invite_code_service(db, payload.invite_code)


@router.post(
    "/{workspace_id}/invite-codes",
    response_model=InviteCodeIssueResponse,
    status_code=status.HTTP_200_OK,
)
async def issue_workspace_invite_code(
    workspace_id: int,
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
) -> InviteCodeIssueResponse:
    """
    특정 워크스페이스의 새 초대코드를 발급하는 API 엔드포인트입니다.

    현재 구조에서는 별도 초대코드 테이블 없이 workspaces 테이블의 invite_code를
    갱신하는 방식으로 재발급을 처리합니다.

    Args:
        workspace_id: 초대코드를 발급할 워크스페이스 ID입니다.
        db: 요청에 사용되는 데이터베이스 세션입니다.

    Returns:
        새로 발급된 초대코드 정보를 반환합니다.
    """
    return issue_workspace_invite_code_service(db, workspace_id)


@router.post(
    "/{workspace_id}/invites/email",
    response_model=WorkspaceInviteEmailResponse,
    status_code=status.HTTP_200_OK,
)
async def send_workspace_invite_emails(
    workspace_id: int,
    payload: WorkspaceInviteEmailRequest,
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
) -> WorkspaceInviteEmailResponse:
    """
    워크스페이스 초대코드를 이메일로 발송합니다.
    """
    return send_workspace_invite_emails_service(db, workspace_id, payload)


@router.get(
    "/{workspace_id}/members",
    response_model=WorkspaceMemberListResponse,
    status_code=status.HTTP_200_OK,
)
async def get_workspace_members(
    workspace_id: int,
    department_id: int | None = None,
    db: Session = Depends(get_db),
    _member: int = Depends(require_workspace_member),
) -> WorkspaceMemberListResponse:
    """
    특정 워크스페이스의 멤버 목록을 조회하는 API 엔드포인트입니다.

    홈·협업 UI 등에서 멤버를 표시할 수 있도록, 워크스페이스 소속 멤버라면
    누구나 조회할 수 있습니다. 역할/부서 변경은 별도 관리자 전용 API를 사용합니다.

    Args:
        workspace_id: 조회할 워크스페이스 ID입니다.
        department_id: 특정 부서 기준으로 필터링할 부서 ID입니다.
        db: 요청에 사용되는 데이터베이스 세션입니다.

    Returns:
        해당 워크스페이스 소속 멤버 목록을 반환합니다.
    """
    return get_workspace_members_service(db, workspace_id, department_id)


@router.patch(
    "/{workspace_id}/members/{user_id}/role",
    response_model=WorkspaceMemberRoleUpdateResponse,
    status_code=status.HTTP_200_OK,
)
async def update_workspace_member_role(
    workspace_id: int,
    user_id: int,
    payload: WorkspaceMemberRoleUpdateRequest,
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
) -> WorkspaceMemberRoleUpdateResponse:
    """
    특정 워크스페이스 소속 멤버의 역할을 변경하는 API 엔드포인트입니다.

    Args:
        workspace_id: 사용자가 속한 워크스페이스 ID입니다.
        user_id: 역할을 변경할 사용자 ID입니다.
        payload: 새 역할 요청 데이터입니다.
        db: 요청에 사용되는 데이터베이스 세션입니다.

    Returns:
        역할 변경 결과를 반환합니다.
    """
    return update_workspace_member_role_service(
        db=db,
        workspace_id=workspace_id,
        user_id=user_id,
        role=payload.role,
    )
    
@router.patch(
    "/{workspace_id}/members/{user_id}/department",
    response_model=WorkspaceMemberDepartmentUpdateResponse,
    status_code=status.HTTP_200_OK,
)
async def update_workspace_member_department(
    workspace_id: int,
    user_id: int,
    payload: WorkspaceMemberDepartmentUpdateRequest,
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
) -> WorkspaceMemberDepartmentUpdateResponse:
    """
    특정 워크스페이스 소속 멤버의 부서를 변경하는 API 엔드포인트입니다.

    department_id를 null로 보내면 기존 부서를 해제합니다.
    """
    return update_workspace_member_department_service(
        db=db,
        workspace_id=workspace_id,
        user_id=user_id,
        payload=payload,
    )


@router.patch(
    "/{workspace_id}/members/{user_id}/profile",
    response_model=WorkspaceMemberProfileUpdateResponse,
    status_code=status.HTTP_200_OK,
)
async def update_workspace_member_profile(
    workspace_id: int,
    user_id: int,
    payload: WorkspaceMemberProfileUpdateRequest,
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
) -> WorkspaceMemberProfileUpdateResponse:
    """
    특정 워크스페이스 소속 멤버의 생년월일과 성별을 변경합니다.
    """
    return update_workspace_member_profile_service(
        db=db,
        workspace_id=workspace_id,
        user_id=user_id,
        payload=payload,
    )



@router.get(
    "/{workspace_id}/departments",
    response_model=DepartmentListResponse,
    status_code=status.HTTP_200_OK,
)
async def get_workspace_departments(
    workspace_id: int,
    db: Session = Depends(get_db),
    _member: int = Depends(require_workspace_member),
) -> DepartmentListResponse:
    """
    특정 워크스페이스의 부서 목록을 조회하는 API 엔드포인트입니다.

    회의 참석자 선택 등 협업 UI를 위해 워크스페이스 소속 멤버(역할 무관)가 조회할 수 있습니다.
    생성·수정·삭제는 관리자 전용 엔드포인트를 사용합니다.
    """
    return get_workspace_departments_service(db, workspace_id)


@router.post(
    "/{workspace_id}/departments",
    response_model=DepartmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_workspace_department(
    workspace_id: int,
    payload: DepartmentCreateRequest,
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
) -> DepartmentResponse:
    """
    특정 워크스페이스에 새 부서를 생성하는 API 엔드포인트입니다.
    """
    return create_workspace_department_service(db, workspace_id, payload)


@router.patch(
    "/{workspace_id}/departments/{department_id}",
    response_model=DepartmentResponse,
    status_code=status.HTTP_200_OK,
)
async def update_workspace_department(
    workspace_id: int,
    department_id: int,
    payload: DepartmentUpdateRequest,
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
) -> DepartmentResponse:
    """
    특정 워크스페이스의 부서 이름을 수정하는 API 엔드포인트입니다.
    """
    return update_workspace_department_service(
        db=db,
        workspace_id=workspace_id,
        department_id=department_id,
        payload=payload,
    )


@router.delete(
    "/{workspace_id}/departments/{department_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_workspace_department(
    workspace_id: int,
    department_id: int,
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
) -> None:
    """
    특정 워크스페이스의 부서를 삭제하는 API 엔드포인트입니다.
    """
    delete_workspace_department_service(
        db=db,
        workspace_id=workspace_id,
        department_id=department_id,
    )
