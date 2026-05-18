# app/domains/action/routers/batch.py
import asyncio
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from app.infra.database.session import get_db
from app.domains.action.schemas import BatchExportRequest, BatchExportResponse, BatchExportServiceResult, JiraNotifyRequest, ExportResponse
from app.domains.action.services.batch import export_batch, notify_slack_jira_complete, add_jira_link_to_calendar, share_wbs_progress_to_slack
from app.domains.user.dependencies import require_workspace_admin

router = APIRouter()

@router.post("/export/batch", response_model=BatchExportResponse)
async def batch_export(
    meeting_id: int,
    body: BatchExportRequest,
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
):
    if not body.services:
        raise HTTPException(status_code=400, detail="내보낼 서비스를 하나 이상 선택하세요.")
    
    result = await export_batch(
        workspace_id=workspace_id,
        meeting_id=meeting_id,
        services=body.services,
        slack_channel_id=body.slack_channel_id,
        include_action_items=body.include_action_items,
        include_reports=body.include_reports,
    )
    return BatchExportResponse(
        overall_status=result['overall_status'],
        results={
            svc: BatchExportServiceResult(**res)
            for svc, res in result['results'].items()
        },
    )

@router.post("/export/jira-notify", response_model=BatchExportResponse)
async def jira_notify(
    meeting_id: int,
    body: JiraNotifyRequest,
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    db: Session = Depends(get_db),
    _admin=Depends(require_workspace_admin),
):
    task_map = {}
    if "slack" in body.services:
        task_map["slack"] = notify_slack_jira_complete(workspace_id, meeting_id, body.created, body.updated)
    if "google_calendar" in body.services:
        task_map["google_calendar"] = add_jira_link_to_calendar(workspace_id, meeting_id)

    results_list = await asyncio.gather(*task_map.values(), return_exceptions=True)
    results = {}
    for name, result in zip(task_map.keys(), results_list):
        results[name] = {"status": "error", "message": str(result), "error_code": "unknown"} \
            if isinstance(result, Exception) else result

    statuses = [r["status"] for r in results.values()]
    overall = "success" if all(s == "ok" for s in statuses) \
            else "failed" if all(s == "error" for s in statuses) \
            else "partial_success"

    return BatchExportResponse(
        overall_status=overall,
        results={svc: BatchExportServiceResult(**res) for svc, res in results.items()},
    )

@router.post("/share/wbs-progress", response_model=ExportResponse)
async def wbs_progress_share(
    meeting_id: int,
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    db: Session = Depends(get_db),
    _admin=Depends(require_workspace_admin),
):
    result = await share_wbs_progress_to_slack(workspace_id, meeting_id)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return ExportResponse(status="ok")