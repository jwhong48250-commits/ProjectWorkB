"""
사용자 도메인의 비즈니스 로직을 처리하는 파일입니다.

service 계층은 인증 기능의 전체 처리 흐름을 담당합니다.
즉, 요청을 직접 받지는 않지만,
회원가입과 로그인 시 어떤 순서로 검증하고 저장하고 응답할지 결정합니다.

현재 구현 범위는 다음과 같습니다.
- 관리자 회원가입
- 멤버 회원가입
- 로그인
- 비밀번호 재설정 요청
- 비밀번호 변경 요청

이 파일은 repository 계층을 호출하여 실제 DB 조회/저장을 수행하고,
security 계층을 호출하여 비밀번호 해시 및 토큰 발급을 처리합니다.
"""

import base64
import json
import secrets
from datetime import date, datetime, timedelta
from urllib.parse import urlencode

from fastapi import HTTPException, status
from jose import JWTError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.email import send_admin_signup_welcome_email, send_password_reset_email
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.domains.integration.repository import create_default_integrations
from app.domains.notification import service as notification_service
from app.domains.user.repository import (
    create_user,
    deactivate_user_account,
    get_user_device_setting,
    get_user_by_email,
    get_user_by_id,
    get_user_by_social_identity,
    update_user_social_identity,
    update_user_profile,
    update_user_profile_image,
    update_user_password,
    upsert_user_device_setting,
)
from app.domains.workspace.models import MemberRole
from app.domains.workspace.repository import (
    count_workspace_admins,
    create_workspace,
    create_workspace_membership,
    delete_workspace_membership,
    get_invite_code_by_code,
    get_workspace_membership,
    get_workspace_by_id,
    get_workspace_by_invite_code,
    mark_invite_code_used,
)
from app.domains.user.schemas import (
    AdminSignupRequest,
    AdminSignupResponse,
    DeviceSettingsRequest,
    DeviceSettingsResponse,
    LoginRequest,
    LogoutRequest,
    MemberSignupRequest,
    MessageResponse,
    OAuthUrlResponse,
    PasswordChangeRequest,
    PasswordResetConfirmRequest,
    PasswordResetRequest,
    RefreshTokenRequest,
    SocialSignupRequest,
    TokenResponse,
    UserProfileResponse,
    UserProfileUpdateRequest,
    UserProfileUpdateResponse,
    UserResponse,
    UserRole,
)
from app.domains.user.models import SocialProvider, User
from app.infra.clients.session_manager import ClientSessionManager
from app.utils.s3_utils import extract_s3_key_from_url, generate_presigned_url

_MEMBER_ROLE_LABEL_KO = {
    MemberRole.admin: "관리자",
    MemberRole.member: "멤버",
    MemberRole.viewer: "뷰어",
}


def _generate_invite_code() -> str:
    """
    워크스페이스 초대코드를 생성합니다.

    Returns:
        대문자 기반의 8자리 초대코드를 반환합니다.
    """
    return secrets.token_hex(4).upper()


def _encode_oauth_state(provider: str, role: str) -> str:
    return base64.urlsafe_b64encode(
        json.dumps({"provider": provider, "role": role}).encode("utf-8"),
    ).decode("utf-8")


def _decode_oauth_state(state: str) -> dict[str, str]:
    try:
        data = json.loads(base64.urlsafe_b64decode(state.encode("utf-8")).decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="유효하지 않은 OAuth state입니다.",
        ) from None

    provider = data.get("provider")
    role = data.get("role")
    if provider not in {SocialProvider.google.value, SocialProvider.kakao.value}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="지원하지 않는 소셜 로그인입니다.")
    if role not in {UserRole.ADMIN.value, UserRole.MEMBER.value}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="지원하지 않는 사용자 역할입니다.")
    return {"provider": provider, "role": role}


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


def _access_token_claims(user: User) -> dict[str, str | int | None]:
    """
    프론트가 로그인 직후 localStorage에 사용자 정보를 채울 수 있도록
    access token에 필요한 최소 프로필 정보를 함께 담습니다.
    """
    return {
        "role": user.role,
        "email": user.email,
        "name": user.name,
        "workspace_id": user.workspace_id,
        "birth_date": user.birth_date.isoformat() if user.birth_date else None,
        "age": _calculate_age(user.birth_date),
        "phone_number": user.phone_number,
        "gender": user.gender,
        "profile_image_url": _resolve_profile_image_url(user.profile_image_url),
    }


