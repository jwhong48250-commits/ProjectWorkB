# app\domains\user\schemas.py

from datetime import date
from enum import Enum
import re

from pydantic import BaseModel, EmailStr, Field, field_validator


class UserRole(str, Enum):
    """
    시스템에서 사용하는 사용자 역할을 정의하는 Enum 클래스입니다.

    str을 상속받아 JSON 응답이나 DB 저장 시 문자열처럼 다룰 수 있도록 합니다.
    Enum을 사용하여 허용 가능한 역할 값을 고정합니다.

    현재 역할 구분은 다음과 같습니다.
    - ADMIN: 워크스페이스를 생성하고 주요 설정을 관리하는 관리자입니다.
    - MEMBER: 초대코드를 통해 참여하는 일반 팀원입니다.
    - VIEWER: 조회 중심 권한을 가진 사용자입니다.
    """
    ADMIN = "admin"
    MEMBER = "member"
    VIEWER = "viewer"


class Gender(str, Enum):
    MALE = "male"
    FEMALE = "female"


class UserProfileFields(BaseModel):
    birth_date: date | None = None
    phone_number: str | None = Field(default=None, min_length=9, max_length=30)
    gender: Gender | None = None

    @field_validator("birth_date")
    @classmethod
    def validate_birth_date(cls, value: date | None) -> date | None:
        if value is None:
            return value
        today = date.today()
        if value >= today:
            raise ValueError("생년월일은 오늘 이전 날짜여야 합니다.")

        age = today.year - value.year - ((today.month, today.day) < (value.month, value.day))
        if age > 120:
            raise ValueError("생년월일을 다시 확인해주세요.")
        return value

    @field_validator("phone_number")
    @classmethod
    def validate_phone_number(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized = value.strip()
        if not re.fullmatch(r"[\d+\-\s()]+", normalized):
            raise ValueError("전화번호는 숫자와 +, -, 공백, 괄호만 사용할 수 있습니다.")

        digit_count = sum(char.isdigit() for char in normalized)
        if digit_count < 9 or digit_count > 15:
            raise ValueError("전화번호는 숫자 기준 9자 이상 15자 이하로 입력해주세요.")
        return normalized


class AdminSignupRequest(UserProfileFields):
    """
    관리자 회원가입 요청 데이터를 검증하기 위한 스키마입니다.

    FastAPI에서 요청 본문(request body)을 이 모델로 받으면,
    각 필드의 타입과 길이 조건을 자동으로 검사합니다.

    필드 설명은 다음과 같습니다.
    - email: 올바른 이메일 형식이어야 합니다.
    - password: 8자 이상 64자 이하이며, 추가 validator에서 영문/숫자 포함 여부를 검사합니다.
    - name: 2자 이상 30자 이하의 사용자 이름입니다.
    """
    email: EmailStr
    password: str = Field(min_length=8, max_length=64)
    name: str = Field(min_length=2, max_length=30)

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        """
        관리자 회원가입 비밀번호를 검증합니다.

        기본 길이 검사는 Field에서 처리하고,
        이 함수에서는 비밀번호 복잡도 조건을 추가로 검사합니다.

        현재 규칙은 다음과 같습니다.
        - 영문자를 최소 1개 이상 포함해야 합니다.
        - 숫자를 최소 1개 이상 포함해야 합니다.

        조건을 만족하지 않으면 ValueError를 발생시키며,
        FastAPI는 이를 422 Unprocessable Entity 응답으로 처리합니다.

        Args:
            value: 사용자가 입력한 원본 비밀번호 문자열입니다.

        Returns:
            검증을 통과한 비밀번호 문자열을 반환합니다.

        Raises:
            ValueError: 영문자 또는 숫자가 포함되지 않은 경우 발생합니다.
        """
        if not any(char.isalpha() for char in value):
            raise ValueError("비밀번호에는 영문자가 최소 1개 이상 포함되어야 합니다.")
        if not any(char.isdigit() for char in value):
            raise ValueError("비밀번호에는 숫자가 최소 1개 이상 포함되어야 합니다.")
        return value


class MemberSignupRequest(UserProfileFields):
    """
    멤버 회원가입 요청 데이터를 검증하기 위한 스키마입니다.

    관리자 회원가입과 달리 워크스페이스 참여를 위한 invite_code가 필요합니다.
    초대코드는 이후 서비스 계층에서 실제 유효한 코드인지 확인하며,
    여기서는 우선 입력 형식과 기본 정규화만 담당합니다.

    필드 설명은 다음과 같습니다.
    - invite_code: 초대코드 문자열입니다.
    - email: 올바른 이메일 형식이어야 합니다.
    - password: 8자 이상 64자 이하의 비밀번호입니다.
    - name: 2자 이상 30자 이하의 사용자 이름입니다.
    """
    invite_code: str = Field(min_length=6, max_length=20)
    email: EmailStr
    password: str = Field(min_length=8, max_length=64)
    name: str = Field(min_length=2, max_length=30)

    @field_validator("invite_code")
    @classmethod
    def normalize_invite_code(cls, value: str) -> str:
        """
        초대코드를 비교하기 쉬운 형태로 정규화합니다.

        사용자가 초대코드를 입력할 때 공백을 포함하거나 소문자로 입력할 수 있으므로,
        서버 내부에서는 비교를 쉽게 하기 위해 다음 처리를 수행합니다.

        처리 방식은 다음과 같습니다.
        - 문자열 양쪽 공백을 제거합니다.
        - 영문자를 모두 대문자로 변환합니다.

        예시는 다음과 같습니다.
        " abcd12 " -> "ABCD12"

        Args:
            value: 사용자가 입력한 초대코드입니다.

        Returns:
            정규화된 초대코드 문자열을 반환합니다.
        """
        return value.strip().upper()

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        """
        멤버 회원가입 비밀번호를 검증합니다.

        관리자 회원가입과 동일한 비밀번호 규칙을 적용합니다.
        공통 규칙을 맞춰두면 이후 인증 정책 관리가 쉬워집니다.

        현재 규칙은 다음과 같습니다.
        - 영문자를 최소 1개 이상 포함해야 합니다.
        - 숫자를 최소 1개 이상 포함해야 합니다.

        Args:
            value: 사용자가 입력한 비밀번호입니다.

        Returns:
            검증을 통과한 비밀번호 문자열을 반환합니다.

        Raises:
            ValueError: 영문자 또는 숫자가 포함되지 않은 경우 발생합니다.
        """
        if not any(char.isalpha() for char in value):
            raise ValueError("비밀번호에는 영문자가 최소 1개 이상 포함되어야 합니다.")
        if not any(char.isdigit() for char in value):
            raise ValueError("비밀번호에는 숫자가 최소 1개 이상 포함되어야 합니다.")
        return value


class LoginRequest(BaseModel):
    """
    로그인 요청 데이터를 검증하기 위한 스키마입니다.

    관리자와 멤버가 공통으로 사용하는 로그인 입력 형식입니다.
    실제 로그인 성공 여부는 서비스 계층에서 사용자 조회와 비밀번호 검증을 통해 판단합니다.

    필드 설명은 다음과 같습니다.
    - email: 로그인에 사용할 이메일입니다.
    - password: 로그인에 사용할 비밀번호입니다.
    """
    email: EmailStr
    password: str = Field(min_length=8, max_length=64)


class PasswordResetRequest(BaseModel):
    """
    비밀번호 재설정 메일 발송 요청 스키마입니다.

    사용자가 비밀번호를 잊었을 때 이메일 주소를 입력하면,
    이후 서비스 계층에서 해당 이메일로 재설정 링크 또는 인증 토큰을 전송하는 흐름에 사용합니다.
    """
    email: EmailStr


class PasswordChangeRequest(BaseModel):
    """
    로그인한 사용자의 비밀번호 변경 요청 스키마입니다.

    현재 비밀번호를 검증한 뒤 새 비밀번호로 변경합니다.
    """
    current_password: str = Field(min_length=8, max_length=64)
    new_password: str = Field(min_length=8, max_length=64)

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, value: str) -> str:
        """
        새 비밀번호를 검증합니다.

        비밀번호 변경 시에도 회원가입과 동일한 복잡도 규칙을 유지합니다.
        이렇게 해야 인증 정책이 일관되게 유지됩니다.

        현재 규칙은 다음과 같습니다.
        - 영문자를 최소 1개 이상 포함해야 합니다.
        - 숫자를 최소 1개 이상 포함해야 합니다.

        Args:
            value: 사용자가 새로 입력한 비밀번호입니다.

        Returns:
            검증을 통과한 새 비밀번호 문자열을 반환합니다.

        Raises:
            ValueError: 영문자 또는 숫자가 포함되지 않은 경우 발생합니다.
        """
        if not any(char.isalpha() for char in value):
            raise ValueError("비밀번호에는 영문자가 최소 1개 이상 포함되어야 합니다.")
        if not any(char.isdigit() for char in value):
            raise ValueError("비밀번호에는 숫자가 최소 1개 이상 포함되어야 합니다.")
        return value


