from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.domains.notification.models import Notification, NotificationType
from app.domains.notification.schemas import NotificationOut
from app.domains.user.models import User
from app.utils.time_utils import KST, now_kst


def _to_out(n: Notification) -> NotificationOut:
    created = n.created_at
    if created.tzinfo is None:
        # DB에 UTC naive로 저장된 값을 UTC로 간주
        from datetime import timezone

        created = created.replace(tzinfo=timezone.utc).astimezone(KST)
    else:
        created = created.astimezone(KST)

    read = n.read_at
    if read is not None:
        from datetime import timezone

        read = read.replace(tzinfo=timezone.utc).astimezone(KST) if read.tzinfo is None else read.astimezone(KST)

    return NotificationOut(
        id=int(n.id),
        type=str(n.type.value if hasattr(n.type, "value") else n.type),
        title=str(n.title),
        body=str(n.body),
        link=n.link,
        created_at=created,
        read_at=read,
    )


def list_notifications(db: Session, workspace_id: int, user_id: int, limit: int = 30) -> tuple[list[NotificationOut], int]:
    rows = (
        db.query(Notification)
        .filter(Notification.workspace_id == workspace_id, Notification.user_id == user_id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(max(1, min(int(limit), 200)))
        .all()
    )
    unread = (
        db.query(Notification.id)
        .filter(
            Notification.workspace_id == workspace_id,
            Notification.user_id == user_id,
            Notification.read_at.is_(None),
        )
        .count()
    )
    return ([_to_out(r) for r in rows], int(unread))


def mark_read(db: Session, workspace_id: int, user_id: int, ids: list[int]) -> None:
    if not ids:
        return
    db.query(Notification).filter(
        Notification.workspace_id == workspace_id,
        Notification.user_id == user_id,
        Notification.id.in_(ids),
    ).update({Notification.read_at: datetime.utcnow()}, synchronize_session=False)
    db.commit()


def mark_all_read(db: Session, workspace_id: int, user_id: int) -> None:
    db.query(Notification).filter(
        Notification.workspace_id == workspace_id,
        Notification.user_id == user_id,
        Notification.read_at.is_(None),
    ).update({Notification.read_at: datetime.utcnow()}, synchronize_session=False)
    db.commit()


def delete_read(db: Session, workspace_id: int, user_id: int) -> int:
    """
    읽은(read_at != NULL) 알림을 사용자 단위로 일괄 삭제합니다.
    """
    q = db.query(Notification).filter(
        Notification.workspace_id == workspace_id,
        Notification.user_id == user_id,
        Notification.read_at.isnot(None),
    )
    deleted = q.delete(synchronize_session=False)
    db.commit()
    return int(deleted or 0)


def create_notification(
    db: Session,
    workspace_id: int,
    user_id: int,
    type_: NotificationType,
    title: str,
    body: str,
    link: str | None = None,
    dedupe_key: str | None = None,
) -> Notification:
    if dedupe_key:
        exists = (
            db.query(Notification.id)
            .filter(
                Notification.workspace_id == workspace_id,
                Notification.user_id == user_id,
                Notification.type == type_,
                Notification.dedupe_key == dedupe_key,
            )
            .first()
        )
        if exists:
            return db.query(Notification).filter(Notification.id == exists[0]).one()

    n = Notification(
        workspace_id=workspace_id,
        user_id=user_id,
        type=type_,
        title=title,
        body=body,
        link=link,
        dedupe_key=dedupe_key,
        created_at=datetime.utcnow(),
    )
    db.add(n)
    db.commit()
    db.refresh(n)
    return n


def emit_meeting_invites(
    db: Session,
    workspace_id: int,
    meeting_id: int,
    meeting_title: str,
    scheduled_at_kst: datetime | None,
    invited_user_ids: list[int],
    actor_user_id: int | None = None,
) -> None:
    when = (
        scheduled_at_kst.astimezone(KST).strftime("%-m/%-d %H:%M")
        if scheduled_at_kst
        else ""
    )
    for uid in invited_user_ids:
        if actor_user_id is not None and uid == actor_user_id:
            continue
        create_notification(
            db,
            workspace_id=workspace_id,
            user_id=uid,
            type_=NotificationType.meeting_invite,
            title="새 회의 초대",
            body=f"[{meeting_title}] 회의에 참석자로 지정되었습니다.{f' ({when})' if when else ''}",
            link=f"/meetings/{meeting_id}/upcoming",
            dedupe_key=f"meeting_invite:{meeting_id}:{uid}",
        )


def emit_meeting_soon_if_needed(
    db: Session,
    workspace_id: int,
    meeting_id: int,
    meeting_title: str,
    scheduled_at_kst: datetime,
    participant_user_ids: list[int],
    minutes_before: int = 10,
) -> None:
    # KST naive 저장 정책을 고려해 비교는 KST 기준으로
    now = now_kst().replace(tzinfo=None)
    target = scheduled_at_kst.replace(tzinfo=None)
    delta = target - now
    if delta < timedelta(minutes=0) or delta > timedelta(minutes=minutes_before):
        return

    for uid in participant_user_ids:
        create_notification(
            db,
            workspace_id=workspace_id,
            user_id=uid,
            type_=NotificationType.meeting_soon,
            title="회의 임박 안내",
            body=f"10분 뒤 [{meeting_title}] 회의가 시작됩니다. 입장 준비를 해주세요.",
            link=f"/meetings/{meeting_id}/upcoming",
            dedupe_key=f"meeting_soon:{meeting_id}:{target.isoformat()}:{uid}",
        )


def emit_workspace_member_joined(
    db: Session,
    workspace_id: int,
    workspace_name: str,
    new_user_id: int,
    new_user_name: str,
    role_display: str,
) -> None:
    """
    워크스페이스에 기존에 속한 멤버·관리자에게 신규 합류 알림을 보냅니다 (신규 가입자 본인 제외).
    """
    rows = (
        db.query(User.id)
        .filter(
            User.workspace_id == workspace_id,
            User.id != new_user_id,
            User.is_active.is_(True),
        )
        .all()
    )
    title = "새 멤버 합류"
    body = f"{new_user_name}님이 [{workspace_name}] 워크스페이스에 {role_display}로 합류했습니다."
    dedupe = f"workspace_member_joined:{new_user_id}"
    link = "/settings/members"
    for (uid,) in rows:
        create_notification(
            db,
            workspace_id=workspace_id,
            user_id=int(uid),
            type_=NotificationType.workspace_member_joined,
            title=title,
            body=body,
            link=link,
            dedupe_key=dedupe,
        )

