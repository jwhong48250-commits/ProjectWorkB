# app\domains\meeting\models.py
from sqlalchemy import Column, String, Enum, DateTime, Boolean, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime, date
from app.infra.database.base import Base
import enum

class MeetingStatus(str, enum.Enum):
    scheduled   = "scheduled"
    in_progress = "in_progress"
    done        = "done"

class DiarizationMethod(str, enum.Enum):
    stereo      = "stereo"
    diarization = "diarization"

class Meeting(Base):
    __tablename__ = "meetings"
    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id"), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(200), nullable=False)
    meeting_type = Column(String(100), nullable=True)
    status = Column(Enum(MeetingStatus), default=MeetingStatus.scheduled)
    room_name = Column(String(100), nullable=False, default="미지정")
    scheduled_at = Column(DateTime, nullable=True)
    started_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)
    google_calendar_event_id = Column(String(255), nullable=True)

    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)

class MeetingParticipant(Base):
    __tablename__ = "meeting_participants"

    id = Column(Integer, primary_key=True, autoincrement=True)
    meeting_id = Column(Integer, ForeignKey("meetings.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    speaker_label = Column(String(20), nullable=True)
    is_host = Column(Boolean, default=False)

class SpeakerProfile(Base):
    __tablename__ = "speaker_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    workspace_id: Mapped[int] = mapped_column(Integer, ForeignKey("workspaces.id"), nullable=False)
    voice_model_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    diarization_method: Mapped[DiarizationMethod] = mapped_column(Enum(DiarizationMethod), nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    voice_embedding: Mapped[str | None] = mapped_column(LONGTEXT().with_variant(Text(), "sqlite"), nullable=True)
    
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)
