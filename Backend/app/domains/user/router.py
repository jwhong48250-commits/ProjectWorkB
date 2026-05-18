"""
사용자 도메인의 API 엔드포인트를 정의하는 파일입니다.

router 계층은 클라이언트의 요청을 직접 받고,
검증된 요청 데이터를 service 계층으로 전달하는 역할을 합니다.

현재는 인증 기능과 관련된 엔드포인트를 먼저 구성합니다.
- 관리자 회원가입
- 멤버 회원가입
- 로그인
- 비밀번호 재설정 요청
- 비밀번호 변경 요청

이제 요청 하나가 들어오면:
FastAPI가 get_db()로 DB 세션을 만듦
router.py가 그 세션을 받음
service.py에 넘김
service가 repository로 DB 작업
"""

from urllib.parse import urlencode
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user_id
from app.db.session import get_db
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
from app.domains.user.service import (
    change_password_service,
    confirm_password_reset_service,
    get_my_device_settings_service,
    get_my_profile_service,
    get_social_oauth_url_service,
    login_service,
    logout_service,
    request_password_reset_service,
    refresh_token_service,
    complete_social_signup_service,
    PendingSocialSignup,
    social_login_callback_service,
    signup_admin_service,
    signup_member_service,
    update_my_profile_service,
    update_my_profile_image_service,
    update_my_device_settings_service,
    withdraw_my_account_service,
)
from app.utils.local_images import save_local_image


router = APIRouter()


