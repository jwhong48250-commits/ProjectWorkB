"""
회의 데이터 → MinuteFields 변환.
MongoDB 요약 / DB 마크다운 / 클라이언트 직접 전달 3가지 소스를 단일 모델로 정규화한다.
"""
import re
from dataclasses import dataclass, field
from typing import Any

_SECTION_FIELD_MAP: dict[str, str] = {
    "회의안건": "agenda_items", "회의 안건": "agenda_items", "안건": "agenda_items",
    "회의내용": "discussion_content", "회의 내용": "discussion_content",
    "논의내용": "discussion_content", "논의 내용": "discussion_content",
    "논의 사항": "discussion_content", "논의사항": "discussion_content",
    # minutes_builder._format_minutes / _build_default_minutes 가 쓰는 헤더
    "개요": "discussion_content",
    "제목": "discussion_content",
    "결정사항": "decisions", "결정 사항": "decisions",
    "특이사항": "special_notes", "특이 사항": "special_notes",
    "미결사항": "special_notes", "미결 사항": "special_notes",
    "미결/특이 사항": "special_notes",
    "비고": "special_notes",
    "액션아이템": "action_items", "액션 아이템": "action_items",
}

_META_FIELD_MAP: dict[str, str] = {
    "회의일시": "datetime", "회의 일시": "datetime", "일시": "datetime", "날짜": "datetime",
    "참석자": "attendees",
    "부서": "dept",
    "작성자": "author",
}

_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


@dataclass
class MinuteFields:
    datetime: str = ""
    dept: str = ""
    author: str = ""
    attendees: str = ""
    agenda_items: str = ""
    discussion_content: str = ""
    decision_rows: list[str] = field(default_factory=list)
    action_items: str = ""
    special_notes: str = ""
    photo_urls: list[str] = field(default_factory=list)

    def ensure_min_decision_rows(self, min_rows: int = 3) -> None:
        while len(self.decision_rows) < min_rows:
            self.decision_rows.append("")

    def to_field_values(self) -> dict[str, str]:
        """API 응답용 field_values dict로 변환합니다."""
        dept_author = (
            f"{self.dept}/{self.author}".strip("/") if self.dept else self.author
        )
        decisions = "\n".join(r for r in self.decision_rows if r.strip())
        return {
            "datetime": self.datetime,
            "dept": self.dept,
            "author": self.author,
            "department_author": dept_author,
            "attendees": self.attendees,
            "agenda_items": self.agenda_items,
            "discussion_content": self.discussion_content,
            "decisions": decisions,
            "action_items": self.action_items,
            "special_notes": self.special_notes,
        }


