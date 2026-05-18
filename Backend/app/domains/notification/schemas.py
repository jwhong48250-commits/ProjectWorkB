from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, Field


class NotificationOut(BaseModel):
    id: int
    type: str
    title: str
    body: str
    link: str | None = None
    created_at: datetime
    read_at: datetime | None = None


class NotificationsListResponse(BaseModel):
    notifications: list[NotificationOut] = Field(default_factory=list)
    unread_count: int = 0


class MarkReadRequest(BaseModel):
    ids: list[int] = Field(default_factory=list)


class DeleteReadResponse(BaseModel):
    deleted_count: int = 0

