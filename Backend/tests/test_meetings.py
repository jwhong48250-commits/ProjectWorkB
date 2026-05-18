"""
회의 도메인 테스트.

엔드포인트 prefix: /api/v1/meetings
- POST   /workspaces/{ws_id}            : 회의 생성
- GET    /workspaces/{ws_id}/history    : 회의 히스토리
- GET    /workspaces/{ws_id}/{mtg_id}   : 회의 상세
- DELETE /workspaces/{ws_id}/{mtg_id}   : 회의 삭제
- PATCH  /workspaces/{ws_id}/{mtg_id}   : 회의 수정

NOTE: 회의 생성/삭제/수정은 workspace.deps.require_workspace_admin을 거칩니다.
      이 의존성은 get_current_user_id()=1 (하드코딩)을 사용하므로,
      admin_user 픽스처가 user.id=1 인 관리자와 WorkspaceMember를 생성합니다.
"""

from datetime import datetime, timedelta, timezone

import pytest

BASE = "/api/v1/meetings"

FUTURE = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
PAST = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()


def make_meeting_body(**overrides):
    return {
        "title": "테스트 회의",
        "meeting_type": "weekly",
        "scheduled_at": FUTURE,
        "participant_ids": [],
        "sync_google_calendar": False,
        **overrides,
    }


# ---------------------------------------------------------------------------
# 회의 생성
# ---------------------------------------------------------------------------

class TestCreateMeeting:
    def test_success(self, client, admin_user):
        _, workspace = admin_user
        res = client.post(f"{BASE}/workspaces/{workspace.id}", json=make_meeting_body())
        assert res.status_code == 201
        body = res.json()
        assert body["success"] is True
        assert body["data"]["title"] == "테스트 회의"

    def test_past_scheduled_at_returns_400(self, client, admin_user):
        _, workspace = admin_user
        res = client.post(
            f"{BASE}/workspaces/{workspace.id}",
            json=make_meeting_body(scheduled_at=PAST),
        )
        assert res.status_code == 400

    def test_missing_title_returns_422(self, client, admin_user):
        _, workspace = admin_user
        body = make_meeting_body()
        del body["title"]
        res = client.post(f"{BASE}/workspaces/{workspace.id}", json=body)
        assert res.status_code == 422

    def test_non_admin_workspace_returns_403(self, client, admin_user):
        """존재하지 않는 워크스페이스(ID 9999)에 대한 요청은 403."""
        res = client.post(f"{BASE}/workspaces/9999", json=make_meeting_body())
        assert res.status_code == 403


# ---------------------------------------------------------------------------
# 회의 히스토리
# ---------------------------------------------------------------------------

class TestMeetingHistory:
    def test_empty_history(self, client, admin_user):
        _, workspace = admin_user
        res = client.get(f"{BASE}/workspaces/{workspace.id}/history")
        assert res.status_code == 200
        body = res.json()
        assert body["total"] == 0
        assert body["meetings"] == []

    def test_history_with_meetings(self, client, admin_user):
        _, workspace = admin_user
        client.post(f"{BASE}/workspaces/{workspace.id}", json=make_meeting_body(title="첫 번째 회의"))
        client.post(f"{BASE}/workspaces/{workspace.id}", json=make_meeting_body(title="두 번째 회의"))
        res = client.get(f"{BASE}/workspaces/{workspace.id}/history")
        assert res.status_code == 200
        assert res.json()["total"] == 2

    def test_history_keyword_filter(self, client, admin_user):
        _, workspace = admin_user
        client.post(f"{BASE}/workspaces/{workspace.id}", json=make_meeting_body(title="스프린트 회의"))
        client.post(f"{BASE}/workspaces/{workspace.id}", json=make_meeting_body(title="기획 회의"))
        res = client.get(f"{BASE}/workspaces/{workspace.id}/history?keyword=스프린트")
        assert res.status_code == 200
        data = res.json()
        assert data["total"] == 1
        assert "스프린트" in data["meetings"][0]["title"]

    def test_history_pagination(self, client, admin_user):
        _, workspace = admin_user
        for i in range(3):
            client.post(
                f"{BASE}/workspaces/{workspace.id}",
                json=make_meeting_body(title=f"회의 {i}"),
            )
        res = client.get(f"{BASE}/workspaces/{workspace.id}/history?page=1&size=2")
        assert res.status_code == 200
        body = res.json()
        assert len(body["meetings"]) == 2
        assert body["total"] == 3

    def test_history_date_filter(self, client, admin_user):
        _, workspace = admin_user
        day_a = "2030-03-10T10:00:00+09:00"
        day_b = "2030-03-11T10:00:00+09:00"
        client.post(
            f"{BASE}/workspaces/{workspace.id}",
            json=make_meeting_body(title="3월 10일 회의", scheduled_at=day_a),
        )
        client.post(
            f"{BASE}/workspaces/{workspace.id}",
            json=make_meeting_body(title="3월 11일 회의", scheduled_at=day_b),
        )
        res = client.get(f"{BASE}/workspaces/{workspace.id}/history?date=2030-03-10")
        assert res.status_code == 200
        data = res.json()
        assert data["total"] == 1
        assert data["meetings"][0]["title"] == "3월 10일 회의"


