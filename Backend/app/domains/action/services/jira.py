# app/domains/action/services/jira.py
import logging
from datetime import datetime, date
from sqlalchemy.orm import Session
from typing import Optional

from app.domains.action import repository
from app.domains.integration import repository as integration_repo
from app.domains.integration.models import ServiceType
from app.domains.integration.service import get_valid_jira_token, get_jira_cloud_id
from app.infra.clients.jira import JiraClient, _to_adf, _from_adf
from app.utils.time_utils import now_kst

logger = logging.getLogger(__name__)

_PRIORITY_MAP = {
    "urgent":   "Highest",
    "critical": "Highest",
    "high":     "High",
    "medium":   "Medium",
    "low":      "Low",
}

async def _clear_stale_jira_ids(
        db: Session,
        client: "JiraClient",
        epics: list,
        task_ids: Optional[list] = None,
) -> None:
    """
    JIRA에서 삭제된 에픽 태스크를 DB에 갱신시킨다.
    """
    epic_keys = [e.jira_epic_id for e in epics if e.jira_epic_id]

    all_tasks = []
    for e in epics:
        tasks = repository.get_wbs_tasks_by_epic(db, e.id)
        if task_ids is not None:
            tasks = [t for t in tasks if t.id in task_ids]
        all_tasks.extend(tasks)
    
    task_keys = [t.jira_issue_id for t in all_tasks if t.jira_issue_id]

    all_keys = epic_keys + task_keys
    if not all_keys:
        return
    
    try:
        live_issues = await client.search_by_jql(
            f"issueKey in ({', '.join(all_keys)})",
            fields="summary",
        )
        live_keys = {i['key'] for i in live_issues}
    
    except Exception as e:
        return # 조회 실패 시 기존 동작
    
    for epic in epics:
        # 지라에서 삭제된 에픽을 확인
        if epic.jira_epic_id and epic.jira_epic_id not in live_keys:
            logger.info(f"Epic JIRA ID stale, 초기화 : {epic.jira_epic_id}")
            repository.update_epic_jira_id(db, epic.id, None)
            epic.jira_epic_id = None
    
    for task in all_tasks:
        # 지라에서 삭제된 태스크를 확인
        if task.jira_issue_id and task.jira_issue_id not in live_keys:
            logger.info(f"Task JIRA ID stale, 초기화 : {task.jira_issue_id}")
            repository.update_task_jira_id(db, task.id, None)
            epic.jira_issue_id = None

