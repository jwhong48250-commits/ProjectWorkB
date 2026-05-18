"""
테스트 공통 픽스처.

DATABASE_URL 을 SQLite 로 덮어쓴 뒤 앱 모듈을 임포트해야
app.infra.database.session.engine 이 SQLite 로 생성됩니다.

AI/외부서비스 의존 모듈들은 sys.modules 에 MagicMock 을 미리 등록해
모듈 수준 초기화(ChromaDB 연결, LLM 바인딩 등)를 건너뜁니다.
"""

import os
import sys
from unittest.mock import MagicMock

# ── 1. 환경변수 (앱 임포트 이전 설정) ──────────────────────────────────────
os.environ["DATABASE_URL"] = "sqlite:///./test_workb.db"
os.environ["SECRET_KEY"] = "test-secret-key-for-tests-only"
# .env 의 DEBUG=True / RESET_DB_ON_STARTUP=True 를 덮어써서
# lifespan 의 MySQL 전용 스키마 초기화 로직이 실행되지 않도록 합니다.
os.environ["DEBUG"] = "False"
os.environ["RESET_DB_ON_STARTUP"] = "False"

# ── 2. 미설치·서버 필요 패키지 Mock ────────────────────────────────────────
_MOCK_MODULES = [
    # 미설치 패키지
    "langchain_community",
    "langchain_community.tools",
    "langchain_community.tools.tavily_search",
    "langchain_text_splitters",
    "pdf2image",
    # ChromaDB (설치됨, but HttpClient 가 서버 연결 시도)
    "chromadb",
    "chromadb.utils",
    "chromadb.utils.embedding_functions",
    # redis_utils 가 numpy._core(numpy 2.x 전용) 를 임포트하므로 모듈 자체를 mock
    "app.utils.redis_utils",
    # 모듈 수준에서 AI 초기화가 일어나는 앱 내부 모듈
    "app.core.graph.state",
    "app.core.graph.workflow",
    "app.core.graph.supervisor",
    "app.domains.knowledge.agent_utils",
    "app.domains.knowledge.service",
    "app.domains.vision.agent_utils",
    "app.domains.vision.service",
]
for _mod in _MOCK_MODULES:
    sys.modules.setdefault(_mod, MagicMock())

# ── 3. 앱 임포트 (모든 모델이 Base.metadata 에 등록됨) ──────────────────────
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from app.infra.database.base import Base
from app.infra.database.session import get_db
from app.main import app
from app.core.security import create_access_token, create_refresh_token, hash_password
from app.domains.user.models import User
from app.domains.workspace.models import Workspace, WorkspaceMember, MemberRole
from app.domains.integration.models import Integration, ServiceType

# ── 4. SQLite 테스트 엔진 ────────────────────────────────────────────────────
SQLITE_URL = "sqlite:///./test_workb.db"
test_engine = create_engine(SQLITE_URL, connect_args={"check_same_thread": False})
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


def get_test_db():
    """모든 라우터의 get_db 를 대체하는 테스트 세션 팩토리."""
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


# FastAPI 의존성 오버라이드
app.dependency_overrides[get_db] = get_test_db


# ── 5. 세션 스코프 픽스처 ───────────────────────────────────────────────────

@pytest.fixture(scope="session")
def client():
    """전체 테스트 세션에서 공유하는 TestClient (라이프사이클 1회)."""
    Base.metadata.create_all(bind=test_engine)
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c
    Base.metadata.drop_all(bind=test_engine)
    if os.path.exists("test_workb.db"):
        os.remove("test_workb.db")


# ── 6. 함수 스코프 픽스처 ───────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def clean_db(request):
    """매 테스트 전에 모든 테이블 데이터를 삭제합니다.

    일반 API 테스트는 client 세션 스코프 픽스처가 먼저 실행되도록 보장합니다.
    graph 단위 테스트는 FastAPI TestClient가 필요 없으므로 앱 lifespan을 띄우지 않습니다.
    SQLite 는 기본적으로 FK 제약을 강제하지 않으므로 순서 무관하게 삭제 가능합니다.
    """
    if "tests/graph" in str(request.node.fspath):
        yield
        return

    request.getfixturevalue("client")
    with test_engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())
    yield


@pytest.fixture
def db():
    """픽스처에서 직접 DB 조작이 필요할 때 사용하는 세션."""
    session = TestSessionLocal()
    try:
        yield session
    finally:
        session.close()


# ── 7. 도메인 데이터 픽스처 ─────────────────────────────────────────────────

@pytest.fixture
def workspace(db):
    """테스트용 워크스페이스."""
    ws = Workspace(name="Test Workspace", invite_code="TESTCODE")
    db.add(ws)
    db.commit()
    db.refresh(ws)
    return ws


@pytest.fixture
def admin_user(db, workspace):
    """관리자 유저 + WorkspaceMember(admin).

    get_current_user_id() 가 1 을 하드코딩하므로 clean_db 이후 첫 번째로
    삽입된 유저가 id=1 이어야 합니다. (SQLite 에서 DELETE 후 자동증가 재시작)
    """
    user = User(
        email="admin@test.com",
        hashed_password=hash_password("Admin1234"),
        name="Test Admin",
        role="admin",
        workspace_id=workspace.id,
    )
    db.add(user)
    db.flush()

    workspace.owner_id = user.id
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=MemberRole.admin))
    db.commit()
    db.refresh(user)
    db.refresh(workspace)
    return user, workspace


@pytest.fixture
def member_user(db, admin_user):
    """멤버 유저 + WorkspaceMember(member)."""
    _, workspace = admin_user
    user = User(
        email="member@test.com",
        hashed_password=hash_password("Member1234"),
        name="Test Member",
        role="member",
        workspace_id=workspace.id,
    )
    db.add(user)
    db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=MemberRole.member))
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def admin_token(admin_user):
    """관리자용 JWT access token."""
    user, workspace = admin_user
    return create_access_token(
        subject=str(user.id),
        extra_claims={
            "role": user.role,
            "email": user.email,
            "name": user.name,
            "workspace_id": workspace.id,
        },
    )


@pytest.fixture
def member_token(member_user, admin_user):
    """멤버용 JWT access token."""
    _, workspace = admin_user
    return create_access_token(
        subject=str(member_user.id),
        extra_claims={
            "role": member_user.role,
            "email": member_user.email,
            "name": member_user.name,
            "workspace_id": workspace.id,
        },
    )


def auth_header(token: str) -> dict:
    """Bearer 토큰을 Authorization 헤더 딕셔너리로 변환합니다."""
    return {"Authorization": f"Bearer {token}"}
