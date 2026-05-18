import json
from sqlalchemy import func
from app.infra.database.session import SessionLocal
from app.core.ontology.schema import EntityType, RelationType, Relation
from datetime import date
from app.utils.time_utils import now_kst


# ──────────────────────────────────────────────────────────────────
# 공통 헬퍼
# ──────────────────────────────────────────────────────────────────

def _parse_date(val) -> date | None:
    """ctx에서 꺼낸 날짜값을 date 객체로 변환. 이미 date면 그대로."""
    if val is None:
        return None
    if isinstance(val, date):
        return val
    try:
        return date.fromisoformat(str(val))
    except Exception:
        return None


# ──────────────────────────────────────────────────────────────────
# [순방향] User 기점 fetch 함수
# ──────────────────────────────────────────────────────────────────

def fetch_user_meetings(
    user_id: int, workspace_id: int, ctx: dict | None = None
) -> list[dict]:
    """User → 참여한 Meeting 목록 (최근 10개, 날짜 필터 가능)"""
    from app.domains.meeting.models import Meeting, MeetingParticipant

    date_from = _parse_date((ctx or {}).get("date_from"))
    date_to   = _parse_date((ctx or {}).get("date_to"))

    db = SessionLocal()
    try:
        q = (
            db.query(Meeting.id, Meeting.title, Meeting.scheduled_at, Meeting.status)
            .join(MeetingParticipant, Meeting.id == MeetingParticipant.meeting_id)
            .filter(
                MeetingParticipant.user_id == user_id,
                Meeting.workspace_id == workspace_id,
            )
        )
        if date_from:
            q = q.filter(Meeting.scheduled_at >= date_from)
        if date_to:
            q = q.filter(Meeting.scheduled_at <= date_to)
        rows = q.order_by(Meeting.scheduled_at.desc()).limit(10).all()
        return [
            {
                "id": r.id,
                "type": EntityType.MEETING.value,
                "title": r.title,
                "date": r.scheduled_at.strftime("%Y-%m-%d") if r.scheduled_at else None,
                "status": r.status.value if r.status else None,
            }
            for r in rows
        ]
    except Exception:
        return []
    finally:
        db.close()


def fetch_user_tasks(
    user_id: int, workspace_id: int, ctx: dict | None = None
) -> list[dict]:
    """User → 담당한 WbsTask 목록 (날짜 필터: due_date 기준)"""
    from app.domains.action.models import WbsTask, WbsEpic
    from app.domains.meeting.models import Meeting

    date_from = _parse_date((ctx or {}).get("date_from"))
    date_to   = _parse_date((ctx or {}).get("date_to"))

    db = SessionLocal()
    try:
        q = (
            db.query(WbsTask)
            .join(WbsEpic, WbsTask.epic_id == WbsEpic.id)
            .join(Meeting, WbsEpic.meeting_id == Meeting.id)
            .filter(WbsTask.assignee_id == user_id, Meeting.workspace_id == workspace_id)
        )
        if date_from:
            q = q.filter(WbsTask.due_date >= date_from)
        if date_to:
            q = q.filter(WbsTask.due_date <= date_to)
        rows = q.order_by(WbsTask.due_date.desc()).limit(10).all()
        return [
            {
                "id": r.id,
                "type": EntityType.WBS_TASK.value,
                "title": r.title,
                "status": r.status.value if r.status else None,
                "progress": r.progress,
                "due_date": r.due_date.strftime("%Y-%m-%d") if r.due_date else None,
            }
            for r in rows
        ]
    except Exception:
        return []
    finally:
        db.close()


def fetch_user_department(
    user_id: int, workspace_id: int, ctx: dict | None = None
) -> list[dict]:
    """User → 소속 Department"""
    from app.domains.workspace.models import WorkspaceMember, Department

    db = SessionLocal()
    try:
        row = (
            db.query(Department.id, Department.name)
            .join(WorkspaceMember, Department.id == WorkspaceMember.department_id)
            .filter(
                WorkspaceMember.user_id == user_id,
                WorkspaceMember.workspace_id == workspace_id,
            )
            .first()
        )
        if not row:
            return []
        return [{"id": row.id, "type": EntityType.DEPARTMENT.value, "name": row.name}]
    except Exception:
        return []
    finally:
        db.close()


def fetch_user_profile(
    user_id: int, workspace_id: int, ctx: dict | None = None
) -> list[dict]:
    """
    User → 프로필 속성 (terminal node).

    name / email / birth_date / gender / phone_number / role 등
    users 테이블 직접 컬럼을 반환한다.

    "조수민의 별자리", "이메일 주소가 뭐야" 같이 User 자체 속성을
    묻는 질문에 온톨로지 컨텍스트로 답변 가능하게 한다.
    """
    from app.domains.user.models import User
    from app.domains.workspace.models import WorkspaceMember

    db = SessionLocal()
    try:
        row = (
            db.query(
                User.id,
                User.name,
                User.email,
                User.birth_date,
                User.gender,
                User.phone_number,
                WorkspaceMember.role,
            )
            .join(WorkspaceMember, User.id == WorkspaceMember.user_id)
            .filter(
                User.id == user_id,
                WorkspaceMember.workspace_id == workspace_id,
            )
            .first()
        )
        if not row:
            return []
        return [{
            "type": "UserProfile",
            "name": row.name,
            "email": row.email,
            "role": row.role.value if row.role else None,
            "birth_date": row.birth_date.strftime("%Y-%m-%d") if row.birth_date else None,
            "gender": row.gender,
            "phone_number": row.phone_number,
        }]
    except Exception:
        return []
    finally:
        db.close()


