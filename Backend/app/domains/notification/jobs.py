from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, date

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal
from app.domains.integration.models import Integration, ServiceType
from app.domains.meeting.models import Meeting, MeetingParticipant, MeetingStatus
from app.domains.action.models import ActionItem, ActionStatus
from app.domains.user.models import User
from app.domains.notification.models import NotificationType
from app.domains.notification import service as notification_service
from app.utils.time_utils import now_kst, KST


def _kst_naive(dt: datetime) -> datetime:
    # 앱 정책: Meeting.scheduled_at 등은 KST naive로 저장됨
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(KST).replace(tzinfo=None)


def run_once(db: Session) -> None:
    _emit_meeting_soon(db)
    _emit_action_assigned_recent(db)
    _emit_action_due_soon(db)
    _emit_integration_token_expiring(db)


def _emit_meeting_soon(db: Session) -> None:
    now = now_kst()
    start = _kst_naive(now)
    end = _kst_naive(now + timedelta(minutes=10))

    meetings = (
        db.query(Meeting)
        .filter(
            Meeting.status == MeetingStatus.scheduled,
            Meeting.scheduled_at.isnot(None),
            Meeting.scheduled_at >= start,
            Meeting.scheduled_at <= end,
        )
        .order_by(Meeting.scheduled_at.asc())
        .all()
    )
    if not meetings:
        return

    meeting_ids = [int(m.id) for m in meetings]
    rows = (
        db.query(MeetingParticipant.meeting_id, MeetingParticipant.user_id)
        .filter(MeetingParticipant.meeting_id.in_(meeting_ids))
        .all()
    )
    participants_by_meeting: dict[int, list[int]] = {}
    for mid, uid in rows:
        participants_by_meeting.setdefault(int(mid), []).append(int(uid))

    for m in meetings:
        mid = int(m.id)
        participant_ids = participants_by_meeting.get(mid, [])
        if not participant_ids:
            continue
        notification_service.emit_meeting_soon_if_needed(
            db,
            workspace_id=int(m.workspace_id),
            meeting_id=mid,
            meeting_title=str(m.title),
            scheduled_at_kst=_kst_naive(m.scheduled_at),  # type: ignore[arg-type]
            participant_user_ids=participant_ids,
            minutes_before=10,
        )


def _emit_action_due_soon(db: Session) -> None:
    today = now_kst().date()
    target = today + timedelta(days=1)
    items = (
        db.query(ActionItem)
        .filter(
            ActionItem.assignee_id.isnot(None),
            ActionItem.due_date == target,
            ActionItem.status != ActionStatus.done,
        )
        .all()
    )
    if not items:
        return

    meeting_ids = list({int(a.meeting_id) for a in items})
    meeting_ws = dict(db.query(Meeting.id, Meeting.workspace_id).filter(Meeting.id.in_(meeting_ids)).all())
    for a in items:
        uid = int(a.assignee_id)  # type: ignore[arg-type]
        wsid = int(meeting_ws.get(int(a.meeting_id), 1))
        notification_service.create_notification(
            db,
            workspace_id=wsid,
            user_id=uid,
            type_=NotificationType.action_due_soon,
            title="업무 기한 임박",
            body=f"액션 아이템 [{a.content}] 마감이 내일입니다.",
            link=f"/meetings/{int(a.meeting_id)}/wbs",
            dedupe_key=f"action_due_soon:{int(a.id)}:{target.isoformat()}",
        )


def _emit_action_assigned_recent(db: Session) -> None:
    # ActionItem에는 created_at이 없어서 detected_at 기준으로 "최근 생성"을 추정
    cutoff = now_kst() - timedelta(minutes=5)
    cutoff_naive = cutoff.replace(tzinfo=None)
    rows = (
        db.query(ActionItem)
        .filter(
            ActionItem.assignee_id.isnot(None),
            ActionItem.detected_at >= cutoff_naive,
        )
        .all()
    )
    if not rows:
        return

    meeting_ids = list({int(a.meeting_id) for a in rows})
    meeting_ws = dict(
        db.query(Meeting.id, Meeting.workspace_id).filter(Meeting.id.in_(meeting_ids)).all()
    )

    for a in rows:
        uid = int(a.assignee_id)  # type: ignore[arg-type]
        wsid = int(meeting_ws.get(int(a.meeting_id), 1))
        notification_service.create_notification(
            db,
            workspace_id=wsid,
            user_id=uid,
            type_=NotificationType.action_assigned,
            title="신규 업무 할당",
            body=f"새로운 액션 아이템 [{a.content}]의 담당자로 지정되었습니다.",
            link=f"/meetings/{int(a.meeting_id)}/wbs",
            dedupe_key=f"action_assigned:{int(a.id)}:{date.today().isoformat()}",
        )


def _emit_integration_token_expiring(db: Session) -> None:
    now = datetime.utcnow()

    integrations = (
        db.query(Integration)
        .filter(
            Integration.is_connected.is_(True),
            Integration.service == ServiceType.google_calendar,
            Integration.token_expires_at.isnot(None),
            # "만료 예정"이 아니라 "진짜 만료됨"일 때만 경고
            Integration.token_expires_at <= now,
        )
        .all()
    )
    if not integrations:
        return

    # 워크스페이스 관리자에게만 노출 (즉시 조치 필요)
    ws_ids = list({int(i.workspace_id) for i in integrations})
    admin_rows = (
        db.query(User.id, User.workspace_id)
        .filter(User.workspace_id.in_(ws_ids), User.role == "admin")
        .all()
    )
    admins_by_ws: dict[int, list[int]] = {}
    for uid, wsid in admin_rows:
        admins_by_ws.setdefault(int(wsid), []).append(int(uid))

    label = {
        ServiceType.google_calendar: "Google Calendar",
        ServiceType.jira: "JIRA",
        ServiceType.slack: "Slack",
    }

    for integ in integrations:
        wsid = int(integ.workspace_id)
        admins = admins_by_ws.get(wsid, [])
        if not admins:
            continue
        service_name = label.get(integ.service, str(integ.service))
        exp = integ.token_expires_at
        exp_str = exp.strftime("%Y-%m-%d %H:%M") if exp else ""
        for uid in admins:
            notification_service.create_notification(
                db,
                workspace_id=wsid,
                user_id=uid,
                type_=NotificationType.integration_expired,
                title="연동 토큰 만료 경고",
                body=f"{service_name} 연동이 만료되었습니다. 설정에서 토큰을 갱신해 주세요.{f' (만료: {exp_str})' if exp_str else ''}",
                link="/settings/integrations",
                # Google Calendar 만료 경고는 1회만 생성 (중복/스팸 방지)
                dedupe_key="integration_expired:google_calendar",
            )


async def notification_jobs_loop() -> None:
    interval = max(int(settings.NOTIFICATION_JOB_INTERVAL_SEC), 10)
    while True:
        db = SessionLocal()
        try:
            run_once(db)
        except Exception:
            # jobs는 best-effort: 예외가 있어도 루프는 유지
            try:
                db.rollback()
            except Exception:
                pass
        finally:
            db.close()
        await asyncio.sleep(interval)