class PasswordResetConfirmRequest(BaseModel):
    """
    이메일 링크로 받은 토큰을 사용해 새 비밀번호를 설정합니다.
    """
    token: str
    new_password: str = Field(min_length=8, max_length=64)

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, value: str) -> str:
        if not any(char.isalpha() for char in value):
            raise ValueError("비밀번호에는 영문자가 최소 1개 이상 포함되어야 합니다.")
        if not any(char.isdigit() for char in value):
            raise ValueError("비밀번호에는 숫자가 최소 1개 이상 포함되어야 합니다.")
        return value


class UserProfileUpdateRequest(BaseModel):
    """
    로그인한 사용자가 마이페이지에서 수정할 수 있는 프로필 정보입니다.
    """
    name: str = Field(min_length=2, max_length=30)
    birth_date: date | None = None
    phone_number: str | None = Field(default=None, min_length=9, max_length=30)
    gender: Gender | None = None

    @field_validator("birth_date")
    @classmethod
    def validate_optional_birth_date(cls, value: date | None) -> date | None:
        if value is None:
            return value
        return UserProfileFields.validate_birth_date(value)

    @field_validator("phone_number")
    @classmethod
    def validate_optional_phone_number(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return UserProfileFields.validate_phone_number(value)


class DeviceSettingsRequest(BaseModel):
    """
    로그인한 사용자의 장비 설정 저장 요청입니다.
    브라우저에서 조회한 deviceId는 기기/브라우저마다 달라질 수 있으므로 문자열로 저장합니다.
    """
    selected_mic_id: str | None = Field(default=None, max_length=255)
    selected_camera_id: str | None = Field(default=None, max_length=255)
    mic_enabled: bool = True
    camera_enabled: bool = True


class DeviceSettingsResponse(DeviceSettingsRequest):
    user_id: int
    workspace_id: int | None = None


class OAuthUrlResponse(BaseModel):
    auth_url: str


class SocialSignupRequest(BaseModel):
    signup_token: str
    role: UserRole
    invite_code: str | None = Field(default=None, min_length=6, max_length=20)

    @field_validator("invite_code")
    @classmethod
    def normalize_optional_invite_code(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return value.strip().upper()


class UserResponse(BaseModel):
    """
    사용자 정보를 응답할 때 사용하는 스키마입니다.

    회원가입 완료 후 사용자 기본 정보를 반환하거나,
    로그인 후 사용자 프로필 정보를 응답할 때 재사용할 수 있습니다.
    """
    id: int
    email: EmailStr
    name: str
    role: UserRole
    birth_date: date | None = None
    age: int | None = None
    phone_number: str | None = None
    gender: Gender | None = None
    profile_image_url: str | None = None


class UserProfileResponse(UserResponse):
    workspace_id: int | None = None


class UserProfileUpdateResponse(BaseModel):
    user: UserProfileResponse
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    message: str


class AdminSignupResponse(UserResponse):
    """
    관리자 회원가입 완료 시 사용하는 응답 스키마입니다.
    관리자 가입과 동시에 생성된 워크스페이스 정보와 초대코드를 함께 반환하기 위해 사용합니다. 
    """
    workspace_id: int
    invite_code: str
    welcome_email_sent: bool = False

class TokenResponse(BaseModel):
    """
    로그인 성공 후 토큰 정보를 응답할 때 사용하는 스키마입니다.

    일반적으로 access token은 인증이 필요한 API 호출에 사용하고,
    refresh token은 access token 재발급에 사용합니다.
    token_type은 bearer로 고정하여 사용합니다.
    """
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshTokenRequest(BaseModel):
    """
    access token 재발급 요청 시 사용하는 스키마입니다.
    """

    refresh_token: str


class LogoutRequest(BaseModel):
    """
    로그아웃 요청 시 사용하는 스키마입니다.

    현재 구조에서는 서버 측 블랙리스트 저장소가 없으므로,
    refresh token 형식 검증 후 클라이언트에서 토큰을 폐기하는 흐름으로 사용합니다.
    """

    refresh_token: str


class MessageResponse(BaseModel):
    """
    단순 메시지 응답에 사용하는 스키마입니다.

    예시는 다음과 같습니다.
    - 비밀번호 재설정 메일 발송 완료 메시지입니다.
    - 회원가입 완료 안내 메시지입니다.
    - 로그아웃 완료 메시지입니다.
    """
    message: str
