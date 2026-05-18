# app\domains\integration\models.py
from sqlalchemy import Enum, ForeignKey, Text, JSON, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import Integer, Boolean, DateTime
from app.infra.database.base import Base
import enum
from datetime import datetime

class ServiceType(str, enum.Enum):
    jira             = "jira"
    slack            = "slack"
    google_calendar  = "google_calendar"

class Integration(Base):
    __tablename__ = "integrations"

    id:                 Mapped[int]             = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id:       Mapped[int]             = mapped_column(Integer, ForeignKey("workspaces.id"), nullable=False)
    service:            Mapped[ServiceType]     = mapped_column(Enum(ServiceType), nullable=False)
    access_token:       Mapped[str | None]      = mapped_column(Text, nullable=True)
    refresh_token :     Mapped[str | None]      = mapped_column(Text, nullable=True)
    token_expires_at:   Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    extra_config:       Mapped[dict | None]      = mapped_column(JSON, nullable=True)
    is_connected:       Mapped[bool]            = mapped_column(Boolean, default=False)
    updated_at:         Mapped[datetime]             = mapped_column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)