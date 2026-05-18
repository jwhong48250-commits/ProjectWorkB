"""
knowledge_node 단위 테스트.

테스트 범위:
  - JSON 응답 파싱 후 올바른 chat_response 반환
  - tool 사용 여부에 따른 citation 검증 분기
  - citation 검증 실패 시 fallback 답변
  - 회의 중(is_live=True) STT 딜레이 고지 prepend
  - LLM JSON 파싱 실패 시 원문 반환
"""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

import app.domains.knowledge.agent_utils as agent_utils
from app.domains.knowledge.agent_utils import knowledge_node


def _make_agent_result(content: str, tool_calls=None):
    """react_agent.ainvoke 반환값 형식 모방."""
    msg = MagicMock()
    msg.content = content
    if tool_calls:
        msg.tool_calls = tool_calls
    else:
        msg.tool_calls = None
    return {"messages": [msg]}


class TestKnowledgeNodeBasic:
    """knowledge_node 기본 동작 테스트."""

    @pytest.mark.asyncio
    async def test_returns_chat_response_and_function_type(self, base_state):
        """올바른 JSON 응답을 받으면 chat_response와 function_type='agent'를 반환합니다."""
        base_state["user_question"] = "오늘 회의에서 결정된 사항이 무엇인가요?"
        response_content = json.dumps({
            "answer": "배포 일정을 2주 앞당기기로 결정했습니다.",
            "confidence": "high",
            "hedge_note": "근거 있음",
            "citations": [],
        })

        with (
            patch.object(agent_utils, "is_meeting_live", new=AsyncMock(return_value=False)),
            patch.object(agent_utils, "get_meeting_context", new=AsyncMock(return_value="")),
            patch.object(agent_utils.react_agent, "ainvoke", new=AsyncMock(
                return_value=_make_agent_result(response_content)
            )),
        ):
            result = await knowledge_node(base_state)

        assert result["function_type"] == "agent"
        assert "배포 일정을 2주 앞당기기로 결정했습니다." in result["chat_response"]

    @pytest.mark.asyncio
    async def test_prepends_stt_delay_notice_when_live(self, base_state):
        """회의 중(is_live=True)이면 STT 딜레이 고지 문구가 답변 앞에 붙습니다."""
        base_state["user_question"] = "현재 논의 중인 주제는?"
        response_content = json.dumps({
            "answer": "API 성능 개선 방안을 논의 중입니다.",
            "confidence": "high",
            "hedge_note": "근거 있음",
            "citations": [],
        })

        with (
            patch.object(agent_utils, "is_meeting_live", new=AsyncMock(return_value=True)),
            patch.object(agent_utils, "get_meeting_context", new=AsyncMock(return_value="")),
            patch.object(agent_utils.react_agent, "ainvoke", new=AsyncMock(
                return_value=_make_agent_result(response_content)
            )),
        ):
            result = await knowledge_node(base_state)

        assert result["chat_response"].startswith("※ 아래는 약 30초 전까지 반영된 발화 기준")

    @pytest.mark.asyncio
    async def test_no_stt_notice_when_not_live(self, base_state):
        """회의가 끝난 상태(is_live=False)이면 STT 딜레이 고지가 없습니다."""
        base_state["user_question"] = "회의 결론은?"
        response_content = json.dumps({
            "answer": "다음 스프린트 목표가 확정됐습니다.",
            "confidence": "high",
            "hedge_note": "근거 있음",
            "citations": [],
        })

        with (
            patch.object(agent_utils, "is_meeting_live", new=AsyncMock(return_value=False)),
            patch.object(agent_utils, "get_meeting_context", new=AsyncMock(return_value="")),
            patch.object(agent_utils.react_agent, "ainvoke", new=AsyncMock(
                return_value=_make_agent_result(response_content)
            )),
        ):
            result = await knowledge_node(base_state)

        assert "약 30초" not in result["chat_response"]