def _token_response_for_user(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(
            subject=str(user.id),
            extra_claims=_access_token_claims(user),
        ),
        refresh_token=create_refresh_token(subject=str(user.id)),
    )


class PendingSocialSignup(Exception):
    def __init__(self, signup_token: str, email: str, name: str):
        self.signup_token = signup_token
        self.email = email
        self.name = name
        super().__init__("소셜 회원가입이 필요합니다.")


def _create_social_signup_token(profile: dict[str, str], provider: str) -> str:
    return create_access_token(
        subject=profile["email"],
        expires_delta=timedelta(minutes=15),
        extra_claims={
            "type": "social_signup",
            "provider": provider,
            "social_id": profile["social_id"],
            "email": profile["email"],
            "name": profile["name"],
        },
    )


def _decode_social_signup_token(signup_token: str) -> dict:
    try:
        decoded = decode_token(signup_token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="소셜 회원가입 정보가 만료되었거나 올바르지 않습니다.",
        ) from None

    if decoded.get("type") != "social_signup":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="소셜 회원가입 정보가 올바르지 않습니다.",
        )

    required = ("provider", "social_id", "email", "name")
    if any(not decoded.get(key) for key in required):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="소셜 회원가입 정보가 올바르지 않습니다.",
        )
    return decoded


def _ensure_requested_social_role(user: User, requested_role: str) -> None:
    if requested_role == UserRole.ADMIN.value and user.role != UserRole.ADMIN.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="관리자 계정으로 로그인해주세요.",
        )

    if requested_role == UserRole.MEMBER.value and user.role == UserRole.ADMIN.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="멤버 계정으로 로그인해주세요.",
        )


def _calculate_age(birth_date: date | None) -> int | None:
    if not birth_date:
        return None

    today = date.today()
    return today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))


def user_profile_context(user: User) -> dict[str, str | int | None]:
    gender_labels = {
        "male": "남성",
        "female": "여성",
    }
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "birth_date": user.birth_date.isoformat() if user.birth_date else None,
        "age": _calculate_age(user.birth_date),
        "phone_number": user.phone_number,
        "gender": user.gender,
        "gender_label": gender_labels.get(user.gender or ""),
    }


def _user_profile_response(user: User) -> UserProfileResponse:
    return UserProfileResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        role=UserRole(user.role),
        workspace_id=user.workspace_id,
        birth_date=user.birth_date,
        age=_calculate_age(user.birth_date),
        phone_number=user.phone_number,
        gender=user.gender,
        profile_image_url=_resolve_profile_image_url(user.profile_image_url),
    )


def update_my_profile_image_service(
    db: Session,
    current_user_id: int,
    profile_image_key: str,
) -> str:
    user = update_user_profile_image(
        db=db,
        user_id=current_user_id,
        profile_image_url=profile_image_key,
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="사용자를 찾을 수 없습니다.",
        )
    return _resolve_profile_image_url(user.profile_image_url) or ""


def _device_settings_response(
    user_id: int,
    workspace_id: int | None,
    selected_mic_id: str | None = None,
    selected_camera_id: str | None = None,
    mic_enabled: bool = True,
    camera_enabled: bool = True,
) -> DeviceSettingsResponse:
    return DeviceSettingsResponse(
        user_id=user_id,
        workspace_id=workspace_id,
        selected_mic_id=selected_mic_id,
        selected_camera_id=selected_camera_id,
        mic_enabled=mic_enabled,
        camera_enabled=camera_enabled,
    )