def fetch_user_stats(
    user_id: int, workspace_id: int, ctx: dict | None = None
) -> list[dict]:
    """
    User → 활동 통계 요약 (terminal node).

    반환 타입 "UserStats"는 ONTOLOGY에 from_entity로 등록되지 않으므로
    traverser가 이 노드에서 추가 탐색을 하지 않는다.

    "00은 어떤 사람이야?" 류 질문에 정량적 맥락을 제공.
    """
    from app.domains.meeting.models import Meeting, MeetingParticipant
    from app.domains.action.models import WbsTask, WbsEpic, TaskStatus

    db = SessionLocal()
    try:
        meeting_count = (
            db.query(func.count(Meeting.id))
            .join(MeetingParticipant, Meeting.id == MeetingParticipant.meeting_id)
            .filter(
                MeetingParticipant.user_id == user_id,
                Meeting.workspace_id == workspace_id,
            )
            .scalar()
        ) or 0

        tasks = (
            db.query(WbsTask.status)
            .join(WbsEpic, WbsTask.epic_id == WbsEpic.id)
            .join(Meeting, WbsEpic.meeting_id == Meeting.id)
            .filter(WbsTask.assignee_id == user_id, Meeting.workspace_id == workspace_id)
            .all()
        )
        task_count = len(tasks)
        done_count = sum(1 for t in tasks if t.status == TaskStatus.done)
        rate = f"{round(done_count / task_count * 100)}%" if task_count > 0 else "0%"

        return [
            {
                "type": "UserStats",
                "meetings_count": meeting_count,
                "tasks_count": task_count,
                "completed_tasks": done_count,
                "completion_rate": rate,
            }
        ]
    except Exception:
        return []
    finally:
        db.close()


# ──────────────────────────────────────────────────────────────────
# [순방향] Meeting 기점 fetch 함수
# ──────────────────────────────────────────────────────────────────

def fetch_meeting_profile(
    meeting_id: int, workspace_id: int, ctx: dict | None = None
) -> list[dict]:
    """
    Meeting → 회의 자체 속성 (terminal node).

    title / meeting_type / room_name / started_at / ended_at / created_by 등
    meetings 테이블 직접 컬럼을 반환한다.

    "이 회의 어디서 했어?", "몇 시에 끝났어?", "어떤 종류 회의야?" 같이
    회의 자체 속성을 묻는 질문에 온톨로지 컨텍스트로 답변 가능하게 한다.
    """
    from app.domains.meeting.models import Meeting
    from app.domains.user.models import User

    db = SessionLocal()
    try:
        row = (
            db.query(
                Meeting.id,
                Meeting.title,
                Meeting.meeting_type,
                Meeting.room_name,
                Meeting.status,
                Meeting.scheduled_at,
                Meeting.started_at,
                Meeting.ended_at,
                User.name.label("created_by_name"),
            )
            .outerjoin(User, Meeting.created_by == User.id)
            .filter(
                Meeting.id == meeting_id,
                Meeting.workspace_id == workspace_id,
            )
            .first()
        )
        if not row:
            return []
        return [{
            "type": "MeetingProfile",
            "title": row.title,
            "meeting_type": row.meeting_type,
            "room_name": row.room_name,
            "status": row.status.value if row.status else None,
            "scheduled_at": row.scheduled_at.strftime("%Y-%m-%d %H:%M") if row.scheduled_at else None,
            "started_at": row.started_at.strftime("%Y-%m-%d %H:%M") if row.started_at else None,
            "ended_at": row.ended_at.strftime("%Y-%m-%d %H:%M") if row.ended_at else None,
            "created_by": row.created_by_name,
        }]
    except Exception:
        return []
    finally:
        db.close()


def fetch_meeting_summary(
    meeting_id: int, workspace_id: int, ctx: dict | None = None
) -> list[dict]:
    """
    Meeting → 회의 요약 key_points (terminal node).

    MeetingMinute.summary JSON의 key_points를 반환한다.
    "이 회의 요약해줘" 처럼 온톨로지 경로로 요약을 요청할 때
    knowledge_node LLM에 summary 컨텍스트를 제공한다.
    """
    from app.domains.intelligence.models import MeetingMinute

    db = SessionLocal()
    try:
        row = db.query(MeetingMinute).filter(MeetingMinute.meeting_id == meeting_id).first()
        if not row or not row.summary:
            return []
        try:
            summary_dict = json.loads(row.summary) if isinstance(row.summary, str) else row.summary
        except Exception:
            return []
        key_points = summary_dict.get("key_points", [])
        if not key_points:
            return []
        return [{"type": "MeetingSummary", "key_points": key_points}]
    except Exception:
        return []
    finally:
        db.close()


def fetch_meeting_decisions(
    meeting_id: int, workspace_id: int, ctx: dict | None = None
) -> list[dict]:
    """Meeting → Decision 목록 (회의 특정 후 전체 반환, 날짜 필터 없음)"""
    from app.domains.intelligence.models import Decision

    db = SessionLocal()
    try:
        rows = (
            db.query(Decision)
            .filter(Decision.meeting_id == meeting_id)
            .order_by(Decision.detected_at.asc())
            .all()
        )
        return [
            {
                "id": r.id,
                "type": EntityType.DECISION.value,
                "content": r.content,
                "is_confirmed": r.is_confirmed,
                "detected_at": r.detected_at.strftime("%Y-%m-%d") if r.detected_at else None,
            }
            for r in rows
        ]
    except Exception:
        return []
    finally:
        db.close()


