"""
supervisor_node 단위 테스트.

supervisor_node는 SharedState를 검사해 next_node를 결정하는 순수 로직 함수입니다.
외부 I/O가 없으므로 모든 분기를 mock 없이 테스트할 수 있습니다.
"""

import pytest
from app.core.graph.supervisor import supervisor_node


class TestSupervisorNodeRouting:
    """supervisor_node 라우팅 분기 테스트."""

    @pytest.mark.asyncio
    async def test_no_integration_settings_routes_to_integration(self, base_state):
        """integration_settings가 비어 있으면 'integration' 노드로 라우팅합니다."""
        base_state["integration_settings"] = {}
        result = await supervisor_node(base_state)
        assert result["next_node"] == "integration"

    @pytest.mark.asyncio
    async def test_transcript_without_docs_routes_to_knowledge(self, base_state):
        """transcript는 있고 retrieved_docs가 없으면 'knowledge' 노드로 라우팅합니다."""
        base_state["integration_settings"] = {"slack": True}
        base_state["transcript"] = [
            {"speaker": "홍길동", "text": "오늘 스프린트 목표를 정합시다.", "timestamp": "10:00"}
        ]
        base_state["retrieved_docs"] = []
        result = await supervisor_node(base_state)
        assert result["next_node"] == "knowledge"

    @pytest.mark.asyncio
    async def test_knowledge_node_sets_search_query(self, base_state):
        """knowledge 노드로 분기할 때 search_query가 transcript로 설정됩니다."""
        transcript = [{"speaker": "김철수", "text": "API 응답 속도 개선 방안은?", "timestamp": "10:05"}]
        base_state["integration_settings"] = {"slack": True}
        base_state["transcript"] = transcript
        base_state["retrieved_docs"] = []
        result = await supervisor_node(base_state)
        assert result.get("search_query") == transcript

    @pytest.mark.asyncio
    async def test_docs_without_summary_routes_to_intelligence(self, base_state):
        """retrieved_docs가 있고 summary가 없으면 'intelligence' 노드로 라우팅합니다."""
        base_state["integration_settings"] = {"slack": True}
        base_state["retrieved_docs"] = [{"source": "past_meetings", "snippet": "지난 스프린트 요약"}]
        base_state["summary"] = {}
        result = await supervisor_node(base_state)
        assert result["next_node"] == "intelligence"

    @pytest.mark.asyncio
    async def test_all_conditions_met_routes_to_end(self, base_state):
        """모든 조건이 충족되면 'end'로 라우팅합니다."""
        base_state["integration_settings"] = {"slack": True}
        base_state["transcript"] = [{"speaker": "이영희", "text": "마무리합시다.", "timestamp": "11:00"}]
        base_state["retrieved_docs"] = [{"source": "internal_db", "snippet": "관련 문서"}]
        base_state["summary"] = {"overview": {"purpose": "스프린트 리뷰"}}
        result = await supervisor_node(base_state)
        assert result["next_node"] == "end"

    @pytest.mark.asyncio
    async def test_empty_transcript_without_retrieved_docs_routes_to_end(self, base_state):
        """transcript가 비어 있고 retrieved_docs도 없으면 'end'로 라우팅합니다."""
        base_state["integration_settings"] = {"slack": True}
        base_state["transcript"] = []
        base_state["retrieved_docs"] = []
        result = await supervisor_node(base_state)
        assert result["next_node"] == "end"

    @pytest.mark.asyncio
    async def test_none_integration_settings_routes_to_integration(self, base_state):
        """integration_settings가 None이면 'integration' 노드로 라우팅합니다."""
        base_state["integration_settings"] = None
        result = await supervisor_node(base_state)
        assert result["next_node"] == "integration"
