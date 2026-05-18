"""
인증 도메인 테스트.

엔드포인트 prefix: /api/v1/users
- POST /signup/admin   : 관리자 회원가입
- POST /signup/member  : 멤버 회원가입 (초대코드 필요)
- POST /login          : 로그인
- POST /auth/token/refresh : 토큰 갱신
- POST /logout         : 로그아웃
- POST /password-reset : 비밀번호 재설정 요청
- POST /password-change : 비밀번호 변경
"""

import asyncio

import pytest
from app.core.security import create_refresh_token
from app.domains.user.models import User
from app.domains.user.service import _encode_oauth_state, social_login_callback_service


BASE = "/api/v1/users"
LOGIN_FAILURE_MESSAGE = "아이디 또는 비밀번호가 틀렸습니다."
PROFILE_PAYLOAD = {
    "birth_date": "2000-01-01",
    "phone_number": "010-1234-5678",
    "gender": "female",
}


# ---------------------------------------------------------------------------
# 관리자 회원가입
# ---------------------------------------------------------------------------

class TestAdminSignup:
    def test_success(self, client):
        res = client.post(f"{BASE}/signup/admin", json={
            "email": "admin@example.com",
            "password": "Secret123",
            "name": "홍길동",
            **PROFILE_PAYLOAD,
        })
        assert res.status_code == 201
        body = res.json()
        assert body["email"] == "admin@example.com"
        assert body["role"] == "admin"
        assert body["age"] is not None
        assert body["phone_number"] == PROFILE_PAYLOAD["phone_number"]
        assert body["gender"] == PROFILE_PAYLOAD["gender"]
        assert "workspace_id" in body
        assert "invite_code" in body

    def test_duplicate_email_returns_400(self, client):
        payload = {"email": "dup@example.com", "password": "Secret123", "name": "중복이", **PROFILE_PAYLOAD}
        client.post(f"{BASE}/signup/admin", json=payload)
        res = client.post(f"{BASE}/signup/admin", json=payload)
        assert res.status_code == 400

    def test_password_too_short_returns_422(self, client):
        res = client.post(f"{BASE}/signup/admin", json={
            "email": "short@example.com",
            "password": "Sh1",
            "name": "짧은비번",
            **PROFILE_PAYLOAD,
        })
        assert res.status_code == 422

    def test_password_no_number_returns_422(self, client):
        res = client.post(f"{BASE}/signup/admin", json={
            "email": "nonumber@example.com",
            "password": "NoNumber",
            "name": "숫자없음",
            **PROFILE_PAYLOAD,
        })
        assert res.status_code == 422

    def test_password_no_letter_returns_422(self, client):
        res = client.post(f"{BASE}/signup/admin", json={
            "email": "noletter@example.com",
            "password": "12345678",
            "name": "문자없음",
            **PROFILE_PAYLOAD,
        })
        assert res.status_code == 422

    def test_invalid_email_returns_422(self, client):
        res = client.post(f"{BASE}/signup/admin", json={
            "email": "not-an-email",
            "password": "Secret123",
            "name": "이메일오류",
            **PROFILE_PAYLOAD,
        })
        assert res.status_code == 422


# ---------------------------------------------------------------------------
# 멤버 회원가입
# ---------------------------------------------------------------------------

class TestMemberSignup:
    def test_success(self, client, workspace):
        res = client.post(f"{BASE}/signup/member", json={
            "invite_code": workspace.invite_code,
            "email": "member@example.com",
            "password": "Member123",
            "name": "멤버이름",
            **PROFILE_PAYLOAD,
        })
        assert res.status_code == 201
        body = res.json()
        assert body["email"] == "member@example.com"
        assert body["role"] == "member"
        assert body["age"] is not None

    def test_invite_code_normalized_to_uppercase(self, client, workspace):
        """초대코드는 소문자로 입력해도 대문자로 정규화됩니다."""
        res = client.post(f"{BASE}/signup/member", json={
            "invite_code": workspace.invite_code.lower(),
            "email": "lower@example.com",
            "password": "Lower123",
            "name": "소문자코드",
            **PROFILE_PAYLOAD,
        })
        assert res.status_code == 201

    def test_invalid_invite_code_returns_400(self, client):
        res = client.post(f"{BASE}/signup/member", json={
            "invite_code": "BADCODE",
            "email": "bad@example.com",
            "password": "Member123",
            "name": "잘못된코드",
            **PROFILE_PAYLOAD,
        })
        assert res.status_code == 400

    def test_duplicate_email_returns_400(self, client, workspace):
        payload = {
            "invite_code": workspace.invite_code,
            "email": "dup@example.com",
            "password": "Member123",
            "name": "중복멤버",
            **PROFILE_PAYLOAD,
        }
        client.post(f"{BASE}/signup/member", json=payload)
        res = client.post(f"{BASE}/signup/member", json=payload)
        assert res.status_code == 400


# ---------------------------------------------------------------------------
# 로그인
# ---------------------------------------------------------------------------