def signup_admin_service(db: Session, payload: AdminSignupRequest) -> AdminSignupResponse:
    """
    관리자 회원가입 요청을 처리합니다.

    처리 순서는 다음과 같습니다.
    1. 이메일 중복 여부를 확인합니다.
    2. 비밀번호를 해시 처리합니다.
    3. 관리자 역할로 사용자를 생성합니다.
    4. 저장된 사용자 정보를 응답 형식으로 반환합니다.

    Args:
        db: 데이터베이스 세션입니다.
        payload: 관리자 회원가입 요청 데이터입니다.

    Returns:
        저장이 완료된 관리자 사용자 응답 데이터를 반환합니다.
    """
    existing_user = get_user_by_email(db, payload.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이미 사용 중인 이메일입니다.",
        )

    hashed_password = hash_password(payload.password)
    workspace = create_workspace(
        db=db,
        name=f"{payload.name} Workspace",
        invite_code=_generate_invite_code(),
    )

    # 워크스페이스가 생성되면 연동 관리 페이지에서 바로 상태를 조회할 수 있도록
    # 기본 integration row 5개를 함께 생성합니다.
    create_default_integrations(
        db=db,
        workspace_id=workspace.id,
    )

    user = create_user(
        db=db,
        email=payload.email,
        hashed_password=hashed_password,
        name=payload.name,
        role=UserRole.ADMIN.value,
        workspace_id=workspace.id,
        birth_date=payload.birth_date,
        phone_number=payload.phone_number,
        gender=payload.gender.value if payload.gender else None,
    )
    create_workspace_membership(
        db=db,
        workspace_id=workspace.id,
        user_id=user.id,
        role=MemberRole.admin,
    )
    welcome_email_sent = send_admin_signup_welcome_email(
        to_email=user.email,
        name=user.name,
        workspace_name=workspace.name,
        invite_code=workspace.invite_code,
    )

    return AdminSignupResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        role=UserRole(user.role),
        workspace_id=workspace.id,
        invite_code=workspace.invite_code,
        welcome_email_sent=welcome_email_sent,
        birth_date=user.birth_date,
        age=_calculate_age(user.birth_date),
        phone_number=user.phone_number,
        gender=user.gender,
        profile_image_url=_resolve_profile_image_url(user.profile_image_url),
    )


def signup_member_service(db: Session, payload: MemberSignupRequest) -> UserResponse:
    """
    멤버 회원가입 요청을 처리합니다.

    현재 단계에서는 초대코드의 실제 유효성 검증 없이,
    기본 회원가입 흐름만 먼저 구현합니다.

    처리 순서는 다음과 같습니다.
    1. 이메일 중복 여부를 확인합니다.
    2. 비밀번호를 해시 처리합니다.
    3. 멤버 역할로 사용자를 생성합니다.
    4. 저장된 사용자 정보를 응답 형식으로 반환합니다.

    Args:
        db: 데이터베이스 세션입니다.
        payload: 멤버 회원가입 요청 데이터입니다.

    Returns:
        저장이 완료된 멤버 사용자 응답 데이터를 반환합니다.
    """
    existing_user = get_user_by_email(db, payload.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이미 사용 중인 이메일입니다.",
        )

    invite = get_invite_code_by_code(db, payload.invite_code)
    invite_role = MemberRole.member

    if invite:
        if invite.is_used or invite.expires_at < datetime.utcnow():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="유효하지 않은 초대코드입니다.",
            )
        workspace = get_workspace_by_id(db, invite.workspace_id)
        invite_role = invite.role
    else:
        workspace = get_workspace_by_invite_code(db, payload.invite_code)

    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="유효하지 않은 초대코드입니다.",
        )

    hashed_password = hash_password(payload.password)

    user = create_user(
        db=db,
        email=payload.email,
        hashed_password=hashed_password,
        name=payload.name,
        role=invite_role.value,
        workspace_id=workspace.id,
        birth_date=payload.birth_date,
        phone_number=payload.phone_number,
        gender=payload.gender.value if payload.gender else None,
    )
    create_workspace_membership(
        db=db,
        workspace_id=workspace.id,
        user_id=user.id,
        role=invite_role,
    )
    if invite:
        mark_invite_code_used(db, invite, user.id)

    try:
        notification_service.emit_workspace_member_joined(
            db,
            workspace_id=int(workspace.id),
            workspace_name=str(workspace.name),
            new_user_id=int(user.id),
            new_user_name=str(user.name),
            role_display=_MEMBER_ROLE_LABEL_KO.get(invite_role, "멤버"),
        )
    except Exception:
        pass

    return UserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        role=UserRole(user.role),
        birth_date=user.birth_date,
        age=_calculate_age(user.birth_date),
        phone_number=user.phone_number,
        gender=user.gender,
        profile_image_url=_resolve_profile_image_url(user.profile_image_url),
    )


