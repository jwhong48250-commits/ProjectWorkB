# app/domains/action/minutes_repository.py
from typing import Optional

from sqlalchemy.orm import Session

from app.domains.intelligence.models import MeetingMinute, MinuteStatus
from app.domains.meeting.models import Meeting
from app.domains.user.models import User
from app.domains.workspace.models import Department, WorkspaceMember
from app.utils.time_utils import now_kst


def get_meeting(db: Session, meeting_id: int) -> Optional[Meeting]:
    return db.query(Meeting).filter(Meeting.id == meeting_id).first()


def get_meeting_minute(db: Session, meeting_id: int) -> Optional[MeetingMinute]:
    return (
        db.query(MeetingMinute)
        .filter(MeetingMinute.meeting_id == meeting_id)
        .first()
    )


def get_user(db: Session, user_id: int) -> Optional[User]:
    return db.query(User).filter(User.id == user_id).first()


def get_dept_name(db: Session, user: User, workspace_id: int | None = None) -> str:
    department_id: int | None = None

    # 워크스페이스 멤버십 부서가 있으면 우선 사용
    if workspace_id is not None:
        membership = (
            db.query(WorkspaceMember)
            .filter(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == user.id,
            )
            .one_or_none()
        )
        if membership and getattr(membership, "department_id", None):
            department_id = int(membership.department_id)

    # 레거시 user.department_id 폴백
    if department_id is None and getattr(user, "department_id", None):
        department_id = int(user.department_id)

    if department_id is None:
        return ""

    dept = db.query(Department).filter(Department.id == department_id).first()
    return dept.name if dept else ""


def save_or_update_minute(
    db: Session,
    meeting_id: int,
    content: str,
    summary: str = "",
) -> MeetingMinute:
    existing = get_meeting_minute(db, meeting_id)
    now = now_kst()
    if existing:
        existing.content = content
        existing.updated_at = now
        db.commit()
        db.refresh(existing)
        return existing

    minute = MeetingMinute(
        meeting_id=meeting_id,
        content=content,
        summary=summary,
        status=MinuteStatus.draft,
        created_at=now,
        updated_at=now,
    )
    db.add(minute)
    db.commit()
    db.refresh(minute)
    return minute
