# app\domains\integration\router.py
from fastapi import APIRouter, Depends, HTTPException, Query, Body, status
from typing import Optional
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.infra.database.session import get_db
from app.domains.action.schemas import ExportResponse
from app.domains.integration import repository, service
from app.domains.integration.models import Integration, ServiceType
from app.domains.integration.schemas import (
    IntegrationListResponse,
    IntegrationResponse,
    OAuthUrlResponse,
    SlackChannelSelectRequest,
    SlackChannelListResponse,
    TestIntegrationResponse,
    GoogleCalendarEventsResponse,
    GoogleCalendarEventItem,
    GoogleCalendarListResponse,
    GoogleCalendarItem,
    GoogleCalendarCreateRequest,
    GoogleCalendarCreateResponse,
    GoogleCalendarSelectRequest,
    JiraStatusListResponse,
    JiraProjectListResponse,
    JiraSiteListResponse,
    JiraSiteSelectRequest,
    JiraSiteItem
)
from app.domains.user.dependencies import require_workspace_admin, require_workspace_member

router = APIRouter()

FRONTEND_INTEGRATIONS = f"{settings.FRONTEND_URL}/settings/integrations"


def _to_response(item: Integration) -> IntegrationResponse:
    return IntegrationResponse(
        id=item.id,
        service=item.service,
        is_connected=item.is_connected,
        selected_channel_id=item.extra_config.get("channel_id") if item.extra_config else None,
        selected_calendar_id=item.extra_config.get("calendar_id") if item.extra_config else None,
        selected_calendar_name=item.extra_config.get("calendar_name") if item.extra_config else None,
        selected_project_key=item.extra_config.get("project_key") if item.extra_config else None,
        updated_at=item.updated_at,
    )


@router.get("/workspaces/{workspace_id}", response_model=IntegrationListResponse)
async def get_integrations(
    workspace_id: int,
    db: Session = Depends(get_db),
    _admin=Depends(require_workspace_admin),
) -> IntegrationListResponse:
    items = service.get_integrations(db, workspace_id)
    return IntegrationListResponse(integrations=[_to_response(item) for item in items])


@router.patch(
    "/workspaces/{workspace_id}/{service_name}/connect",
    response_model=IntegrationResponse,
    status_code=status.HTTP_200_OK,
)
async def connect_integration_for_dev(
    workspace_id: int,
    service_name: ServiceType,
    db: Session = Depends(get_db),
    _admin=Depends(require_workspace_admin),
) -> IntegrationResponse:
    item = repository.get_integration(db, workspace_id, service_name)
    if item is None:
        item = Integration(
            workspace_id=workspace_id,
            service=service_name,
            is_connected=True,
        )
        db.add(item)
    else:
        item.is_connected = True
    db.commit()
    db.refresh(item)
    return _to_response(item)


@router.patch(
    "/workspaces/{workspace_id}/{service_name}/disconnect",
    response_model=IntegrationResponse,
    status_code=status.HTTP_200_OK,
)
@router.post(
    "/workspaces/{workspace_id}/{service_name}/disconnect",
    response_model=IntegrationResponse,
    status_code=status.HTTP_200_OK,
)
async def disconnect_integration(
    workspace_id: int,
    service_name: ServiceType,
    db: Session = Depends(get_db),
    _admin=Depends(require_workspace_admin),
) -> IntegrationResponse:
    item = service.disconnect_integration(db, workspace_id, service_name)
    if item is None:
        raise HTTPException(status_code=404, detail="연동 정보를 찾을 수 없습니다.")
    return _to_response(item)


@router.post("/workspaces/{workspace_id}/{service_name}/test", response_model=TestIntegrationResponse)
async def test_webhook(
    workspace_id: int,
    service_name: ServiceType,
    db: Session = Depends(get_db),
    _admin=Depends(require_workspace_admin),
):
    result = await service.test_integration(db, workspace_id, service_name)
    return TestIntegrationResponse(success=result['status']=="ok", status=result['status'], message=result['message'])