def login_service(db: Session, payload: LoginRequest) -> TokenResponse:
    """
    로그인 요청을 처리합니다.

    처리 순서는 다음과 같습니다.
    1. 이메일로 사용자를 조회합니다.
    2. 사용자가 존재하는지 확인합니다.
    3. 입력한 비밀번호와 저장된 해시 비밀번호를 비교합니다.
    4. 인증 성공 시 access token과 refresh token을 발급합니다.

    Args:
        db: 데이터베이스 세션입니다.
        payload: 로그인 요청 데이터입니다.

    Returns:
        발급된 토큰 응답 데이터를 반환합니다.
    """
    user = get_user_by_email(db, payload.email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="아이디 또는 비밀번호가 틀렸습니다.",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="아이디 또는 비밀번호가 틀렸습니다.",
        )

    if not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="아이디 또는 비밀번호가 틀렸습니다.",
        )

    return _token_response_for_user(user)


def get_social_oauth_url_service(provider: str, role: UserRole) -> OAuthUrlResponse:
    state = _encode_oauth_state(provider, role.value)

    if provider == SocialProvider.google.value:
        if not settings.GOOGLE_CLIENT_ID:
            raise HTTPException(status_code=500, detail="GOOGLE_CLIENT_ID가 설정되어 있지 않습니다.")
        params = urlencode({
            "client_id": settings.GOOGLE_CLIENT_ID,
            "redirect_uri": settings.GOOGLE_LOGIN_REDIRECT_URI,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "prompt": "select_account",
        })
        return OAuthUrlResponse(auth_url=f"https://accounts.google.com/o/oauth2/v2/auth?{params}")

    if provider == SocialProvider.kakao.value:
        if not settings.KAKAO_REST_API_KEY:
            raise HTTPException(status_code=500, detail="KAKAO_REST_API_KEY가 설정되어 있지 않습니다.")
        params = urlencode({
            "client_id": settings.KAKAO_REST_API_KEY,
            "redirect_uri": settings.KAKAO_LOGIN_REDIRECT_URI,
            "response_type": "code",
            "state": state,
        })
        return OAuthUrlResponse(auth_url=f"https://kauth.kakao.com/oauth/authorize?{params}")

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="지원하지 않는 소셜 로그인입니다.")


async def _fetch_google_profile(code: str) -> dict[str, str]:
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="Google OAuth 설정이 누락되었습니다.")

    client = await ClientSessionManager.get_client()
    token_res = await client.post(
        "https://oauth2.googleapis.com/token",
        data={
            "code": code,
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri": settings.GOOGLE_LOGIN_REDIRECT_URI,
            "grant_type": "authorization_code",
        },
    )
    token_res.raise_for_status()
    access_token = token_res.json()["access_token"]

    user_res = await client.get(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    user_res.raise_for_status()
    data = user_res.json()
    return {
        "social_id": str(data["id"]),
        "email": data["email"],
        "name": data.get("name") or data["email"].split("@")[0],
    }


async def _fetch_kakao_profile(code: str) -> dict[str, str]:
    if not settings.KAKAO_REST_API_KEY:
        raise HTTPException(status_code=500, detail="KAKAO_REST_API_KEY가 설정되어 있지 않습니다.")

    client = await ClientSessionManager.get_client()
    token_payload = {
        "grant_type": "authorization_code",
        "client_id": settings.KAKAO_REST_API_KEY,
        "redirect_uri": settings.KAKAO_LOGIN_REDIRECT_URI,
        "code": code,
    }
    if settings.KAKAO_CLIENT_SECRET:
        token_payload["client_secret"] = settings.KAKAO_CLIENT_SECRET

    token_res = await client.post("https://kauth.kakao.com/oauth/token", data=token_payload)
    token_res.raise_for_status()
    access_token = token_res.json()["access_token"]

    user_res = await client.get(
        "https://kapi.kakao.com/v2/user/me",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    user_res.raise_for_status()
    data = user_res.json()
    kakao_account = data.get("kakao_account") or {}
    profile = kakao_account.get("profile") or {}
    email = kakao_account.get("email")
    if not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="카카오 계정 이메일 제공 동의가 필요합니다.")
    return {
        "social_id": str(data["id"]),
        "email": email,
        "name": profile.get("nickname") or email.split("@")[0],
    }


async def social_login_callback_service(db: Session, provider: str, code: str, state: str) -> TokenResponse:
    state_data = _decode_oauth_state(state)
    if state_data["provider"] != provider:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OAuth provider 정보가 일치하지 않습니다.")

    profile = (
        await _fetch_google_profile(code)
        if provider == SocialProvider.google.value
        else await _fetch_kakao_profile(code)
    )

    user = get_user_by_social_identity(db, provider, profile["social_id"])
    if not user:
        existing_user = get_user_by_email(db, profile["email"])
        if existing_user:
            user = update_user_social_identity(db, existing_user, provider, profile["social_id"])

    if not user:
        raise PendingSocialSignup(
            signup_token=_create_social_signup_token(profile, provider),
            email=profile["email"],
            name=profile["name"],
        )

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="탈퇴했거나 비활성화된 계정입니다.")

    return _token_response_for_user(user)


