# app/domains/action/services/slack.py
import json
import logging
from typing import Optional, List
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domains.integration.repository import get_integration
from app.domains.integration.models import ServiceType
from app.domains.action import repository
from app.domains.action.models import ReportFormat
from app.infra.clients.slack import SlackClient

logger = logging.getLogger(__name__)

async def export_slack(
        db: Session,
        workspace_id: int,
        meeting_id: int,
        channel_id: Optional[str] = None,
        include_action_items: bool = True,
        include_reports: bool = False,
) -> None:
    try:
        # 1. Slack 연동
        integration = get_integration(db, workspace_id, ServiceType.slack)
        if not integration or not integration.access_token:
            raise ValueError("Slack 연동이 필요합니다.")
        
        # 2. 채널 찾기
        channel_id = channel_id or (integration.extra_config or {}).get("channel_id")
        
        if not channel_id:
            raise ValueError("Slack 채널이 설정되지 않았습니다.")
        
        # 3. 회의 정보
        meeting = repository.get_meeting(db, meeting_id)
        if not meeting:
            raise ValueError(f"회의 (id={meeting_id})를 찾을 수 없습니다.")
        
        # 4. 회의록
        minute = repository.get_meeting_minute(db, meeting_id)
        if not minute:
            raise ValueError("회의록이 존재하지 않습니다.")
        
        # 5. 슬랙 클라이언트
        slack = SlackClient(bot_token=integration.access_token)

        # 6. 액션 아이템 준비
        action_item_texts: List[str] = []
        slack_action_items: List[dict] = []

        if include_action_items:
            items = repository.get_action_items(db, meeting_id)
            if items:
                # 채널 멤버 목록 조회
                member_ids = await slack.get_channel_members(channel_id)
                email_to_uid = {}
                for uid in member_ids:
                    info = await slack.get_user_info(uid)
                    if info['email']:
                        email_to_uid[info['email']] = uid

                for item in items:
                    action_item_texts.append(item.content)
                    if item.assignee_id:
                        user = repository.get_user(db, item.assignee_id)
                        slack_uid = email_to_uid.get(user.email) if user else None
                        if slack_uid:
                            slack_action_items.append({
                                "slack_user_id": slack_uid,
                                "task": item.content,
                                "due": str(item.due_date) if item.due_date else None,
                            })

        # 7. 딥링크 URL 생성
        base        = settings.FRONTEND_URL
        minutes_url = f"{base}/meetings/{meeting_id}/notes"
        wbs_url     = f"{base}/meetings/{meeting_id}/wbs"

        jira_url = None
        jira_int = get_integration(db, workspace_id, ServiceType.jira)
        if jira_int and jira_int.is_connected:
            extra       = jira_int.extra_config or {}
            site_url    = extra.get("site_url")
            project_key = extra.get("project_key")
            if site_url and project_key:
                jira_url = f"https://{site_url}/browse/{project_key}"

        # 8. 채널 참여 + 전송
        await slack.join_channel(channel_id)
        ts = await slack.send_minutes(
            channel_id=channel_id,
            meeting_title=meeting.title,
            minutes_text=minute.content or minute.summary or "",
            action_items=action_item_texts,
            link_url=minutes_url,
            wbs_url=wbs_url,
            jira_url=jira_url,
        )
        await slack.pin_message(channel_id, ts)

        if slack_action_items:
            await slack.send_action_items(
                channel_id=channel_id,
                thread_ts=ts,
                action_items=slack_action_items,
            )

        if include_reports:
            reports = repository.get_reports(db, meeting_id)
            for report in reports:
                if report.format == ReportFormat.markdown and report.content:
                    text = f"*[{report.title}]*\n{report.content[:2000]}"
                    await slack.send_message(
                        channel_id=channel_id,
                        text=text,
                        thread_ts=ts
                    )

                elif report.format == ReportFormat.wbs and report.content:
                    wbs = json.loads(report.content)
                    lines = [f"*[WBS: {report.title}]*"]
                    for epic in wbs.get("epics", []):
                        lines.append(f"\n*{epic['title']}*")
                        for task in epic.get("tasks", []):
                            lines.append(f"  • [{task.get('assignee','')}] {task['title']}")
                    await slack.send_message(
                        channel_id=channel_id,
                        text="\n".join(lines)[:3000],
                        thread_ts=ts
                    )
                
                elif report.format in (ReportFormat.excel, ReportFormat.html):
                    report_link = f"{settings.FRONTEND_URL}/meetings/{meeting_id}/reports"
                    await slack.send_message(
                        channel_id=channel_id,
                        text=f"*[{report.title}]* 다운로드",
                        thread_ts=ts,
                    )

        logger.info(f"[Slack Export] 완료 - meeting_id = {meeting_id}, channel={channel_id}")

    except Exception as e:
        logger.error(f"[Slack Export] 실패 - meeting_id={meeting_id} : {e}")