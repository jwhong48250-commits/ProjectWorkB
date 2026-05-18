"""
연동(Integration) 도메인 테스트.

엔드포인트 prefix: /api/v1/integrations
- GET    /workspaces/{ws_id}                            : 연동 목록 조회
- PATCH  /workspaces/{ws_id}/{service}/connect          : 연동 활성화
- PATCH  /workspaces/{ws_id}/{service}/disconnect       : 연동 비활성화
- POST   /workspaces/{ws_id}/{service}/disconnect       : 연동 비활성화 (POST)
- POST   /workspaces/{ws_id}/{service}/test             : 연동 상태 테스트
- POST   /workspaces/{ws_id}/jira/connect               : Jira API 키 연동
- POST   /workspaces/{ws_id}/kakao/connect              : 카카오 API 키 연동
- GET    /workspaces/{ws_id}/slack/channels             : Slack 채널 목록

NOTE: integration 라우터는 user.dependencies.require_workspace_admin을 사용합니다.
      JWT Bearer 토큰이 반드시 필요합니다 (Authorization 헤더).
"""

from unittest.mock import AsyncMock, patch

import pytest

from app.domains.integration.models import Integration, ServiceType
from tests.conftest import auth_header, TestSessionLocal

BASE = "/api/v1/integrations"


def _setup_integration(workspace_id, service, is_connected=False):
    """테스트용 Integration 행을 직접 DB에 삽입합니다."""
    db = TestSessionLocal()
    try:
        existing = db.query(Integration).filter(
            Integration.workspace_id == workspace_id,
            Integration.service == service,
        ).first()
        if not existing:
            db.add(Integration(
                workspace_id=workspace_id,
                service=service,
                is_connected=is_connected,
            ))
            db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# 연동 목록 조회
# ---------------------------------------------------------------------------

class TestGetIntegrations:
    def test_success_empty(self, client, admin_user, admin_token):
        _, workspace = admin_user
        res = client.get(
            f"{BASE}/workspaces/{workspace.id}",
            headers=auth_header(admin_token),
        )
        assert res.status_code == 200
        body = res.json()
        assert "integrations" in body
        assert isinstance(body["integrations"], list)

    def test_success_with_integrations(self, client, admin_user, admin_token):
        _, workspace = admin_user
        for service in ServiceType:
            _setup_integration(workspace.id, service)

        res = client.get(
            f"{BASE}/workspaces/{workspace.id}",
            headers=auth_header(admin_token),
        )
        assert res.status_code == 200
        assert len(res.json()["integrations"]) == len(ServiceType)

    def test_no_token_returns_401(self, client, admin_user):
        _, workspace = admin_user
        res = client.get(f"{BASE}/workspaces/{workspace.id}")
        assert res.status_code == 401

    def test_member_token_returns_403(self, client, admin_user, member_user, member_token):
        _, workspace = admin_user
        res = client.get(
            f"{BASE}/workspaces/{workspace.id}",
            headers=auth_header(member_token),
        )
        assert res.status_code == 403

    def test_wrong_workspace_returns_403(self, client, admin_user, admin_token):
        res = client.get(
            f"{BASE}/workspaces/9999",
            headers=auth_header(admin_token),
        )
        assert res.status_code == 403


# ---------------------------------------------------------------------------
# 연동 활성화 (connect)
# ---------------------------------------------------------------------------

class TestConnectIntegration:
    def test_connect_slack_success(self, client, admin_user, admin_token):
        _, workspace = admin_user
        res = client.patch(
            f"{BASE}/workspaces/{workspace.id}/slack/connect",
            headers=auth_header(admin_token),
        )
        assert res.status_code == 200
        body = res.json()
        assert body["service"] == "slack"
        assert body["is_connected"] is True

    def test_connect_notion_success(self, client, admin_user, admin_token):
        _, workspace = admin_user
        res = client.patch(
            f"{BASE}/workspaces/{workspace.id}/notion/connect",
            headers=auth_header(admin_token),
        )
        assert res.status_code == 200
        assert res.json()["is_connected"] is True

    def test_connect_without_token_returns_401(self, client, admin_user):
        _, workspace = admin_user
        res = client.patch(f"{BASE}/workspaces/{workspace.id}/slack/connect")
        assert res.status_code == 401

    def test_connect_idempotent(self, client, admin_user, admin_token):
        """이미 연동된 서비스를 다시 연동해도 200을 반환합니다."""
        _, workspace = admin_user
        _setup_integration(workspace.id, ServiceType.slack, is_connected=True)
        res = client.patch(
            f"{BASE}/workspaces/{workspace.id}/slack/connect",
            headers=auth_header(admin_token),
        )
        assert res.status_code == 200