def complete_social_signup_service(db: Session, payload: SocialSignupRequest) -> TokenResponse:
    profile = _decode_social_signup_token(payload.signup_token)
    provider = str(profile["provider"])
    social_id = str(profile["social_id"])
    email = str(profile["email"])
    name = str(profile["name"])

    user = get_user_by_social_identity(db, provider, social_id)
    if not user:
        existing_user = get_user_by_email(db, email)
        if existing_user:
            user = update_user_social_identity(db, existing_user, provider, social_id)

    if user:
        if not user.is_active:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="탈퇴했거나 비활성화된 계정입니다.")
        return _token_response_for_user(user)

    if payload.role not in (UserRole.ADMIN, UserRole.MEMBER):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="소셜 회원가입 유형은 관리자 또는 멤버만 선택할 수 있습니다.",
        )

    if payload.role == UserRole.ADMIN:
        workspace = create_workspace(
            db=db,
            name=f"{name} Workspace",
            invite_code=_generate_invite_code(),
        )
        create_default_integrations(db=db, workspace_id=workspace.id)
        user = create_user(
            db=db,
            email=email,
            hashed_password=hash_password(secrets.token_urlsafe(32)),
            name=name,
            role=UserRole.ADMIN.value,
            workspace_id=workspace.id,
            social_provider=provider,
            social_id=social_id,
        )
        create_workspace_membership(
            db=db,
            workspace_id=workspace.id,
            user_id=user.id,
            role=MemberRole.admin,
        )
        return _token_response_for_user(user)

    invite_code = payload.invite_code
    if not invite_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="초대코드를 입력해주세요.",
        )

    invite = get_invite_code_by_code(db, invite_code)
    invite_role = MemberRole.member
    if invite:
        if invite.is_used or invite.expires_at < datetime.utcnow():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="올바르지 않은 초대코드입니다.",
            )
        workspace = get_workspace_by_id(db, invite.workspace_id)
        invite_role = invite.role
    else:
        workspace = get_workspace_by_invite_code(db, invite_code)

    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="올바르지 않은 초대코드입니다.",
        )

    user = create_user(
        db=db,
        email=email,
        hashed_password=hash_password(secrets.token_urlsafe(32)),
        name=name,
        role=invite_role.value,
        workspace_id=workspace.id,
        social_provider=provider,
        social_id=social_id,
    )
    create_workspace_membership(
        db=db,
        workspace_id=workspace.id,
        user_id=user.id,
        role=invite_role,
    )
    if invite:
        mark_invite_code_used(db, invite, user.id)

    return _token_response_for_user(user)


