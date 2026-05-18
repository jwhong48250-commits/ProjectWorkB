"""
LangGraph 노드 단위 테스트 공통 설정.

루트 conftest.py의 sys.modules 모킹 중 그래프 관련 모듈을 해제하고
실제 구현 코드를 불러올 수 있도록 준비합니다.

핵심 전략:
  - langchain.tools.tool을 pass-through 데코레이터로 교체 →
    @tool 붙은 함수들이 실제 Python async 함수로 유지됨.
  - motor / redis / langchain_openai 등 서버 연결 패키지를 MagicMock으로 대체.
  - chromadb / langchain_community 는 루트 conftest에서 이미 mock 됨.
"""

import sys
import os
from unittest.mock import MagicMock, AsyncMock
import pytest

# ── 0. 그래프 테스트 전용 환경 변수 ─────────────────────────────────────────
os.environ.setdefault("MONGODB_URL", "mongodb://localhost:27017")
os.environ.setdefault("CHROMA_HOST", "localhost")
os.environ.setdefault("CHROMA_PORT", "8000")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("TAVILY_API_KEY", "test-tavily-key")

# ── 1. @tool 데코레이터를 pass-through로 교체 ────────────────────────────────
# langchain.tools.tool이 MagicMock이면 @tool이 함수를 MagicMock으로 교체해버림.
# lambda f: f 로 교체하면 @tool 데코레이터가 함수를 그대로 반환하므로
# search_past_meetings 등이 실제 async def로 유지됩니다.
_langchain_tools_mock = MagicMock()
_langchain_tools_mock.tool = lambda f: f

_langchain_mock = MagicMock()
_langchain_mock.tools = _langchain_tools_mock

sys.modules["langchain"] = _langchain_mock
sys.modules["langchain.tools"] = _langchain_tools_mock

# ── 2. 나머지 외부 패키지 mock ───────────────────────────────────────────────
_numpy_mock = MagicMock()
_numpy_mock.int32 = int

for _mod in [
    "numpy",
    "numpy._core",
    "numpy._core.numerictypes",
    "langchain_openai",
    "langgraph",
    "langgraph.prebuilt",
    "langgraph.graph",
    "motor",
    "motor.motor_asyncio",
    "redis",
    "redis.asyncio",
]:
    sys.modules.setdefault(_mod, _numpy_mock if "numpy" in _mod else MagicMock())

# ── 3. 실제 그래프 모듈 임포트를 위해 루트 conftest mock 해제 ────────────────
for _mod in [
    "app.core.graph",
    "app.core.graph.state",
    "app.core.graph.supervisor",
    "app.core.graph.workflow",
    "app.domains.knowledge.agent_utils",
    "app.utils.redis_utils",
]:
    sys.modules.pop(_mod, None)


# ── 픽스처 ──────────────────────────────────────────────────────────────────

@pytest.fixture
def base_state() -> dict:
    """모든 SharedState 필드를 초기값으로 채운 기본 상태."""
    return {
        "next_node": "",
        "current_scenario": "",
        "workspace_id": 1,
        "meeting_id": 42,
        "transcript": [],
        "search_query": "",
        "retrieved_docs": [],
        "chat_history": [],
        "user_question": "테스트 질문입니다.",
        "chat_response": "",
        "summary": {},
        "decisions": [],
        "previous_context": "",
        "screenshot_analysis": "",
        "wbs": [],
        "realtime_actions": [],
        "external_links": {},
        "integration_settings": {"slack": True},
        "accuracy_score": 0.0,
        "errors": [],
        "function_type": "",
    }


@pytest.fixture
def llm_json_response():
    """knowledge_node가 파싱할 JSON 형식 LLM 응답."""
    import json
    content = json.dumps({
        "answer": "테스트 답변입니다.",
        "confidence": "high",
        "hedge_note": "근거 있음",
        "citations": ["[홍길동] 프로젝트 일정을 2주 앞당기기로 했습니다."],
    })
    mock = MagicMock()
    mock.content = content
    return mock


@pytest.fixture
def summary_json_response():
    """summary_node가 파싱할 JSON 형식 LLM 응답."""
    import json
    content = json.dumps({
        "overview": {"purpose": "스프린트 회고", "datetime_str": "2026-04-23 10:00"},
        "discussion_items": [{"topic": "배포 일정", "content": "2주 앞당기기로 결정"}],
        "decisions": [{"decision": "배포 일정 단축", "citation": "[홍길동] 2주 앞당기겠습니다."}],
        "action_items": [
            {
                "assignee": "홍길동",
                "content": "배포 스크립트 수정",
                "deadline": "2026-04-30",
                "priority": "high",
                "urgency": "urgent",
                "citation": "[홍길동] 배포 스크립트 수정하겠습니다.",
            }
        ],
        "pending_items": [],
        "next_meeting": "2026-04-30",
        "previous_followups": [],
        "hallucination_flags": [],
    })
    mock = MagicMock()
    mock.content = content
    return mock
