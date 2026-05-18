# app/domains/action/routers/jira.py
import asyncio
import json
from fastapi import APIRouter, Depends, BackgroundTasks, Query, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.infra.database.session import get_db, SessionLocal
from app.domains.action.schemas import (
    ExportResponse, JiraSyncResponse, JiraSyncItem,
    JiraPreviewResponse, JiraPreviewEpic, JiraPreviewTask,
    JiraSelectiveSyncRequest,
)
from app.domains.action.services.jira import export_jira, sync_from_jira, preview_jira_export
from app.domains.integration.repository import get_integration
from app.domains.integration.models import ServiceType

router = APIRouter()

@router.post("/export/jira", response_model=ExportResponse)
async def jira_export(
    meeting_id: int,
    background_tasks: BackgroundTasks,
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    db: Session = Depends(get_db),
):
    integration = get_integration(db, workspace_id, ServiceType.jira)
    if not integration or not integration.access_token:
        raise HTTPException(status_code=400, detail="지라 연동이 필요합니다. 설정 > 연동 관리에서 연결해주세요.")
    
    project_key = (integration.extra_config or {}).get("project_key")
    if not project_key:
        raise HTTPException(status_code=400, detail="프로젝트를 선택해주세요. 설정 > 연동 관리")
    
    background_tasks.add_task(
        export_jira,
        db=db,
        workspace_id=workspace_id,
        meeting_id=meeting_id,
    )
    return ExportResponse(status="processing")

@router.get("/sync/jira", response_model=JiraSyncResponse)
async def sync_from_jira_route(
    meeting_id: int,
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    db: Session = Depends(get_db),
):
    integration = get_integration(db, workspace_id, ServiceType.jira)
    if not integration:
        raise HTTPException(status_code=400, detail="JIRA 연동이 필요합니다. 설정 > 연동 관리에서 연동해주세요.")
    
    try:
        result = await sync_from_jira(db, workspace_id, meeting_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    return JiraSyncResponse(
        changed=[JiraSyncItem(**item) for item in result['changed']],
        unchanged=result['unchanged'],
        synced_at=result['synced_at'],
    )
    
@router.post("/export/jira/preview", response_model=JiraPreviewResponse)
async def jira_export_preview(
    meeting_id: int,
    body: JiraSelectiveSyncRequest,
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    db: Session = Depends(get_db),
):
    integration = get_integration(db, workspace_id, ServiceType.jira)
    if not integration or not integration.access_token:
        raise HTTPException(status_code=400, detail="JIRA 연동이 필요합니다. 설정 > 연동 관리에서 다시 시도 해주세요.")
    
    result = await preview_jira_export(
        db, workspace_id, meeting_id,
        epic_ids=body.epic_ids,
        task_ids=body.task_ids,
    )
    return JiraPreviewResponse(
        epics=[
            JiraPreviewEpic(
                id=e["id"], title=e["title"], action=e["action"],
                tasks=[JiraPreviewTask(**t) for t in e["tasks"]],
            )
            for e in result["epics"]
        ],
        epic_create=result["epic_create"],
        epic_update=result["epic_update"],
        task_create=result["task_create"],
        task_update=result["task_update"],
        total=result["total"],
    )

@router.post("/export/jira/selective", response_model=ExportResponse)
async def jira_export_selective(
    meeting_id: int,
    body: JiraSelectiveSyncRequest,
    background_tasks: BackgroundTasks,
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    db: Session = Depends(get_db),
):
    integration = get_integration(db, workspace_id, ServiceType.jira)
    if not integration or not integration.access_token:
        raise HTTPException(status_code=400, detail="JIRA 연동이 필요합니다. 설정 > 연동 관리에서 다시 시도해주세요.")
    project_key = (integration.extra_config or {}).get("project_key")
    if not project_key:
        raise HTTPException(status_code=400, detail="JIRA 프로젝트를 찾을 수 없습니다. 설정 > 연동 관리에서 프로젝트를 선택해주세요.")
    background_tasks.add_task(
        export_jira,
        db=db,
        workspace_id=workspace_id,
        meeting_id=meeting_id,
        epic_ids=body.epic_ids,
        task_ids=body.task_ids,
    )
    return ExportResponse(status='ok')

@router.post("/export/jira/stream")
async def jira_export_stream(
    meeting_id: int,
    body: JiraSelectiveSyncRequest,
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    db: Session = Depends(get_db),
):
    integration = get_integration(db, workspace_id, ServiceType.jira)
    if not integration or not integration.access_token:
        raise HTTPException(status_code=400, detail="JIRA 연동이 필요합니다. 설정 > 연동 관리 에서 다시 시도해주세요.")
    
    '''
    내보내기 하는 중에 진행률을 보여주기 위해 비동기식으로 데이터를 전달해야되는데 비동기 큐를 이용해 데이터를 전달한다.
    완료가 되지 않은 상황에서 데이터를 전달하는 것은 list.get은 불가.
    asyncio.Queue가 그 역할을 한다.
    '''
    queue: asyncio.Queue = asyncio.Queue()

    async def run():
        # 백그라운드 작업은 새로운 DB 세션으로 연다.
        # get_db의 세션은 응답을 보낸 순간 세션을 닫는다.
        # background_tasks는 200을 첨부터 보내니 바로 닫혀서 게이지가 안 올라가는 상황이 발생한다.
        db_bg = SessionLocal()
        try:
            result = await export_jira(
                db=db_bg,
                workspace_id=workspace_id,
                meeting_id=meeting_id,
                epic_ids=body.epic_ids,
                task_ids=body.task_ids,
                progress_queue=queue,
            )
            await queue.put({"done": True, **result})
        except Exception as e:
            await queue.put({"done": True, "created": 0, "updated": 0, "failed": [str(e)]})
        finally:
            db_bg.close()
    
    async def event_generator():
        # 백그라운드에서 JIRA 동기화 작업
        asyncio.create_task(run())

        while True:
            # item이 들어올때까지(이벤트 생길때까지) 대기
            item = await queue.get()
            if isinstance(item, dict) and item.get("done"):
                # SSE Server-Sent Events 국제 표준 규칙
                yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
    
    # 이번 Response는 한 번에 끝낼 게 아니다!
    return StreamingResponse(event_generator(), media_type="text/event-stream")