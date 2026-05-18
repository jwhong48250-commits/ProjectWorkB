from fastapi import Depends, Header, HTTPException, status
from jose import JWTError
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db.session import get_db
from app.domains.user.models import User
from app.domains.user.repository import get_user_by_id
from app.domains.user.schemas import UserRole
from app.domains.workspace.models import MemberRole
from app.domains.workspace.repository import get_workspace_membership


def _get_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="인증 토큰이 필요합니다.",
        )

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer 토큰 형식이 올바르지 않습니다.",
        )

    return token


def require_workspace_admin(
    workspace_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    token = _get_bearer_token(authorization)

    try:
        payload = decode_token(token)
        user_id = int(payload.get("sub"))
    except (JWTError, TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 인증 토큰입니다.",
        )

    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="access token이 필요합니다.",
        )

    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="사용자를 찾을 수 없습니다.",
        )

    membership = get_workspace_membership(db, workspace_id, user.id)
    if membership and membership.role == MemberRole.admin:
        return user

    if not membership and user.role == UserRole.ADMIN.value and user.workspace_id == workspace_id:
        return user

    if membership is None or membership.role != MemberRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="워크스페이스 관리자 권한이 필요합니다.",
        )

    return user

def require_workspace_member(
    workspace_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    token = _get_bearer_token(authorization)

    try:
        payload = decode_token(token)
        user_id = int(payload.get("sub"))
    except (JWTError, TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 인증 토큰입니다.",
        )

    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="access token이 필요합니다.",
        )

    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="사용자를 찾을 수 없습니다.",
        )

    membership = get_workspace_membership(db, workspace_id, user.id)
    if membership or user.workspace_id == workspace_id:
        return user

    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="해당 워크스페이스 접근 권한이 없습니다.",
        )

    return user
