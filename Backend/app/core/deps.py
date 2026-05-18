# app/core/deps.py
"""
앱 전역 FastAPI 의존성 (현재 사용자 식별 등).

워크스페이스 단위 인가(require_workspace_admin 등)는
app.domains.workspace.deps 를 사용합니다.
"""

from fastapi import Header, HTTPException, status
from jose import JWTError

from app.core.security import decode_token


def get_current_user_id(authorization: str | None = Header(default=None)) -> int:
    """Authorization Bearer access token에서 현재 사용자 ID를 읽습니다."""
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

    return user_id