class TestCitationVerification:
    """citation 검증 분기 테스트."""

    @pytest.mark.asyncio
    async def test_valid_citation_appended_to_answer(self, base_state):
        """citation이 발화 원문에 존재하면 답변에 인용구 블록이 추가됩니다."""
        meeting_context = "[홍길동] 프로젝트 일정을 2주 앞당기기로 결정했습니다."
        base_state["user_question"] = "일정 변경 결정 내용은?"
        response_content = json.dumps({
            "answer": "일정을 2주 앞당기기로 결정했습니다.",
            "confidence": "high",
            "hedge_note": "근거 있음",
            "citations": ["[홍길동] 프로젝트 일정을 2주 앞당기기로 결정했습니다."],
        })

        with (
            patch.object(agent_utils, "is_meeting_live", new=AsyncMock(return_value=False)),
            patch.object(agent_utils, "get_meeting_context", new=AsyncMock(return_value=meeting_context)),
            patch.object(agent_utils.react_agent, "ainvoke", new=AsyncMock(
                return_value=_make_agent_result(response_content)
            )),
        ):
            result = await knowledge_node(base_state)

        assert "📎 근거 발화" in result["chat_response"]

    @pytest.mark.asyncio
    async def test_fabricated_citation_triggers_fallback(self, base_state):
        """citation이 발화 원문과 일치하지 않으면 fallback 답변으로 대체됩니다."""
        meeting_context = "[김철수] 예산을 축소하기로 했습니다."
        base_state["user_question"] = "인사 결정 사항은?"
        response_content = json.dumps({
            "answer": "구조조정을 진행하기로 결정했습니다.",
            "confidence": "high",
            "hedge_note": "근거 있음",
            "citations": ["[이영희] 전혀 다른 내용의 발화입니다. 완전히 조작된 인용구입니다."],
        })

        with (
            patch.object(agent_utils, "is_meeting_live", new=AsyncMock(return_value=False)),
            patch.object(agent_utils, "get_meeting_context", new=AsyncMock(return_value=meeting_context)),
            patch.object(agent_utils.react_agent, "ainvoke", new=AsyncMock(
                return_value=_make_agent_result(response_content)
            )),
        ):
            result = await knowledge_node(base_state)

        assert result["chat_response"] == "해당 내용은 회의에서 확인되지 않았습니다."

    @pytest.mark.asyncio
    async def test_tool_used_skips_citation_verification(self, base_state):
        """도구를 사용한 경우 citation 검증을 건너뜁니다."""
        base_state["user_question"] = "최신 AI 트렌드를 검색해줘."
        tool_call_mock = MagicMock()
        tool_call_mock.tool_calls = [{"name": "web_search", "args": {"query": "AI trend"}}]

        # 두 번째 메시지(final answer)에는 tool_calls 없음
        final_msg = MagicMock()
        final_msg.content = json.dumps({
            "answer": "2026년 AI 트렌드: 멀티모달 에이전트가 주목받고 있습니다.",
            "confidence": "high",
            "hedge_note": "근거 있음",
            "citations": [],
        })
        final_msg.tool_calls = None

        with (
            patch.object(agent_utils, "is_meeting_live", new=AsyncMock(return_value=False)),
            patch.object(agent_utils, "get_meeting_context", new=AsyncMock(return_value="")),
            patch.object(agent_utils.react_agent, "ainvoke", new=AsyncMock(
                return_value={"messages": [tool_call_mock, final_msg]}
            )),
        ):
            result = await knowledge_node(base_state)

        # fallback 답변으로 대체되지 않았어야 함
        assert result["chat_response"] != "해당 내용은 회의에서 확인되지 않았습니다."
        assert result["function_type"] == "agent"

    @pytest.mark.asyncio
    async def test_medium_confidence_appends_hedge_note(self, base_state):
        """confidence가 medium이면 간접 근거 고지 문구가 추가됩니다."""
        meeting_context = "[홍길동] 비용 절감을 검토해보겠다고 말했습니다."
        base_state["user_question"] = "비용 관련 결정은?"
        response_content = json.dumps({
            "answer": "비용 절감을 검토하기로 했습니다.",
            "confidence": "medium",
            "hedge_note": "간접 근거",
            "citations": ["[홍길동] 비용 절감을 검토해보겠다고 말했습니다."],
        })

        with (
            patch.object(agent_utils, "is_meeting_live", new=AsyncMock(return_value=False)),
            patch.object(agent_utils, "get_meeting_context", new=AsyncMock(return_value=meeting_context)),
            patch.object(agent_utils.react_agent, "ainvoke", new=AsyncMock(
                return_value=_make_agent_result(response_content)
            )),
        ):
            result = await knowledge_node(base_state)

        assert "간접적으로 언급된 내용" in result["chat_response"]


class TestKnowledgeNodeEdgeCases:
    """knowledge_node 엣지 케이스 테스트."""

    @pytest.mark.asyncio
    async def test_llm_json_parse_failure_uses_raw_content(self, base_state):
        """LLM 응답이 JSON이 아니면 원문 그대로 chat_response로 사용합니다."""
        base_state["user_question"] = "오늘 날씨?"
        raw_content = "이것은 JSON 형식이 아닌 일반 텍스트 응답입니다."

        with (
            patch.object(agent_utils, "is_meeting_live", new=AsyncMock(return_value=False)),
            patch.object(agent_utils, "get_meeting_context", new=AsyncMock(return_value="")),
            patch.object(agent_utils.react_agent, "ainvoke", new=AsyncMock(
                return_value=_make_agent_result(raw_content)
            )),
        ):
            result = await knowledge_node(base_state)

        assert result["function_type"] == "agent"
        # fallback 또는 원문이 포함되어야 함
        assert result["chat_response"]

    @pytest.mark.asyncio
    async def test_no_meeting_id_skips_redis_calls(self, base_state):
        """meeting_id가 없으면 Redis 호출 없이 동작합니다."""
        base_state["meeting_id"] = None
        base_state["user_question"] = "일반 질문입니다."
        response_content = json.dumps({
            "answer": "일반 답변입니다.",
            "confidence": "low",
            "hedge_note": "근거 없음",
            "citations": [],
        })

        mock_is_live = AsyncMock(return_value=False)
        mock_get_context = AsyncMock(return_value="")

        with (
            patch.object(agent_utils, "is_meeting_live", new=mock_is_live),
            patch.object(agent_utils, "get_meeting_context", new=mock_get_context),
            patch.object(agent_utils.react_agent, "ainvoke", new=AsyncMock(
                return_value=_make_agent_result(response_content)
            )),
        ):
            result = await knowledge_node(base_state)

        # meeting_id=None이면 is_meeting_live/get_meeting_context가 호출되지 않아야 함
        mock_is_live.assert_not_called()
        mock_get_context.assert_not_called()
        assert result["function_type"] == "agent"
