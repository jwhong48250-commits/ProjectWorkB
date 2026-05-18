# app\domains\integration\service.py
import json
import base64
import hashlib
import secrets
import logging
from datetime import datetime, timedelta, timezone
from app.utils.time_utils import now_kst, KST

from sqlalchemy.orm import Session
from typing import List
import httpx

from app.core.graph.state import SharedState
from app.domains.integration.models import Integration, ServiceType
from app.domains.integration import repository
from app.infra.clients.session_manager import ClientSessionManager
from app.core.config import settings
from app.infra.clients.slack import SlackClient
from app.infra.clients.google import GoogleCalendarClient
from app.infra.clients.jira import JiraClient
from app.domains.meeting.models import Meeting
from app.domains.action.models import WbsEpic, WbsTask

logger= logging.getLogger(__name__)

# PKCE 생성 함수 OAuth 국제 보안 표준
def _generate_pkce_pair() -> tuple[str, str]:
    # code_verifier: 최소 43자 랜덤 문자열 
    code_verifier = secrets.token_urlsafe(43)

    # code_challenge: SHA256 를 Base64URL로 인코딩. 패딩 제거
    digest = hashlib.sha256(code_verifier.encode()).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b'=').decode()
    return code_verifier, code_challenge


# --- state  인코딩, 디코딩 (OAuth state parameters) ---
def _encode_state(workspace_id: int, code_verifier: str = "") -> str:
    payload: dict = {"workspace_id": workspace_id}
    if code_verifier:
        payload['cv'] = code_verifier
    return base64.urlsafe_b64encode(
        json.dumps(payload).encode()
    ).decode()

def _decode_state(state: str) -> int:
    data = json.loads(base64.urlsafe_b64decode(state.encode()).decode())
    return data['workspace_id']

def _decode_state_with_cv(state: str) -> tuple[int, str]:
    data = json.loads(base64.urlsafe_b64decode(state.encode()).decode())
    return data['workspace_id'], data.get('cv', "")

# --- LangGraph Node ---

async def load_integration_settings(state: SharedState, db: Session):
    """
    DB에서 워크스페이스 연동 설정을 읽어 SharedSate에 올린다.
    회의 시작 시 supervisor가 이노드를 호출한다.
    """
    workspace_id = int(state['workspace_id'])
    integrations = repository.get_integrations(db, workspace_id)

    integration_settings = {}
    for item in integrations:
        integration_settings[item.service.value] = {
            "is_connected": item.is_connected,
            "access_token": item.access_token,
            "extra_config": item.extra_config,
        }
    return {"integration_settings": integration_settings}

# --- 비즈니스 로직 ---
def get_integrations(db: Session, workspace_id: int) -> List[Integration]:
    return repository.get_integrations(db, workspace_id)

def disconnect_integration(
        db: Session,
        workspace_id: int,
        service: ServiceType
) -> Integration:
    """
    연동 해제
    is_connected=False, webhook_url 삭제
    """
    return repository.disconnect_integration(db, workspace_id, service)

def reset_jira_links(db: Session, workspace_id: int) -> None:
    """JIRA 연동 ID 초기화 - 다른 JIRA 프로젝트 전환 시 사용"""
    epic_ids_subq = (
        db.query(WbsEpic.id)
        .join(Meeting, WbsEpic.meeting_id == Meeting.id)
        .filter(Meeting.workspace_id == workspace_id)
        .subquery()
    )
    db.query(WbsTask).filter(WbsTask.epic_id.in_(epic_ids_subq)).update(
        {"jira_issue_id": None}, synchronize_session=False
    )
    db.query(WbsEpic).filter(WbsEpic.id.in_(epic_ids_subq)).update(
        {"jira_epic_id": None}, synchronize_session=False
    )
    db.commit()

