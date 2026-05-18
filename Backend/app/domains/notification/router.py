from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.deps import get_current_user_id
from app.db.session import get_db
from app.domains.user.dependencies import require_workspace_member
from app.domains.notification import service
from app.domains.notification.schemas import NotificationsListResponse, MarkReadRequest, DeleteReadResponse


router = APIRouter()


@router.get("/workspaces/{workspace_id}", response_model=NotificationsListResponse)
def list_my_notifications(
    workspace_id: int,
    limit: int = Query(30, ge=1, le=200),
    db: Session = Depends(get_db),
    _member=Depends(require_workspace_member),
    current_user_id: int = Depends(get_current_user_id),
) -> NotificationsListResponse:
    items, unread = service.list_notifications(db, workspace_id, current_user_id, limit=limit)
    return NotificationsListResponse(notifications=items, unread_count=unread)


@router.patch("/workspaces/{workspace_id}/read")
def mark_notifications_read(
    workspace_id: int,
    body: MarkReadRequest,
    db: Session = Depends(get_db),
    _member=Depends(require_workspace_member),
    current_user_id: int = Depends(get_current_user_id),
) -> dict:
    service.mark_read(db, workspace_id, current_user_id, body.ids)
    return {"status": "ok"}


@router.post("/workspaces/{workspace_id}/read-all")
def mark_all_notifications_read(
    workspace_id: int,
    db: Session = Depends(get_db),
    _member=Depends(require_workspace_member),
    current_user_id: int = Depends(get_current_user_id),
) -> dict:
    service.mark_all_read(db, workspace_id, current_user_id)
    return {"status": "ok"}


@router.delete("/workspaces/{workspace_id}/read")
def delete_read_notifications(
    workspace_id: int,
    db: Session = Depends(get_db),
    _member=Depends(require_workspace_member),
    current_user_id: int = Depends(get_current_user_id),
) -> DeleteReadResponse:
    deleted = service.delete_read(db, workspace_id, current_user_id)
    return DeleteReadResponse(deleted_count=deleted)

