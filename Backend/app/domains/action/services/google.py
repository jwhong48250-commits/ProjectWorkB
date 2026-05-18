# app/domains/action/services/google.py
import logging
from datetime import datetime, timedelta, timezone
from typing import List

from sqlalchemy.orm import Session

from app.utils.time_utils import now_kst, KST
from app.domains.integration.models import ServiceType
from app.domains.integration import repository as integration_repo
from app.domains.integration.service import get_valid_google_token, get_required_workspace_google_calendar_id
from app.domains.action import repository
from app.domains.action.mongo_repository import get_meeting_summary
from app.infra.clients.google import GoogleCalendarClient
from app.infra.clients.slack import SlackClient

logger = logging.getLogger(__name__)

async def export_google_calendar(
        db: Session,
        workspace_id: int,
        meeting_id: int
) -> None:
    """
    회의 종료 후 구글 캘린더 이벤트에 회의록 요약을 첨부.
    - meeting.google_calendar_event_id가 있으면 description PATCH
    - meeting.google_calendar_event_id가 없으면 새 이벤트 생성
    """
    try:
        access_token = await get_valid_google_token(db, workspace_id)
        client = GoogleCalendarClient(access_token)
        calendar_id = get_required_workspace_google_calendar_id(db, workspace_id)

        meeting = repository.get_meeting(db, meeting_id)
        if not meeting:
            raise ValueError(f"회의 (id={meeting_id})를 찾을 수 없습니다.") 
        
        summary = get_meeting_summary(meeting_id)
        attendees = summary.get("attendees", [])
        overview = summary.get("overview", {})
        decisions = summary.get("decisions", [])
        action_items = summary.get("action_items", [])

        lines = []
        if overview:
            lines.append(f"[목적] {overview.get('purpose', '')}")
            lines.append(f"[일시] {overview.get('datetime_str', '')}")

        if decisions:
            lines.append("\n[결정 사항]")
            lines.extend(f"- {d.get('decision', '')}" for d in decisions)

        if action_items:
            lines.append("\n[액션 아이템]")
            for a in action_items:
                deadline = f"(~{a.get('deadline', '')})" if a.get("deadline") else ""
                lines.append(f"- [{a.get('assignee', '')}] {a.get('content', '')} {deadline}")
        
        if attendees:
            lines.append(f"\n[참석자] {', '.join(attendees)}")
        
        description = "\n".join(lines)

        if meeting.google_calendar_event_id:
            await client.update_event_description(
                event_id=meeting.google_calendar_event_id,
                description=description,
                calendar_id=calendar_id,
            )
        
        else:
            started = (
                meeting.started_at
                or meeting.scheduled_at
                or (meeting.ended_at - timedelta(hours=1) if meeting.ended_at else now_kst())
            )
            ended = meeting.ended_at or (started + timedelta(hours=1))
            await client.create_event(
                title=meeting.title,
                start_datetime=started.strftime("%Y-%m-%dT%H:%M:%S"),
                end_datetime=ended.strftime("%Y-%m-%dT%H:%M:%S"),
                description=description,
                calendar_id=calendar_id,
            )
        
        logger.info(f"[Google Calendar Export] 완료 - meeting_id={meeting_id}")

    except Exception as e:
        logger.error(f"[Google Calendar Export] 실패 - meeting_id = {meeting_id} - error_code = {e}")

