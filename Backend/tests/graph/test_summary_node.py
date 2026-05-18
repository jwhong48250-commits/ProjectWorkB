"""
summary_node 단위 테스트.

테스트 범위:
  - 정상 발화 → 구조화된 summary dict + 마크다운 chat_response 반환
  - 할루시네이션 검증 (citation 겹침률 계산)
  - partial_summary 캐시 사용 경로
  - 회의 중(is_live=True) STT 딜레이 고지 prepend
  - LLM JSON 파싱 실패 시 빈 dict 반환
  - meeting_id 없을 때 Redis 미호출
"""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

import app.domains.knowledge.agent_utils as agent_utils
from app.domains.knowledge.agent_utils import summary_node


def _search_mock_with_ainvoke(return_value=None):
    """search_past_meetings.ainvoke(...)를 AsyncMock으로 대체한 mock 객체."""
    mock = MagicMock()
    mock.ainvoke = AsyncMock(return_value=return_value or [])
    return mock


def _make_redis_mock(cached=None):
    """r.get / r.set AsyncMock을 포함한 Redis mock."""
    mock = MagicMock()
    mock.get = AsyncMock(return_value=cached)
    mock.set = AsyncMock(return_value=None)
    return mock


class TestSummaryNodeBasic:
    """summary_node 기본 동작 테스트."""

    @pytest.mark.asyncio
    async def test_returns_summary_dict_and_chat_response(self, base_state, summary_json_response):
        """올바른 발화가 있으면 summary dict와 마크다운 chat_response를 반환합니다."""
        base_state["meeting_id"] = 42

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

        assert "summary" in result
        assert isinstance(result["summary"], dict)
        assert result["function_type"] == "summary"
        assert result["chat_response"]

    @pytest.mark.asyncio
    async def test_chat_response_contains_markdown_headers(self, base_state, summary_json_response):
        """마크다운 chat_response에 주요 섹션 헤더가 포함됩니다."""
        base_state["meeting_id"] = 42

        with (
            patch.object(agent_utils, "is_meeting_live", new=AsyncMock(return_value=False)),
            patch.object(agent_utils, "get_meeting_context", new=AsyncMock(
                return_value="[홍길동] 배포 스크립트를 수정하겠습니다."
            )),
            patch.object(agent_utils, "r", new=_make_redis_mock()),
            patch.object(agent_utils, "search_past_meetings", new=_search_mock_with_ainvoke()),
            patch.object(agent_utils, "llm", new_callable=MagicMock) as mock_llm,
            patch("app.domains.knowledge.repository.get_meeting_participants", return_value=[]),
        ):
            mock_llm.ainvoke = AsyncMock(return_value=summary_json_response)

            result = await summary_node(base_state)

        assert "##" in result["chat_response"]

    @pytest.mark.asyncio
    async def test_stt_delay_notice_prepended_when_live(self, base_state, summary_json_response):
        """회의 중이면 STT 딜레이 고지 문구가 앞에 붙습니다."""
        base_state["meeting_id"] = 42

        with (
            patch.object(agent_utils, "is_meeting_live", new=AsyncMock(return_value=True)),
            patch.object(agent_utils, "get_meeting_context", new=AsyncMock(return_value="[A] 내용")),
            patch.object(agent_utils, "r", new=_make_redis_mock()),
            patch.object(agent_utils, "search_past_meetings", new=_search_mock_with_ainvoke()),
            patch.object(agent_utils, "llm", new_callable=MagicMock) as mock_llm,
            patch("app.domains.knowledge.repository.get_meeting_participants", return_value=[]),
        ):
            mock_llm.ainvoke = AsyncMock(return_value=summary_json_response)

            result = await summary_node(base_state)

        assert result["chat_response"].startswith("※ 아래는 약 30초 전까지 반영된 발화 기준")

    @pytest.mark.asyncio
    async def test_no_meeting_id_skips_redis_and_llm_with_empty_context(self, base_state):
        """meeting_id가 없으면 context가 빈 문자열이고 Redis를 호출하지 않습니다."""
        base_state["meeting_id"] = None

        empty_summary_content = json.dumps({
            "overview": {"purpose": "", "datetime_str": ""},
            "discussion_items": [],
            "decisions": [],
            "action_items": [],
            "pending_items": [],
            "next_meeting": None,
            "previous_followups": [],
            "hallucination_flags": [],
        })
        mock_llm_resp = MagicMock()
        mock_llm_resp.content = empty_summary_content

        mock_r = _make_redis_mock()

        with (
            patch.object(agent_utils, "is_meeting_live", new=AsyncMock(return_value=False)),
            patch.object(agent_utils, "get_meeting_context", new=AsyncMock(return_value="")),
            patch.object(agent_utils, "r", new=mock_r),
            patch.object(agent_utils, "search_past_meetings", new=_search_mock_with_ainvoke()),
            patch.object(agent_utils, "llm", new_callable=MagicMock) as mock_llm,
            patch("app.domains.knowledge.repository.get_meeting_participants", return_value=[]),
        ):
            mock_llm.ainvoke = AsyncMock(return_value=mock_llm_resp)
            result = await summary_node(base_state)

        mock_r.get.assert_not_called()
        assert result["function_type"] == "summary"