def fetch_meeting_tasks(
    meeting_id: int, workspace_id: int, ctx: dict | None = None
) -> list[dict]:
    """
    Meeting → WbsTask 목록 (WbsEpic 경유, 날짜 필터: due_date 기준).

    WbsTask에 meeting_id 컬럼이 없으므로 반드시 WbsEpic join 필요.
    WbsTask.epic_id → WbsEpic.meeting_id → Meeting.id 체인.
    """
    import logging as _log
    from app.domains.action.models import WbsTask, WbsEpic

    db = SessionLocal()
    try:
        q = (
            db.query(WbsTask)
            .join(WbsEpic, WbsTask.epic_id == WbsEpic.id)
            .filter(WbsEpic.meeting_id == meeting_id)
        )
        rows = q.order_by(WbsTask.due_date.asc()).all()
        _log.getLogger(__name__).warning(
            "[fetch_meeting_tasks] meeting_id=%s → %d rows", meeting_id, len(rows)
        )
        return [
            {
                "id": r.id,
                "type": EntityType.WBS_TASK.value,
                "title": r.title,
                "assignee": r.assignee_name,
                "status": r.status.value if r.status else None,
                "progress": r.progress,
                "due_date": r.due_date.strftime("%Y-%m-%d") if r.due_date else None,
            }
            for r in rows
        ]
    except Exception as e:
        _log.getLogger(__name__).warning("[fetch_meeting_tasks] ERROR meeting_id=%s: %s", meeting_id, e)
        return []
    finally:
        db.close()


def fetch_meeting_members(
    meeting_id: int, workspace_id: int, ctx: dict | None = None
) -> list[dict]:
    """Meeting → 참석자 User 목록"""
    from app.domains.meeting.models import MeetingParticipant
    from app.domains.user.models import User

    db = SessionLocal()
    try:
        rows = (
            db.query(User.id, User.name, MeetingParticipant.is_host)
            .join(MeetingParticipant, User.id == MeetingParticipant.user_id)
            .filter(MeetingParticipant.meeting_id == meeting_id)
            .order_by(MeetingParticipant.is_host.desc(), User.name.asc())
            .all()
        )
        return [
            {
                "id": r.id,
                "type": EntityType.USER.value,
                "name": r.name,
                "is_host": r.is_host,
            }
            for r in rows
        ]
    except Exception:
        return []
    finally:
        db.close()


def fetch_meeting_reports(
    meeting_id: int, workspace_id: int, ctx: dict | None = None
) -> list[dict]:
    """Meeting → MeetingMinute(Report) 목록"""
    from app.domains.intelligence.models import MeetingMinute

    db = SessionLocal()
    try:
        rows = (
            db.query(MeetingMinute).filter(MeetingMinute.meeting_id == meeting_id).all()
        )
        return [
            {
                "id": r.id,
                "type": EntityType.REPORT.value,
                "status": r.status.value if r.status else None,
                "review_status": r.review_status,
            }
            for r in rows
        ]
    except Exception:
        return []
    finally:
        db.close()


def fetch_meeting_stats(
    meeting_id: int, workspace_id: int, ctx: dict | None = None
) -> list[dict]:
    """
    Meeting → 회의 통계 요약 (terminal node).

    참석자 수 / 결정사항 수 / WBS 태스크 수 / 완료율을 한 번에 조회.
    "이 회의 어떻게 됐어?", "그 회의 정리해줘" 질문에 정량적 맥락 제공.
    """
    from app.domains.meeting.models import MeetingParticipant
    from app.domains.intelligence.models import Decision
    from app.domains.action.models import WbsTask, WbsEpic, TaskStatus

    db = SessionLocal()
    try:
        participant_count = (
            db.query(func.count(MeetingParticipant.id))
            .filter(MeetingParticipant.meeting_id == meeting_id)
            .scalar()
        ) or 0

        decision_count = (
            db.query(func.count(Decision.id))
            .filter(Decision.meeting_id == meeting_id)
            .scalar()
        ) or 0

        tasks = (
            db.query(WbsTask.status)
            .join(WbsEpic, WbsTask.epic_id == WbsEpic.id)
            .filter(WbsEpic.meeting_id == meeting_id)
            .all()
        )
        task_count = len(tasks)
        done_count = sum(1 for t in tasks if t.status == TaskStatus.done)
        rate = f"{round(done_count / task_count * 100)}%" if task_count > 0 else "0%"

        return [
            {
                "type": "MeetingStats",
                "participants_count": participant_count,
                "decisions_count": decision_count,
                "tasks_count": task_count,
                "tasks_completion_rate": rate,
            }
        ]
    except Exception:
        return []
    finally:
        db.close()


# ──────────────────────────────────────────────────────────────────
# [역방향] WbsTask 기점 fetch 함수
#
# WbsTask는 직접 meeting_id를 갖지 않으므로
# WbsEpic을 경유하는 join이 필수다.
# ──────────────────────────────────────────────────────────────────

