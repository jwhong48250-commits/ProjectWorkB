"""
워크스페이스 도메인 전용 FastAPI Depends (인가).

현재 사용자 식별(get_current_user_id)은 API 공통 deps에 두고,
워크스페이스 멤버십·역할 검사만 이 모듈에서 처리합니다.
"""

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user_id
from app.db.session import get_db
from app.domains.user.repository import get_user_by_id
from app.domains.workspace.models import MemberRole
from app.domains.workspace.repository import get_workspace_membership


def require_workspace_admin(
    workspace_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> int:
    """경로의 workspace_id에 대해 현재 사용자가 admin일 때만 통과합니다."""
    row = get_workspace_membership(db, workspace_id, current_user_id)
    if row is not None and row.role == MemberRole.admin:
        return current_user_id

    user = get_user_by_id(db, current_user_id)
    if user and user.workspace_id == workspace_id and user.role == MemberRole.admin.value:
        return current_user_id

    if row is None or row.role != MemberRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="워크스페이스 관리자만 수행할 수 있습니다.",
        )
    return current_user_id


def require_workspace_member(
    workspace_id: int,
    current_user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> int:
    """경로의 workspace_id에 대해 현재 사용자가 멤버(역할 무관)일 때만 통과합니다."""
    row = get_workspace_membership(db, workspace_id, current_user_id)
    if row is not None:
        return current_user_id

    user = get_user_by_id(db, current_user_id)
    if user and user.workspace_id == workspace_id:
        return current_user_id

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="워크스페이스 멤버만 수행할 수 있습니다.",
        )
    return current_user_id
