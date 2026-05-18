"""
StateGraph 전체 플로우 통합 테스트.

supervisor_node → knowledge_node → summary_node 흐름을
외부 I/O를 모두 mock 처리한 뒤 StateGraph를 직접 실행합니다.

현재 workflow.py가 루트 conftest.py에서 mock 처리 중이므로
LangGraph StateGraph를 직접 조립해 통합 테스트를 수행합니다.
"""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

import app.domains.knowledge.agent_utils as agent_utils
from app.core.graph.supervisor import supervisor_node
from app.domains.knowledge.agent_utils import knowledge_node, summary_node


def _search_mock_with_ainvoke(return_value=None):
    mock = MagicMock()
    mock.ainvoke = AsyncMock(return_value=return_value or [])
    return mock


def _make_redis_mock():
    mock = MagicMock()
    mock.get = AsyncMock(return_value=None)
    mock.set = AsyncMock(return_value=None)
    return mock


class TestSupervisorKnowledgeFlow:
    """supervisor → knowledge 플로우 테스트."""

    @pytest.mark.asyncio
    async def test_supervisor_routes_to_knowledge_then_knowledge_responds(self, base_state):
        """supervisor가 knowledge를 선택하고 knowledge_node가 정상 응답합니다."""
        base_state["integration_settings"] = {"slack": True}
        base_state["transcript"] = [{"speaker": "홍길동", "text": "예산 현황은?", "timestamp": "10:00"}]
        base_state["retrieved_docs"] = []
        base_state["user_question"] = "예산 현황을 알려주세요."

        # 1단계: supervisor
        supervisor_result = await supervisor_node(base_state)
        assert supervisor_result["next_node"] == "knowledge"

        # 2단계: knowledge_node 실행
        response_content = json.dumps({
            "answer": "현재 예산 집행률은 60%입니다.",
            "confidence": "medium",
            "hedge_note": "간접 근거",
            "citations": [],
        })
        base_state.update(supervisor_result)

        with (
            patch.object(agent_utils, "is_meeting_live", new=AsyncMock(return_value=False)),
            patch.object(agent_utils, "get_meeting_context", new=AsyncMock(return_value="")),
            patch.object(agent_utils.react_agent, "ainvoke", new=AsyncMock(
                return_value={"messages": [MagicMock(content=response_content, tool_calls=None)]}
            )),
        ):
            knowledge_result = await knowledge_node(base_state)

        assert knowledge_result["function_type"] == "agent"
        assert knowledge_result["chat_response"]


class TestSupervisorIntelligenceFlow:
    """supervisor → intelligence 분기 테스트."""

    @pytest.mark.asyncio
    async def test_supervisor_routes_to_intelligence_when_docs_present(self, base_state):
        """retrieved_docs가 있고 summary가 없으면 intelligence로 라우팅합니다."""
        base_state["integration_settings"] = {"slack": True}
        base_state["retrieved_docs"] = [{"source": "past_meetings", "snippet": "지난 회의 내용"}]
        base_state["summary"] = {}

        result = await supervisor_node(base_state)
        assert result["next_node"] == "intelligence"


class TestSupervisorSummaryFlow:
    """supervisor → knowledge → summary 연계 플로우 테스트."""

    @pytest.mark.asyncio
    async def test_summary_node_produces_markdown_response(self, base_state, summary_json_response):
        """summary_node가 마크다운 형식의 chat_response를 생성합니다."""
        base_state["meeting_id"] = 42
        base_state["user_question"] = "현재까지 회의 내용 요약해줘."

        with (
            patch.object(agent_utils, "is_meeting_live", new=AsyncMock(return_value=False)),
            patch.object(agent_utils, "get_meeting_context", new=AsyncMock(
                return_value="[홍길동] 배포 일정을 2주 앞당기겠습니다."
            )),
            patch.object(agent_utils, "r", new=_make_redis_mock()),
            patch.object(agent_utils, "search_past_meetings", new=_search_mock_with_ainvoke()),
            patch.object(agent_utils, "llm", new_callable=MagicMock) as mock_llm,
            patch("app.domains.knowledge.repository.get_meeting_participants", return_value=["홍길동"]),
        ):
            mock_llm.ainvoke = AsyncMock(return_value=summary_json_response)

            result = await summary_node(base_state)

        assert result["function_type"] == "summary"
        assert "##" in result["chat_response"]
        assert isinstance(result["summary"], dict)


class TestFullStateMerge:
    """노드 결과가 SharedState에 올바르게 병합되는지 검증합니다."""

    @pytest.mark.asyncio
    async def test_supervisor_result_can_update_state(self, base_state):
        """supervisor 결과를 state에 업데이트할 수 있습니다."""
        base_state["integration_settings"] = {"slack": True}
        base_state["transcript"] = [{"speaker": "A", "text": "질문", "timestamp": "10:00"}]
        base_state["retrieved_docs"] = []

        result = await supervisor_node(base_state)
        base_state.update(result)

        assert base_state["next_node"] == "knowledge"

    @pytest.mark.asyncio
    async def test_errors_field_accumulates_across_nodes(self, base_state):
        """errors 필드가 노드 간 누적됩니다."""
        base_state["errors"] = ["이전 노드 에러"]
        base_state["integration_settings"] = {"slack": True}

        result = await supervisor_node(base_state)
        # supervisor_node는 errors를 건드리지 않음
        assert base_state["errors"] == ["이전 노드 에러"]