def fetch_task_source_meeting(
    task_id: int, workspace_id: int, ctx: dict | None = None
) -> list[dict]:
    """
    WbsTask → 태스크가 생성된 Meeting (역방향, WbsEpic 경유).

    "이 태스크 어느 회의에서 나온 거야?" 질문 처리.
    WbsTask를 seed로 출발해 소속 회의를 역추적한다.
    """
    from app.domains.action.models import WbsTask, WbsEpic
    from app.domains.meeting.models import Meeting

    db = SessionLocal()
    try:
        row = (
            db.query(Meeting.id, Meeting.title, Meeting.scheduled_at, Meeting.status)
            .join(WbsEpic, Meeting.id == WbsEpic.meeting_id)
            .join(WbsTask, WbsEpic.id == WbsTask.epic_id)
            .filter(WbsTask.id == task_id, Meeting.workspace_id == workspace_id)
            .first()
        )
        if not row:
            return []
        return [
            {
                "id": row.id,
                "type": EntityType.MEETING.value,
                "title": row.title,
                "date": row.scheduled_at.strftime("%Y-%m-%d") if row.scheduled_at else None,
                "status": row.status.value if row.status else None,
            }
        ]
    except Exception:
        return []
    finally:
        db.close()


def fetch_task_assignee(
    task_id: int, workspace_id: int, ctx: dict | None = None
) -> list[dict]:
    """
    WbsTask → 담당자 User (역방향).

    "이 태스크 담당자 누구야?" 질문 처리.
    WbsTask.assignee_id → User.id로 역추적.
    """
    from app.domains.action.models import WbsTask
    from app.domains.user.models import User

    db = SessionLocal()
    try:
        row = (
            db.query(User.id, User.name)
            .join(WbsTask, User.id == WbsTask.assignee_id)
            .filter(WbsTask.id == task_id)
            .first()
        )
        if not row:
            return []
        return [{"id": row.id, "type": EntityType.USER.value, "name": row.name}]
    except Exception:
        return []
    finally:
        db.close()


def fetch_task_context(
    task_id: int, workspace_id: int, ctx: dict | None = None
) -> list[dict]:
    """
    WbsTask → 태스크 전체 컨텍스트 요약 (terminal node).

    에픽명 / 소속 회의 / 담당자 / 진행률을 한 번에 조회.
    "UI 개선 태스크 현황 알려줘" 류 질문에 풍부한 맥락 제공.
    """
    from app.domains.action.models import WbsTask, WbsEpic
    from app.domains.meeting.models import Meeting
    from app.domains.user.models import User

    db = SessionLocal()
    try:
        row = (
            db.query(
                WbsTask,
                WbsEpic.title.label("epic_title"),
                Meeting.title.label("meeting_title"),
                User.name.label("assignee_name"),
            )
            .join(WbsEpic, WbsTask.epic_id == WbsEpic.id)
            .join(Meeting, WbsEpic.meeting_id == Meeting.id)
            .outerjoin(User, WbsTask.assignee_id == User.id)
            .filter(WbsTask.id == task_id, Meeting.workspace_id == workspace_id)
            .first()
        )
        if not row:
            return []
        task, epic_title, meeting_title, assignee_name = row
        return [
            {
                "type": "TaskContext",
                "task_title": task.title,
                "epic": epic_title,
                "meeting": meeting_title,
                "assignee": assignee_name or task.assignee_name or "미배정",
                "status": task.status.value if task.status else None,
                "progress": task.progress,
                "due_date": task.due_date.strftime("%Y-%m-%d") if task.due_date else None,
            }
        ]
    except Exception:
        return []
    finally:
        db.close()


# ──────────────────────────────────────────────────────────────────
# [역방향] Decision 기점 fetch 함수
# ──────────────────────────────────────────────────────────────────

def fetch_decision_meeting(
    decision_id: int, workspace_id: int, ctx: dict | None = None
) -> list[dict]:
    """
    Decision → 결정사항이 나온 Meeting (역방향).

    "이 결정 어느 회의에서 나왔어?" 질문 처리.
    Decision.meeting_id → Meeting 역추적.
    """
    from app.domains.intelligence.models import Decision
    from app.domains.meeting.models import Meeting

    db = SessionLocal()
    try:
        row = (
            db.query(Meeting.id, Meeting.title, Meeting.scheduled_at, Meeting.status)
            .join(Decision, Meeting.id == Decision.meeting_id)
            .filter(Decision.id == decision_id, Meeting.workspace_id == workspace_id)
            .first()
        )
        if not row:
            return []
        return [
            {
                "id": row.id,
                "type": EntityType.MEETING.value,
                "title": row.title,
                "date": row.scheduled_at.strftime("%Y-%m-%d") if row.scheduled_at else None,
                "status": row.status.value if row.status else None,
            }
        ]
    except Exception:
        return []
    finally:
        db.close()


def fetch_decision_speaker(
    decision_id: int, workspace_id: int, ctx: dict | None = None
) -> list[dict]:
    """
    Decision → 결정을 제안한 User (역방향, speaker_id 기반).

    "이 결정 누가 제안했어?" 질문 처리.
    speaker_id가 null인 경우 빈 list 반환.
    """
    from app.domains.intelligence.models import Decision
    from app.domains.user.models import User

    db = SessionLocal()
    try:
        row = (
            db.query(User.id, User.name)
            .join(Decision, User.id == Decision.speaker_id)
            .filter(Decision.id == decision_id)
            .first()
        )
        if not row:
            return []
        return [{"id": row.id, "type": EntityType.USER.value, "name": row.name}]
    except Exception:
        return []
    finally:
        db.close()


