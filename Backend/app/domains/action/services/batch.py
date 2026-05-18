# app/domains/action/services/batch.py
import asyncio
import logging
from app.infra.database.session import SessionLocal
from app.core.config import settings
from app.domains.action.services.slack import export_slack
from app.domains.action.services.google import export_google_calendar
from app.domains.action.services.jira import export_jira
from app.domains.action import repository
from app.infra.clients.slack import SlackClient
from app.domains.integration.service import get_valid_google_token, get_required_workspace_google_calendar_id
from app.infra.clients.google import GoogleCalendarClient
from app.domains.integration import repository as integration_repo
from app.domains.integration.models import ServiceType

logger = logging.getLogger(__name__)

def _classify_error(msg: str) -> str:
    lower = msg.lower()
    if "401" in msg or "token" in lower or "expired" in lower or "unauthorized" in lower:
        return "token_expired"
    if "연동" in msg or "not_connected" in lower:
        return "not_connected"
    return "unknown"

async def export_batch(
        workspace_id: int,
        meeting_id: int,
        services: list[str],
        slack_channel_id: str | None = None,
        include_action_items: bool = True,
        include_reports: bool = False,
) -> dict:
    # 각 서비스마다 별도 세션으로 병렬 실행
    async def run_slack():
        db = SessionLocal()
        try:
            integration = integration_repo.get_integration(db, workspace_id, ServiceType.slack)
            channel_id = slack_channel_id or ((integration.extra_config or {}).get("channel_id") if integration else None)
            if not channel_id:
                return {
                    "status": "error",
                    "message": "Slack 채널이 설정되지 않았습니다.",
                    "error_code": "not_connected"
                }
            await export_slack(db, workspace_id, meeting_id, channel_id, include_action_items, include_reports)
            return {
                "status": "ok",
                "message": "Slack 전송 완료"
            }
        except Exception as e:
            return {
                "status": "error",
                "message": "Slack 전송 실패",
                "error_code": _classify_error(str(e))
            }
        finally:
            db.close()
    
    async def run_google():
        db = SessionLocal()
        try:
            await export_google_calendar(db, workspace_id, meeting_id)
            return {
                "status": "ok",
                "message": "Google Calendar 등록 완료"
            }
        except Exception as e:
            return {
                "status": "error",
                "message": "Google Calendar 등록 에러",
                "error_code": _classify_error(str(e))         
            }
        finally:
            db.close()

    async def run_jira():
        db = SessionLocal() 
        try:
            result = await export_jira(db, workspace_id, meeting_id)
            if result.get('failed'):
                return {
                    "status": "error",
                    "message": f"{len(result['failed'])}개 항목 실패",
                    "error_code": "unknown"
                }
            
            # 담당자 DM - 백그라운드 실행 
            asyncio.create_task(notify_jira_assignees(workspace_id, meeting_id))

            return {
                "status": "ok",
                "message": f"이슈 생성 {result.get('created', 0)}개 · 업데이트 {result.get("updated", 0)}개"
            }
        except Exception as e:
            return {
                "status": "error",
                "message": "JIRA 내보내기 실패",
                "error_code": _classify_error(str(e))
            }
        finally:
            db.close()
    
    task_map: dict = {}
    if 'slack' in services:
        task_map['slack'] = run_slack()
    if 'google_calendar' in services:
        task_map['google_calendar'] = run_google()
    if 'jira' in services:
        task_map['jira'] = run_jira()

    results_list = await asyncio.gather(*task_map.values(), return_exceptions=True)
    results: dict = {}
    for name, result in zip(task_map.keys(), results_list):
        if isinstance(result, Exception):
            results[name] = {
                "status": "error",
                "message": str(result),
                "error_code": "unknown"
            }
        else:
            results[name] = result
    
    statuses = [r['status'] for r in results.values()]
    overall = (
        "success" if all(s == "ok" for s in statuses)
        else "failed" if all(s == "error" for s in statuses)
        else "partial_success"
    )
    return {
        "overall_status": overall,
        "results": results
    }