async def test_integration(db: Session, workspace_id: int, service: ServiceType) -> dict:
    """
    각 API 토큰과 권한 대시보드를 위한 헬스체크 핑 테스트 함수
    """
    integration = repository.get_integration(db, workspace_id, service)
    if not integration or not integration.is_connected or not integration.access_token:
        return {
            "status": "disconnected", 
            "message": "연동되지 않았습니다."
        }

    try:
        http = await ClientSessionManager.get_client()

        if service == ServiceType.slack:
            expires_at = integration.token_expires_at
            if expires_at:
                if expires_at.tzinfo is None:
                    expires_at = expires_at.replace(tzinfo=KST)
                if expires_at < now_kst():
                    return {"status": "expired", "message": "토큰이 만료되었습니다. 재연동이 필요합니다."}
            res = await http.get(
                "https://slack.com/api/auth.test",
                headers={"Authorization": f"Bearer {integration.access_token}"},
            )
            if not res.json().get("ok"):
                return {"status": "revoked", "message": "Slack 권한이 해제되었습니다. 재연동이 필요합니다."}

        elif service == ServiceType.google_calendar:
            token = await get_valid_google_token(db, workspace_id)
            res = await http.get(
                "https://www.googleapis.com/oauth2/v3/tokeninfo",
                params={"access_token": token},
            )
            if res.status_code != 200:
                return {"status": "revoked", "message": "Google Calendar 권한이 해제되었습니다. 재연동이 필요합니다."}

        elif service == ServiceType.jira:
            token = await get_valid_jira_token(db, workspace_id)
            cloud_id = get_jira_cloud_id(db, workspace_id)
            jira = JiraClient(token, cloud_id)
            await jira._request("GET", "/myself")

        return {"status": "ok", "message": "정상 연결되어 있습니다."}

    except Exception:
        return {"status": "revoked", "message": "연결이 끊겼습니다. 재연동이 필요합니다."}



#===============================================================
#
#                OAuth API
#
#===============================================================



# --- Google Calendar OAuth ---

def get_google_auth_url(workspace_id: int):
    if not settings.GOOGLE_CLIENT_ID:
        raise ValueError("GOOGLE_CLIENT_ID가 설정되어 있지 않습니다. (.env 또는 환경변수 확인)")
    if not settings.GOOGLE_REDIRECT_URI:
        raise ValueError("GOOGLE_REDIRECT_URI가 설정되어 있지 않습니다. (.env 또는 환경변수 확인)")
    code_verifier, code_challenge = _generate_pkce_pair()
    state = _encode_state(workspace_id, code_verifier)
    params = (
        f"https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={settings.GOOGLE_CLIENT_ID}"
        f"&redirect_uri={settings.GOOGLE_REDIRECT_URI}"
        f"&response_type=code"
        f"&scope=https://www.googleapis.com/auth/calendar"
        f"&access_type=offline"
        f"&prompt=consent"
        f"&state={state}"
        f"&code_challenge={code_challenge}"
        f"&code_challenge_method=S256"
    )
    return params

async def handle_google_callback(db: Session, code: str, state: str) -> int:
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        raise ValueError("Google OAuth 설정이 누락되었습니다. (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET 확인)")
    workspace_id, code_verifier = _decode_state_with_cv(state)
    client = await ClientSessionManager.get_client()

    res = await client.post(
        "https://oauth2.googleapis.com/token",
        data={
            "code": code,
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri": settings.GOOGLE_REDIRECT_URI,
            "grant_type": "authorization_code",
            "code_verifier": code_verifier,
        },
    )
    res.raise_for_status()
    tokens = res.json()

    expires_at = now_kst() + timedelta(seconds=tokens.get("expires_in", 3600))

    repository.update_tokens(
        db,
        workspace_id=workspace_id,
        service=ServiceType.google_calendar,
        access_token=tokens['access_token'],
        refresh_token=tokens.get('refresh_token'),
        token_expires_at=expires_at,
    )
    logger.info(f"GOOGLE Calender 연동 완료 {workspace_id}번")
    return workspace_id

# --- Slack OAuth ---

def get_slack_auth_url(workspace_id: int) -> str:
    state = _encode_state(workspace_id)
    return (
        f"https://slack.com/oauth/v2/authorize"
        f"?client_id={settings.SLACK_CLIENT_ID}"
        f"&scope=chat:write,chat:write.public,channels:join,channels:read,users:read,users:read.email,im:write,files:write,pins:write"
        f"&redirect_uri={settings.SLACK_REDIRECT_URI}"
        f"&state={state}"
    )

