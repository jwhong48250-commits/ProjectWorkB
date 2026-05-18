"""
액션 도메인 테스트.

실제 구현된 엔드포인트:
  POST /api/v1/actions/meetings/{meeting_id}/export/slack           (workspace_id 쿼리 필수)
  POST /api/v1/actions/meetings/{meeting_id}/export/google-calendar (workspace_id 쿼리 필수)
  POST /api/v1/actions/meetings/{meeting_id}/next-meeting/suggest   (workspace_id 쿼리 필수)
  POST /api/v1/actions/meetings/{meeting_id}/next-meeting/register  (workspace_id 쿼리 필수)

미구현 라우터 (빈 APIRouter):
  Notion, Kakao, Jira → 스킵

외부 서비스 호출은 unittest.mock.patch 로 처리합니다.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

BASE_ACTIONS = "/api/v1/actions"
BASE_MEETINGS = "/api/v1/meetings"

FUTURE = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()


def _create_meeting(client, workspace_id):
    res = client.post(
        f"{BASE_MEETINGS}/workspaces/{workspace_id}",
        json={
            "title": "액션 테스트 회의",
            "meeting_type": "weekly",
            "scheduled_at": FUTURE,
            "participant_ids": [],
        },
    )
    assert res.status_code == 201
    return res.json()["data"]["meeting_id"]


# ---------------------------------------------------------------------------
# Slack 내보내기
# ---------------------------------------------------------------------------

class TestSlackExport:
    def test_export_accepted(self, client, admin_user):
        """백그라운드 태스크로 즉시 200을 반환합니다."""
        _, workspace = admin_user
        meeting_id = _create_meeting(client, workspace.id)

        with patch(
            "app.domains.action.services.slack.export_slack",
            new_callable=AsyncMock,
        ):
            res = client.post(
                f"{BASE_ACTIONS}/meetings/{meeting_id}/export/slack"
                f"?workspace_id={workspace.id}",
                json={"channel_id": "C123456", "include_action_items": True},
            )
        assert res.status_code == 200
        assert res.json()["status"] == "processing"

    def test_export_without_channel(self, client, admin_user):
        _, workspace = admin_user
        meeting_id = _create_meeting(client, workspace.id)

        with patch(
            "app.domains.action.services.slack.export_slack",
            new_callable=AsyncMock,
        ):
            res = client.post(
                f"{BASE_ACTIONS}/meetings/{meeting_id}/export/slack"
                f"?workspace_id={workspace.id}",
                json={"include_action_items": False},
            )
        assert res.status_code == 200

    def test_export_missing_workspace_id_returns_422(self, client, admin_user):
        """workspace_id 쿼리 파라미터 없으면 422를 반환합니다."""
        _, workspace = admin_user
        meeting_id = _create_meeting(client, workspace.id)
        res = client.post(
            f"{BASE_ACTIONS}/meetings/{meeting_id}/export/slack",
            json={"channel_id": "C123456"},
        )
        assert res.status_code == 422


# ---------------------------------------------------------------------------
# Notion / Kakao / Jira (미구현 라우터)
# ---------------------------------------------------------------------------

class TestUnimplementedExports:
    @pytest.mark.parametrize("path_suffix", [
        "export/notion",
        "export/kakao",
        "export/jira",
    ])
    def test_unimplemented_routes_return_404(self, client, admin_user, path_suffix):
        """아직 구현되지 않은 export 라우터는 404를 반환합니다."""
        _, workspace = admin_user
        meeting_id = _create_meeting(client, workspace.id)
        res = client.post(
            f"{BASE_ACTIONS}/meetings/{meeting_id}/{path_suffix}"
            f"?workspace_id={workspace.id}",
            json={},
        )
        assert res.status_code == 404


# ---------------------------------------------------------------------------
# Google Calendar 내보내기
# ---------------------------------------------------------------------------

class TestGoogleCalendarExport:
    def test_export_accepted(self, client, admin_user):
        _, workspace = admin_user
        meeting_id = _create_meeting(client, workspace.id)

        with patch(
            "app.domains.action.services.google.export_google_calendar",
            new_callable=AsyncMock,
        ):
            res = client.post(
                f"{BASE_ACTIONS}/meetings/{meeting_id}/export/google-calendar"
                f"?workspace_id={workspace.id}",
            )
        assert res.status_code == 200
        assert res.json()["status"] == "processing"

    def test_export_missing_workspace_id_returns_422(self, client, admin_user):
        _, workspace = admin_user
        meeting_id = _create_meeting(client, workspace.id)
        res = client.post(
            f"{BASE_ACTIONS}/meetings/{meeting_id}/export/google-calendar",
        )
        assert res.status_code == 422


# ---------------------------------------------------------------------------
# 다음 회의 시간 추천
# ---------------------------------------------------------------------------

class TestNextMeetingSuggest:
    def test_suggest_success(self, client, admin_user):
        _, workspace = admin_user
        meeting_id = _create_meeting(client, workspace.id)

        mock_slots = ["2025-06-10T10:00:00", "2025-06-10T14:00:00"]
        # 라우터가 from ... import 로 가져오므로 라우터 모듈 기준으로 패치합니다
        with patch(
            "app.domains.action.routers.google.suggest_next_meeting",
            new_callable=AsyncMock,
            return_value=mock_slots,
        ):
            res = client.post(
                f"{BASE_ACTIONS}/meetings/{meeting_id}/next-meeting/suggest"
                f"?workspace_id={workspace.id}",
                json={"duration_minutes": 60},
            )
        assert res.status_code == 200
        assert "slots" in res.json()

    def test_suggest_missing_workspace_id_returns_422(self, client, admin_user):
        _, workspace = admin_user
        meeting_id = _create_meeting(client, workspace.id)
        res = client.post(
            f"{BASE_ACTIONS}/meetings/{meeting_id}/next-meeting/suggest",
            json={"duration_minutes": 60},
        )
        assert res.status_code == 422


# ---------------------------------------------------------------------------
# 다음 회의 등록
# ---------------------------------------------------------------------------

class TestMinutesEnsure:
    def test_ensure_creates_default_when_none_exists(self, client, admin_user):
        """회의록이 없을 때 기본 양식을 생성하고 200을 반환합니다."""
        _, workspace = admin_user
        meeting_id = _create_meeting(client, workspace.id)

        res = client.get(
            f"{BASE_ACTIONS}/meetings/{meeting_id}/minutes/ensure"
            f"?workspace_id={workspace.id}",
        )
        assert res.status_code == 200
        body = res.json()
        assert body["meeting_id"] == meeting_id
        assert body["content"] is not None
        assert "## 개요" in body["content"]
        assert "## 논의 사항" in body["content"]
        assert "## 결정 사항" in body["content"]
        assert "## 액션 아이템" in body["content"]
        assert "## 미결/특이 사항" in body["content"]

    def test_ensure_returns_existing_when_present(self, client, admin_user):
        """이미 회의록이 있으면 기존 저장본을 그대로 반환합니다."""
        _, workspace = admin_user
        meeting_id = _create_meeting(client, workspace.id)

        # 첫 ensure → 기본 양식 생성
        first = client.get(
            f"{BASE_ACTIONS}/meetings/{meeting_id}/minutes/ensure"
            f"?workspace_id={workspace.id}",
        )
        assert first.status_code == 200
        first_updated_at = first.json()["updated_at"]

        # 두 번째 ensure → 동일 레코드 반환 (updated_at 변화 없음)
        second = client.get(
            f"{BASE_ACTIONS}/meetings/{meeting_id}/minutes/ensure"
            f"?workspace_id={workspace.id}",
        )
        assert second.status_code == 200
        assert second.json()["updated_at"] == first_updated_at

    def test_ensure_missing_workspace_id_returns_422(self, client, admin_user):
        _, workspace = admin_user
        meeting_id = _create_meeting(client, workspace.id)
        res = client.get(
            f"{BASE_ACTIONS}/meetings/{meeting_id}/minutes/ensure",
        )
        assert res.status_code == 422


class TestNextMeetingRegister:
    def test_register_success(self, client, admin_user):
        _, workspace = admin_user
        meeting_id = _create_meeting(client, workspace.id)

        with patch(
            "app.domains.action.routers.google.register_next_meeting",
            new_callable=AsyncMock,
            return_value="google_event_id_abc",
        ):
            res = client.post(
                f"{BASE_ACTIONS}/meetings/{meeting_id}/next-meeting/register"
                f"?workspace_id={workspace.id}",
                json={
                    "title": "다음 스프린트",
                    "scheduled_at": FUTURE,
                    "participant_ids": [],
                    "attendee_emails": ["user@example.com"],
                },
            )
        assert res.status_code == 200
        assert "event_id" in res.json()
