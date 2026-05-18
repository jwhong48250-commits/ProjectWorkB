# Workb Backend

AI 회의 어시스턴트 서비스의 백엔드 프로젝트입니다. FastAPI + LangGraph 기반 멀티 에이전트 시스템으로, 실시간 회의 분석·요약·액션 아이템 추출을 담당합니다.

## 사전 요구사항

- Python **3.11** 권장 (`Dockerfile`의 `python:3.11-slim`과 맞춤). 3.10 이상에서 동작을 가정합니다.
- MySQL 8.x
- Redis
- MongoDB
- ChromaDB (벡터/RAG, `requirements.txt`의 `chromadb` 기준으로 로컬에서 사용)

## 설치

가상환경을 생성하고 패키지를 설치합니다.

```bash
python -m venv venv

# Mac / Linux
source venv/bin/activate

# Windows (PowerShell)
# .\venv\Scripts\Activate.ps1
# Windows (CMD)
# venv\Scripts\activate.bat
# Windows (Git Bash 등)
# source venv/Scripts/activate

pip install --upgrade pip
pip install -r requirements.txt
```

설치 중 인코딩 오류가 나면 `PYTHONUTF8=1 pip install -r requirements.txt`를 사용합니다.

## 환경 변수

`.env.example`을 복사해 `.env`를 생성한 뒤 값을 채웁니다.

```bash
cp .env.example .env     # Mac / Linux
copy .env.example .env   # Windows
```

| 변수명 | 필수 | 설명 |
|---|---|---|
| `DATABASE_URL` | 필수 | MySQL 연결 문자열 |
| `MONGODB_URL` | 필수 | MongoDB 연결 문자열 |
| `REDIS_URL` | 필수 | Redis 연결 문자열 |
| `CHROMA_HOST` / `CHROMA_PORT` | 필수 | ChromaDB 주소 |
| `SECRET_KEY` | 필수 | JWT 서명 키 (`python -c "import secrets; print(secrets.token_urlsafe(64))"`) |
| `ALGORITHM` | 필수 | JWT 알고리즘 (기본값: `HS256`) |
| `FRONTEND_URL` | 필수 | 프론트엔드 origin (CORS, OAuth 리다이렉트) |
| `OPENAI_API_KEY` | 필수 | OpenAI API 키 |
| `GEMINI_API_KEY` | 선택 | Google Gemini API 키 |
| `ANTHROPIC_API_KEY` | 선택 | Anthropic API 키 |
| `TAVILY_API_KEY` | 선택 | Tavily 검색 API 키 |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | 선택 | Slack OAuth 연동 |
| `JIRA_CLIENT_ID` / `JIRA_CLIENT_SECRET` | 선택 | Jira OAuth 연동 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 선택 | Google Calendar / 로그인 OAuth |
| `KAKAO_REST_API_KEY` / `KAKAO_CLIENT_SECRET` | 선택 | 카카오 로그인 |
| `SMTP_HOST` 외 SMTP 설정 | 선택 | 이메일 발송 (관리자 가입 안내, 비밀번호 재설정) |
| `AWS_ACCESS_KEY_ID` 외 AWS 설정 | 선택 | S3 파일 업로드 |

각 변수의 상세 설명과 배포 체크리스트는 `.env.example`의 주석을 참고합니다. `.env`는 Git에 올리지 않습니다.

## 로컬 실행

```bash
uvicorn app.main:app --reload
```

| 엔드포인트 | 설명 |
|---|---|
| `http://localhost:8000` | API 서버 |
| `http://localhost:8000/docs` | Swagger UI (API 테스트) |
| `http://localhost:8000/health` | 헬스체크 |

## 테스트

```bash
# 전체 테스트
pytest

# 특정 도메인 테스트
pytest tests/domains/meeting
```

## 디렉터리 개요

```
app/
  api/v1/           # API 라우터 집결 (api_router.py)
  core/
    graph/          # LangGraph Supervisor · State · Workflow
    ontology/       # 도메인 온톨로지
  domains/          # 도메인별 비즈니스 로직
    action/         # 액션 아이템, WBS, 문서 변환
    integration/    # 워크스페이스 식별자 및 외부 서비스 OAuth 연동
    intelligence/   # 요약·결정사항 추출, Supervisor 역할
    knowledge/      # 검색·RAG (ChromaDB 등)
    meeting/        # 실시간 STT·발화 스트림·회의 관리
    notification/   # 알림 발송
    quality/        # 정확도 검증·에러 모니터링
    user/           # 인증·음성 지문 프로필
    vision/         # 화면 OCR·이미지 분석
    workspace/      # 팀·멤버·설정 관리
  infra/
    clients/        # 외부 서비스 클라이언트 (Slack, Jira, Google 등)
    database/       # SQLAlchemy 세션·Base
    websocket/      # WebSocket 연결 관리
  utils/
```

## 관련 문서

- 프론트엔드: [`workb-frontend/README.md`](../workb-frontend/README.md)

---

## 도메인 개발 표준 (v1.1)

멀티 에이전트 시스템의 일관성을 유지하기 위해 모든 도메인 개발자가 준수해야 할 표준입니다.

### 1. 폴더 구조 및 역할 (Layered Architecture)

각 도메인은 `app/domains/{domain_name}/` 아래 6개 파일을 기본으로 구성합니다.