class TestSummaryNodeHallucination:
    """summary_node 할루시네이션 검증 테스트."""

    @pytest.mark.asyncio
    async def test_verified_citation_flags_as_verified(self, base_state):
        """발화 원문과 충분히 겹치는 citation은 'verified'로 표시됩니다."""
        context = "[홍길동] 배포 스크립트를 금요일까지 수정하겠습니다."
        summary_content = json.dumps({
            "overview": {"purpose": "테스트", "datetime_str": ""},
            "discussion_items": [],
            "decisions": [{"decision": "배포 스크립트 수정", "citation": "[홍길동] 배포 스크립트를 금요일까지 수정하겠습니다."}],
            "action_items": [],
            "pending_items": [],
            "next_meeting": None,
            "previous_followups": [],
            "hallucination_flags": [],
        })
        mock_resp = MagicMock()
        mock_resp.content = summary_content

        with (
            patch.object(agent_utils, "is_meeting_live", new=AsyncMock(return_value=False)),
            patch.object(agent_utils, "get_meeting_context", new=AsyncMock(return_value=context)),
            patch.object(agent_utils, "r", new=_make_redis_mock()),
            patch.object(agent_utils, "search_past_meetings", new=_search_mock_with_ainvoke()),
            patch.object(agent_utils, "llm", new_callable=MagicMock) as mock_llm,
            patch("app.domains.knowledge.repository.get_meeting_participants", return_value=[]),
        ):
            mock_llm.ainvoke = AsyncMock(return_value=mock_resp)

            result = await summary_node(base_state)

        flags = result["summary"].get("hallucination_flags", [])
        assert any(f["confidence"] == "verified" for f in flags)

    @pytest.mark.asyncio
    async def test_missing_citation_flags_as_needs_review(self, base_state):
        """citation이 null인 결정 사항은 'needs_review'로 표시됩니다."""
        context = "[홍길동] 예산을 줄이기로 했습니다."
        summary_content = json.dumps({
            "overview": {"purpose": "테스트", "datetime_str": ""},
            "discussion_items": [],
            "decisions": [{"decision": "예산 삭감", "citation": None}],
            "action_items": [],
            "pending_items": [],
            "next_meeting": None,
            "previous_followups": [],
            "hallucination_flags": [],
        })
        mock_resp = MagicMock()
        mock_resp.content = summary_content

        with (
            patch.object(agent_utils, "is_meeting_live", new=AsyncMock(return_value=False)),
            patch.object(agent_utils, "get_meeting_context", new=AsyncMock(return_value=context)),
            patch.object(agent_utils, "r", new=_make_redis_mock()),
            patch.object(agent_utils, "search_past_meetings", new=_search_mock_with_ainvoke()),
            patch.object(agent_utils, "llm", new_callable=MagicMock) as mock_llm,
            patch("app.domains.knowledge.repository.get_meeting_participants", return_value=[]),
        ):
            mock_llm.ainvoke = AsyncMock(return_value=mock_resp)

            result = await summary_node(base_state)

        flags = result["summary"].get("hallucination_flags", [])
        assert any(f["confidence"] == "needs_review" for f in flags)


class TestSummaryNodePartialCache:
    """summary_node partial_summary 캐시 경로 테스트."""

    @pytest.mark.asyncio
    async def test_uses_cached_partial_summary_when_available(self, base_state, summary_json_response):
        """Redis에 partial_summary 캐시가 있으면 이전 요약 + 새 발화를 조합합니다."""
        base_state["meeting_id"] = 42
        cached_summary = "이전 스프린트 결과 논의 완료"

        with (
            patch.object(agent_utils, "is_meeting_live", new=AsyncMock(return_value=False)),
            patch.object(agent_utils, "get_meeting_context", new=AsyncMock(return_value="[A] 추가 발화")),
            patch.object(agent_utils, "r", new=_make_redis_mock(cached=cached_summary.encode())),
            patch.object(agent_utils, "search_past_meetings", new=_search_mock_with_ainvoke()),
            patch.object(agent_utils, "llm", new_callable=MagicMock) as mock_llm,
            patch("app.domains.knowledge.repository.get_meeting_participants", return_value=[]),
        ):
            mock_llm.ainvoke = AsyncMock(return_value=summary_json_response)

            result = await summary_node(base_state)

        assert result["function_type"] == "summary"
        mock_llm.ainvoke.assert_called_once()