def from_mongo_summary(
    summary: dict,
    meeting_row=None,
    creator_name: str = "",
    dept_name: str = "",
) -> MinuteFields:
    """MongoDB meeting_summaries → MinuteFields"""
    f = MinuteFields()

    meetings_list = summary.get("meetings", [])
    first = (
        meetings_list[0]
        if meetings_list and isinstance(meetings_list[0], dict)
        else {}
    )

    dt = (
        first.get("date")
        or first.get("datetime_str")
        or (summary.get("overview") or {}).get("datetime_str", "")
    )
    location = (
        first.get("location") or (summary.get("overview") or {}).get("location", "")
    )
    db_datetime = ""
    if meeting_row is not None:
        dt_obj = (
            getattr(meeting_row, "scheduled_at", None)
            or getattr(meeting_row, "started_at", None)
        )
        if dt_obj:
            db_datetime = dt_obj.strftime("%Y년 %m월 %d일 %H:%M")

    # 회의 일시는 DB(meetings.scheduled_at)를 우선 사용한다.
    if db_datetime:
        f.datetime = db_datetime
        if location:
            f.datetime += f"\n장소: {location}"
    elif dt:
        dt = str(dt)
        m = _DATE_RE.match(dt)
        if m:
            dt = f"{m.group(1)}년 {int(m.group(2))}월 {int(m.group(3))}일"
        if location:
            dt += f"\n장소: {location}"
        f.datetime = dt

    attendees = first.get("attendees") or summary.get("attendees", [])
    if attendees:
        f.attendees = ", ".join(str(a) for a in attendees)

    f.dept = dept_name
    f.author = creator_name

    agenda_items = summary.get("agenda_items", [])
    if agenda_items:
        f.agenda_items = "\n".join(
            f"{i}. {str(item)}" for i, item in enumerate(agenda_items, 1)
        )

    items = summary.get("discussion_items", [])
    if items:
        agenda_lines: list[str] = []
        content_lines: list[str] = []
        for i, raw in enumerate(items, 1):
            item = raw if isinstance(raw, dict) else {"content": str(raw)}
            topic = item.get("topic") or f"안건 {i}"
            content = item.get("content", "")
            agenda_lines.append(f"{i}. {topic}")
            content_lines.append(f"**{topic}**\n{content}")
        if not f.agenda_items:
            f.agenda_items = "\n".join(agenda_lines)
        f.discussion_content = "\n\n".join(content_lines)

    decisions = summary.get("decisions", [])
    if decisions:
        rows: list[str] = []
        for i, raw in enumerate(decisions, 1):
            d = raw if isinstance(raw, dict) else {"decision": str(raw)}
            text = d.get("decision") or d.get("content", "")
            if d.get("rationale"):
                text += f" (근거: {d['rationale']})"
            rows.append(f"{i}. {text}")
        f.decision_rows = rows

    action_items = summary.get("action_items", [])
    if action_items:
        lines: list[str] = []
        for raw in action_items:
            a = raw if isinstance(raw, dict) else {"content": str(raw)}
            deadline = f" (~{a['deadline']})" if a.get("deadline") else ""
            assignee = a.get("assignee") or ""
            prefix = f"[{assignee}] " if assignee else ""
            lines.append(f"- {prefix}{a.get('content', '')}{deadline}")
        f.action_items = "\n".join(lines)

    pending = summary.get("pending_items", [])
    if pending:
        lines = [
            f"- {(p if isinstance(p, str) else p.get('content', ''))}"
            for p in pending
        ]
        f.special_notes = "\n".join(lines)
    elif summary.get("overview_summary"):
        # pending이 비어있으면 overview를 특이사항에 보강해 빈칸을 줄인다.
        f.special_notes = str(summary.get("overview_summary", ""))

    f.ensure_min_decision_rows()
    return f


def from_markdown_content(
    content: str,
    meeting_row=None,
    creator_name: str = "",
    dept_name: str = "",
) -> MinuteFields:
    """DB meeting_minutes.content (마크다운) → MinuteFields"""
    f = MinuteFields()
    cur_key: str | None = None
    cur_lines: list[str] = []

    def flush() -> None:
        nonlocal cur_key
        if cur_key:
            val = "\n".join(cur_lines).strip()
            if cur_key == "decisions":
                f.decision_rows = [ln for ln in val.split("\n") if ln.strip()]
            elif cur_key == "discussion_content":
                # 여러 섹션(개요 → 논의 사항 등)이 같은 필드를 쓸 때 빈 섹션이 앞내용을 지우지 않게 한다.
                if val:
                    if f.discussion_content.strip():
                        f.discussion_content = (
                            f.discussion_content.strip() + "\n\n" + val
                        )
                    else:
                        f.discussion_content = val
            elif cur_key in ("action_items", "special_notes", "agenda_items"):
                if val or not getattr(f, cur_key, "").strip():
                    setattr(f, cur_key, val)
            elif hasattr(f, cur_key):
                setattr(f, cur_key, val)

    for raw_line in content.splitlines():
        line = raw_line.strip()

        if line.startswith("## "):
            flush()
            heading = line[3:].strip()
            cur_key = _SECTION_FIELD_MAP.get(heading)
            cur_lines = []
            continue

        if line.startswith("# "):
            flush()
            cur_key = None
            cur_lines = []
            continue

        if not cur_key:
            mapped = _SECTION_FIELD_MAP.get(line)
            if mapped:
                flush()
                cur_key = mapped
                cur_lines = []
                continue

        if cur_key is None and ":" in line:
            label, _, val = line.partition(":")
            meta_key = _META_FIELD_MAP.get(label.lstrip("-• ").strip())
            if meta_key and hasattr(f, meta_key):
                setattr(f, meta_key, val.strip())
                continue

        if cur_key:
            cur_lines.append(raw_line)

    flush()

    if not f.datetime and meeting_row is not None:
        dt_obj = (
            getattr(meeting_row, "started_at", None)
            or getattr(meeting_row, "scheduled_at", None)
        )
        if dt_obj:
            f.datetime = dt_obj.strftime("%Y년 %m월 %d일 %H:%M")

    if not f.dept and dept_name:
        f.dept = dept_name
    if not f.author and creator_name:
        f.author = creator_name

    if not f.discussion_content:
        f.discussion_content = content

    f.ensure_min_decision_rows()
    return f