async def handle_slack_callback(db: Session, code: str, state: str) -> int:
    workspace_id = _decode_state(state)
    client = await ClientSessionManager.get_client()

    res = await client.post(
        "https://slack.com/api/oauth.v2.access",
        data={
            "code": code,
            "client_id": settings.SLACK_CLIENT_ID,
            "client_secret": settings.SLACK_CLIENT_SECRET,
            "redirect_uri": settings.SLACK_REDIRECT_URI,
        },
    )
    res.raise_for_status()
    data = res.json()

    bot_token = data['access_token']
    team_id = data.get("team", {}).get("id", "")

    repository.update_tokens(
        db,
        workspace_id=workspace_id,
        service=ServiceType.slack,
        access_token=bot_token,
        extra_config={"team_id": team_id},
    )
    logger.info(f"slack 연동 완료 {workspace_id}번")
    return workspace_id


# --- JIRA OAuth 2.0 Key ---
def get_jira_auth_url(workspace_id: int) -> str:
    if not settings.JIRA_CLIENT_ID:
        raise ValueError("JIRA_CLIENT_ID가 설정되어 있지 않습니다.")
    if not settings.JIRA_REDIRECT_URI:
        raise ValueError("JIRA_REDIRECT_URI가 설정되어 있지 않습니다.")
    if not settings.JIRA_CLIENT_SECRET:
        raise ValueError("JIRA_CLIENT_SECRET가 설정되어 있지 않습니다.")
    code_verifier, code_challenge = _generate_pkce_pair()
    state = _encode_state(workspace_id, code_verifier)
    return (
        f"https://auth.atlassian.com/authorize"
        f"?audience=api.atlassian.com"
        f"&client_id={settings.JIRA_CLIENT_ID}"
        f"&scope=read:jira-work%20write:jira-work%20read:jira-user%20read:me%20offline_access"
        f"&redirect_uri={settings.JIRA_REDIRECT_URI}"
        f"&state={state}"
        f"&response_type=code"
        f"&prompt=consent"
        f"&code_challenge={code_challenge}"
        f"&code_challenge_method=S256"
    )

async def handle_jira_callback(db: Session, code: str, state: str) -> dict:
    if not settings.JIRA_CLIENT_ID or not settings.JIRA_CLIENT_SECRET:
        raise ValueError("JIRA OAuth 설정이 누락되어있습니다.")
    workspace_id, code_verifier = _decode_state_with_cv(state)
    client = await ClientSessionManager.get_client()

    # 1. code -> token 교환
    res = await client.post(
        "https://auth.atlassian.com/oauth/token",
        json={
            "grant_type": "authorization_code",
            "client_id": settings.JIRA_CLIENT_ID,
            "client_secret": settings.JIRA_CLIENT_SECRET,
            "code": code,
            "redirect_uri": settings.JIRA_REDIRECT_URI,
            "code_verifier": code_verifier,
        },
    )
    res.raise_for_status()
    tokens = res.json()

    # 60분 만료시간 세팅
    expires_at = now_kst() + timedelta(seconds=tokens.get("expires_in", 3600))
    
    # 2. cloud_id 조회
    resource_res = await client.get(
        "https://api.atlassian.com/oauth/token/accessible-resources",
        headers={
            "Authorization": f"Bearer {tokens['access_token']}"
        },
    )
    resource_res.raise_for_status()
    resources = resource_res.json()

    if not resources:
        raise ValueError("접근 가능한 JIRA 사이트가 없습니다.")

    if len(resources) == 1:
        # 1개인 경우 자동 선택
        site = resources[0]
        cloud_id = site['id']
        site_url = site['url'].replace('https://', "")

        repository.update_tokens(
            db=db,
            workspace_id=workspace_id,
            service=ServiceType.jira,
            access_token=tokens['access_token'],
            refresh_token=tokens.get('refresh_token'),
            token_expires_at=expires_at,
            extra_config={
                "cloud_id": cloud_id,
                "site_url": site_url
            }
        )
        return {
            "status": "connected",
            "workspace_id": workspace_id
        }

    else:
        # 프로젝트가 여러개 인경우 
        sites = [{
            "id": r['id'],
            "name": r['name'],
            "url": r['url'].replace('https://', "")
        } for r in resources]

        repository.update_tokens(
            db=db,
            workspace_id=workspace_id,
            service=ServiceType.jira,
            access_token=tokens['access_token'],
            refresh_token=tokens.get('refresh_token'),
            token_expires_at=expires_at,
            extra_config={
                "pending_sites": sites
            },
        )
        # is_connected는 False -> 프로젝트 선택을 안했기 때문
        integration = repository.get_integration(db, workspace_id, ServiceType.jira)
        integration.is_connected = False
        db.commit()
        return {
            "status": "select_site",
            "workspace_id": workspace_id
        }


