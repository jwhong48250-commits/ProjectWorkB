# app/domains/action/routers/slack.py
from fastapi import APIRouter, Depends, BackgroundTasks, Query, HTTPException
from sqlalchemy.orm import Session

from app.infra.database.session import get_db
from app.domains.action.schemas import SlackExportRequest, ExportResponse
from app.domains.action.services.slack import export_slack
from app.domains.integration.repository import get_integration
from app.domains.integration.models import ServiceType

router = APIRouter()

'''
    router : http://localhost:8000/api/v1/actions//meetings/{meeting_id}
'''

@router.post("/export/slack", response_model=ExportResponse)
async def export_to_slack(
    meeting_id: int,
    request: SlackExportRequest,
    background_tasks: BackgroundTasks,
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    db: Session = Depends(get_db),
):
    integration = get_integration(db, workspace_id, ServiceType.slack)
    if not integration or not integration.access_token:
        raise HTTPException(status_code=400, detail="Slack 연동이 필요합니다. 설정 > 연동 관리에서 연결해주세요.")

    channel_id = request.channel_id or (integration.extra_config or {}).get("channel_id")
    if not channel_id:
        raise HTTPException(status_code=400, detail="Slack 채널이 설정되지 않았습니다. 설정 > 연동 관리에서 채널을 선택해주세요.")
    
    background_tasks.add_task(
        export_slack,
        db=db,
        workspace_id=workspace_id,
        meeting_id=meeting_id,
        channel_id=channel_id,
        include_action_items=request.include_action_items,
        include_reports=request.include_reports,
    )
    return ExportResponse()