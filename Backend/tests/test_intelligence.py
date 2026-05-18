"""
인텔리전스 도메인 테스트.

현재 app/domains/intelligence/router.py 가 비어 있습니다.
API 엔드포인트가 구현되면 아래 스켈레톤을 기반으로 테스트를 작성합니다.

예상 엔드포인트 (구현 후 활성화):
  GET    /api/v1/intelligence/meetings/{meeting_id}/minutes
  PATCH  /api/v1/intelligence/meetings/{meeting_id}/minutes
  POST   /api/v1/intelligence/meetings/{meeting_id}/minutes/resummarize
  GET    /api/v1/intelligence/meetings/{meeting_id}/decisions
  POST   /api/v1/intelligence/meetings/{meeting_id}/decisions/{decision_id}/confirm
  POST   /api/v1/intelligence/meetings/{meeting_id}/review-request
"""

import pytest

BASE = "/api/v1/intelligence"


# ---------------------------------------------------------------------------
# 회의록 (Meeting Minutes)
# ---------------------------------------------------------------------------

@pytest.mark.skip(reason="intelligence router 미구현 - 라우터 완성 후 활성화")
class TestMeetingMinutes:
    def test_get_minutes_success(self, client, admin_user):
        _, workspace = admin_user
        # 회의 및 회의록 데이터 생성 필요
        res = client.get(f"{BASE}/meetings/1/minutes")
        assert res.status_code == 200

    def test_get_minutes_not_found(self, client, admin_user):
        res = client.get(f"{BASE}/meetings/9999/minutes")
        assert res.status_code == 404

    def test_update_minutes_success(self, client, admin_user):
        res = client.patch(
            f"{BASE}/meetings/1/minutes",
            json={"content": "수정된 회의록 내용"},
        )
        assert res.status_code == 200

    def test_resummarize_success(self, client, admin_user):
        res = client.post(f"{BASE}/meetings/1/minutes/resummarize")
        assert res.status_code == 200


# ---------------------------------------------------------------------------
# 결정사항 (Decisions)
# ---------------------------------------------------------------------------

@pytest.mark.skip(reason="intelligence router 미구현 - 라우터 완성 후 활성화")
class TestDecisions:
    def test_get_decisions_success(self, client, admin_user):
        res = client.get(f"{BASE}/meetings/1/decisions")
        assert res.status_code == 200

    def test_confirm_decision(self, client, admin_user):
        res = client.post(f"{BASE}/meetings/1/decisions/1/confirm")
        assert res.status_code == 200

    def test_decision_not_found(self, client, admin_user):
        res = client.post(f"{BASE}/meetings/1/decisions/9999/confirm")
        assert res.status_code == 404


# ---------------------------------------------------------------------------
# 상급자 검토 요청 (Review Request)
# ---------------------------------------------------------------------------

@pytest.mark.skip(reason="intelligence router 미구현 - 라우터 완성 후 활성화")
class TestReviewRequest:
    def test_create_review_request(self, client, admin_user):
        res = client.post(
            f"{BASE}/meetings/1/review-request",
            json={"reviewer_id": 2, "notify_slack": True, "notify_kakao": False},
        )
        assert res.status_code == 201

    def test_review_request_unauthorized(self, client):
        """인증 없이 요청 시 401."""
        res = client.post(
            f"{BASE}/meetings/1/review-request",
            json={"reviewer_id": 2},
        )
        assert res.status_code in (401, 403)