class TestLogin:
    def _signup_admin(self, client):
        client.post(f"{BASE}/signup/admin", json={
            "email": "login@example.com",
            "password": "Login123",
            "name": "로그인테스트",
            **PROFILE_PAYLOAD,
        })

    def test_success(self, client):
        self._signup_admin(client)
        res = client.post(f"{BASE}/login", json={
            "email": "login@example.com",
            "password": "Login123",
        })
        assert res.status_code == 200
        body = res.json()
        assert "access_token" in body
        assert "refresh_token" in body
        assert body["token_type"] == "bearer"

    def test_wrong_email_returns_401(self, client):
        res = client.post(f"{BASE}/login", json={
            "email": "nobody@example.com",
            "password": "Login123",
        })
        assert res.status_code == 401
        assert res.json()["detail"] == LOGIN_FAILURE_MESSAGE

    def test_wrong_password_returns_401(self, client):
        self._signup_admin(client)
        res = client.post(f"{BASE}/login", json={
            "email": "login@example.com",
            "password": "WrongPw1",
        })
        assert res.status_code == 401
        assert res.json()["detail"] == LOGIN_FAILURE_MESSAGE

    def test_inactive_user_returns_generic_login_failure(self, client, db):
        self._signup_admin(client)
        user = db.query(User).filter(User.email == "login@example.com").one()
        user.is_active = False
        db.commit()

        res = client.post(f"{BASE}/login", json={
            "email": "login@example.com",
            "password": "Login123",
        })

        assert res.status_code == 401
        assert res.json()["detail"] == LOGIN_FAILURE_MESSAGE


# ---------------------------------------------------------------------------
# 소셜 로그인
# ---------------------------------------------------------------------------

class TestSocialLogin:
    def test_google_auth_url_contains_role_state(self, client, monkeypatch):
        monkeypatch.setattr("app.domains.user.service.settings.GOOGLE_CLIENT_ID", "google-client-id")

        res = client.get(f"{BASE}/oauth/google/auth?role=admin")

        assert res.status_code == 200
        auth_url = res.json()["auth_url"]
        assert "https://accounts.google.com/o/oauth2/v2/auth" in auth_url
        assert "client_id=google-client-id" in auth_url
        assert "scope=openid+email+profile" in auth_url
        assert "state=" in auth_url

    def test_existing_admin_can_login_with_google_by_email(self, db, admin_user, monkeypatch):
        user, _ = admin_user

        async def fake_google_profile(code: str):
            return {
                "social_id": "google-123",
                "email": user.email,
                "name": user.name,
            }

        monkeypatch.setattr("app.domains.user.service._fetch_google_profile", fake_google_profile)

        tokens = asyncio.run(
            social_login_callback_service(
                db,
                "google",
                "auth-code",
                _encode_oauth_state("google", "admin"),
            ),
        )

        db.refresh(user)
        assert tokens.token_type == "bearer"
        assert user.social_provider == "google"
        assert user.social_id == "google-123"

    def test_admin_tab_rejects_existing_member_social_account(self, db, member_user, monkeypatch):
        async def fake_google_profile(code: str):
            return {
                "social_id": "google-member",
                "email": member_user.email,
                "name": member_user.name,
            }

        monkeypatch.setattr("app.domains.user.service._fetch_google_profile", fake_google_profile)

        with pytest.raises(Exception) as exc:
            asyncio.run(
                social_login_callback_service(
                    db,
                    "google",
                    "auth-code",
                    _encode_oauth_state("google", "admin"),
                ),
            )

        assert "관리자 계정으로 로그인해주세요." in str(exc.value)

    def test_member_tab_rejects_existing_admin_social_account(self, db, admin_user, monkeypatch):
        user, _ = admin_user

        async def fake_google_profile(code: str):
            return {
                "social_id": "google-admin",
                "email": user.email,
                "name": user.name,
            }

        monkeypatch.setattr("app.domains.user.service._fetch_google_profile", fake_google_profile)

        with pytest.raises(Exception) as exc:
            asyncio.run(
                social_login_callback_service(
                    db,
                    "google",
                    "auth-code",
                    _encode_oauth_state("google", "member"),
                ),
            )

        assert "멤버 계정으로 로그인해주세요." in str(exc.value)


# ---------------------------------------------------------------------------
# 토큰 갱신
# ---------------------------------------------------------------------------

class TestRefreshToken:
    def test_success(self, client, admin_user):
        user, _ = admin_user
        refresh = create_refresh_token(subject=str(user.id))
        res = client.post(f"{BASE}/auth/token/refresh", json={"refresh_token": refresh})
        assert res.status_code == 200
        body = res.json()
        assert "access_token" in body
        assert "refresh_token" in body

    def test_invalid_token_returns_401(self, client):
        res = client.post(f"{BASE}/auth/token/refresh", json={"refresh_token": "bad.token.here"})
        assert res.status_code == 401

    def test_access_token_as_refresh_returns_401(self, client, admin_token):
        """access token을 refresh token으로 사용하면 거부됩니다."""
        res = client.post(f"{BASE}/auth/token/refresh", json={"refresh_token": admin_token})
        assert res.status_code == 401


# ---------------------------------------------------------------------------
# 로그아웃
# ---------------------------------------------------------------------------

class TestLogout:
    def test_success(self, client, admin_user):
        user, _ = admin_user
        refresh = create_refresh_token(subject=str(user.id))
        res = client.post(f"{BASE}/logout", json={"refresh_token": refresh})
        assert res.status_code == 200
        assert "message" in res.json()

    def test_invalid_token_returns_401(self, client):
        res = client.post(f"{BASE}/logout", json={"refresh_token": "invalid.token"})
        assert res.status_code == 401


# ---------------------------------------------------------------------------
# 비밀번호 재설정 / 변경
# ---------------------------------------------------------------------------

class TestPasswordReset:
    def test_reset_request_success(self, client):
        res = client.post(f"{BASE}/password-reset", json={"email": "any@example.com"})
        assert res.status_code == 200
        assert "message" in res.json()

    def test_password_change_success(self, client):
        res = client.post(f"{BASE}/password-change", json={
            "token": "some-reset-token",
            "new_password": "NewPass123",
        })
        assert res.status_code == 200
        assert "message" in res.json()

    def test_password_change_weak_password_returns_422(self, client):
        res = client.post(f"{BASE}/password-change", json={
            "token": "token",
            "new_password": "12345678",  # 숫자만
        })
        assert res.status_code == 422