def fetch_decision_context(
    decision_id: int, workspace_id: int, ctx: dict | None = None
) -> list[dict]:
    """
    Decision → 결정사항 전체 컨텍스트 (terminal node).

    회의 제목 / 발언자 / 확정 여부를 한 번에 조회.
    "이 결정사항 정리해줘" 질문에 풍부한 맥락 제공.
    """
    from app.domains.intelligence.models import Decision
    from app.domains.meeting.models import Meeting
    from app.domains.user.models import User

    db = SessionLocal()
    try:
        row = (
            db.query(
                Decision,
                Meeting.title.label("meeting_title"),
                User.name.label("speaker_name"),
            )
            .join(Meeting, Decision.meeting_id == Meeting.id)
            .outerjoin(User, Decision.speaker_id == User.id)
            .filter(Decision.id == decision_id, Meeting.workspace_id == workspace_id)
            .first()
        )
        if not row:
            return []
        decision, meeting_title, speaker_name = row
        return [
            {
                "type": "DecisionContext",
                "content": decision.content,
                "meeting": meeting_title,
                "speaker": speaker_name or "미상",
                "is_confirmed": decision.is_confirmed,
                "detected_at": decision.detected_at.strftime("%Y-%m-%d") if decision.detected_at else None,
            }
        ]
    except Exception:
        return []
    finally:
        db.close()


# ──────────────────────────────────────────────────────────────────
# [역방향] Department 기점 fetch 함수
# ──────────────────────────────────────────────────────────────────

def fetch_department_members(
    dept_id: int, workspace_id: int, ctx: dict | None = None
) -> list[dict]:
    """
    Department → 소속 User 목록 (역방향).

    "개발팀 구성원 보여줘" 질문 처리.
    Department를 seed로 출발해 멤버를 탐색.
    depth=2 탐색 시 User→WbsTask까지 이어져
    "개발팀 사람들 담당 태스크"도 추론 가능.
    """
    from app.domains.workspace.models import WorkspaceMember
    from app.domains.user.models import User

    db = SessionLocal()
    try:
        rows = (
            db.query(User.id, User.name, WorkspaceMember.role)
            .join(WorkspaceMember, User.id == WorkspaceMember.user_id)
            .filter(
                WorkspaceMember.department_id == dept_id,
                WorkspaceMember.workspace_id == workspace_id,
            )
            .all()
        )
        return [
            {
                "id": r.id,
                "type": EntityType.USER.value,
                "name": r.name,
                "role": r.role.value if r.role else None,
            }
            for r in rows
        ]
    except Exception:
        return []
    finally:
        db.close()


def fetch_department_stats(
    dept_id: int, workspace_id: int, ctx: dict | None = None
) -> list[dict]:
    """
    Department → 부서 통계 요약 (terminal node).

    멤버 수 등 집계값 제공.
    "개발팀 현황 알려줘" 질문에 정량적 맥락 추가.
    """
    from app.domains.workspace.models import WorkspaceMember, Department

    db = SessionLocal()
    try:
        member_count = (
            db.query(func.count(WorkspaceMember.id))
            .filter(
                WorkspaceMember.department_id == dept_id,
                WorkspaceMember.workspace_id == workspace_id,
            )
            .scalar()
        ) or 0

        dept = db.query(Department.name).filter(Department.id == dept_id).first()

        return [
            {
                "type": "DeptStats",
                "department": dept.name if dept else "Unknown",
                "member_count": member_count,
            }
        ]
    except Exception:
        return []
    finally:
        db.close()


# ──────────────────────────────────────────────────────────────────
# [워크스페이스 집합] fetch 함수
# entity_id 자리에 workspace_id가 들어온다
# ──────────────────────────────────────────────────────────────────

def fetch_ws_members(
    workspace_id: int, _ws_id: int, ctx: dict | None = None
) -> list[dict]:
    """워크스페이스 전체 멤버 목록"""
    from app.domains.workspace.models import WorkspaceMember
    from app.domains.user.models import User

    db = SessionLocal()
    try:
        rows = (
            db.query(User.id, User.name, User.email, WorkspaceMember.role)
            .join(WorkspaceMember, User.id == WorkspaceMember.user_id)
            .filter(WorkspaceMember.workspace_id == workspace_id)
            .all()
        )
        return [
            {
                "id": r.id,
                "type": EntityType.USER.value,
                "name": r.name,
                "email": r.email,
                "role": r.role.value if r.role else None,
            }
            for r in rows
        ]
    except Exception:
        return []
    finally:
        db.close()


def fetch_ws_departments(
    workspace_id: int, _ws_id: int, ctx: dict | None = None
) -> list[dict]:
    """워크스페이스 전체 부서 목록"""
    from app.domains.workspace.models import Department

    db = SessionLocal()
    try:
        rows = (
            db.query(Department).filter(Department.workspace_id == workspace_id).all()
        )
        return [
            {"id": r.id, "type": EntityType.DEPARTMENT.value, "name": r.name}
            for r in rows
        ]
    except Exception:
        return []
    finally:
        db.close()


def fetch_ws_reports(
    workspace_id: int, _ws_id: int, ctx: dict | None = None
) -> list[dict]:
    """워크스페이스 전체 보고서 (날짜 필터: 회의 scheduled_at 기준)"""
    from app.domains.intelligence.models import MeetingMinute
    from app.domains.meeting.models import Meeting

    date_from = _parse_date((ctx or {}).get("date_from"))
    date_to   = _parse_date((ctx or {}).get("date_to"))

    db = SessionLocal()
    try:
        q = (
            db.query(MeetingMinute, Meeting.title, Meeting.scheduled_at)
            .join(Meeting, MeetingMinute.meeting_id == Meeting.id)
            .filter(Meeting.workspace_id == workspace_id)
        )
        if date_from:
            q = q.filter(Meeting.scheduled_at >= date_from)
        if date_to:
            q = q.filter(Meeting.scheduled_at <= date_to)
        rows = q.order_by(Meeting.scheduled_at.desc()).limit(20).all()
        return [
            {
                "id": minute.id,
                "type": EntityType.REPORT.value,
                "meeting_title": title,
                "date": scheduled_at.strftime("%Y-%m-%d") if scheduled_at else None,
                "status": minute.status.value if minute.status else None,
            }
            for minute, title, scheduled_at in rows
        ]
    except Exception:
        return []
    finally:
        db.close()


