# app\domains\action\repository.py
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date

from app.domains.action.models import ActionItem, WbsEpic, WbsTask, Report, ReportFormat, Priority, WbsSnapshot
from app.domains.intelligence.models import MeetingMinute, MinutePhoto
from app.domains.meeting.models import Meeting
from app.domains.user.models import User

# ----------------------------------------------------------------------
def get_meeting(db: Session, meeting_id: int) -> Optional[Meeting]:
    return db.query(Meeting).filter(Meeting.id == meeting_id).first()

def get_meeting_minute(db: Session, meeting_id: int) -> Optional[MeetingMinute]:
    return db.query(MeetingMinute).filter(MeetingMinute.meeting_id == meeting_id).first()

def get_meeting_minute_photos(db: Session, meeting_id: int) -> list[MinutePhoto]:
    minute = get_meeting_minute(db, meeting_id)
    if not minute:
        return []
    return (
        db.query(MinutePhoto)
        .filter(MinutePhoto.minute_id == minute.id)
        .order_by(MinutePhoto.taken_at.asc())
        .all()
    )

def get_action_items(db: Session, meeting_id: int) -> List[ActionItem]:
    return db.query(ActionItem).filter(ActionItem.meeting_id == meeting_id).all()

def get_user(db: Session, user_id: int) -> Optional[User]:
    return db.query(User).filter(User.id == user_id).first()

def get_users_by_ids(db: Session, user_ids: list[int]) -> dict[int, User]:
    if not user_ids:
        return {}
    users = db.query(User).filter(User.id.in_(user_ids)).all()
    return {u.id: u for u in users}

