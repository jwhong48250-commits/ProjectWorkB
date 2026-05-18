from __future__ import annotations

from datetime import datetime
import enum

from sqlalchemy import Enum, ForeignKey, Integer, String, DateTime, Text, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.infra.database.base import Base


class NotificationType(str, enum.Enum):
    meeting_invite = "meeting_invite"
    meeting_soon = "meeting_soon"
    minutes_ready = "minutes_ready"
    action_assigned = "action_assigned"
    action_due_soon = "action_due_soon"
    review_requested = "review_requested"
    integration_expired = "integration_expired"
    role_changed = "role_changed"
    workspace_member_joined = "workspace_member_joined"


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(Integer, ForeignKey("workspaces.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)

    type: Mapped[NotificationType] = mapped_column(Enum(NotificationType), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    link: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # 중복 방지 키 (예: meeting_soon:meeting_id:timestamp)
    dedupe_key: Mapped[str | None] = mapped_column(String(200), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


Index("ix_notifications_user_created", Notification.user_id, Notification.created_at)
Index("ix_notifications_dedupe", Notification.user_id, Notification.type, Notification.dedupe_key)

