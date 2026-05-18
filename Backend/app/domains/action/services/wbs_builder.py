# app/domains/action/services/wbs_builder.py
from sqlalchemy.orm import Session
from app.domains.action import repository

async def build_wbs_template(db: Session, meeting_id: int) -> dict:
    # 이미 생성된 WBS가 있으면 반환
    epics = repository.get_wbs_epics(db, meeting_id)
    if epics:
        return _from_wbs_table(db, epics)
    
    action_items = repository.get_action_items(db, meeting_id)
    if not action_items:
        raise ValueError(f"등록된 실행 항목이 없습니다. (meeting_id: {meeting_id}")
    
    return _persist_and_build(db, meeting_id, action_items)
    

def _from_wbs_table(db: Session, epics: list) -> dict:
    # 모든 태스크 한 번 에 수집
    all_tasks = []
    epic_task_map: dict[int, list] = {}
    for epic in epics:
        tasks = repository.get_wbs_tasks_by_epic(db, epic.id)
        epic_task_map[epic.id] = tasks
        all_tasks.extend(tasks)
    
    # assignee 배치 조회 (N+1 방지)
    assignee_ids = list({t.assignee_id for t in all_tasks if t.assignee_id})
    user_cache = repository.get_users_by_ids(db, assignee_ids)

    result = []
    for epic in epics:
        task_list = []
        for t in epic_task_map[epic.id]:
            user = user_cache.get(t.assignee_id) if t.assignee_id else None
            task_list.append({
                "id": t.id,
                "title": t.title,
                "assignee_name": user.name if user else t.assignee_name,
                "due_date": str(t.due_date) if t.due_date else None,
                "priority": t.priority.value if hasattr(t.priority, 'value') else t.priority,
                'urgency': "normal",
            })
        result.append({"id": epic.id, "title": epic.title, "tasks": task_list})
    return {"epics": result}

def _persist_and_build(db: Session, meeting_id: int, action_items: list) -> dict:
    # assignee_id 기준으로 그룹화
    groups: dict[int | None, list] = {}
    for item in action_items:
        key = item.assignee_id
        if key not in groups:
            groups[key] = []    
        groups[key].append(item)
    
    # assignee 배치 조회 (N + 1 방지)
    assignee_ids = [aid for aid in groups if aid is not None]
    user_cache = repository.get_users_by_ids(db, assignee_ids)

    result = []
    for i, (assignee_id, items) in enumerate(groups.items()):
        user = user_cache.get(assignee_id) if assignee_id else None
        epic_title = user.name if user else "미배정"

        epic = repository.save_wbs_epic(db, meeting_id, epic_title, order_index=i)
        task_list = []

        for item in items:
            priority = item.priority.value if hasattr(item.priority, 'value') else (item.priority or "medium")
            task = repository.save_wbs_task(
                db=db,
                epic_id=epic.id,
                title=item.content,
                assignee_id=assignee_id,
                assignee_name=user.name if user else None,
                priority=priority,
                due_date=item.due_date,
            )
            task_list.append({
                "id":   task.id,
                "title":    task.title,
                "assignee_name": user.name if user else None,
                "due_date": str(item.due_date) if item.due_date else None,
                "priority": priority,
                "urgency": item.urgency or "normal",
            })
        result.append({"id": epic.id, "title": epic_title, "tasks": task_list})
    return {"epics": result}