# -----------보고서-------------------------------------------------------
def save_report(
        db: Session,
        meeting_id: int,
        created_by: int,
        format: ReportFormat,
        title: str,
        content: Optional[str] = None,
        file_url: Optional[str] = None,
        thumbnail_url: Optional[str] = None,
) -> Report:
    report = Report(
        meeting_id=meeting_id,
        created_by=created_by,
        format=format,
        title=title,
        content=content,
        file_url=file_url,
        thumbnail_url=thumbnail_url,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report

def get_report(db: Session, report_id: int) -> Optional[Report]:
    return db.query(Report).filter(Report.id == report_id).first()

def get_reports(db: Session, meeting_id: int) -> List[Report]:
    return db.query(Report).filter(Report.meeting_id==meeting_id).order_by(Report.created_at.desc()).all()

def update_report(db: Session, report_id: int, content: str) -> Optional[Report]:
    report = get_report(db, report_id)
    if report:
        report.content = content    
        db.commit()
        db.refresh(report)
    return report

# --- WBS 조회 ---
def get_wbs_epics(db: Session, meeting_id: int) -> List[WbsEpic]:
    return (
        db.query(WbsEpic).filter(WbsEpic.meeting_id == meeting_id)
        .order_by(WbsEpic.order_index)
        .all()
    )

def get_wbs_tasks_by_epic(db: Session, epic_id: int) -> List[WbsTask]:
    return db.query(WbsTask).filter(WbsTask.epic_id == epic_id).all()

# --- WBS 생성 ---
def save_wbs_epic(
        db: Session, 
        meeting_id: int, 
        title: str, 
        order_index: int
) -> WbsEpic:
    epic = WbsEpic(
        meeting_id=meeting_id,
        title=title,
        order_index=order_index
    )
    db.add(epic)
    db.commit()
    db.refresh(epic)
    return epic

def save_wbs_task(
        db: Session,
        epic_id: int,
        title: str,
        content: Optional[str] = None,
        assignee_id: Optional[int] = None,
        assignee_name: Optional[str] = None,
        priority: str = Priority.medium,
        urgency: Optional[str] = None,
        due_date: Optional[date] = None,
        order_index: Optional[int] = None,
) -> WbsTask:
    if order_index is None:
        order_index = db.query(WbsTask).filter(WbsTask.epic_id == epic_id).count()

    task = WbsTask(
        epic_id=epic_id,
        title=title,
        content=content,
        assignee_id=assignee_id,
        assignee_name=assignee_name,
        priority=priority if priority else Priority.medium,
        urgency=urgency,
        due_date=due_date,
        order_index=order_index,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task

# --- 외부 ID 저장 ------------------------------------------

def update_epic_jira_id(db: Session, epic_id: int, jira_epic_id: str) -> None:
    db.query(WbsEpic).filter(WbsEpic.id == epic_id).update({
        "jira_epic_id": jira_epic_id
    })
    db.commit()

def update_task_jira_id(db: Session, task_id: int, jira_issue_id: str) -> None:
    db.query(WbsTask).filter(WbsTask.id == task_id).update({
        "jira_issue_id": jira_issue_id
    })
    db.commit()

# =================================================================
# WBS
# =================================================================
def get_wbs_epic(db: Session, epic_id: int) -> Optional[WbsEpic]:
    return db.query(WbsEpic).filter(WbsEpic.id==epic_id).first()

def get_wbs_task(db: Session, task_id: int) -> Optional[WbsTask]:
    return db.query(WbsTask).filter(WbsTask.id==task_id).first()

def update_wbs_epic(
        db: Session,
        epic_id: int,
        title: Optional[str] = None,
        order_index: Optional[int] = None, 
) -> Optional[WbsEpic]:
    epic = get_wbs_epic(db, epic_id)
    if not epic:
        return None
    if title is not None:
        epic.title = title
    if order_index is not None:
        epic.order_index = order_index
    db.commit()
    db.refresh(epic)
    return epic

def update_wbs_task(
        db: Session,
        task_id: int,
        title: Optional[str] = None,
        content: Optional[str] = None,
        assignee_id: Optional[int] = None,
        assignee_name: Optional[str] = None,
        priority: Optional[str] = None,
        urgency: Optional[str] = None,
        due_date: Optional[date] = None,
        progress: Optional[int] = None,
        status: Optional[str] = None,
        order_index: Optional[int] = None,
) -> Optional[WbsTask]:
    task = get_wbs_task(db, task_id)
    if not task:
        return None
    if title is not None:
        task.title = title
    if content is not None:
        task.content = content
    if assignee_id is not None:
        task.assignee_id = assignee_id
    if assignee_name is not None:
        task.assignee_name = assignee_name
    if priority is not None:
        task.priority = priority
    if urgency is not None:
        task.urgency = urgency
    if due_date is not None:
        task.due_date = due_date
    if progress is not None:
        task.progress = max(0, min(100, progress))
    if status is not None:
        task.status = status
    if order_index is not None:
        task.order_index = order_index
    db.commit()
    db.refresh(task)
    return task

def delete_wbs_epic(db: Session, epic_id: int) -> bool:
    epic = get_wbs_epic(db, epic_id)
    if not epic:
        return False
    db.query(WbsTask).filter(WbsTask.epic_id == epic_id).delete()
    db.delete(epic)
    db.commit()
    return True

def delete_wbs_task(db: Session, task_id: int) -> bool:
    task = get_wbs_task(db, task_id)
    if not task:
        return False
    db.delete(task)
    db.commit()
    return True

def move_wbs_task(
        db: Session,
        task_id: int,
        target_epic_id: int,
        order_index: int,
) -> Optional[WbsTask]:
    task = get_wbs_task(db, task_id)
    if not task:
        return None
    task.epic_id = target_epic_id
    task.order_index = order_index
    db.commit()
    db.refresh(task)
    return task

def reorder_wbs_epics(db: Session, items: list) -> None:
    for item in items:
        db.query(WbsEpic).filter(WbsEpic.id == item['id']).update({"order_index": item['order_index']})
    db.commit()

def reorder_wbs_tasks(db: Session, items: list) -> None:
    for item in items:
        db.query(WbsTask).filter(WbsTask.id == item['id']).update({"order_index": item['order_index']})
    db.commit()

def get_wbs_snapshot(db: Session, meeting_id: int) -> Optional["WbsSnapshot"]:
    return db.query(WbsSnapshot).filter(WbsSnapshot.meeting_id == meeting_id).first()

def save_wbs_snapshot(db: Session, meeting_id: int, epic_with_tasks: list) -> None:
    """
    정리된 wbs_epics 와 wbs_tasks의 초깃값을 저장
    """
    import json
    
    data = {
        "epics": [
            {
                "title": epic.title,
                "order_index": epic.order_index,
                "tasks": [
                    {
                        "title": t.title,
                        "content": t.content,
                        "assignee_id": t.assignee_id,
                        "assignee_name": t.assignee_name,
                        'priority': t.priority.value if hasattr(t.priority, 'value') else t.priority,
                        'urgency': t.urgency,
                        'due_date': str(t.due_date) if t.due_date else None,
                        'progress': t.progress,
                        "status": t.status.value if hasattr(t.status, "value") else t.status,
                        "order_index": t.order_index,
                    } for t in tasks
                ],
            } for epic, tasks in epic_with_tasks
        ]
    }

    existing = get_wbs_snapshot(db, meeting_id)
    if existing:
        return
    
    snapshot = WbsSnapshot(meeting_id=meeting_id, snapshot_data=json.dumps(data, ensure_ascii=False))
    db.add(snapshot)
    db.commit()
    
def restore_wbs_from_snapshot(db: Session, meeting_id: int) -> bool:
    """
    스냅샷으로 wbs_epics 와 wbs_tasks 복원. 기존데이터 전부 삭제
    """
    import json

    snapshot = get_wbs_snapshot(db, meeting_id)
    if not snapshot:
        return False
    
    # 태스크 삭제
    epics = get_wbs_epics(db, meeting_id)
    for epic in epics:
        tasks = get_wbs_tasks_by_epic(db, epic.id)
        for task in tasks:
            db.delete(task)
    db.flush()

    # 에픽 삭제
    for epic in epics:
        db.delete(epic)
    
    # 스냅샷으로 재생성
    data = json.loads(snapshot.snapshot_data)
    for epic_data in data['epics']:
        epic = save_wbs_epic(db, meeting_id, epic_data["title"], epic_data['order_index'])

        for task_data in epic_data["tasks"]:
            save_wbs_task(
                db=db,
                epic_id=epic.id,
                title=task_data['title'],
                content=task_data.get("content"),
                assignee_id=task_data.get("assignee_id"),
                assignee_name=task_data.get("assignee_name"),
                priority=task_data.get("priority", "medium"),
                urgency=task_data.get("urgency"),
                due_date=task_data.get("due_date"),
                order_index=task_data.get("order_index", 0),
            )

    db.commit()
    return True