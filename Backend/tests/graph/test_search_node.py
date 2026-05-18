"""
검색 도구(search_past_meetings, search_internal_db) 단위 테스트.

각 도구 함수는 @tool 데코레이터가 pass-through로 교체되어 있어
실제 async def / sync def 함수 그대로 테스트할 수 있습니다.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

import app.domains.knowledge.agent_utils as agent_utils
from app.domains.knowledge.agent_utils import (
    search_past_meetings,
    search_internal_db,
)


class TestSearchPastMeetings:
    """search_past_meetings 도구 테스트 (MongoDB 기반)."""

    @pytest.mark.asyncio
    async def test_returns_formatted_docs_on_success(self):
        """MongoDB 커서가 문서를 반환하면 올바른 형식의 리스트를 반환합니다."""
        fake_docs = [
            {"title": "3월 스프린트 리뷰", "summary": "배포 일정 논의", "score": 0.9},
            {"title": "2월 기획 회의", "summary": "신기능 기획", "score": 0.7},
        ]

        mock_cursor = MagicMock()
        mock_cursor.to_list = AsyncMock(return_value=fake_docs)
        mock_cursor.sort = MagicMock(return_value=mock_cursor)
        mock_cursor.limit = MagicMock(return_value=mock_cursor)

        mock_collection = MagicMock()
        mock_collection.find = MagicMock(return_value=mock_cursor)

        with patch.object(agent_utils, "mongo_db", {"meeting_contexts": mock_collection}):
            result = await search_past_meetings("스프린트 배포")

        assert len(result) == 2
        assert result[0]["source"] == "past_meetings"
        assert result[0]["title"] == "3월 스프린트 리뷰"
        assert result[0]["snippet"] == "배포 일정 논의"
        assert result[0]["relevance_score"] == 0.9

    @pytest.mark.asyncio
    async def test_returns_empty_list_on_exception(self):
        """MongoDB 예외 발생 시 빈 리스트를 반환합니다 (fallback)."""
        mock_collection = MagicMock()
        mock_collection.find = MagicMock(side_effect=Exception("MongoDB connection error"))

        with patch.object(agent_utils, "mongo_db", {"meeting_contexts": mock_collection}):
            result = await search_past_meetings("에러 쿼리")

        assert result == []

    @pytest.mark.asyncio
    async def test_handles_empty_result(self):
        """검색 결과가 없으면 빈 리스트를 반환합니다."""
        mock_cursor = MagicMock()
        mock_cursor.to_list = AsyncMock(return_value=[])
        mock_cursor.sort = MagicMock(return_value=mock_cursor)
        mock_cursor.limit = MagicMock(return_value=mock_cursor)

        mock_collection = MagicMock()
        mock_collection.find = MagicMock(return_value=mock_cursor)

        with patch.object(agent_utils, "mongo_db", {"meeting_contexts": mock_collection}):
            result = await search_past_meetings("없는 주제")

        assert result == []

    @pytest.mark.asyncio
    async def test_missing_fields_use_defaults(self):
        """문서에 title/summary 필드가 없으면 기본값을 사용합니다."""
        fake_docs = [{"_id": "abc123"}]  # title, summary, score 없음

        mock_cursor = MagicMock()
        mock_cursor.to_list = AsyncMock(return_value=fake_docs)
        mock_cursor.sort = MagicMock(return_value=mock_cursor)
        mock_cursor.limit = MagicMock(return_value=mock_cursor)

        mock_collection = MagicMock()
        mock_collection.find = MagicMock(return_value=mock_cursor)

        with patch.object(agent_utils, "mongo_db", {"meeting_contexts": mock_collection}):
            result = await search_past_meetings("쿼리")

        assert result[0]["title"] == "이전 회의"
        assert result[0]["snippet"] == ""
        assert result[0]["relevance_score"] == 0.5


class TestSearchInternalDb:
    """search_internal_db 도구 테스트 (ChromaDB 기반)."""

    def test_returns_formatted_docs_on_success(self):
        """ChromaDB 쿼리 결과를 올바른 형식의 리스트로 반환합니다."""
        mock_results = {
            "documents": [["내부 정책 문서 내용", "제품 명세서 내용"]],
            "metadatas": [
                [{"title": "인사 정책", "url": None}, {"title": "제품 명세", "url": "https://example.com"}]
            ],
            "distances": [[0.1, 0.3]],
        }

        mock_collection = MagicMock()
        mock_collection.query = MagicMock(return_value=mock_results)

        with patch.object(agent_utils, "get_collection", return_value=mock_collection):
            result = search_internal_db("정책 문서", "1")

        assert len(result) == 2
        assert result[0]["source"] == "internal_db"
        assert result[0]["title"] == "인사 정책"
        assert result[0]["snippet"] == "내부 정책 문서 내용"
        assert abs(result[0]["relevance_score"] - 0.9) < 0.01  # 1 - 0.1

    def test_returns_empty_list_on_exception(self):
        """ChromaDB 예외 발생 시 빈 리스트를 반환합니다 (fallback)."""
        with patch.object(
            agent_utils, "get_collection", side_effect=Exception("ChromaDB unavailable")
        ):
            result = search_internal_db("쿼리", "1")

        assert result == []

    def test_relevance_score_calculation(self):
        """ChromaDB distance를 relevance_score(1 - distance)로 올바르게 변환합니다."""
        mock_results = {
            "documents": [["문서A"]],
            "metadatas": [[{"title": "문서A"}]],
            "distances": [[0.4]],
        }
        mock_collection = MagicMock()
        mock_collection.query = MagicMock(return_value=mock_results)

        with patch.object(agent_utils, "get_collection", return_value=mock_collection):
            result = search_internal_db("쿼리", "1")

        assert abs(result[0]["relevance_score"] - 0.6) < 0.001