def refresh_token_service(db: Session, payload: RefreshTokenRequest) -> TokenResponse:
    """
    refresh token을 검증하고 새 access token을 발급합니다.
    """
    try:
        decoded = decode_token(payload.refresh_token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 refresh token입니다.",
        ) from None

    if decoded.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 refresh token입니다.",
        )

    subject = decoded.get("sub")
    if not subject:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 refresh token입니다.",
        )

    try:
        user_id = int(subject)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 refresh token입니다.",
        ) from None

    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="사용자를 찾을 수 없습니다.",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="탈퇴했거나 비활성화된 계정입니다.",
        )

    access_token = create_access_token(
        subject=str(user.id),
        extra_claims=_access_token_claims(user),
    )
    new_refresh_token = create_refresh_token(subject=str(user.id))

    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh_token,
    )


def logout_service(db: Session, payload: LogoutRequest) -> MessageResponse:
    """
    로그아웃 요청을 처리합니다.

    현재 구조에서는 서버 측 토큰 저장소가 없으므로,
    refresh token이 유효한 형식인지 확인한 뒤 클라이언트 폐기 메시지를 반환합니다.
    """
    try:
        decoded = decode_token(payload.refresh_token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 refresh token입니다.",
        ) from None

    if decoded.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 refresh token입니다.",
        )

    subject = decoded.get("sub")
    if not subject:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 refresh token입니다.",
        )

    return MessageResponse(message="로그아웃되었습니다.")


def get_my_profile_service(db: Session, current_user_id: int) -> UserProfileResponse:
    user = get_user_by_id(db, current_user_id)
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="사용자를 찾을 수 없습니다.",
        )
    return _user_profile_response(user)


def update_my_profile_service(
    db: Session,
    current_user_id: int,
    payload: UserProfileUpdateRequest,
) -> UserProfileUpdateResponse:
    user = update_user_profile(
        db,
        current_user_id,
        payload.name.strip(),
        birth_date=payload.birth_date,
        phone_number=payload.phone_number.strip() if payload.phone_number else None,
        gender=payload.gender.value if payload.gender else None,
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="사용자를 찾을 수 없습니다.",
        )

    access_token = create_access_token(
        subject=str(user.id),
        extra_claims=_access_token_claims(user),
    )
    refresh_token = create_refresh_token(subject=str(user.id))

    return UserProfileUpdateResponse(
        user=_user_profile_response(user),
        access_token=access_token,
        refresh_token=refresh_token,
        message="프로필이 변경되었습니다.",
    )


def get_my_device_settings_service(
    db: Session,
    current_user_id: int,
) -> DeviceSettingsResponse:
    user = get_user_by_id(db, current_user_id)
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="사용자를 찾을 수 없습니다.",
        )

    setting = get_user_device_setting(db, current_user_id)
    if not setting:
        return _device_settings_response(
            user_id=user.id,
            workspace_id=user.workspace_id,
        )

    return _device_settings_response(
        user_id=user.id,
        workspace_id=setting.workspace_id,
        selected_mic_id=setting.selected_mic_id,
        selected_camera_id=setting.selected_camera_id,
        mic_enabled=setting.mic_enabled,
        camera_enabled=setting.camera_enabled,
    )


def update_my_device_settings_service(
    db: Session,
    current_user_id: int,
    payload: DeviceSettingsRequest,
) -> DeviceSettingsResponse:
    user = get_user_by_id(db, current_user_id)
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="사용자를 찾을 수 없습니다.",
        )

    setting = upsert_user_device_setting(
        db=db,
        user_id=user.id,
        workspace_id=user.workspace_id,
        selected_mic_id=payload.selected_mic_id,
        selected_camera_id=payload.selected_camera_id,
        mic_enabled=payload.mic_enabled,
        camera_enabled=payload.camera_enabled,
    )

    return _device_settings_response(
        user_id=user.id,
        workspace_id=setting.workspace_id,
        selected_mic_id=setting.selected_mic_id,
        selected_camera_id=setting.selected_camera_id,
        mic_enabled=setting.mic_enabled,
        camera_enabled=setting.camera_enabled,
    )


