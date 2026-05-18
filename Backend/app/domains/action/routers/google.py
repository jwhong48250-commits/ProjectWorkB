# app/domains/action/routers/google.py
from fastapi import APIRouter, Depends, BackgroundTasks, Query, HTTPException
from sqlalchemy.orm import Session

from app.infra.database.session import get_db
from app.domains.action.schemas import (
    ExportResponse,
    NextMeetingSuggestRequest,
    NextMeetingSuggestResponse,
    NextMeetingRegisterRequest,
    NextMeetingRegisterResponse,
    NextMeetingUpdateRequest,
)
from app.domains.action.services.google import (
    export_google_calendar,
    suggest_next_meeting,
    register_next_meeting,
    update_next_meeting,
    delete_next_meeting,
)

router = APIRouter()

'''
    router : http://localhost:8000/api/v1/actions//meetings/{meeting_id}
'''

@router.post("/export/google-calendar", response_model=ExportResponse)
async def export_to_google_calendar(
        meeting_id: int,
        background_tasks: BackgroundTasks,
        workspace_id: int = Query(..., description="워크스페이스 ID"),
        db: Session = Depends(get_db),
):
    background_tasks.add_task(
        export_google_calendar,
        db=db,
        workspace_id=workspace_id,
        meeting_id=meeting_id,
    )
    return ExportResponse(status="processing")

@router.post("/next-meeting/suggest", response_model=NextMeetingSuggestResponse)
async def suggest_next_meeting_slot(
    meeting_id: int,
    request: NextMeetingSuggestRequest,
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    db: Session = Depends(get_db),
):
    try:
        slots = await suggest_next_meeting(
            db=db,
            workspace_id=workspace_id,
            meeting_id= meeting_id,
            duration_minutes=request.duration_minutes,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return NextMeetingSuggestResponse(slots=slots)

@router.post("/next-meeting/register", response_model=NextMeetingRegisterResponse)
async def register_next_meeting_slot(
    meeting_id: int,
    request: NextMeetingRegisterRequest,
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    db: Session = Depends(get_db),
):
    event_id = await register_next_meeting(
        db=db,
        workspace_id=workspace_id,
        meeting_id=meeting_id,
        title=request.title,
        scheduled_at=request.scheduled_at,
        attendee_emails=request.attendee_emails,
    )
    return NextMeetingRegisterResponse(event_id=event_id)

@router.patch("/next-meeting/{event_id}", response_model=ExportResponse)
async def update_next_meeting_slot(
    meeting_id: int,
    event_id: str,
    request: NextMeetingUpdateRequest,
    workspace_id: int = Query(..., description="워크스페이스 ID"),
    db: Session = Depends(get_db),
):
    await update_next_meeting(
        db=db,
        workspace_id=workspace_id,
        event_id=event_id,
        title=request.title,
        scheduled_at=request.scheduled_at,
        duration_minutes=request.duration_minutes,
        attendee_emails=request.attendee_emails,
        description=request.description,
    )
    return ExportResponse(status="ok")

@router.delete("/next-meeting/{event_id}", response_model=ExportResponse)
async def delete_next_meeting_slot(
        meeting_id: int,
        event_id: str,
        workspace_id: int = Query(..., description="워크스페이스 ID"),
        db: Session = Depends(get_db),
):
    await delete_next_meeting(
            db=db, 
            workspace_id=workspace_id, 
            event_id=event_id
    )
    return ExportResponse(status="ok")