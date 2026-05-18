"""
캘린더 도구 단위 테스트.

register_calendar, update_calendar_event, delete_calendar_event, get_calendar_events는
현재 외부 Google Calendar API를 직접 호출하지 않고 TODO 상태의 stub 함수입니다.
올바른 반환 구조와 타입을 검증합니다.
"""

import pytest
from app.domains.knowledge.agent_utils import (
    register_calendar,
    update_calendar_event,
    delete_calendar_event,
    get_calendar_events,
)


class TestRegisterCalendar:
    """register_calendar 도구 테스트."""

    def test_returns_registered_status(self):
        """일정 등록 시 status='registered'를 반환합니다."""
        result = register_calendar(
            title="스프린트 킥오프",
            start="2026-05-01T10:00:00+09:00",
            end="2026-05-01T11:00:00+09:00",
        )
        assert result["status"] == "registered"

    def test_returns_correct_title_and_dates(self):
        """반환값에 입력한 제목과 시작 시간이 포함됩니다."""
        result = register_calendar(
            title="주간 회의",
            start="2026-04-28T09:00:00+09:00",
        )
        assert result["title"] == "주간 회의"
        assert result["start"] == "2026-04-28T09:00:00+09:00"

    def test_optional_fields_default_to_empty(self):
        """선택 필드(end, description, location)를 생략해도 동작합니다."""
        result = register_calendar(title="미팅", start="2026-04-28T09:00:00+09:00")
        assert "status" in result

    def test_returns_dict(self):
        """반환값이 dict 타입이어야 합니다."""
        result = register_calendar(title="테스트", start="2026-04-28T09:00:00+09:00")
        assert isinstance(result, dict)


class TestUpdateCalendarEvent:
    """update_calendar_event 도구 테스트."""

    def test_returns_updated_status(self):
        """일정 수정 시 status='updated'를 반환합니다."""
        result = update_calendar_event(event_id="event_abc123")
        assert result["status"] == "updated"

    def test_returns_event_id(self):
        """반환값에 event_id가 포함됩니다."""
        result = update_calendar_event(event_id="event_xyz789", title="수정된 제목")
        assert result["event_id"] == "event_xyz789"

    def test_all_optional_fields_accepted(self):
        """모든 선택 필드를 함께 전달해도 정상 동작합니다."""
        result = update_calendar_event(
            event_id="ev001",
            title="새 제목",
            start="2026-05-01T10:00:00+09:00",
            end="2026-05-01T11:00:00+09:00",
            description="설명 수정",
            location="회의실 A",
        )
        assert result["status"] == "updated"


class TestDeleteCalendarEvent:
    """delete_calendar_event 도구 테스트."""

    def test_returns_deleted_status(self):
        """일정 삭제 시 status='deleted'를 반환합니다."""
        result = delete_calendar_event(event_id="event_del001")
        assert result["status"] == "deleted"

    def test_returns_correct_event_id(self):
        """반환값에 삭제 대상 event_id가 포함됩니다."""
        result = delete_calendar_event(event_id="event_del999")
        assert result["event_id"] == "event_del999"


class TestGetCalendarEvents:
    """get_calendar_events 도구 테스트."""

    def test_returns_list(self):
        """현재 stub 구현은 빈 리스트를 반환합니다."""
        result = get_calendar_events(date="2026-04-28")
        assert isinstance(result, list)

    def test_accepts_date_only(self):
        """날짜만 전달해도 정상 동작합니다."""
        result = get_calendar_events(date="2026-04-23")
        assert result == []

    def test_accepts_event_id_only(self):
        """event_id만 전달해도 정상 동작합니다."""
        result = get_calendar_events(event_id="ev_12345")
        assert result == []

    def test_accepts_no_arguments(self):
        """인자 없이 호출해도 정상 동작합니다."""
        result = get_calendar_events()
        assert result == []