def from_explicit(field_values: dict) -> MinuteFields:
    """클라이언트가 직접 제공한 field_values dict → MinuteFields"""
    f = MinuteFields()

    f.datetime = field_values.get("datetime", "")
    f.attendees = field_values.get("attendees", "")
    f.agenda_items = field_values.get("agenda_items", "")
    f.discussion_content = field_values.get("discussion_content", "")
    f.action_items = field_values.get("action_items", "")
    f.special_notes = field_values.get("special_notes", "")

    # 신규 키(dept/author) 우선, 기존 키(department_author)도 호환 유지
    f.dept = (field_values.get("dept", "") or "").strip()
    f.author = (field_values.get("author", "") or "").strip()
    if not f.dept and not f.author:
        da = (field_values.get("department_author", "") or "").strip()
        if "/" in da:
            f.dept, _, f.author = da.partition("/")
            f.dept, f.author = f.dept.strip(), f.author.strip()
        else:
            f.author = da.strip()

    dec_text = field_values.get("decisions", "")
    f.decision_rows = [ln for ln in dec_text.split("\n") if ln.strip()]

    f.ensure_min_decision_rows()
    return f


def enrich_minute_fields_from_db(
    fields: MinuteFields,
    db: Any,
    meeting_id: int,
) -> MinuteFields:
    """회의일시·부서·작성자·참석자가 비어 있으면 MySQL meetings / participants 로 보강."""
    from app.domains.action import repository as action_repo
    from app.domains.action import minutes_repository as minutes_repo
    from app.domains.meeting.models import MeetingParticipant
    from app.domains.user.models import User

    meeting_row = action_repo.get_meeting(db, meeting_id)
    if not meeting_row:
        return fields
    if not fields.datetime.strip():
        dt_obj = meeting_row.started_at or meeting_row.scheduled_at
        if dt_obj:
            fields.datetime = dt_obj.strftime("%Y년 %m월 %d일 %H:%M")
    if not fields.dept.strip() or not fields.author.strip():
        user = action_repo.get_user(db, meeting_row.created_by)
        if user:
            if not fields.dept.strip():
                fields.dept = minutes_repo.get_dept_name(
                    db, user, int(meeting_row.workspace_id)
                )
            if not fields.author.strip():
                fields.author = user.name
    if not fields.attendees.strip():
        names = [
            n
            for (n,) in db.query(User.name)
            .join(MeetingParticipant, MeetingParticipant.user_id == User.id)
            .filter(MeetingParticipant.meeting_id == meeting_id)
            .order_by(MeetingParticipant.id)
            .all()
            if n
        ]
        if names:
            fields.attendees = ", ".join(names)
    return fields