def withdraw_my_account_service(db: Session, current_user_id: int) -> MessageResponse:
    """
    로그인한 사용자의 회원 탈퇴를 처리합니다.

    마지막 워크스페이스 관리자가 단독으로 탈퇴하면 워크스페이스 관리자가 사라지므로
    워크스페이스 삭제 또는 다른 관리자 지정 후 탈퇴하도록 막습니다.
    """
    user = get_user_by_id(db, current_user_id)
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="사용자를 찾을 수 없습니다.",
        )

    workspace_id = user.workspace_id
    if workspace_id is not None:
        membership = get_workspace_membership(db, workspace_id, user.id)
        is_admin = (
            (membership is not None and membership.role == MemberRole.admin)
            or user.role == MemberRole.admin.value
        )
        if is_admin and count_workspace_admins(db, workspace_id) <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="마지막 관리자는 먼저 워크스페이스를 삭제하거나 다른 관리자를 지정해야 합니다.",
            )
        delete_workspace_membership(db, workspace_id, user.id)

    deactivated = deactivate_user_account(db, user.id)
    if not deactivated:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="사용자를 찾을 수 없습니다.",
        )

    return MessageResponse(message="회원 탈퇴가 완료되었습니다.")


def request_password_reset_service(
    db: Session,
    payload: PasswordResetRequest,
) -> MessageResponse:
    """
    비밀번호 재설정 메일 발송 요청을 처리합니다.

    사용자가 존재하면 비밀번호 재설정 링크를 이메일로 전송합니다.
    존재하지 않는 이메일이어도 계정 존재 여부가 노출되지 않도록 동일한 메시지를 반환합니다.

    Args:
        payload: 비밀번호 재설정 메일 발송 요청 데이터입니다.

    Returns:
        재설정 메일 발송 안내 메시지를 반환합니다.
    """
    user = get_user_by_email(db, payload.email)
    if user:
        token = create_access_token(
            subject=str(user.id),
            expires_delta=timedelta(minutes=settings.PASSWORD_RESET_TOKEN_MINUTES),
            extra_claims={"type": "password_reset", "email": user.email},
        )
        reset_url = f"{settings.FRONTEND_URL.rstrip('/')}/reset-password?token={token}"
        send_password_reset_email(
            to_email=user.email,
            name=user.name,
            reset_url=reset_url,
        )

    return MessageResponse(message=f"{payload.email} 주소로 비밀번호 재설정 안내를 전송했습니다.")


def confirm_password_reset_service(
    db: Session,
    payload: PasswordResetConfirmRequest,
) -> MessageResponse:
    try:
        decoded = decode_token(payload.token)
        user_id = int(decoded.get("sub"))
    except (JWTError, TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="비밀번호 재설정 링크가 유효하지 않거나 만료되었습니다.",
        ) from None

    if decoded.get("type") != "password_reset":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="비밀번호 재설정 링크가 유효하지 않거나 만료되었습니다.",
        )

    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="사용자를 찾을 수 없습니다.",
        )

    updated = update_user_password(
        db=db,
        user_id=user.id,
        hashed_password=hash_password(payload.new_password),
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="사용자를 찾을 수 없습니다.",
        )

    return MessageResponse(message="비밀번호가 성공적으로 재설정되었습니다.")


def change_password_service(
    db: Session,
    current_user_id: int,
    payload: PasswordChangeRequest,
) -> MessageResponse:
    """
    비밀번호 변경 요청을 처리합니다.

    현재 로그인한 사용자의 기존 비밀번호를 검증한 뒤 새 비밀번호로 변경합니다.

    Args:
        payload: 비밀번호 변경 요청 데이터입니다.

    Returns:
        비밀번호 변경 완료 메시지를 반환합니다.
    """
    user = get_user_by_id(db, current_user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="사용자를 찾을 수 없습니다.",
        )

    if not verify_password(payload.current_password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="현재 비밀번호가 올바르지 않습니다.",
        )

    if verify_password(payload.new_password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="새 비밀번호는 현재 비밀번호와 달라야 합니다.",
        )

    updated = update_user_password(
        db=db,
        user_id=user.id,
        hashed_password=hash_password(payload.new_password),
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="사용자를 찾을 수 없습니다.",
        )

    return MessageResponse(message="비밀번호가 성공적으로 변경되었습니다.")