async def export_jira(
        db: Session,
        workspace_id: int,
        meeting_id: int,
        epic_ids: Optional[list] = None,
        task_ids: Optional[list] = None,
        progress_queue = None,
) -> dict:
    '''
    웹 서비스 WBS를 JIRA로 내보내는 함수
    '''
    token = await get_valid_jira_token(db, workspace_id)
    cloud_id = get_jira_cloud_id(db, workspace_id)
    integration = integration_repo.get_integration(db, workspace_id, ServiceType.jira)
    project_key = (integration.extra_config or {}).get("project_key")
    if not project_key:
        raise ValueError("JIRA 프로젝트가 선택되지 않았습니다. 다시 시도하세요.")
    
    client = JiraClient(token, cloud_id)
    epics = repository.get_wbs_epics(db, meeting_id)
    if epic_ids is not None:
        epics = [e for e in epics if e.id in epic_ids]

    # JIRA에서 삭제된 ID 정리
    await _clear_stale_jira_ids(db, client, epics, task_ids)
    
    total_tasks = sum(
        len([t for t in repository.get_wbs_tasks_by_epic(db, e.id) if task_ids is None or t.id in task_ids])
        for e in epics
    )
    done = 0

    created, updated, failed = 0, 0, []
    for epic in epics:
        try:
            # 처음 내보내는 에픽 일 때 (신규 생성 에픽)
            if not epic.jira_epic_id:
                epic_key = await client.create_epic(project_key, epic.title)
                repository.update_epic_jira_id(db, epic.id, epic_key)
                epic.jira_epic_id = epic_key
                created += 1
            
            # 이미 내보낸 에픽일 때 제목만 업데이트
            else:
                await client.update_issue(epic.jira_epic_id, {"summary": epic.title})
                updated += 1
        
        except Exception as e:
            logger.error(f"Epic 처리 실패 epic_id={epic.id}: {e}")
            failed.append(f"Epic: {epic.title}")
            # 스킵된 태스크 수만큼 done 보상 -> 진행률 보장
            skipped = repository.get_wbs_tasks_by_epic(db, epic.id)
            if task_ids is not None:
                skipped = [t for t in skipped if t.id in task_ids]
            done += len(skipped)
            if progress_queue and total_tasks > 0:
                await progress_queue.put({
                    "done": done,
                    "total": total_tasks,
                    "current": f"[건너뜀] {epic.title}",
                })
            continue

        # epic에 속한 task 다 불러옴
        tasks = repository.get_wbs_tasks_by_epic(db, epic.id)
        if task_ids is not None:
            tasks = [t for t in tasks if t.id in task_ids]
        for task in tasks:
            try:
                # 우선순위 매핑
                priority = _PRIORITY_MAP.get(
                    task.priority.value if hasattr(task.priority, 'value') else task.priority,
                    "Medium"
                )
                # 마감일 문자열 처리
                due_date = str(task.due_date) if task.due_date else None

                # 담당자 accountId 조회
                assignee_id = None
                if task.assignee_name:
                    try:
                        users = await client.search_user(task.assignee_name)
                        if users:
                            assignee_id = users[0].get("accountId")
                    except Exception:
                        pass

                # 처음 내보내는 태스크 일 때 (신규 생성 태스크)
                if not task.jira_issue_id:
                    issue_key = await client.create_issue(
                        project_key=project_key,
                        summary=task.title,
                        epic_key=epic.jira_epic_id,
                        priority=priority,
                        due_date=due_date,
                        assignee_account_id=assignee_id,
                        description=task.content,
                    )
                    repository.update_task_jira_id(db, task.id, issue_key)
                    created += 1
                
                # 이미 있는 태스크 일 때 (기존 값만 업데이트)
                else:
                    try:
                        fields = {
                            "summary": task.title,
                            "priority": {"name": priority}
                        }
                        if due_date:
                            fields["duedate"] = due_date
                        if assignee_id:
                            fields["assignee"] = {"accountId": assignee_id}
                        if task.content:
                            fields["description"] = _to_adf(task.content)
                        await client.update_issue(task.jira_issue_id, fields)
                        updated += 1
                    except Exception as e:
                        logger.error(f"Task 업데이트 실패 task_id={task.id}: {e}")
                        failed.append(f"Task: {task.title}")
            except Exception as e:
                logger.error(f"Task 처리 실패 task_id={task.id}: {e}")
                failed.append(f"Task: {task.title}")
            done += 1
            if progress_queue:
                await progress_queue.put({
                    "done": done,
                    "total": total_tasks,
                    "current": task.title,
                })
    return {
        "created": created,
        "updated": updated,
        "failed": failed
    }

