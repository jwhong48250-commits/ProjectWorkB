# app/core/lifespan.py
from contextlib import asynccontextmanager
import contextlib

from fastapi import FastAPI
from sqlalchemy import inspect
from sqlalchemy import text
import asyncio

from app.core.config import settings
from app.infra.clients.session_manager import ClientSessionManager
from app.infra.database.base import Base
from app.infra.database.session import engine
from scripts.seed import seed_test_data
from app.domains.notification.jobs import notification_jobs_loop

# 모든 모델을 import해야 Base가 테이블을 인식함
from app.domains.user.models import User, UserDeviceSetting
from app.domains.workspace.models import Workspace, InviteCode, WorkspaceMember, DeviceSetting, Department
from app.domains.meeting.models import Meeting, MeetingParticipant, SpeakerProfile
from app.domains.intelligence.models import Decision, MeetingMinute, MinutePhoto, ReviewRequest
from app.domains.action.models import ActionItem, WbsEpic, WbsTask, Report, WbsSnapshot
from app.domains.integration.models import Integration
from app.domains.notification.models import Notification


def _reset_mysql_schema() -> None:
    """
    MySQL에서 순환 FK가 있어도 전체 테이블을 강제로 초기화합니다.
    """
    with engine.begin() as conn:
        conn.execute(text("SET FOREIGN_KEY_CHECKS=0"))
        table_rows = conn.execute(text("SHOW TABLES")).fetchall()
        for row in table_rows:
            table_name = row[0]
            conn.execute(text(f"DROP TABLE IF EXISTS `{table_name}`"))
        conn.execute(text("SET FOREIGN_KEY_CHECKS=1"))


def _ensure_user_profile_columns() -> None:
    """
    create_all() does not alter existing tables, so local databases created
    before social login/profile fields need these columns added explicitly.
    """
    inspector = inspect(engine)
    if not inspector.has_table("users"):
        return

    existing_columns = {column["name"] for column in inspector.get_columns("users")}
    statements: list[str] = []

    if "social_provider" not in existing_columns:
        statements.append("ALTER TABLE users ADD COLUMN social_provider VARCHAR(20) NOT NULL DEFAULT 'none'")

    if "social_id" not in existing_columns:
        statements.append("ALTER TABLE users ADD COLUMN social_id VARCHAR(255) NULL")

    if "birth_date" not in existing_columns:
        statements.append("ALTER TABLE users ADD COLUMN birth_date DATE NULL")

    if "phone_number" not in existing_columns:
        statements.append("ALTER TABLE users ADD COLUMN phone_number VARCHAR(30) NULL")

    if "gender" not in existing_columns:
        statements.append("ALTER TABLE users ADD COLUMN gender VARCHAR(20) NULL")

    if "profile_image_url" not in existing_columns:
        statements.append("ALTER TABLE users ADD COLUMN profile_image_url VARCHAR(500) NULL")

    if not statements:
        return

    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))


async def _prefetch_fonts() -> None:
    """앱 시작 시 PDF 생성용 한글 폰트를 임시 디렉터리에 미리 준비합니다."""
    try:
        from app.domains.action.minutes_pipeline.pdf_renderer import prefetch_fonts
        loop = asyncio.get_event_loop()
        ok = await loop.run_in_executor(None, prefetch_fonts)
        if ok:
            print("[폰트] NanumGothic 다운로드/확인 완료 → tmp/workb-fonts")
        else:
            print("[폰트] NanumGothic 다운로드 실패 — 시스템 폰트 또는 Helvetica 사용")
    except Exception as exc:
        print(f"[폰트] 폰트 준비 중 오류: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    should_reset_db = settings.DEBUG and settings.RESET_DB_ON_STARTUP
    jobs_task: asyncio.Task | None = None

    if should_reset_db:
        _reset_mysql_schema()
        print("🗑️  [DEBUG] 전체 테이블 삭제 완료")

    Base.metadata.create_all(bind=engine)
    _ensure_user_profile_columns()
    print("테이블 생성 완료")

    # [시작 시] HTTP 클라이언트 세션 초기화
    await ClientSessionManager.get_client()

    # [시작 시] PDF 한글 폰트 준비
    await _prefetch_fonts()

    if should_reset_db:
        seed_test_data()

    if settings.NOTIFICATION_JOBS_ENABLED:
        jobs_task = asyncio.create_task(notification_jobs_loop())

    yield
    
    # [종료 시] 연결 닫기
    await ClientSessionManager.close_client()

    if jobs_task is not None:
        jobs_task.cancel()
        with contextlib.suppress(Exception):
            await jobs_task