async def suggest_next_meeting(
        db: Session,
        workspace_id: int,
        meeting_id: int,
        duration_minutes: int = 60,
) -> List[str]:
    """
    Slack 채널 멤버 이메일을 수집하여 Google Freebusy API로
    -> 구글 이메일이 대부분인 슬랙 채널 멤버 이메일로 가정
    2주 이내 평일 09:00-18:00 기준 전원이 비어있는 슬록 3개를 추천한다.
    구글 이메일이 없는 멤버는 제외된다.

    args:
        duration_minutes: 회의 소요 시간 기본값 - 60분
    
    return:
        추천 시간 리스트 레코드 3개
    """
    attendee_emails: List[str] = []

    # 1차: Slack 채널 멤버 이메일
    slack_integration = integration_repo.get_integration(db, workspace_id, ServiceType.slack)
    if slack_integration and slack_integration.access_token:
        channel_id = (slack_integration.extra_config or {}).get("channel_id")
        if channel_id:
            try:
                slack_client = SlackClient(slack_integration.access_token)
                member_ids = await slack_client.get_channel_members(channel_id=channel_id)
                for uid in member_ids:
                    info = await slack_client.get_user_info(uid)
                    email = info.get("email", "")
                    if email:
                        attendee_emails.append(email)
            except Exception:
                pass

    # 2차 fallback: WorkB DB 워크스페이스 멤버 이메일
    if not attendee_emails:
        from app.domains.workspace.models import WorkspaceMember
        from app.domains.user.models import User
        rows = (
            db.query(User.email)
            .join(WorkspaceMember, WorkspaceMember.user_id == User.id)
            .filter(WorkspaceMember.workspace_id == workspace_id)
            .all()
        )
        attendee_emails = [r.email for r in rows if r.email]

    if not attendee_emails:
        raise ValueError("일정 제안에 사용할 이메일을 찾을 수 없습니다. 워크스페이스 멤버를 추가하거나 Slack 채널을 설정해주세요.")
    
    access_token = await get_valid_google_token(db, workspace_id)
    client = GoogleCalendarClient(access_token)

    now = now_kst()
    time_min = now.strftime("%Y-%m-%dT%H:%M:%S+09:00")
    time_max = (now + timedelta(days=14)).strftime("%Y-%m-%dT%H:%M:%S+09:00")

    try:
        workspace_calendar_id = get_required_workspace_google_calendar_id(db, workspace_id)
        calendar_ids = attendee_emails + [workspace_calendar_id]
    except ValueError:
        calendar_ids = attendee_emails

    freebusy = await client.get_free_slots(
        calendar_ids=calendar_ids,
        time_min=time_min,
        time_max=time_max,
    )

    busy_intervals: List[tuple] = []
    for cal in freebusy.get("calendars", {}).values():
        for slot in cal.get("busy", []):
            start = datetime.fromisoformat(slot['start'].replace("Z", "+00:00")).astimezone(KST)
            end = datetime.fromisoformat(slot["end"].replace("Z", "+00:00")).astimezone(KST)
            busy_intervals.append((start, end))
    
    suggestions: List[dict] = []
    cursor = (now + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)

    while len(suggestions) < 3 and cursor < now + timedelta(days=14):
        if cursor.weekday() >= 5:
            cursor += timedelta(days=1)
            continue

        slot_end = cursor + timedelta(minutes=duration_minutes)
        work_end = cursor.replace(hour=18, minute=0, second=0, microsecond=0)
        if slot_end > work_end:
            cursor = cursor.replace(hour=9, minute=0) + timedelta(days=1)
            continue

        overlaps = any(
            not (slot_end <= b_start or cursor >= b_end)
            for b_start, b_end in busy_intervals
        )
        if not overlaps:
            suggestions.append({
                "start": cursor.strftime("%Y-%m-%dT%H:%M:%S+09:00"),
                "end": (cursor + timedelta(minutes=duration_minutes)).strftime("%Y-%m-%dT%H:%M:%S+09:00"),
            })
        cursor += timedelta(minutes=30)

    return suggestions
    
    