# ---------------------------------------------------------------------------
# 회의 상세 조회
# ---------------------------------------------------------------------------

class TestMeetingDetail:
    def _create_meeting(self, client, workspace_id):
        res = client.post(f"{BASE}/workspaces/{workspace_id}", json=make_meeting_body())
        return res.json()["data"]["meeting_id"]

    def test_success(self, client, admin_user):
        _, workspace = admin_user
        mtg_id = self._create_meeting(client, workspace.id)
        res = client.get(f"{BASE}/workspaces/{workspace.id}/{mtg_id}")
        assert res.status_code == 200
        body = res.json()
        assert body["success"] is True
        assert body["data"]["id"] == mtg_id

    def test_not_found_returns_404(self, client, admin_user):
        _, workspace = admin_user
        res = client.get(f"{BASE}/workspaces/{workspace.id}/9999")
        assert res.status_code == 404

    def test_participants_included(self, client, admin_user):
        _, workspace = admin_user
        mtg_id = self._create_meeting(client, workspace.id)
        res = client.get(f"{BASE}/workspaces/{workspace.id}/{mtg_id}")
        data = res.json()["data"]
        # 생성자(user_id=1)는 항상 참석자에 포함됩니다
        assert len(data["participants"]) >= 1


# ---------------------------------------------------------------------------
# 회의 삭제
# ---------------------------------------------------------------------------

class TestDeleteMeeting:
    def _create_meeting(self, client, workspace_id):
        res = client.post(f"{BASE}/workspaces/{workspace_id}", json=make_meeting_body())
        return res.json()["data"]["meeting_id"]

    def test_success(self, client, admin_user):
        _, workspace = admin_user
        mtg_id = self._create_meeting(client, workspace.id)
        res = client.delete(f"{BASE}/workspaces/{workspace.id}/{mtg_id}")
        assert res.status_code == 200
        assert res.json()["success"] is True

    def test_deleted_meeting_not_found(self, client, admin_user):
        _, workspace = admin_user
        mtg_id = self._create_meeting(client, workspace.id)
        client.delete(f"{BASE}/workspaces/{workspace.id}/{mtg_id}")
        res = client.get(f"{BASE}/workspaces/{workspace.id}/{mtg_id}")
        assert res.status_code == 404

    def test_not_found_returns_404(self, client, admin_user):
        _, workspace = admin_user
        res = client.delete(f"{BASE}/workspaces/{workspace.id}/9999")
        assert res.status_code == 404

    def test_wrong_workspace_returns_404(self, client, admin_user):
        _, workspace = admin_user
        mtg_id = self._create_meeting(client, workspace.id)
        res = client.delete(f"{BASE}/workspaces/9999/{mtg_id}")
        # 권한 없는 워크스페이스이므로 403 또는 404
        assert res.status_code in (403, 404)


# ---------------------------------------------------------------------------
# 회의 수정
# ---------------------------------------------------------------------------

class TestUpdateMeeting:
    def _create_meeting(self, client, workspace_id):
        res = client.post(f"{BASE}/workspaces/{workspace_id}", json=make_meeting_body())
        return res.json()["data"]["meeting_id"]

    def test_success(self, client, admin_user):
        _, workspace = admin_user
        mtg_id = self._create_meeting(client, workspace.id)
        res = client.patch(
            f"{BASE}/workspaces/{workspace.id}/{mtg_id}",
            json=make_meeting_body(title="수정된 회의"),
        )
        assert res.status_code == 200
        assert res.json()["data"]["title"] == "수정된 회의"

    def test_past_scheduled_at_returns_400(self, client, admin_user):
        _, workspace = admin_user
        mtg_id = self._create_meeting(client, workspace.id)
        res = client.patch(
            f"{BASE}/workspaces/{workspace.id}/{mtg_id}",
            json=make_meeting_body(scheduled_at=PAST),
        )
        assert res.status_code == 400

    def test_not_found_returns_404(self, client, admin_user):
        _, workspace = admin_user
        res = client.patch(
            f"{BASE}/workspaces/{workspace.id}/9999",
            json=make_meeting_body(),
        )
        assert res.status_code == 404
