"""
사용자 도메인의 데이터베이스 모델을 정의하는 파일입니다.

현재는 인증과 워크스페이스 소속 관리, 부서 연결까지 고려한 사용자 테이블 구조를 정의합니다.
"""

from datetime import date, datetime, timezone
import enum

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

class SocialProvider(str, enum.Enum):
    """
    users 테이블의 social_provider의 값들 정리
    """
    none = "none"
    google = "google"
    kakao = "kakao"


class Gender(str, enum.Enum):
    male = "male"
    female = "female"


class User(Base):
    __tablename__ = "users"

    # 사용자 고유 번호입니다.
    # 각 사용자를 구분하는 기본 키이며, 내부 식별자로 사용합니다.
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # 로그인에 사용할 이메일입니다.
    # 중복 회원가입을 막기 위해 unique=True를 설정합니다.
    # 로그인 시 자주 조회되므로 index도 함께 설정합니다.
    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        index=True,
        nullable=False,
    )

    # 사용자의 원본 비밀번호 대신 해시된 비밀번호를 저장합니다.
    # 로그인 시에는 사용자가 입력한 비밀번호를 해시 비교하여 검증합니다.
    hashed_password: Mapped[str] = mapped_column(
        "password_hash",
        String(255),
        nullable=False,
    )

    # 사용자 이름입니다.
    # 회원가입 후 응답 데이터나 사용자 표시 정보에 활용할 수 있습니다.
    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    birth_date: Mapped[date | None] = mapped_column(
        Date,
        nullable=True,
    )

    phone_number: Mapped[str | None] = mapped_column(
        String(30),
        nullable=True,
    )

    gender: Mapped[str | None] = mapped_column(
        String(20),
        nullable=True,
    )

    profile_image_url: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    # 사용자 역할입니다.
    # 현재는 admin / member / viewer 값을 문자열로 저장하는 구조를 사용합니다.
    # 이후 권한 분기나 관리자 기능 접근 제어에 활용합니다.
    role: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="member",
    )

    social_provider: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=SocialProvider.none.value,
    )

    social_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    # 사용자가 속한 워크스페이스 ID입니다.
    # 관리자는 가입 시 생성된 워크스페이스와 연결되고,
    # 멤버는 초대코드 검증 후 해당 워크스페이스에 연결됩니다.
    workspace_id: Mapped[int | None] = mapped_column(
        ForeignKey("workspaces.id"),
        nullable=True,
    )

    # 사용자가 속한 부서 ID입니다.
    # 아직 부서가 지정되지 않은 사용자를 허용해야 하므로 nullable=True로 둡니다.
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id"),
        nullable=True,
    )

    # 계정 활성 상태입니다.
    # 추후 비활성화/정지/탈퇴 처리 시 사용할 수 있도록 추가합니다.
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
    )

    # 계정 생성 시각입니다.
    # 회원가입 시점을 기록하기 위해 현재 UTC 시간을 저장합니다.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


class UserDeviceSetting(Base):
    __tablename__ = "user_device_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        unique=True,
        nullable=False,
    )
    workspace_id: Mapped[int | None] = mapped_column(
        ForeignKey("workspaces.id"),
        nullable=True,
    )
    selected_mic_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    selected_camera_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mic_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    camera_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