| 파일명 | 역할 | 비고 |
|---|---|---|
| `agent_utils.py` | Prompt store | LLM 프롬프트 정의 및 버전 관리 |
| `models.py` | Database Entity | SQLAlchemy DB 테이블 정의 |
| `schemas.py` | Data Contract (DTO) | Pydantic 입출력 규격 |
| `repository.py` | Data Access | 순수 DB CRUD (비즈니스 로직 금지) |
| `service.py` | Business Logic | 에이전트 호출, 데이터 가공, 타 도메인 협업 |
| `router.py` | API Endpoint | 외부 요청 수신 및 서비스 연결 |

### 2. 레이어별 코드 템플릿

**models.py**

```python
from sqlalchemy import Column, Integer, String, DateTime, Text
from app.infra.database.base import Base
from datetime import datetime

class DomainModel(Base):
    __tablename__ = "domain_table_name"

    id = Column(Integer, primary_key=True, index=True)
    content = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
```

**schemas.py** — 출력은 `Response`, 입력은 `Request`를 클래스 이름 뒤에 붙입니다.

```python
from pydantic import BaseModel
from datetime import datetime

class DomainBase(BaseModel):
    title: str

class DomainCreate(DomainBase):
    pass

class DomainResponse(DomainBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True
```

**repository.py**

```python
from sqlalchemy.orm import Session
from . import models, schemas

class DomainRepository:
    @staticmethod
    def save_data(db: Session, data: schemas.DomainCreate):
        db_obj = models.DomainModel(**data.model_dump())
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    @staticmethod
    def get_by_id(db: Session, obj_id: int):
        return db.query(models.DomainModel).filter(models.DomainModel.id == obj_id).first()
```

**service.py** — LangGraph 노드로 등록될 함수는 `state: SharedState`를 인자로 받고 업데이트된 `dict`를 반환합니다.

```python
from sqlalchemy.orm import Session
from .repository import DomainRepository
from app.core.graph.state import SharedState

class DomainService:
    @staticmethod
    async def process_agent_task(state: SharedState, db: Session) -> dict:
        current_context = state.get("transcript", "")
        # LLM 호출 또는 DB 저장 후 업데이트할 State 조각만 반환
        return {"summary": "분석된 요약 결과"}
```

**router.py**

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.infra.database.session import get_db
from . import service, schemas

router = APIRouter(prefix="/domain-path", tags=["DomainTag"])

@router.post("/", response_model=schemas.DomainResponse)
async def create_endpoint(data: schemas.DomainCreate, db: Session = Depends(get_db)):
    return await service.DomainService.handle_api_request(data, db)
```

라우터를 완성하면 `app/api/v1/api_router.py`에 등록합니다.

```python
from app.domains.meeting.router import router as meeting_router
api_router.include_router(meeting_router)
```

### 3. 협업 핵심 원칙

**SharedState 규칙 (`app/core/graph/state.py`)**

- 모든 도메인 서비스는 중앙 `SharedState`에 정의된 키만 사용합니다.
- 자신이 담당한 도메인의 키만 수정하고, 타 도메인 데이터는 Read-only로 취급합니다.

**비동기 원칙**

- LLM 호출 및 외부 API(Jira, Slack) 연동은 반드시 `async/await`를 사용합니다.

**에러 처리**

- `service.py`의 에이전트 호출 구간에는 `try-except`를 구성하고, 에러 발생 시 `state["errors"]`에 기록합니다.
- 결과 불충분 시: `return {"errors": ["데이터 부족"], "next_step": "researcher"}`

**모크 우선 방식 (Mock-First)**

- `tests/mocks/`에 시나리오별 JSON을 정의해, 타 도메인 구현 완료 전에도 개발 가능하게 합니다.

**독립 테스트**

- 각 도메인은 자기 입력 → 출력만 검증하며, 전체 시스템 없이도 테스트 가능해야 합니다.

### 4. Git 컨벤션

브랜치: `feature/meeting`, `feature/action` 등 도메인별로 분리합니다.

커밋 메시지: `feat(meeting): add speaker diarization logic` 형식으로 접두어를 붙여 도메인을 명시합니다.

### 5. 도메인별 업무 분담 및 SharedState

| 도메인 | 핵심 기능 | SharedState 키 | 저장소 (로컬·기본 구성 기준) |
|---|---|---|---|
| Integration | 워크스페이스/회의 식별자 관리, 외부 서비스 OAuth | `workspace_id`, `meeting_id`, `next_node`, `current_scenario` | MySQL |
| User | 회원가입·로그인, 음성 지문 등록 | `user_id` | MySQL |
| Workspace | 워크스페이스 멤버 권한·설정 관리 | `workspace_id` | MySQL |
| Meeting | 실시간 STT, 화자 분리 발화 스트림 | `transcript` | Redis, MySQL |
| Knowledge | 즉석 검색·RAG, 개별 질문 답변 | `search_query`, `retrieved_docs`, `chat_history`, `user_question`, `chat_response` | ChromaDB, MongoDB |
| Intelligence | 요약·결정사항 추출, 전체 그래프 Supervisor | `summary`, `decisions`, `previous_context` | MySQL |
| Vision | 공유 화면 OCR, 발표 맥락 해석 | `screenshot_analysis` | MySQL, S3 |
| Action | 액션 아이템 감지, WBS 생성, 문서 변환 | `wbs`, `realtime_actions`, `external_links` | MySQL, S3 |
| Quality | 결과물 정확도 검증, 에러·지연 모니터링 | `integration_settings`, `accuracy_score`, `errors` | MySQL |

표의 저장소 열은 `.env.example`의 MySQL·MongoDB·Redis·Chroma·S3 설정과 맞춘 참고용입니다. 배포 환경에서 벡터 DB나 RDB 벤더를 바꾼 경우 해당 행만 조정하면 됩니다.