@router.post("/me/profile-image", status_code=status.HTTP_200_OK)
async def upload_my_profile_image(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> dict[str, str]:
    image_key = await save_local_image(
        file=file,
        directory=Path("profile"),
        stem=f"user-{current_user_id}",
    )
    image_url = update_my_profile_image_service(
        db=db,
        current_user_id=current_user_id,
        profile_image_key=image_key,
    )
    return {"image_url": image_url}


@router.get(
    "/oauth/{provider}/auth",
    response_model=OAuthUrlResponse,
    status_code=status.HTTP_200_OK,
)
async def social_oauth_auth(provider: str, role: UserRole = UserRole.MEMBER) -> OAuthUrlResponse:
    """
    Google/Kakao 소셜 로그인 시작 URL을 반환합니다.
    """
    return get_social_oauth_url_service(provider, role)


@router.get("/oauth/{provider}/callback")
async def social_oauth_callback(
    provider: str,
    code: str,
    state: str,
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """
    OAuth provider callback을 처리하고 프론트 callback 페이지로 토큰을 전달합니다.
    """
    try:
        tokens = await social_login_callback_service(db, provider, code, state)
        params = urlencode({
            "access_token": tokens.access_token,
            "refresh_token": tokens.refresh_token,
        })
        return RedirectResponse(f"{settings.FRONTEND_URL.rstrip('/')}/oauth/callback?{params}")
    except PendingSocialSignup as pending:
        params = urlencode({
            "social_signup": "1",
            "signup_token": pending.signup_token,
            "email": pending.email,
            "name": pending.name,
        })
        return RedirectResponse(f"{settings.FRONTEND_URL.rstrip('/')}/oauth/callback?{params}")
    except HTTPException as exc:
        message = exc.detail if isinstance(exc.detail, str) else "소셜 로그인에 실패했습니다."
        params = urlencode({"error": message})
        return RedirectResponse(f"{settings.FRONTEND_URL.rstrip('/')}/login?{params}")
    except Exception as exc:
        params = urlencode({"error": str(exc)})
        return RedirectResponse(f"{settings.FRONTEND_URL.rstrip('/')}/login?{params}")


@router.post(
    "/oauth/social-signup",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
)
async def complete_social_signup(
    payload: SocialSignupRequest,
    db: Session = Depends(get_db),
) -> TokenResponse:
    """
    미가입 소셜 계정의 관리자/멤버 회원가입을 완료합니다.
    """
    return complete_social_signup_service(db, payload)


@router.post(
    "/signup/admin",
    response_model=AdminSignupResponse,
    status_code=status.HTTP_201_CREATED,
)
async def signup_admin(
    payload: AdminSignupRequest,
    db: Session = Depends(get_db),
) -> AdminSignupResponse:
    """
    관리자 회원가입 요청을 처리하는 API 엔드포인트입니다.

    요청 데이터 검증은 Pydantic 스키마가 담당하고,
    실제 회원가입 처리 로직은 service 계층에 위임합니다.

    Args:
        payload: 관리자 회원가입 요청 데이터입니다.
        db: 요청에 사용되는 데이터베이스 세션입니다.

    Returns:
        회원가입 처리 결과 사용자 정보와 초대코드를 반환합니다.
    """
    return signup_admin_service(db, payload)


@router.post(
    "/signup/member",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
async def signup_member(
    payload: MemberSignupRequest,
    db: Session = Depends(get_db),
) -> UserResponse:
    """
    멤버 회원가입 요청을 처리하는 API 엔드포인트입니다.

    Args:
        payload: 멤버 회원가입 요청 데이터입니다.
        db: 요청에 사용되는 데이터베이스 세션입니다.

    Returns:
        회원가입 처리 결과 사용자 정보를 반환합니다.
    """
    return signup_member_service(db, payload)


@router.post(
    "/login",
    response_model=TokenResponse,
    status_code=status.HTTP_200_OK,
)
async def login(
    payload: LoginRequest,
    db: Session = Depends(get_db),
) -> TokenResponse:
    """
    로그인 요청을 처리하는 API 엔드포인트입니다.

    Args:
        payload: 로그인 요청 데이터입니다.
        db: 요청에 사용되는 데이터베이스 세션입니다.

    Returns:
        로그인 처리 결과 토큰 정보를 반환합니다.
    """
    return login_service(db, payload)


@router.post(
    "/auth/token/refresh",
    response_model=TokenResponse,
    status_code=status.HTTP_200_OK,
)
async def refresh_token(
    payload: RefreshTokenRequest,
    db: Session = Depends(get_db),
) -> TokenResponse:
    """
    refresh token으로 새 토큰을 발급하는 API 엔드포인트입니다.
    """
    return refresh_token_service(db, payload)


@router.post(
    "/logout",
    response_model=MessageResponse,
    status_code=status.HTTP_200_OK,
)
async def logout(
    payload: LogoutRequest,
    db: Session = Depends(get_db),
) -> MessageResponse:
    """
    로그아웃을 처리하는 API 엔드포인트입니다.
    """
    return logout_service(db, payload)


@router.get(
    "/me",
    response_model=UserProfileResponse,
    status_code=status.HTTP_200_OK,
)
async def get_my_profile(
    db: Session = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> UserProfileResponse:
    """
    로그인한 사용자의 마이페이지 프로필 정보를 조회합니다.
    """
    return get_my_profile_service(db, current_user_id)


@router.patch(
    "/me",
    response_model=UserProfileUpdateResponse,
    status_code=status.HTTP_200_OK,
)
async def update_my_profile(
    payload: UserProfileUpdateRequest,
    db: Session = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> UserProfileUpdateResponse:
    """
    로그인한 사용자의 이름을 수정하고 갱신된 토큰을 발급합니다.
    """
    return update_my_profile_service(db, current_user_id, payload)


@router.get(
    "/me/device-settings",
    response_model=DeviceSettingsResponse,
    status_code=status.HTTP_200_OK,
)
async def get_my_device_settings(
    db: Session = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> DeviceSettingsResponse:
    """
    로그인한 사용자의 장비 설정을 조회합니다.
    """
    return get_my_device_settings_service(db, current_user_id)


@router.patch(
    "/me/device-settings",
    response_model=DeviceSettingsResponse,
    status_code=status.HTTP_200_OK,
)
async def update_my_device_settings(
    payload: DeviceSettingsRequest,
    db: Session = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> DeviceSettingsResponse:
    """
    로그인한 사용자의 장비 설정을 저장합니다.
    """
    return update_my_device_settings_service(db, current_user_id, payload)


@router.delete(
    "/me",
    response_model=MessageResponse,
    status_code=status.HTTP_200_OK,
)
async def withdraw_my_account(
    db: Session = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> MessageResponse:
    """
    로그인한 사용자의 회원 탈퇴를 처리합니다.
    """
    return withdraw_my_account_service(db, current_user_id)


@router.post(
    "/password-reset",
    response_model=MessageResponse,
    status_code=status.HTTP_200_OK,
)
async def request_password_reset(
    payload: PasswordResetRequest,
    db: Session = Depends(get_db),
) -> MessageResponse:
    """
    비밀번호 재설정 메일 발송 요청을 처리하는 API 엔드포인트입니다.

    Args:
        payload: 비밀번호 재설정 메일 발송 요청 데이터입니다.

    Returns:
        요청 처리 결과 메시지를 반환합니다.
    """
    return request_password_reset_service(db, payload)


@router.post(
    "/password-reset/confirm",
    response_model=MessageResponse,
    status_code=status.HTTP_200_OK,
)
async def confirm_password_reset(
    payload: PasswordResetConfirmRequest,
    db: Session = Depends(get_db),
) -> MessageResponse:
    """
    비밀번호 재설정 링크에서 새 비밀번호를 저장합니다.
    """
    return confirm_password_reset_service(db, payload)


@router.post(
    "/password-change",
    response_model=MessageResponse,
    status_code=status.HTTP_200_OK,
)
async def change_password(
    payload: PasswordChangeRequest,
    db: Session = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id),
) -> MessageResponse:
    """
    비밀번호 변경 요청을 처리하는 API 엔드포인트입니다.

    Args:
        payload: 비밀번호 변경 요청 데이터입니다.

    Returns:
        요청 처리 결과 메시지를 반환합니다.
    """
    return change_password_service(db, current_user_id, payload)