@router.get("/google/auth", response_model=OAuthUrlResponse)
async def google_auth(
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    _admin=Depends(require_workspace_admin),
) -> OAuthUrlResponse:
    try:
        return OAuthUrlResponse(auth_url=service.get_google_auth_url(workspace_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/google/callback")
async def google_callback(code: str, state: str, db: Session = Depends(get_db)):
    try:
        await service.handle_google_callback(db, code, state)
        return RedirectResponse(f"{FRONTEND_INTEGRATIONS}?service=google_calendar&status=connected")
    except Exception:
        return RedirectResponse(f"{FRONTEND_INTEGRATIONS}?service=google_calendar&status=error")


@router.get("/slack/auth", response_model=OAuthUrlResponse)
async def slack_auth(
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    _admin=Depends(require_workspace_admin),
) -> OAuthUrlResponse:
    return OAuthUrlResponse(auth_url=service.get_slack_auth_url(workspace_id))


@router.get("/slack/callback")
async def slack_callback(code: str, state: str, db: Session = Depends(get_db)):
    try:
        await service.handle_slack_callback(db, code, state)
        return RedirectResponse(f"{FRONTEND_INTEGRATIONS}?service=slack&status=connected")
    except Exception:
        return RedirectResponse(f"{FRONTEND_INTEGRATIONS}?service=slack&status=error")

@router.get("/jira/auth", response_model=OAuthUrlResponse)
async def jira_auth(
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    _admin = Depends(require_workspace_admin),
) -> OAuthUrlResponse:
    try:
        return OAuthUrlResponse(auth_url=service.get_jira_auth_url(workspace_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

@router.get("/jira/callback")
async def jira_callback(code: str, state: str, db: Session = Depends(get_db)) :
    try:
        result = await service.handle_jira_callback(db, code, state)
        if result['status'] == "connected":
            return RedirectResponse(f"{FRONTEND_INTEGRATIONS}?service=jira&status=connected")
        
        else:
            wid = result['workspace_id']
            return RedirectResponse(f"{FRONTEND_INTEGRATIONS}?service=jira&status=select_site&workspace_id={wid}")
    except Exception:
        return RedirectResponse(f"{FRONTEND_INTEGRATIONS}?service=jira&status=error")

@router.get("/workspaces/{workspace_id}/jira/projects", response_model=JiraProjectListResponse)
async def list_jira_projects(
    workspace_id: int,
    query: str = Query(default="", description="프로젝트 이름 검색"),
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
):
    try:
        projects = await service.get_jira_projects(db, workspace_id, query)
        return JiraProjectListResponse(projects=projects)
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

@router.post("/workspaces/{workspace_id}/jira/project/select", response_model=ExportResponse)
async def select_jira_project(
    workspace_id: int,
    body: dict = Body(...),
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
):
    try:
        service.save_jira_project(db, workspace_id, body['project_key'])
        return ExportResponse(status="ok")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

@router.get("/workspaces/{workspace_id}/jira/statuses", response_model=JiraStatusListResponse)
async def list_jira_statuses(
    workspace_id: int,
    db: Session = Depends(get_db),
    _admin=Depends(require_workspace_admin),
):
    try:
        statuses = await service.get_jira_project_statuses(db, workspace_id)
        return JiraStatusListResponse(statuses=statuses)
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    
@router.post("/workspaces/{workspace_id}/jira/mapping", response_model=ExportResponse)
async def save_jira_mapping(
    workspace_id: int,
    body: dict = Body(...),
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
): 
    try:
        service.save_jira_status_mapping(db, workspace_id, body['status_mapping'])
        return ExportResponse(status="ok")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

@router.post("/workspaces/{workspace_id}/jira/reset-links")
async def reset_jira_links(
    workspace_id: int,
    db: Session = Depends(get_db),
    _admin=Depends(require_workspace_admin),
):
    try:
        service.reset_jira_links(db, workspace_id)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

@router.get("/workspaces/{workspace_id}/jira/sites", response_model=JiraSiteListResponse)
async def list_jira_pending_sites(
    workspace_id: int,
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
):
    try:
        sites = service.get_jira_pending_sites(db, workspace_id)
        return JiraSiteListResponse(sites=[JiraSiteItem(**s) for s in sites])

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

@router.post("/workspaces/{workspace_id}/jira/site/select", response_model=ExportResponse)
async def select_jira_site(
    workspace_id: int,
    body: JiraSiteSelectRequest,
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
):
    try:
        service.save_jira_site(db, workspace_id, body.cloud_id, body.site_url)
        return ExportResponse(status="ok")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

@router.get("/workspaces/{workspace_id}/slack/channels", response_model=SlackChannelListResponse)
async def list_slack_channels(
    workspace_id: int,
    db: Session = Depends(get_db),
    _admin=Depends(require_workspace_admin),
):
    try:
        channels = await service.get_slack_channel(db, workspace_id)
        return SlackChannelListResponse(channels=channels)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/google/events", response_model=GoogleCalendarEventsResponse)
async def list_google_calendar_events(
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    time_min: Optional[str] = Query(None, description="조회 시작 시각 (ISO 8601)"),
    max_results: int = Query(50, description="최대 반환 건수"),
    db: Session = Depends(get_db),
    _admin=Depends(require_workspace_member),
):
    try:
        events = await service.list_google_calendar_events(db, workspace_id, time_min, max_results)
        return GoogleCalendarEventsResponse(
            events=[GoogleCalendarEventItem(**e) for e in events]
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/google/calendars", response_model=GoogleCalendarListResponse)
async def list_google_calendars(
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    db: Session = Depends(get_db),
    _admin=Depends(require_workspace_admin),
):
    """
    Google OAuth 완료 후, 캘린더 선택 UI를 위해 캘린더 목록을 조회한다.
    (calendar.calendarList.list)
    """
    try:
        calendars = await service.list_google_calendars(db, workspace_id)
        return GoogleCalendarListResponse(calendars=[GoogleCalendarItem(**c) for c in calendars])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/google/calendars", response_model=GoogleCalendarCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_google_calendar(
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    body: GoogleCalendarCreateRequest = Body(...),
    db: Session = Depends(get_db),
    _admin=Depends(require_workspace_admin),
):
    """
    새 서브 캘린더를 생성하고(calendar.calendars.insert) calendar_id를 반환한다.
    """
    try:
        created = await service.create_google_calendar(db, workspace_id, body.name)
        return GoogleCalendarCreateResponse(**created)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/google/calendars/select", response_model=IntegrationResponse, status_code=status.HTTP_200_OK)
async def select_google_calendar(
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    body: GoogleCalendarSelectRequest = Body(...),
    db: Session = Depends(get_db),
    _admin=Depends(require_workspace_admin),
):
    """
    사용자가 최종 선택한 calendar_id를 workspace에 저장한다.
    integrations.extra_config = {"calendar_id": "..."}
    """
    try:
        item = service.save_workspace_google_calendar_id(db, workspace_id, body.calendar_id, body.calendar_name)
        return _to_response(item)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/slack/channel", response_model=ExportResponse)
async def select_slack_channel(
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    body: SlackChannelSelectRequest = Body(...),
    db: Session = Depends(get_db),
    _admin=Depends(require_workspace_admin),
):
    await service.save_slack_channel(db, workspace_id, body.channel_id)
    return ExportResponse(status="ok")