async def sync_from_jira(
        db: Session,
        workspace_id: int,
        meeting_id: int,
) -> dict:
    # 1단계: JIRA에 등록된 태스크만 골라내기
    token = await get_valid_jira_token(db, workspace_id)
    cloud_id = get_jira_cloud_id(db, workspace_id)
    integration = integration_repo.get_integration(db, workspace_id, ServiceType.jira)
    status_maaping: dict = (integration.extra_config or {}).get("status_mapping", {})

    # jira_issue_id 있는 태스크만 수집
    epics = repository.get_wbs_epics(db, meeting_id)
    tasks_with_jira = []
    for epic in epics:
        for task in repository.get_wbs_tasks_by_epic(db, epic.id):
            if task.jira_issue_id:
                tasks_with_jira.append(task)
    
    if not tasks_with_jira:
        return {
            "changed": [],
            "unchanged": 0,
            "synced_at": now_kst().isoformat()
        }
    
    client = JiraClient(token, cloud_id)

    # 2단계: JQL로 한 번에 조회하기
    # N + 1 방지 : JQL 배치 조회
    keys = [t.jira_issue_id for t in tasks_with_jira]
    jql = f"issueKey in ({', '.join(keys)})"
    
    # 1번의 API 호출로 모든 정보를 가져옴
    issues = await client.search_by_jql(jql, fields="status,summary,assignee,duedate,description")

    # key -> issue 딕셔너리
    issue_map = {issue['key']: issue for issue in issues}

    changed = []
    unchanged = 0

    # 3단계: 변경된 내용 비교 & DB 업데이트
    for task in tasks_with_jira:
        try:
            issue = issue_map.get(task.jira_issue_id)
            if not issue:
                unchanged += 1
                continue

            fields           = issue.get("fields", {})
            jira_status_name = fields.get("status", {}).get("name", "")
            jira_title       = fields.get("summary", "")
            jira_assignee    = fields.get("assignee")
            jira_assignee_name = (jira_assignee or {}).get("displayName", "") if jira_assignee else ""
            jira_due_date_str  = fields.get("duedate")
            jira_description   = _from_adf(fields.get("description"))

            workb_status   = status_maaping.get(jira_status_name, "todo")
            current_status = task.status.value if hasattr(task.status, "value") else task.status
            task_changed   = False

            # 상태 비교
            if workb_status != current_status:
                changed.append({
                    "task_id": task.id, "jira_key": task.jira_issue_id,
                    "field": "status", "old": current_status, "new": workb_status,
                })
                repository.update_wbs_task(db, task.id, status=workb_status)
                task_changed = True

            # 제목 비교
            if jira_title and jira_title != task.title:
                changed.append({
                    "task_id": task.id, "jira_key": task.jira_issue_id,
                    "field": "title", "old": task.title, "new": jira_title,
                })
                repository.update_wbs_task(db, task.id, title=jira_title)
                task_changed = True

            # 담당자 비교
            current_assignee = task.assignee_name or ""
            if jira_assignee_name != current_assignee:
                new_name = jira_assignee_name or None
                changed.append({
                    "task_id": task.id, "jira_key": task.jira_issue_id,
                    "field": "assignee",
                    "old": current_assignee or "미지정",
                    "new": jira_assignee_name or "미지정",
                })
                repository.update_wbs_task(db, task.id, assignee_name=new_name)
                task_changed = True

            # 날짜 비교
            current_due = str(task.due_date) if task.due_date else None
            jira_due_norm = jira_due_date_str[:10] if jira_due_date_str else None  # YYYY-MM-DD만
            if jira_due_norm != current_due:
                changed.append({
                    "task_id": task.id, "jira_key": task.jira_issue_id,
                    "field": "due_date", "old": current_due or "없음", "new": jira_due_norm or "없음",
                })
                new_date = date.fromisoformat(jira_due_norm) if jira_due_norm else None
                repository.update_wbs_task(db, task.id, due_date=new_date)
                task_changed = True

            # 내용 비교
            if jira_description != (task.content or None):
                changed.append({
                    "task_id": task.id, "jira_key": task.jira_issue_id,
                    "field": "content",
                    "old": (task.content or "없음")[:30],
                    "new": (jira_description or "없음")[:30],
                })
                repository.update_wbs_task(db, task.id, content=jira_description)
                task_changed = True

            if not task_changed:
                unchanged += 1

        except Exception as e:
            logger.error(f"Task 동기화 실패 task_id={task.id}: {e}")
            unchanged += 1

    return {
        "changed": changed,
        "unchanged": unchanged,
        "synced_at": now_kst().isoformat(),
    }

async def preview_jira_export(
        db: Session,
        workspace_id: int,
        meeting_id: int,
        epic_ids: Optional[list] = None,
        task_ids: Optional[list] = None,
) -> dict:
    epics = repository.get_wbs_epics(db, meeting_id)
    if epic_ids is not None:
        epics = [e for e in epics if e.id in epic_ids]
    
    # JIRA 연결된 경우에만 stale ID 정리 (프리뷰의 정확성을 위햬)
    try:
        token = await get_valid_jira_token(db, workspace_id)
        cloud_id = get_jira_cloud_id(db, workspace_id)
        client = JiraClient(token, cloud_id)
        await _clear_stale_jira_ids(db, client, epics, task_ids)
    
    except Exception:
        pass
    
    result_epics = []
    epic_create = epic_update = task_create = task_update = 0

    for epic in epics:
        epic_action = "create" if not epic.jira_epic_id else "update"
        if epic_action == "create": epic_create += 1
        else: epic_update += 1

        tasks = repository.get_wbs_tasks_by_epic(db, epic.id)
        if task_ids is not None:
            tasks = [t for t in tasks if t.id in task_ids]

        task_items = []
        for task in tasks:
            task_action = "create" if not task.jira_issue_id else "update"
            if task_action == "create": task_create += 1
            else: task_update += 1
            task_items.append({"id": task.id, "title": task.title, "action": task_action})

        result_epics.append({
            "id": epic.id, "title": epic.title,
            "action": epic_action, "tasks": task_items,
        })

    return {
        "epics":       result_epics,
        "epic_create": epic_create,
        "epic_update": epic_update,
        "task_create": task_create,
        "task_update": task_update,
        "total":       epic_create + epic_update + task_create + task_update,
    }