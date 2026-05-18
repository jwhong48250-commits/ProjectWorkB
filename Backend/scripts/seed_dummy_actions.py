from app.domains.user.models import User  # noqa: F401
import argparse
from datetime import datetime
from typing import Sequence

from sqlalchemy.orm import Session

from app.infra.database.session import SessionLocal
from app.domains.action.models import ActionItem, ActionStatus
from app.domains.meeting.models import Meeting


def _pick_meeting(db: Session, workspace_id: int, meeting_id: int | None) -> Meeting:
    q = db.query(Meeting).filter(Meeting.workspace_id == workspace_id)
    if meeting_id is not None:
        q = q.filter(Meeting.id == meeting_id)
    meeting = q.order_by(Meeting.id.desc()).first()
    if meeting is None:
        raise SystemExit(
            f"No meeting found (workspace_id={workspace_id}, meeting_id={meeting_id}). "
            "Create a meeting first."
        )
    return meeting


def _bulk_insert_actions(
    db: Session,
    meeting_id: int,
    total: int,
    done: int,
    content_prefix: str,
) -> Sequence[ActionItem]:
    total = max(0, int(total))
    done = max(0, min(int(done), total))
    now = datetime.now()

    items: list[ActionItem] = []
    for i in range(total):
        status = ActionStatus.done if i < done else ActionStatus.pending
        items.append(
            ActionItem(
                meeting_id=meeting_id,
                content=f"{content_prefix} #{i + 1}",
                status=status,
                detected_at=now,
            )
        )

    db.add_all(items)
    db.commit()
    return items


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed dummy ActionItems for dashboard completion-rate testing."
    )
    parser.add_argument("--workspace-id", type=int, default=1)
    parser.add_argument("--meeting-id", type=int, default=None)
    parser.add_argument("--total", type=int, default=5)
    parser.add_argument("--done", type=int, default=2)
    parser.add_argument("--prefix", type=str, default="더미 액션")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        meeting = _pick_meeting(db, workspace_id=args.workspace_id, meeting_id=args.meeting_id)
        items = _bulk_insert_actions(
            db,
            meeting_id=int(meeting.id),
            total=args.total,
            done=args.done,
            content_prefix=args.prefix,
        )
        print(
            f"Inserted {len(items)} ActionItems into meeting_id={int(meeting.id)} "
            f"(workspace_id={args.workspace_id}). done={args.done}"
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()