# --- Google Token 확인 및 갱신 ---

async def get_valid_google_token(db: Session, workspace_id: int) -> str:
    integration = repository.get_integration(db, workspace_id, ServiceType.google_calendar)
    if not integration or not integration.access_token:
        raise ValueError("Google Calendar 연동이 필요합니다.")

    expires_at = integration.token_expires_at
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=KST)
    if expires_at and expires_at < now_kst() + timedelta(minutes=5):
        client = await ClientSessionManager.get_client()
        res = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "refresh_token": integration.refresh_token,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "grant_type": "refresh_token",
            },
        )
        res.raise_for_status()
        tokens = res.json()
        expires_at = now_kst() + timedelta(seconds=tokens.get("expires_in", 3600))
        repository.update_tokens(
            db, workspace_id, ServiceType.google_calendar,
            access_token=tokens["access_token"],
            refresh_token=integration.refresh_token,
            token_expires_at=expires_at,
        )
        return tokens["access_token"]

    return integration.access_token


def get_required_workspace_google_calendar_id(db: Session, workspace_id: int) -> str:
    """
    workspace의 integrations(service=google_calendar).extra_config["calendar_id"]를 반환.
    없으면 '캘린더 선택 필요' 에러를 발생시킨다.
    """
    integration = repository.get_integration(db, workspace_id, ServiceType.google_calendar)
    cal_id = (integration.extra_config or {}).get("calendar_id") if integration else None
    if isinstance(cal_id, str) and cal_id.strip():
        return cal_id.strip()
    raise ValueError("캘린더 선택이 필요합니다. (Google Calendar 서브 캘린더를 선택/생성해주세요)")


async def list_google_calendars(db: Session, workspace_id: int) -> list[dict]:
    """
    연동된 계정의 캘린더 목록을 반환한다. (calendar.calendarList.list)
    """
    access_token = await get_valid_google_token(db, workspace_id)
    client = GoogleCalendarClient(access_token)
    try:
        res = await client.list_calendars(min_access_role="reader")
    except httpx.HTTPStatusError as e:
        raise ValueError(f"Google Calendar 목록 조회 실패: {e.response.status_code}") from e

    items = res.get("items", []) if isinstance(res, dict) else []
    out: list[dict] = []
    for it in items:
        cid = str(it.get("id", "") or "")
        if not cid:
            continue
        out.append(
            {
                "id": cid,
                "summary": str(it.get("summary", "") or ""),
                "primary": bool(it.get("primary", False)),
                "access_role": str(it.get("accessRole", "") or "") if it.get("accessRole") is not None else None,
            }
        )
    return out


async def create_google_calendar(db: Session, workspace_id: int, name: str) -> dict:
    """
    새 캘린더 생성 (calendar.calendars.insert)
    """
    name = (name or "").strip()
    if not name:
        raise ValueError("캘린더 이름(name)이 비어 있습니다.")
    access_token = await get_valid_google_token(db, workspace_id)
    client = GoogleCalendarClient(access_token)
    try:
        created = await client.create_calendar(summary=name, time_zone="Asia/Seoul")
    except httpx.HTTPStatusError as e:
        raise ValueError(f"Google Calendar 생성 실패: {e.response.status_code}") from e

    calendar_id = str(created.get("id", "") or "")
    if not calendar_id:
        raise ValueError("Google Calendar 생성 응답에 id(calendar_id)가 없습니다.")
    return {"calendar_id": calendar_id, "summary": name}