def fetch_ws_schedule(
    workspace_id: int, _ws_id: int, ctx: dict | None = None
) -> list[dict]:
    """워크스페이스 예정 회의 일정 (날짜 필터 가능, 기본: 미래 회의)"""
    from app.domains.meeting.models import Meeting, MeetingStatus

    date_from = _parse_date((ctx or {}).get("date_from")) or now_kst().date()
    date_to   = _parse_date((ctx or {}).get("date_to"))

    db = SessionLocal()
    try:
        q = db.query(
            Meeting.id, Meeting.title, Meeting.scheduled_at, Meeting.status
        ).filter(
            Meeting.workspace_id == workspace_id,
            Meeting.status == MeetingStatus.scheduled,
            Meeting.scheduled_at >= date_from,
        )
        if date_to:
            q = q.filter(Meeting.scheduled_at <= date_to)
        rows = q.order_by(Meeting.scheduled_at.asc()).limit(10).all()
        return [
            {
                "id": r.id,
                "type": EntityType.MEETING.value,
                "title": r.title,
                "date": r.scheduled_at.strftime("%Y-%m-%d %H:%M") if r.scheduled_at else None,
            }
            for r in rows
        ]
    except Exception:
        return []
    finally:
        db.close()


def fetch_ws_device(
    workspace_id: int, _ws_id: int, ctx: dict | None = None
) -> list[dict]:
    """워크스페이스 장비/환경 설정"""
    from app.domains.workspace.models import WorkspaceDeviceSetting

    db = SessionLocal()
    try:
        rows = (
            db.query(WorkspaceDeviceSetting)
            .filter(WorkspaceDeviceSetting.workspace_id == workspace_id)
            .all()
        )
        return [
            {
                "id": r.id,
                "type": EntityType.WS_DEVICE.value,
                "device_name": r.device_name,
                "mic_enabled": r.mic_enabled,
                "camera_enabled": r.camera_enabled,
                "speaker_enabled": r.speaker_enabled,
            }
            for r in rows
        ]
    except Exception:
        return []
    finally:
        db.close()


def fetch_ws_integration(
    workspace_id: int, _ws_id: int, ctx: dict | None = None
) -> list[dict]:
    """워크스페이스 외부 서비스 연동 상태"""
    from app.domains.integration.models import IntegrationSetting

    db = SessionLocal()
    try:
        rows = (
            db.query(IntegrationSetting)
            .filter(IntegrationSetting.workspace_id == workspace_id)
            .all()
        )
        return [
            {
                "id": r.id,
                "type": EntityType.WS_INTEGRATION.value,
                "service": r.service_name,
                "is_connected": r.is_connected,
                "token_expire_at": r.token_expire_at.isoformat() if r.token_expire_at else None,
            }
            for r in rows
        ]
    except Exception:
        return []
    finally:
        db.close()


def fetch_ws_tasks(
    workspace_id: int, _ws_id: int, ctx: dict | None = None
) -> list[dict]:
    """워크스페이스 전체 WBS 태스크 (날짜 필터: due_date 기준)"""
    from app.domains.action.models import WbsTask, WbsEpic
    from app.domains.meeting.models import Meeting

    date_from = _parse_date((ctx or {}).get("date_from"))
    date_to   = _parse_date((ctx or {}).get("date_to"))

    db = SessionLocal()
    try:
        q = (
            db.query(WbsTask)
            .join(WbsEpic, WbsTask.epic_id == WbsEpic.id)
            .join(Meeting, WbsEpic.meeting_id == Meeting.id)
            .filter(Meeting.workspace_id == workspace_id)
        )
        if date_from:
            q = q.filter(WbsTask.due_date >= date_from)
        if date_to:
            q = q.filter(WbsTask.due_date <= date_to)
        rows = q.order_by(WbsTask.due_date.asc()).limit(20).all()
        return [
            {
                "id": r.id,
                "type": EntityType.WBS_TASK.value,
                "title": r.title,
                "status": r.status.value if r.status else None,
                "progress": r.progress,
                "due_date": r.due_date.strftime("%Y-%m-%d") if r.due_date else None,
            }
            for r in rows
        ]
    except Exception:
        return []
    finally:
        db.close()


def fetch_ws_decisions(
    workspace_id: int, _ws_id: int, ctx: dict | None = None
) -> list[dict]:
    """워크스페이스 전체 결정 사항 (날짜 필터: detected_at 기준)"""
    from app.domains.intelligence.models import Decision
    from app.domains.meeting.models import Meeting

    date_from = _parse_date((ctx or {}).get("date_from"))
    date_to   = _parse_date((ctx or {}).get("date_to"))

    db = SessionLocal()
    try:
        q = (
            db.query(Decision, Meeting.title)
            .join(Meeting, Decision.meeting_id == Meeting.id)
            .filter(Meeting.workspace_id == workspace_id)
        )
        if date_from:
            q = q.filter(Decision.detected_at >= date_from)
        if date_to:
            q = q.filter(Decision.detected_at <= date_to)
        rows = q.order_by(Decision.detected_at.desc()).limit(20).all()
        return [
            {
                "id": decision.id,
                "type": EntityType.DECISION.value,
                "content": decision.content,
                "is_confirmed": decision.is_confirmed,
                "meeting_title": title,
                "detected_at": decision.detected_at.strftime("%Y-%m-%d") if decision.detected_at else None,
            }
            for decision, title in rows
        ]
    except Exception:
        return []
    finally:
        db.close()


