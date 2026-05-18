"""
회의 ID별 연관 데이터 일괄 삭제 (MySQL → Mongo → Redis).

실행 예:
  cd workb-backend && python -m scripts.delete_meetings 122 123 124
  cd workb-backend && .venv/bin/python scripts/delete_meetings.py 45 46
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

# 프로젝트 루트를 path에 추가
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("delete_meetings")


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="지정한 meeting id의 MySQL·Mongo·Redis 연관 데이터를 삭제합니다.",
    )
    p.add_argument(
        "meeting_ids",
        nargs="+",
        type=int,
        metavar="ID",
        help="삭제할 meetings.id (공백으로 여러 개)",
    )
    return p.parse_args()


def _register_orm_models() -> None:
    """SQLAlchemy FK 해석을 위해 앱과 동일하게 모델 등록."""
    from app.domains.user.models import User, UserDeviceSetting  # noqa: F401
    from app.domains.workspace.models import (  # noqa: F401
        Workspace,
        InviteCode,
        WorkspaceMember,
        DeviceSetting,
        Department,
    )
    from app.domains.meeting.models import Meeting, MeetingParticipant, SpeakerProfile  # noqa: F401
    from app.domains.intelligence.models import (  # noqa: F401
        Decision,
        MeetingMinute,
        MinutePhoto,
        ReviewRequest,
    )
    from app.domains.action.models import (  # noqa: F401
        ActionItem,
        WbsEpic,
        WbsTask,
        Report,
        WbsSnapshot,
    )
    from app.domains.integration.models import Integration  # noqa: F401
    from app.domains.notification.models import Notification  # noqa: F401


def delete_mysql_for_meeting(db, meeting_id: int) -> bool:
    from app.domains.intelligence.models import Decision, MeetingMinute, MinutePhoto, ReviewRequest
    from app.domains.meeting.models import Meeting, MeetingParticipant
    from app.domains.action.models import ActionItem, Report, WbsEpic, WbsTask, WbsSnapshot
    from app.domains.notification.models import Notification

    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).one_or_none()
    if meeting is None:
        logger.warning("MySQL: meetings.id=%s 없음 (건너뜀)", meeting_id)
        return False

    minute = (
        db.query(MeetingMinute)
        .filter(MeetingMinute.meeting_id == meeting_id)
        .one_or_none()
    )
    if minute is not None:
        mid_int = int(minute.id)
        db.query(MinutePhoto).filter(MinutePhoto.minute_id == mid_int).delete(
            synchronize_session=False
        )
        db.query(ReviewRequest).filter(ReviewRequest.minute_id == mid_int).delete(
            synchronize_session=False
        )
        db.query(MeetingMinute).filter(MeetingMinute.id == mid_int).delete(
            synchronize_session=False
        )

    db.query(Decision).filter(Decision.meeting_id == meeting_id).delete(
        synchronize_session=False
    )
    db.query(MeetingParticipant).filter(
        MeetingParticipant.meeting_id == meeting_id
    ).delete(synchronize_session=False)
    db.query(ActionItem).filter(ActionItem.meeting_id == meeting_id).delete(
        synchronize_session=False
    )
    db.query(Report).filter(Report.meeting_id == meeting_id).delete(
        synchronize_session=False
    )
    db.query(WbsSnapshot).filter(WbsSnapshot.meeting_id == meeting_id).delete(
        synchronize_session=False
    )

    epic_ids = [
        int(e.id)
        for e in db.query(WbsEpic.id).filter(WbsEpic.meeting_id == meeting_id).all()
    ]
    if epic_ids:
        db.query(WbsTask).filter(WbsTask.epic_id.in_(epic_ids)).delete(
            synchronize_session=False
        )
        db.query(WbsEpic).filter(WbsEpic.id.in_(epic_ids)).delete(
            synchronize_session=False
        )

    link_needle = f"/meetings/{meeting_id}/"
    db.query(Notification).filter(Notification.link.contains(link_needle)).delete(
        synchronize_session=False
    )

    db.query(Meeting).filter(Meeting.id == meeting_id).delete(synchronize_session=False)
    logger.info("MySQL: meeting_id=%s 행 및 연관 데이터 삭제 예정 (커밋 전)", meeting_id)
    return True


def delete_mongo_for_meeting(db_mongo, meeting_id: int) -> None:
    q = {"$or": [{"meeting_id": meeting_id}, {"meeting_id": str(meeting_id)}]}
    for coll in ("utterances", "meeting_summaries", "meeting_contexts"):
        res = db_mongo[coll].delete_many(q)
        if res.deleted_count:
            logger.info("Mongo %s: meeting_id=%s 삭제 %d건", coll, meeting_id, res.deleted_count)


def delete_redis_for_meeting(r_sync, meeting_id: int) -> None:
    keys = [
        f"meeting:{meeting_id}:utterances",
        f"meeting:{meeting_id}:latest",
        f"meeting:{meeting_id}:speakers",
        f"meeting:{meeting_id}:partial_summary",
    ]
    deleted = r_sync.delete(*keys)
    if deleted:
        logger.info("Redis meeting_id=%s 키 %d개 삭제", meeting_id, deleted)


def main() -> None:
    args = _parse_args()
    meeting_ids = sorted({mid for mid in args.meeting_ids if mid > 0})
    if not meeting_ids:
        logger.error("유효한 meeting id가 없습니다. (양의 정수만 허용)")
        sys.exit(1)
    skipped = sorted(set(args.meeting_ids) - set(meeting_ids))
    if skipped:
        logger.warning("건너뜀 (0 이하): %s", skipped)

    from app.core.config import settings
    from app.infra.database.session import SessionLocal
    import redis
    from pymongo import MongoClient

    _register_orm_models()
    logger.info("삭제 대상 meeting_ids=%s", meeting_ids)

    session = SessionLocal()
    try:
        for mid in meeting_ids:
            delete_mysql_for_meeting(session, mid)
        session.commit()
        logger.info("MySQL 커밋 완료")
    except Exception:
        session.rollback()
        logger.exception("MySQL 롤백")
        raise
    finally:
        session.close()

    mongo_client = MongoClient(settings.MONGODB_URL)
    try:
        db_mongo = mongo_client["meeting_assistant"]
        for mid in meeting_ids:
            delete_mongo_for_meeting(db_mongo, mid)
    finally:
        mongo_client.close()

    r_sync = redis.Redis.from_url(settings.REDIS_URL)
    try:
        for mid in meeting_ids:
            delete_redis_for_meeting(r_sync, mid)
    finally:
        r_sync.close()

    logger.info("완료: meeting_ids=%s", meeting_ids)


if __name__ == "__main__":
    main()