# ---------------------------------------------------------------------------
# 연동 비활성화 (disconnect)
# ---------------------------------------------------------------------------

class TestDisconnectIntegration:
    def test_disconnect_patch_success(self, client, admin_user, admin_token):
        _, workspace = admin_user
        _setup_integration(workspace.id, ServiceType.slack, is_connected=True)

        res = client.patch(
            f"{BASE}/workspaces/{workspace.id}/slack/disconnect",
            headers=auth_header(admin_token),
        )
        assert res.status_code == 200
        assert res.json()["is_connected"] is False

    def test_disconnect_post_success(self, client, admin_user, admin_token):
        _, workspace = admin_user
        _setup_integration(workspace.id, ServiceType.notion, is_connected=True)

        res = client.post(
            f"{BASE}/workspaces/{workspace.id}/notion/disconnect",
            headers=auth_header(admin_token),
        )
        assert res.status_code == 200
        assert res.json()["is_connected"] is False

    def test_disconnect_not_connected_returns_404(self, client, admin_user, admin_token):
        """연동 row 자체가 없으면 404를 반환합니다."""
        _, workspace = admin_user
        res = client.patch(
            f"{BASE}/workspaces/{workspace.id}/jira/disconnect",
            headers=auth_header(admin_token),
        )
        assert res.status_code == 404

    def test_disconnect_without_token_returns_401(self, client, admin_user):
        _, workspace = admin_user
        res = client.patch(f"{BASE}/workspaces/{workspace.id}/slack/disconnect")
        assert res.status_code == 401


# ---------------------------------------------------------------------------
# Jira API 키 연동
# ---------------------------------------------------------------------------

class TestJiraConnect:
    def test_connect_jira_success(self, client, admin_user, admin_token):
        _, workspace = admin_user
        res = client.post(
            f"{BASE}/workspaces/{workspace.id}/jira/connect",
            json={
                "domain": "https://mycompany.atlassian.net",
                "email": "jira@example.com",
                "api_token": "JIRA_TOKEN_123",
                "project_key": "PROJ",
            },
            headers=auth_header(admin_token),
        )
        assert res.status_code == 200
        assert res.json()["service"] == "jira"
        assert res.json()["is_connected"] is True

    def test_connect_jira_missing_field_returns_422(self, client, admin_user, admin_token):
        _, workspace = admin_user
        res = client.post(
            f"{BASE}/workspaces/{workspace.id}/jira/connect",
            json={"domain": "https://mycompany.atlassian.net"},
            headers=auth_header(admin_token),
        )
        assert res.status_code == 422


# ---------------------------------------------------------------------------
# 카카오 API 키 연동
# ---------------------------------------------------------------------------

class TestKakaoConnect:
    def test_connect_kakao_success(self, client, admin_user, admin_token):
        _, workspace = admin_user
        res = client.post(
            f"{BASE}/workspaces/{workspace.id}/kakao/connect",
            json={"api_key": "KAKAO_REST_KEY_123"},
            headers=auth_header(admin_token),
        )
        assert res.status_code == 200
        assert res.json()["service"] == "kakao"
        assert res.json()["is_connected"] is True

    def test_connect_kakao_missing_api_key_returns_422(self, client, admin_user, admin_token):
        _, workspace = admin_user
        res = client.post(
            f"{BASE}/workspaces/{workspace.id}/kakao/connect",
            json={},
            headers=auth_header(admin_token),
        )
        assert res.status_code == 422


# ---------------------------------------------------------------------------
# Slack 채널 목록 조회
# ---------------------------------------------------------------------------

class TestSlackChannels:
    def test_get_channels_success(self, client, admin_user, admin_token):
        _, workspace = admin_user
        _setup_integration(workspace.id, ServiceType.slack, is_connected=True)

        with patch(
            "app.domains.integration.service.get_slack_channel",
            new_callable=AsyncMock,
            return_value=[{"id": "C001", "name": "general"}],
        ):
            res = client.get(
                f"{BASE}/workspaces/{workspace.id}/slack/channels",
                headers=auth_header(admin_token),
            )
        assert res.status_code == 200
        assert "channels" in res.json()

    def test_get_channels_not_connected_returns_400(self, client, admin_user, admin_token):
        """Slack이 연동되지 않았으면 400을 반환합니다."""
        _, workspace = admin_user

        with patch(
            "app.domains.integration.service.get_slack_channel",
            new_callable=AsyncMock,
            side_effect=ValueError("Slack이 연동되지 않았습니다."),
        ):
            res = client.get(
                f"{BASE}/workspaces/{workspace.id}/slack/channels",
                headers=auth_header(admin_token),
            )
        assert res.status_code == 400
