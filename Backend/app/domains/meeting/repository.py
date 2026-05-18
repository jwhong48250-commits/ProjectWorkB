# app\domains\meeting\repository.py
from __future__ import annotations

from datetime import date as DateType

from sqlalchemy import desc, func, or_
from sqlalchemy.orm import Session

from app.domains.intelligence.models import MeetingMinute
from app.domains.meeting.models import Meeting, MeetingParticipant, MeetingStatus


class MeetingHistoryRepository:
    @staticmethod
    def search_history(
        db: Session,
        workspace_id: int,
        keyword: str | None,
        page: int,
        size: int,
        participant_user_id: int | None = None,
        on_date: DateType | None = None,
        status_filter: str = "all",
    ) -> tuple[int, list[tuple[Meeting, MeetingMinute | None]]]:
        q = (
            db.query(Meeting, MeetingMinute)
            .outerjoin(MeetingMinute, MeetingMinute.meeting_id == Meeting.id)
            .filter(Meeting.workspace_id == workspace_id)
        )

        # 상태 필터: scheduled=예정만, done=완료만, all=둘 다(진행 중 항상 제외)
        if status_filter == "scheduled":
            q = q.filter(Meeting.status == MeetingStatus.scheduled)
        elif status_filter == "done":
            q = q.filter(Meeting.status == MeetingStatus.done)
        else:
            q = q.filter(Meeting.status != MeetingStatus.in_progress)

        if participant_user_id is not None:
            participant_meeting_ids = db.query(MeetingParticipant.meeting_id).filter(
                MeetingParticipant.user_id == participant_user_id
            )
            q = q.filter(Meeting.id.in_(participant_meeting_ids))

        if keyword is not None:
            kw = keyword.strip()
            if kw:
                like = f"%{kw}%"
                q = q.filter(
                    or_(
                        Meeting.title.ilike(like),
                        MeetingMinute.content.ilike(like),
                        MeetingMinute.summary.ilike(like),
                    )
                )

        if on_date is not None:
            q = q.filter(
                or_(
                    func.date(Meeting.scheduled_at) == on_date,
                    func.date(Meeting.started_at) == on_date,
                    func.date(Meeting.ended_at) == on_date,
                )
            )

        total = q.with_entities(func.count(Meeting.id)).scalar() or 0


        rows = (
            # MySQL does not support "NULLS LAST" syntax.
            # Match home-dashboard sort: ended_at desc (NULLs last) → started_at desc (NULLs last).
            q.order_by(
                Meeting.ended_at.is_(None),
                desc(Meeting.ended_at),
                Meeting.started_at.is_(None),
                desc(Meeting.started_at),
            )
            .offset((page - 1) * size)
            .limit(size)
            .all()
        )

        return int(total), rows