async def notify_slack_jira_complete(
        workspace_id: int,
        meeting_id: int,
        created: int,
        updated: int,
) -> dict:
    """JIRA 전송 완료 시 슬랙에 알림으로 전송"""
    db = SessionLocal()
    try:
        slack_int = integration_repo.get_integration(db, workspace_id, ServiceType.slack)
        if not slack_int or not slack_int.is_connected or not slack_int.access_token:
            return {
                "status": "error",
                "message": "Slack 연동이 필요합니다. 설정 > 연동 관리 에서 다시 시도해주세요.",
                "error_code": "not_connected"
            }
        
        channel_id = (slack_int.extra_config or {}).get("channel_id")
        if not channel_id:
            return {
                "status": "error",
                "message": "채널이 설정되지 않았습니다.",
                "error_code": "not_connected"
            }
        
        jira_int = integration_repo.get_integration(db, workspace_id, ServiceType.jira)
        extra = (jira_int.extra_config or {}) if jira_int else {}
        site_url = extra.get("site_url")
        project_key = extra.get("project_key")

        meeting= repository.get_meeting(db, meeting_id)
        meeting_title = meeting.title if meeting else f"회의#{meeting_id}"

        jira_url = f"https://{site_url}/browse/{project_key}" if site_url and project_key else None
        wbs_url = f"{settings.FRONTEND_URL}/meetings/{meeting_id}/wbs"

        msg = (
            f"🔵 *JIRA 이슈가 생성됐습니다*\n"
            f"*{meeting_title}*\n"
            f"생성 {created}개 · 업데이트 {updated}개"
        )

        buttons = []
        if jira_url:
            buttons.append({
                "type": "button",
                "text": {
                    "type": "plain_text", 
                    "text": "🔵 JIRA 보기"
                }, 
                "url": jira_url, "style": "primary"
            })
        buttons.append({
            "type": "button",
            "text": {
                "type": "plain_text", 
                "text": "📊 WBS 보기"
            }, 
            "url": wbs_url
        })

        blocks = [
            {
                "type": "section", 
                "text": {
                    "type": "mrkdwn", 
                    "text": msg
                }
            },
            {"type": "actions", "elements": buttons},
        ]

        slack = SlackClient(bot_token=slack_int.access_token)
        await slack.join_channel(channel_id)
        await slack.send_message(channel_id, msg, blocks)

        return {
            "status": "ok",
            "message": "Slack 알림 전송 완료"
        }
    except Exception as e:
        return {
            "status": "error",
            "message": "Slack 알림 실패",
            "error_code": _classify_error(str(e))
        }
    finally:
        db.close()

async def add_jira_link_to_calendar(workspace_id: int, meeting_id: int) -> dict:
    """
    기존 Google Calendar 이벤트 description에 JIRA 링크 추가
    """
    db = SessionLocal()
    try:
        access_token = await get_valid_google_token(db, workspace_id)
        calendar_id = get_required_workspace_google_calendar_id(db, workspace_id)

        meeting = repository.get_meeting(db, meeting_id)
        if not meeting or not getattr(meeting, "google_calendar_event_id", None):
            return {
                "status": "error", 
                "message": "연동된 Google Calendar가 없습니다.",
                "error_code": "not_connected"
            }
        
        jira_int = integration_repo.get_integration(db, workspace_id, ServiceType.jira)
        extra = (jira_int.extra_config or {}) if jira_int else {}
        cloud_id = extra.get("cloud_id")
        site_url = extra.get("site_url")
        project_key = extra.get("project_key")

        if not site_url or not project_key:
            return {
                "status": "error",
                "message": "JIRA 프로젝트 정보가 없습니다.",
                "error_code": "not_connected"
            }
        
        jira_url = f"https://{site_url}/browse/{project_key}"
        wbs_url = f"{settings.FRONTEND_URL}/meetings/{meeting_id}/wbs"
        desc = f"🔵 JIRA 프로젝트: {jira_url}\n📊 WBS: {wbs_url}"

        client = GoogleCalendarClient(access_token)
        await client.update_event_description(
            event_id=meeting.google_calendar_event_id,
            description=desc,
            calendar_id=calendar_id,
        )
        return {
            "status": "ok",
            "message": "Google Calendar 업데이트 완료"
        }
    except ValueError as e:
        return {
            "status": "error",
            "message": str(e),
            "error_code": "not_connected"
        }
    
    except Exception as e:
        return {
            "status": "error",
            "message": "Google Calendar 업데이트 실패",
            "error_code": _classify_error(str(e))
        }
    
    finally:
        db.close()