def save_workspace_google_calendar_id(db: Session, workspace_id: int, calendar_id: str, calendar_name=None) -> Integration:
    """
    최종 선택된 calendar_id를 integrations.extra_config에 저장한다.
    스키마 변경 없이 {"calendar_id": "..."} 형태로 저장.
    """
    calendar_id = (calendar_id or "").strip()
    if not calendar_id:
        raise ValueError("calendar_id가 비어 있습니다.")

    integration = repository.get_integration(db, workspace_id, ServiceType.google_calendar)
    if not integration or not integration.access_token:
        raise ValueError("Google Calendar 연동이 필요합니다.")

    # 요구사항대로 calendar_id만 저장 (다른 키는 유지하지 않음)
    integration.extra_config = {
        "calendar_id": calendar_id,
        "calendar_name": calendar_name or calendar_id,
    }
    db.commit()
    db.refresh(integration)
    return integration

#===============================================================
#
#                   API service
#
#===============================================================

# Slack API
async def get_slack_channel(db: Session, workspace_id: int) -> List[dict]:
    """
    슬랙 연동후 채널을 선택하기 위해 채널 목록 반환
    """
    integration = repository.get_integration(db, workspace_id, ServiceType.slack)
    if not integration or not integration.access_token:
        raise ValueError("Slack 연동이 되어있지 않거나 토큰이 없습니다.")
    
    slack_client = SlackClient(integration.access_token)
    return await slack_client.get_public_channels()


async def save_slack_channel(db: Session, workspace_id: int, channel_id: str) -> Integration:
    """
    유저가 선택한 Slack 채널 ID를 extra_config 에 저장
    """
    integration = repository.get_integration(db, workspace_id, ServiceType.slack)
    if not integration or not integration.access_token:
        raise ValueError("Slack 연동이 안 되어있습니다.")
    
    extra_config = {**(integration.extra_config or {}) , "channel_id": channel_id}
    return repository.update_tokens(
        db,
        workspace_id=workspace_id,
        access_token=integration.access_token,
        service=ServiceType.slack,
        extra_config=extra_config,
    )

# Google Calendar API
async def list_google_calendar_events(
    db: Session,
    workspace_id: int,
    time_min: str = None,
    max_results: int = 50,
) -> list:
    
    access_token = await get_valid_google_token(db, workspace_id)
    client = GoogleCalendarClient(access_token)
    calendar_id = get_required_workspace_google_calendar_id(db, workspace_id)
    try:
        result = await client.list_events(calendar_id=calendar_id, time_min=time_min, max_results=max_results)
    except httpx.HTTPStatusError as e:
        # 선택된 calendar_id가 삭제/권한 제거 등으로 유효하지 않은 경우
        if e.response.status_code in (404, 410):
            raise ValueError("선택된 Google 캘린더를 찾을 수 없습니다. 다시 선택해주세요.") from e
        raise ValueError(f"Google Calendar 이벤트 조회 실패: {e.response.status_code}") from e
    events = []
    for item in result.get("items", []):
        start = item.get("start", {})
        end = item.get("end", {})
        events.append({
            "id": item.get("id", ""),
            "title": item.get("summary", "(제목 없음)"),
            "start": start.get("dateTime") or start.get("date", ""),
            "end": end.get("dateTime") or end.get("date", ""),
            "description": item.get("description"),
            "html_link": item.get("htmlLink"),
        })
    return events


# jira API 
async def get_valid_jira_token(db: Session, workspace_id: int) -> str:
    integration = repository.get_integration(db, workspace_id, ServiceType.jira)
    if not integration or not integration.access_token:
        raise ValueError("JIRA 연동이 필요합니다.")
    
    expires_at = integration.token_expires_at
    if expires_at:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=KST)
        if expires_at < now_kst() + timedelta(minutes=5):
            client = await ClientSessionManager.get_client()
            res = await client.post(
                "https://auth.atlassian.com/oauth/token",
                json={
                    "grant_type": "refresh_token",
                    "client_id": settings.JIRA_CLIENT_ID,
                    "client_secret": settings.JIRA_CLIENT_SECRET,
                    "refresh_token": integration.refresh_token,
                },
            )
            res.raise_for_status()
            new_tokens = res.json()
            new_expires = now_kst() + timedelta(seconds=new_tokens.get("expires_in", 3600))
            repository.update_tokens(
                db,
                workspace_id=workspace_id,
                service=ServiceType.jira,
                access_token=new_tokens['access_token'],
                refresh_token=new_tokens.get('refresh_token', integration.refresh_token),
                token_expires_at=new_expires,
            )
            return new_tokens['access_token']
    return integration.access_token

