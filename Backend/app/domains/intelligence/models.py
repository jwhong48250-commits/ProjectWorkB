# app\domains\intelligence\models.py
from sqlalchemy import Column, String, Enum, DateTime, Boolean, ForeignKey, Text, Integer, func
from app.infra.database.base import Base
import enum

class MinuteStatus(str, enum.Enum):
    draft   = "draft"
    editing = "editing"
    final   = "final"

class ReviewStatus(str, enum.Enum):
    pending  = "pending"
    approved = "approved"
    rejected = "rejected"

class Decision(Base):
    __tablename__ = "decisions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    meeting_id = Column(Integer, ForeignKey("meetings.id"), nullable=False)
    content = Column(Text, nullable=False)
    speaker_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    detected_at = Column(DateTime, nullable=False)
    is_confirmed = Column(Boolean, default=False)

class MeetingMinute(Base):
      __tablename__ = "meeting_minutes"

      id            = Column(Integer, primary_key=True, autoincrement=True)
      meeting_id    = Column(Integer, ForeignKey("meetings.id"), unique=True, nullable=False)
      content       = Column(Text, nullable=True)
      summary       = Column(Text, nullable=True)
      status        = Column(Enum(MinuteStatus), default=MinuteStatus.draft)
      reviewer_id   = Column(Integer, ForeignKey("users.id"), nullable=True)
      review_status = Column(Enum(ReviewStatus), nullable=True)
      created_at    = Column(DateTime, default=func.now(), nullable=False)
      updated_at    = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)


class MinutePhoto(Base):
      __tablename__ = "minute_photos"

      id         = Column(Integer, primary_key=True, autoincrement=True)
      minute_id  = Column(Integer, ForeignKey("meeting_minutes.id"), nullable=False)
      photo_url  = Column(String(500), nullable=False)
      taken_at   = Column(DateTime, nullable=False)
      taken_by   = Column(Integer, ForeignKey("users.id"), nullable=False)


class ReviewRequest(Base):
      __tablename__ = "review_requests"

      id           = Column(Integer, primary_key=True, autoincrement=True)
      minute_id    = Column(Integer, ForeignKey("meeting_minutes.id"), nullable=False)
      requester_id = Column(Integer, ForeignKey("users.id"), nullable=False)
      reviewer_id  = Column(Integer, ForeignKey("users.id"), nullable=False)
      notify_slack = Column(Boolean, default=False)
      status       = Column(Enum(ReviewStatus), default=ReviewStatus.pending)
      requested_at = Column(DateTime, default=func.now(), nullable=False)
      reviewed_at  = Column(DateTime, nullable=True)