async def notify_jira_assignees(workspace_id: int, meeting_id: int) -> None:
    """
    JIRA 내보내기 완료 시 담당자에게 Slack DM 발송
    """
    db = SessionLocal()
    try:
        slack_int = integration_repo.get_integration(db, workspace_id, ServiceType.slack)
        if not slack_int or not slack_int.is_connected or not slack_int.access_token:
            return
        
        channel_id = (slack_int.extra_config or {}).get("channel_id")
        if not channel_id:
            return
        
        jira_int = integration_repo.get_integration(db, workspace_id, ServiceType.jira)
        extra = (jira_int.extra_config or {}) if jira_int else {}
        site_url = extra.get("site_url")

        slack = SlackClient(bot_token=slack_int.access_token)

        # 채널 멤버 이메일 -> Slack UID 매핑
        member_ids = await slack.get_channel_members(channel_id)
        email_to_uid: dict = {}
        for uid in member_ids:
            info = await slack.get_user_info(uid)
            if info.get("email"):
                email_to_uid[info['email']] = uid
        
        _priority_label = {
            "low": "낮음",
            "medium": "보통",
            "high": "높음",
            "critical": "최고"
        }

        epics = repository.get_wbs_epics(db, meeting_id)
        for epic in epics:
            for task in repository.get_wbs_tasks_by_epic(db, epic.id):
                if not task.jira_issue_id or not task.assignee_id:
                    continue

                user = repository.get_user(db, task.assignee_id)
                if not user:
                    continue

                slack_uid = email_to_uid.get(user.email)
                if not slack_uid:
                    continue

                priority_val = task.priority.value if hasattr(task.priority, 'value') else str(task.priority)
                priority_label = _priority_label.get(priority_val, "보통")
                due_str = f"마감: {task.due_date} · " if task.due_date else ""
                msg = (
                    f"*새 JIRA 이슈가 할당되었습니다.*\n"
                    f"*[{task.jira_issue_id}]* {task.title}\n"
                    f"{due_str}우선순위: {priority_label}"
                )

                buttons = []
                if site_url:
                    buttons.append({
                        "type": "button",
                        "text": {
                            "type": "plain_text",
                            "text": "🔵 이슈 보기",
                        },
                        "url": f"https://{site_url}/browse/{task.jira_issue_id}",
                        "style": "primary",
                    })
                buttons.append({
                    "type": "button",
                    "text": {
                        "type": "plain_text",
                        "text": "📊 WBS 보기"
                    },
                    "url": f"{settings.FRONTEND_URL}/meetings/{meeting_id}/wbs",
                })

                blocks = [
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": msg,
                        }
                    },
                    {
                        "type": "actions",
                        "elements": buttons
                    },
                ]

                try: 
                    dm_channel = await slack.open_dm(slack_uid)
                    await slack.send_message(dm_channel, msg, blocks)
                except Exception as e:
                    logger.warning(f"DM 전송 실패 user={user.email}:{e}")
    except Exception as e:
        logger.error(f"notify_jira_assignees 실패: {e}")
    finally:
        db.close()

async def share_wbs_progress_to_slack(workspace_id: int, meeting_id: int) -> dict:
    """
    담당자별 WBS 진행률을 Slack 채널에 공유.
    독촉 DM도 발송.
    """
    db = SessionLocal()
    try:
        slack_int = integration_repo.get_integration(db, workspace_id, ServiceType.slack)
        if not slack_int or not slack_int.is_connected or not slack_int.access_token:
            return {
                "status": "error",
                "message": "Slack 연동이 필요합니다.",
                "error_code": "not_connected"
            }
        
        channel_id = (slack_int.extra_config or {}).get("channel_id")
        if not channel_id:
            return {
                "status": "error",
                "message": "채널이 설정되지 않았습니다.",
                "error_code": "not_connected"
            }
        
        meeting = repository.get_meeting(db, meeting_id)
        meeting_title = meeting.title if meeting else f"회의#{meeting_id}"

        # 담당자별 태스크 집계
        epics = repository.get_wbs_epics(db, meeting_id)
        assignee_stats: dict[str, dict] = {}
        total_done = total_tasks = 0

        for epic in epics:
            for task in repository.get_wbs_tasks_by_epic(db, epic.id):
                name = task.assignee_name or "미지정"
                if name not in assignee_stats:
                    assignee_stats[name] = {"done": 0, "total": 0}
                assignee_stats[name]['total'] += 1
                total_tasks += 1
                status_val = task.status.value if hasattr(task.status, 'value') else str(task.status)
                if status_val == "done":
                    assignee_stats[name]["done"] += 1
                    total_done += 1

        if not assignee_stats:
            return {
                "status": "error",
                "message": "WBS 태스크가 없습니다.",
                "error_code": "unknown"
            }
        
        overall_pct = round(total_done / total_tasks * 100) if total_tasks else 0

        def _bar(done: int, total: int) -> str:
            filled = round(done / total * 10) if total else 0
            return "█" * filled + "░" * (10 - filled) 
        
        lines = [f"📊 *WBS 진행 현황*\n*{meeting_title}*\n"]
        for name, s in sorted(assignee_stats.items()):
            pct = round(s['done'] / s['total'] * 100) if s['total'] else 0
            lines.append(f"{name}: `{_bar(s['done'], s['total'])}` {pct}% ({s['done']}/{s['total']} 완료)")

        lines.append(f"\n전체: {overall_pct}% · 미완료 {total_tasks - total_done}건")

        msg = "\n".join(lines)
        wbs_url = f"{settings.FRONTEND_URL}/meetings/{meeting_id}/wbs"
        blocks = [
            {
                "type": "section", 
                "text": {
                    "type": "mrkdwn", 
                    "text": msg
                }
            },
            {
                "type": "actions", 
                "elements": [{
                    "type": "button",
                    "text": {
                        "type": "plain_text", 
                        "text": "📊 WBS 보기"
                    },
                    "url": wbs_url,
                    "style": "primary",
                }]
            },
        ]

        slack = SlackClient(bot_token=slack_int.access_token)
        await slack.join_channel(channel_id)
        await slack.send_message(channel_id=channel_id, text=msg, blocks=blocks)
        return {
            "status": "ok", 
            "message": "진행률이 Slack에 공유되었습니다."
        }

    except Exception as e:
        return {
            "status": "error", 
            "message": "Slack 공유 실패",
            "error_code": _classify_error(str(e))
        }
    finally:
        db.close()