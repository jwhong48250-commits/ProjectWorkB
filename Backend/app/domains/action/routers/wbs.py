# app/domains/action/routers/wbs.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.infra.database.session import get_db
from app.domains.action import repository
from app.domains.action.schemas import (
    WbsPageResponse, WbsEpicResponse, WbsTaskResponse,
    WbsEpicCreateRequest, WbsEpicPatchRequest,
    WbsTaskCreateRequest, WbsTaskPatchRequest,
    ExportResponse, WbsMoveTaskRequest,
    WbsReorderRequest
)
from app.domains.user.dependencies import require_workspace_admin, require_workspace_member

# http://localhost:8000/api/v1/actions/meetings/{meeting_id}/wbs
router = APIRouter()

def _task_to_response(t, epic_id: int) -> WbsTaskResponse:
    return WbsTaskResponse(
        id=t.id,
        epic_id=epic_id,
        title=t.title,
        content=t.content,
        assignee_id=t.assignee_id,
        assignee_name=t.assignee_name,
        priority=t.priority.value if hasattr(t.priority, 'value') else t.priority,
        urgency=t.urgency,
        due_date=t.due_date,
        progress=t.progress,
        status=t.status.value if hasattr(t.status, 'value') else t.status,
        jira_issue_id=t.jira_issue_id,
        order_index=t.order_index,
    )

@router.get("/wbs", response_model=WbsPageResponse)
async def get_wbs(
        meeting_id: int,
        workspace_id: int = Query(..., description="워크스페이스 ID"),
        db: Session = Depends(get_db),
        _member = Depends(require_workspace_member),
):
    epics = repository.get_wbs_epics(db, meeting_id)
    epics_with_tasks = [(epic, repository.get_wbs_tasks_by_epic(db, epic.id)) for epic in epics]

    # 스냅샷 없는 경우 최초 저장
    if epics_with_tasks and not repository.get_wbs_snapshot(db, meeting_id):
        repository.save_wbs_snapshot(db, meeting_id, epics_with_tasks)

    result = []
    for epic, tasks in epics_with_tasks:
        result.append(WbsEpicResponse(
            id=epic.id,
            title=epic.title,
            order_index=epic.order_index,
            tasks=[_task_to_response(t, epic.id) for t in tasks]
        ))
    return WbsPageResponse(epics=result)
    
@router.post("/wbs/generate", response_model=WbsPageResponse)
async def generate_wbs(
    meeting_id: int,
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
):
    restored = repository.restore_wbs_from_snapshot(db, meeting_id)
    if not restored:
        raise HTTPException(status_code=404, detail="스냅샷이 없습니다. WBS 데이터가 존재하지 않습니다.")
    
    epics = repository.get_wbs_epics(db, meeting_id)
    
    result = []
    for epic in epics:
        tasks = repository.get_wbs_tasks_by_epic(db, epic.id)
        result.append(WbsEpicResponse(
            id=epic.id,
            title=epic.title,
            order_index=epic.order_index,
            tasks=[_task_to_response(t, epic.id) for t in tasks]
        ))
        
    return WbsPageResponse(epics=result)

@router.post("/wbs/epics", response_model=WbsEpicResponse)
def create_epic(
    meeting_id: int,
    body: WbsEpicCreateRequest,
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
):
    epics = repository.get_wbs_epics(db, meeting_id)
    order = body.order_index if body.order_index is not None else len(epics)
    epic = repository.save_wbs_epic(db, meeting_id, body.title, order)
    return WbsEpicResponse(
        id=epic.id,
        title=epic.title,
        order_index=epic.order_index,
        tasks=[]
    )

@router.post("/wbs/tasks", response_model=WbsTaskResponse)
def create_task(
    meeting_id: int,
    body: WbsTaskCreateRequest,
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
):
    task = repository.save_wbs_task(
        db=db, epic_id=body.epic_id, title=body.title, 
        content=body.content,
        assignee_id=body.assignee_id, 
        assignee_name=body.assignee_name,
        priority=body.priority or "medium", 
        urgency=body.urgency,
        due_date=body.due_date,
        order_index=body.order_index,
    )
    return _task_to_response(task, task.epic_id)

@router.patch("/wbs/epics/{epic_id}", response_model=WbsEpicResponse)
def patch_epic(
    meeting_id: int,
    epic_id: int,
    body: WbsEpicPatchRequest,
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
):
    epic = repository.update_wbs_epic(db, epic_id, body.title, order_index=body.order_index)
    if not epic:
        raise HTTPException(status_code=404, detail="Epic을 찾을 수 없습니다.")
    tasks = repository.get_wbs_tasks_by_epic(db, epic_id)
    return WbsEpicResponse(
        id=epic_id,
        title=epic.title,
        order_index=epic.order_index,
        tasks=[
            _task_to_response(t, epic_id) for t in tasks]
    ) 

@router.patch("/wbs/tasks/{task_id}", response_model=WbsTaskResponse)
def patch_task(
    meeting_id: int,
    task_id: int,
    body: WbsTaskPatchRequest,
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
):
    if body.epic_id is not None:
        repository.move_wbs_task(db, task_id, body.epic_id, body.order_index or 0)
    task = repository.update_wbs_task(
        db=db,
        task_id=task_id,
        title=body.title,
        content=body.content,
        assignee_id=body.assignee_id,
        assignee_name=body.assignee_name,
        priority=body.priority,
        urgency=body.urgency,
        due_date=body.due_date,
        progress=body.progress,
        status=body.status,
        order_index=body.order_index,
    )
    if not task:
        raise HTTPException(status_code=404, detail="TASK를 찾을 수 없습니다.")
    return _task_to_response(task, task.epic_id)

@router.delete("/wbs/epics/{epic_id}", response_model=ExportResponse)
def delete_epic(
    meeting_id: int,
    epic_id: int,
    workspace_id: int = Query(..., description='워크스페이스 ID'),
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
):
    ok = repository.delete_wbs_epic(db, epic_id)
    if not ok:
        raise HTTPException(status_code=404, detail="EPIC을 찾을 수 없습니다.")
    return ExportResponse(status="ok")

@router.delete("/wbs/tasks/{task_id}", response_model=ExportResponse)
def delete_task(
    meeting_id: int,
    task_id: int,
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
):
    ok = repository.delete_wbs_task(db, task_id)
    if not ok:
        raise HTTPException(status_code=404, detail="TASK를 찾을 수 없습니다.")
    return ExportResponse(status="ok")

@router.patch("/wbs/tasks/{task_id}/move", response_model= WbsTaskResponse)
def move_task(
    meeting_id: int,
    task_id: int,
    body: WbsMoveTaskRequest,
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
):
    task = repository.move_wbs_task(db, task_id, body.target_epic_id, body.order_index)
    if not task:
        raise HTTPException(status_code=404, detail="태스크를 찾을 수 없습니다.")
    return _task_to_response(task, task.epic_id)

@router.patch("/wbs/reorder", response_model=ExportResponse)
def reorder_wbs(
    meeting_id: int,
    body: WbsReorderRequest,
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
):
    if body.epics:
        repository.reorder_wbs_epics(
            db,
            [{
                "id": e.id,
                "order_index": e.order_index
            } for e in body.epics]
        )
    
    if body.tasks:
        repository.reorder_wbs_tasks(
            db,
            [{
                "id": t.id,
                "order_index": t.order_index
            } for t in body.tasks]
        )
    return ExportResponse(status="ok")