async def register_next_meeting(
        db: Session,
        workspace_id: int,
        meeting_id: int,
        title: str,
        scheduled_at: str,
        attendee_emails: list[str] = [],
        duration_minutes: int = 60,
) -> str:
    """
    확정된 다음 회의 시간을 캘린더에 이벤트로 등록한다.

    args:
        workspace_id: 워크스페이스 ID
        meeting_id: 회의 ID
        title: 회의 제목
        scheduled_at: 회의 시작 시간
        duration_minutes: 회의 소요 시간 (기본 60분)
    return:
        등록 잘 됬나 안됬나
    """
    # 1. 토큰 갱신
    access_token = await get_valid_google_token(db, workspace_id)
    if not access_token:
        raise ValueError(f"[Google Calendar] {workspace_id} - 구글 연동이 되지 않았습니다.")
    
    # 참석자 이메일 없으면 슬랙에서 찾아봄
    if not attendee_emails:
        slack_integration = integration_repo.get_integration(db, workspace_id, ServiceType.slack)
        if slack_integration and slack_integration.access_token:
            channel_id = (slack_integration.extra_config or {}).get("channel_id")
            if channel_id:
                slack_client = SlackClient(slack_integration.access_token)
                member_ids = await slack_client.get_channel_members(channel_id)
                for uid in member_ids:
                    info = await slack_client.get_user_info(uid)
                    email = info.get("email", "")
                    if email:
                        attendee_emails.append(email)
    # 구글 클라이언트 꺼내기
    client = GoogleCalendarClient(access_token)
    calendar_id = get_required_workspace_google_calendar_id(db, workspace_id)
    start_at = datetime.fromisoformat(scheduled_at)
    end_at = start_at + timedelta(minutes=duration_minutes)

    result = await client.create_event(
        title=title,
        start_datetime=start_at.strftime("%Y-%m-%dT%H:%M:%S"),
        end_datetime=end_at.strftime("%Y-%m-%dT%H:%M:%S"),
        attendees=attendee_emails if attendee_emails else None,
        calendar_id=calendar_id,
    )
    event_id = result.get("id", "")
    logger.info(f"[Google Calendar] 다음 회의 등록 완료 - meeting_id={meeting_id}, event_id={event_id}")
    return event_id

async def update_next_meeting(
        db: Session,
        workspace_id: int,
        event_id: str,
        title: str | None = None,
        scheduled_at: str | None = None,
        duration_minutes: int = 60,
        attendee_emails: List[str] | None = None,
        description: str | None = None,
) -> None:
    """
    workspace_id와 event_id를 받아서 바꾸고 싶은 부분만 바꾸는 코드

    args:
        workspace_id: 워크스페이스 ID
        event_id: 캘린더 ID
        title: 제목
        scheduled_at: 일정
        duration_minutes: 회의 소요시간
        attendee_emails: 참석자들 구글 이메일
        description: 회의 설명

    return ?
    """
    access_token = await get_valid_google_token(db, workspace_id)
    if not access_token:
        raise ValueError(f"구글 연동이 되지 않았습니다. (workspace_id={workspace_id})")
    
    client = GoogleCalendarClient(access_token)
    calendar_id = get_required_workspace_google_calendar_id(db, workspace_id)

    start_datetime = None
    end_datetime = None
    if scheduled_at:
        start_at = datetime.fromisoformat(scheduled_at)
        end_at = start_at + timedelta(minutes=duration_minutes)
        start_datetime = start_at.strftime("%Y-%m-%dT%H:%M:%S")
        end_datetime = end_at.strftime("%Y-%m-%dT%H:%M:%S")

    await client.update_event(
        event_id=event_id,
        title=title,
        start_datetime=start_datetime,
        end_datetime=end_datetime,
        attendees=attendee_emails,
        description=description,
        calendar_id=calendar_id,
    )

    logger.info(f"[Google Calendar] 이벤트 수정 완료 - event_id={event_id}")

async def delete_next_meeting(
        db: Session,
        workspace_id: int,
        event_id: str,
) -> None:
    access_token = await get_valid_google_token(db, workspace_id)
    if not access_token:
        raise ValueError(f"구글 연동이 되지 않았습니다. (workspace_id={workspace_id})")
    client = GoogleCalendarClient(access_token)
    calendar_id = get_required_workspace_google_calendar_id(db, workspace_id)
    await client.delete_event(event_id=event_id, calendar_id=calendar_id)
    logger.info(f"[Google Calendar] 이벤트 삭제 완료 - event_id={event_id}")