# ──────────────────────────────────────────────────────────────────
# ONTOLOGY 레지스트리
#
# 각 Relation이 "어떤 엔티티에서 어떤 엔티티로 어떻게 이동하는가"를
# 선언적으로 정의한다. traverser는 이 목록만 보고 탐색 경로를 결정한다.
#
# weight 가이드:
#   2.0 = 질문 의도와 직결 (결정사항, 태스크)
#   1.8 = 중요도 높음 (태스크 컨텍스트, 담당 태스크)
#   1.5 = 보통 이상 (보고서, 참여 회의, 역방향 회의 추적)
#   1.2 = 맥락용 (참석자, 담당자 역방향)
#   1.0 = 기본값 (워크스페이스 집합, 부서 멤버, 발언자)
#   0.8 = 보조 정보 (stats — 항상 마지막에 읽힘)
# ──────────────────────────────────────────────────────────────────
ONTOLOGY: list[Relation] = [

    # ── User 기점 순방향 ─────────────────────────────────────────
    Relation(
        type=RelationType.HAS_PROFILE,
        from_entity=EntityType.USER,
        to_entity=EntityType.USER,  # terminal: UserProfile 타입 반환 → 추가 탐색 없음
        fetch_fn=fetch_user_profile,
        description="사용자 프로필 정보",
        infer_at_depth=1,
        weight=1.6,  # stats(0.8)보다 높게 — 별자리/이메일/성별 질문에 먼저 노출
    ),
    Relation(
        type=RelationType.PARTICIPATED_IN,
        from_entity=EntityType.USER,
        to_entity=EntityType.MEETING,
        fetch_fn=fetch_user_meetings,
        description="사용자가 참여한 회의",
        infer_at_depth=1,
        weight=1.5,
    ),
    Relation(
        type=RelationType.ASSIGNED_TO,
        from_entity=EntityType.USER,
        to_entity=EntityType.WBS_TASK,
        fetch_fn=fetch_user_tasks,
        description="사용자에게 할당된 태스크",
        infer_at_depth=1,
        weight=1.8,
    ),
    Relation(
        type=RelationType.BELONGS_TO,
        from_entity=EntityType.USER,
        to_entity=EntityType.DEPARTMENT,
        fetch_fn=fetch_user_department,
        description="사용자의 소속 부서",
        infer_at_depth=1,
        weight=1.0,
    ),
    Relation(
        type=RelationType.HAS_STATS,
        from_entity=EntityType.USER,
        to_entity=EntityType.USER,  # terminal: UserStats 타입 반환 → 추가 탐색 없음
        fetch_fn=fetch_user_stats,
        description="사용자 활동 통계",
        infer_at_depth=1,
        weight=0.8,
    ),

    # ── Meeting 기점 순방향 ──────────────────────────────────────
    Relation(
        type=RelationType.HAS_PROFILE,
        from_entity=EntityType.MEETING,
        to_entity=EntityType.MEETING,  # terminal: MeetingProfile 타입 반환
        fetch_fn=fetch_meeting_profile,
        description="회의 기본 정보",
        infer_at_depth=1,
        weight=1.6,
    ),
    Relation(
        type=RelationType.HAS_SUMMARY,
        from_entity=EntityType.MEETING,
        to_entity=EntityType.MEETING,  # terminal: MeetingSummary 타입 반환
        fetch_fn=fetch_meeting_summary,
        description="회의 요약 핵심 포인트",
        infer_at_depth=1,
        weight=1.9,  # HAS_DECISION(2.0) 다음으로 높게 — 요약 질문에 최우선
    ),
    # infer_at_depth=1: Meeting이 직접 seed일 때도 탐색
    Relation(
        type=RelationType.HAS_DECISION,
        from_entity=EntityType.MEETING,
        to_entity=EntityType.DECISION,
        fetch_fn=fetch_meeting_decisions,
        description="회의에서 나온 결정 사항",
        infer_at_depth=1,
        weight=2.0,
    ),
    Relation(
        type=RelationType.HAS_TASK,
        from_entity=EntityType.MEETING,
        to_entity=EntityType.WBS_TASK,
        fetch_fn=fetch_meeting_tasks,
        description="회의에서 생성된 WBS 태스크",
        infer_at_depth=1,
        weight=1.8,
    ),
    Relation(
        type=RelationType.HAS_REPORT,
        from_entity=EntityType.MEETING,
        to_entity=EntityType.REPORT,
        fetch_fn=fetch_meeting_reports,
        description="회의 보고서",
        infer_at_depth=1,
        weight=1.5,
    ),
    Relation(
        type=RelationType.HAS_MEMBER,
        from_entity=EntityType.MEETING,
        to_entity=EntityType.USER,
        fetch_fn=fetch_meeting_members,
        description="회의 참석자",
        infer_at_depth=1,
        weight=1.2,
    ),
    Relation(
        type=RelationType.HAS_STATS,
        from_entity=EntityType.MEETING,
        to_entity=EntityType.MEETING,  # terminal: MeetingStats 타입 반환
        fetch_fn=fetch_meeting_stats,
        description="회의 통계 요약",
        infer_at_depth=1,
        weight=0.8,
    ),

    # ── WbsTask 기점 역방향 ──────────────────────────────────────
    # "이 태스크 어느 회의 거야?", "이 태스크 담당자 누구야?" 처리
    Relation(
        type=RelationType.SOURCE_MEETING,
        from_entity=EntityType.WBS_TASK,
        to_entity=EntityType.MEETING,
        fetch_fn=fetch_task_source_meeting,
        description="태스크가 생성된 회의",
        infer_at_depth=1,
        weight=1.5,
    ),
    Relation(
        type=RelationType.ASSIGNED_BY,
        from_entity=EntityType.WBS_TASK,
        to_entity=EntityType.USER,
        fetch_fn=fetch_task_assignee,
        description="태스크 담당자",
        infer_at_depth=1,
        weight=1.2,
    ),
    Relation(
        type=RelationType.HAS_CONTEXT,
        from_entity=EntityType.WBS_TASK,
        to_entity=EntityType.WBS_TASK,  # terminal: TaskContext 타입 반환
        fetch_fn=fetch_task_context,
        description="태스크 전체 컨텍스트",
        infer_at_depth=1,
        weight=1.8,
    ),

    # ── Decision 기점 역방향 ─────────────────────────────────────
    # "이 결정 어느 회의 거야?", "이 결정 누가 제안했어?" 처리
    Relation(
        type=RelationType.FROM_MEETING,
        from_entity=EntityType.DECISION,
        to_entity=EntityType.MEETING,
        fetch_fn=fetch_decision_meeting,
        description="결정사항이 나온 회의",
        infer_at_depth=1,
        weight=1.5,
    ),
    Relation(
        type=RelationType.PROPOSED_BY,
        from_entity=EntityType.DECISION,
        to_entity=EntityType.USER,
        fetch_fn=fetch_decision_speaker,
        description="결정을 제안한 사람",
        infer_at_depth=1,
        weight=1.0,
    ),
    Relation(
        type=RelationType.HAS_CONTEXT,
        from_entity=EntityType.DECISION,
        to_entity=EntityType.DECISION,  # terminal: DecisionContext 타입 반환
        fetch_fn=fetch_decision_context,
        description="결정사항 전체 컨텍스트",
        infer_at_depth=1,
        weight=1.8,
    ),

    # ── Department 기점 역방향 ───────────────────────────────────
    # "개발팀 구성원 보여줘" 처리
    # depth=2 탐색으로 Department→User→WbsTask 추론 가능
    Relation(
        type=RelationType.HAS_DEPT_MEMBER,
        from_entity=EntityType.DEPARTMENT,
        to_entity=EntityType.USER,
        fetch_fn=fetch_department_members,
        description="부서 소속 멤버",
        infer_at_depth=1,
        weight=1.5,
    ),
    Relation(
        type=RelationType.HAS_STATS,
        from_entity=EntityType.DEPARTMENT,
        to_entity=EntityType.DEPARTMENT,  # terminal: DeptStats 타입 반환
        fetch_fn=fetch_department_stats,
        description="부서 통계",
        infer_at_depth=1,
        weight=0.8,
    ),

    # ── 워크스페이스 집합 관계 ───────────────────────────────────
    Relation(
        type=RelationType.LISTS_MEMBERS,
        from_entity=EntityType.WS_MEMBERS,
        to_entity=EntityType.USER,
        fetch_fn=fetch_ws_members,
        description="워크스페이스 전체 멤버",
        infer_at_depth=1,
        weight=1.0,
    ),
    Relation(
        type=RelationType.LISTS_DEPARTMENTS,
        from_entity=EntityType.WS_DEPARTMENTS,
        to_entity=EntityType.DEPARTMENT,
        fetch_fn=fetch_ws_departments,
        description="워크스페이스 전체 부서",
        infer_at_depth=1,
        weight=1.0,
    ),
    Relation(
        type=RelationType.LISTS_REPORTS,
        from_entity=EntityType.WS_REPORTS,
        to_entity=EntityType.REPORT,
        fetch_fn=fetch_ws_reports,
        description="워크스페이스 전체 보고서",
        infer_at_depth=1,
        weight=1.0,
    ),
    Relation(
        type=RelationType.LISTS_SCHEDULE,
        from_entity=EntityType.WS_SCHEDULE,
        to_entity=EntityType.MEETING,
        fetch_fn=fetch_ws_schedule,
        description="예정된 회의 일정",
        infer_at_depth=1,
        weight=1.0,
    ),
    Relation(
        type=RelationType.LISTS_DEVICE,
        from_entity=EntityType.WS_DEVICE,
        to_entity=EntityType.WS_DEVICE,
        fetch_fn=fetch_ws_device,
        description="장비/환경 설정",
        infer_at_depth=1,
        weight=1.0,
    ),
    Relation(
        type=RelationType.LISTS_INTEGRATION,
        from_entity=EntityType.WS_INTEGRATION,
        to_entity=EntityType.WS_INTEGRATION,
        fetch_fn=fetch_ws_integration,
        description="외부 서비스 연동 상태",
        infer_at_depth=1,
        weight=1.0,
    ),
    Relation(
        type=RelationType.LISTS_TASKS,
        from_entity=EntityType.WS_TASKS,
        to_entity=EntityType.WBS_TASK,
        fetch_fn=fetch_ws_tasks,
        description="워크스페이스 전체 WBS 태스크",
        infer_at_depth=1,
        weight=1.0,
    ),
    Relation(
        type=RelationType.LISTS_DECISIONS,
        from_entity=EntityType.WS_DECISIONS,
        to_entity=EntityType.DECISION,
        fetch_fn=fetch_ws_decisions,
        description="워크스페이스 전체 결정 사항",
        infer_at_depth=1,
        weight=1.0,
    ),
]