def get_jira_cloud_id(db: Session, workspace_id: int) -> str:
    integration = repository.get_integration(db, workspace_id, ServiceType.jira)
    if not integration:
        raise ValueError("JIRA 연동이 필요합니다. 다시 시도하세요.")
    cloud_id = (integration.extra_config or {}).get("cloud_id")
    if not cloud_id:
        raise ValueError("JIRA cloud_id가 설정되지 않았습니다. 다시 시도하세요.")
    return cloud_id

async def get_jira_projects(db: Session, workspace_id: int, query: str = "") -> list[dict]:
    token = await get_valid_jira_token(db, workspace_id)
    cloud_id = get_jira_cloud_id(db, workspace_id)
    client = JiraClient(token, cloud_id)
    projects = await client.get_projects(query)
    return [{
        "key": p["key"],
        "name": p["name"]
    } for p in projects
    ]

def save_jira_project(db: Session, workspace_id: int, project_key: str) -> None:

    integration = repository.get_integration(db, workspace_id, ServiceType.jira)
    if not integration:
        raise ValueError("JIRA 연동이 필요합니다.")

    extra = dict(integration.extra_config or {})
    old_project_key = extra.get("project_key")

    # 프로젝트가 바뀌면 기존 연동 ID 초기화
    if old_project_key and old_project_key != project_key:
        epic_ids_subq = (
            db.query(WbsEpic.id)
            .join(Meeting, WbsEpic.meeting_id == Meeting.id)
            .filter(Meeting.workspace_id == workspace_id)
            .subquery()
        ) 
        db.query(WbsTask).filter(WbsTask.epic_id.in_(epic_ids_subq)).update(
            {"jira_issue_id": None}, synchronize_session=False
        )
        db.query(WbsEpic).filter(WbsEpic.id.in_(epic_ids_subq)).update(
            {"jira_epic_id": None}, synchronize_session=False
        )

    extra["project_key"] = project_key
    integration.extra_config = extra
    db.commit()

async def get_jira_project_statuses(db: Session, workspace_id: int) -> list[str]:
    token = await get_valid_jira_token(db, workspace_id)
    cloud_id = get_jira_cloud_id(db, workspace_id)
    integration = repository.get_integration(db, workspace_id, ServiceType.jira)
    project_key = (integration.extra_config or {}).get("project_key")
    if not project_key:
        raise ValueError("프로젝트를 먼저 선택하세요.")
    client = JiraClient(token, cloud_id)
    return await client.get_project_statuses(project_key)

def save_jira_status_mapping(db: Session, workspace_id: int, mapping: dict) -> None:
    integration = repository.get_integration(db, workspace_id, ServiceType.jira)
    if not integration:
        raise ValueError("JIRA 연동이 필요합니다.")
    extra = dict(integration.extra_config or {})
    extra['status_mapping'] = mapping
    integration.extra_config = extra
    db.commit()

def get_jira_pending_sites(db: Session, workspace_id: int) -> list:
    integration = repository.get_integration(db, workspace_id, ServiceType.jira)
    if not integration or not integration.access_token:
        raise ValueError("JIRA 가 연동되지 않았습니다. 설정 > 연동 관리 에서 다시 시도해주세요.")
    return (integration.extra_config or {}).get("pending_sites", [])

def save_jira_site(db: Session, workspace_id: int, cloud_id: str, site_url: str) -> None:
    integration = repository.get_integration(db, workspace_id, ServiceType.jira)
    if not integration or not integration.access_token:
        raise ValueError("JIRA 연동이 되지 않았습니다. 설정 > 연동 관리 에서 다시 시도해주세요.")
    extra = dict(integration.extra_config or {})
    extra.pop("pending_sites", None)
    extra['cloud_id'] = cloud_id
    extra['site_url'] = site_url
    integration.extra_config = extra
    integration.is_connected = True
    db.commit()


