# app\domains\action\models.py
from sqlalchemy import Enum, ForeignKey, Text, String, func, Integer, DateTime, Date
from sqlalchemy.orm import Mapped, mapped_column
from app.infra.database.base import Base
from datetime import datetime, date
import enum

class ActionStatus(str, enum.Enum):
    pending     = "pending"
    in_progress = "in_progress"
    done        = "done"

class TaskStatus(str, enum.Enum):
    todo        = "todo"
    in_progress = "in_progress"
    done        = "done"

class Priority(str, enum.Enum):
    low      = "low"
    medium   = "medium"
    high     = "high"
    critical = "critical"

class ReportFormat(str, enum.Enum):
    markdown = "markdown"
    excel = "excel"
    wbs = "wbs"
    html = "html"

class ActionItem(Base):
    __tablename__ = "action_items"

    id:             Mapped[int]         = mapped_column(Integer, primary_key=True, autoincrement=True)
    meeting_id:     Mapped[int]         = mapped_column(Integer, ForeignKey("meetings.id"), nullable=False)
    content :       Mapped[str]         = mapped_column(Text, nullable=False)
    assignee_id:    Mapped[int | None]  = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    due_date:       Mapped[date | None] = mapped_column(Date, nullable=True)
    status:         Mapped[ActionStatus]= mapped_column(Enum(ActionStatus), default=ActionStatus.pending)
    detected_at:    Mapped[datetime]    = mapped_column(DateTime, nullable=False)
    jira_issue_id:  Mapped[str | None]  = mapped_column(String(100), nullable=True)
    priority:    Mapped[Priority | None]= mapped_column(Enum(Priority), nullable=True)
    urgency:        Mapped[str | None]  = mapped_column(String(20), nullable=True)


class WbsEpic(Base):
    __tablename__ = "wbs_epics"

    id:             Mapped[int]         = mapped_column(Integer, primary_key=True, autoincrement=True)
    meeting_id:     Mapped[int]         = mapped_column(Integer, ForeignKey("meetings.id"), nullable=False)
    title:          Mapped[str]         = mapped_column(String(200), nullable=False)
    order_index:    Mapped[int]         = mapped_column(Integer, nullable=False)
    jira_epic_id:   Mapped[str | None]  = mapped_column(String(100), nullable=True)


class WbsTask(Base):
    __tablename__ = "wbs_tasks"

    id:             Mapped[int]         = mapped_column(Integer, primary_key=True, autoincrement=True)
    epic_id:        Mapped[int]         = mapped_column(Integer, ForeignKey("wbs_epics.id"), nullable=False)
    title:          Mapped[str]         = mapped_column(String(200), nullable=False)
    content:        Mapped[str | None]  = mapped_column(Text, nullable=True)
    assignee_id:    Mapped[int | None]  = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    assignee_name:  Mapped[str | None]  = mapped_column(String(100), nullable=True)
    priority:       Mapped[Priority]    = mapped_column(Enum(Priority), default=Priority.medium)
    urgency:        Mapped[str | None]  = mapped_column(String(20), nullable=True)
    due_date:       Mapped[date | None ]= mapped_column(Date, nullable=True)
    progress:       Mapped[int]         = mapped_column(Integer, default=0)
    status:         Mapped[TaskStatus]  = mapped_column(Enum(TaskStatus), default=TaskStatus.todo)
    jira_issue_id:  Mapped[str | None]  = mapped_column(String(100), nullable=True)
    created_at:     Mapped[datetime]    = mapped_column(DateTime, default=func.now(), nullable=False)
    updated_at:     Mapped[datetime]    = mapped_column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)
    order_index:    Mapped[int]         = mapped_column(Integer, default=0)

class WbsSnapshot(Base):
    __tablename__ = "wbs_snapshots"
    
    id:             Mapped[int] =       mapped_column(Integer, primary_key=True, autoincrement=True)
    meeting_id:     Mapped[int] =       mapped_column(Integer, ForeignKey("meetings.id"), nullable=False, unique=True)
    snapshot_data:  Mapped[str] =       mapped_column(Text, nullable=False) #JSON
    created_at:     Mapped[datetime] = mapped_column(DateTime, default=func.now(), nullable=False)


class Report(Base):
    __tablename__ = "reports"

    id:         Mapped[int]             = mapped_column(Integer, primary_key=True, autoincrement=True)
    meeting_id: Mapped[int]             = mapped_column(Integer, ForeignKey("meetings.id"), nullable=False)
    created_by: Mapped[int]             = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    format:     Mapped[ReportFormat]    = mapped_column(Enum(ReportFormat), nullable=False)
    title:      Mapped[str]             = mapped_column(String(200), nullable=False)
    content:    Mapped[str | None]      = mapped_column(Text, nullable=True)
    file_url:   Mapped[str | None]      = mapped_column(String(500), nullable=True)
    thumbnail_url:Mapped[str | None]    = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime]        = mapped_column(DateTime, default=func.now(), nullable=False)
    updated_at: Mapped[datetime]        = mapped_column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)
