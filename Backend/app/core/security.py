# app\core\security.py
# jwt token이나 kakao access_token, refresh_token 발급 및 재생성 맡을거임

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings


BCRYPT_MAX_PASSWORD_BYTES = 72


def _encode_password(password: str) -> bytes:
    return password.encode("utf-8")


def hash_password(password: str) -> str:
    """
    평문 비밀번호를 해시 처리합니다.

    DB에는 원본 비밀번호를 그대로 저장하면 안 되므로, 회원가입 시 이 함수를 사용해서 해시된 문자열로 변환합니다.

    Args: password: 사용자가 입력한 원본 비밀번호입니다.

    Returns: bcrypt 방식으로 해시된 비밀번호 문자열을 반환합니다.
    """
    password_bytes = _encode_password(password)
    if len(password_bytes) > BCRYPT_MAX_PASSWORD_BYTES:
        raise ValueError("비밀번호는 UTF-8 기준 72바이트를 넘을 수 없습니다.")

    return bcrypt.hashpw(password_bytes, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    입력된 비밀번호와 저장된 해시 비밀번호가 일치하는지 검증합니다.

    로그인 시 사용자가 입력한 비밀번호를 그대로 비교하지 않고,
    해시 검증 함수를 통해 일치 여부를 확인합니다.

    Args:
        plain_password: 사용자가 로그인 시 입력한 원본 비밀번호입니다.
        hashed_password: DB 등에 저장된 해시 비밀번호입니다.

    Returns:
        비밀번호가 일치하면 True를, 그렇지 않으면 False를 반환합니다.
    """
    plain_password_bytes = _encode_password(plain_password)
    if len(plain_password_bytes) > BCRYPT_MAX_PASSWORD_BYTES:
        return False

    try:
        return bcrypt.checkpw(
            plain_password_bytes,
            hashed_password.encode("utf-8"),
        )
    except (TypeError, ValueError):
        return False


def create_access_token(
    subject: str,
    expires_delta: Optional[timedelta] = None,
    extra_claims: Optional[dict[str, Any]] = None,
) -> str:
    """
    access token을 생성합니다.

    subject에는 일반적으로 사용자 식별값을 넣습니다.
    expires_delta가 없으면 기본 30분 만료 시간을 사용합니다.

    Args:
        subject: 토큰의 주체가 되는 사용자 식별값입니다.
        expires_delta: 토큰 만료 시간을 직접 지정할 때 사용합니다.
        extra_claims: role 등의 추가 정보를 토큰에 넣고 싶을 때 사용합니다.

    Returns:
        JWT 문자열을 반환합니다.
    """
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=30)
    )

    payload: dict[str, Any] = {
        "sub": subject,
        "exp": expire,
        "type": "access",
    }

    if extra_claims:
        payload.update(extra_claims)

    return jwt.encode(
        payload,
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )


def create_refresh_token(
    subject: str,
    expires_delta: Optional[timedelta] = None,
) -> str:
    """
    refresh token을 생성합니다.

    refresh token은 access token이 만료되었을 때 새 access token을 발급받는 용도로 사용합니다.

    Args:
        subject: 토큰의 주체가 되는 사용자 식별값입니다.
        expires_delta: 토큰 만료 시간을 직접 지정할 때 사용합니다.

    Returns:
        JWT 문자열을 반환합니다.
    """
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(days=7)
    )

    payload = {
        "sub": subject,
        "exp": expire,
        "type": "refresh",
    }

    return jwt.encode(
        payload,
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )


def decode_token(token: str) -> dict[str, Any]:
    """
    JWT 문자열을 복호화하고 payload를 반환합니다.

    Args:
        token: 복호화할 JWT 문자열입니다.

    Returns:
        디코딩된 payload 딕셔너리를 반환합니다.

    Raises:
        JWTError: 토큰이 유효하지 않거나 만료된 경우 발생합니다.
    """
    return jwt.decode(
        token,
        settings.SECRET_KEY,
        algorithms=[settings.ALGORITHM],
    )

"""
- hash_password(): 회원가입할 때 비밀번호를 암호화된 문자열로 바꿉니다.
- verify_password(): 그인할 때 입력 비밀번호가 맞는지 확인합니다.
- create_access_token(): 로그인 성공 후 짧게 쓰는 토큰을 만듭니다.
- create_refresh_token(): access token 재발급용 긴 토큰을 만듭니다.
"""
