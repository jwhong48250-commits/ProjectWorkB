import json
import logging
import re

from sqlalchemy.orm import Session

from app.domains.intelligence.models import MeetingMinute, MinutePhoto, MinuteStatus
from app.domains.meeting.models import Meeting, MeetingParticipant
from app.domains.notification import service as notification_service
from app.domains.notification.models import NotificationType
from app.domains.user.models import User
from app.utils.time_utils import now_kst
from app.utils.s3_utils import resolve_minute_photo_url

logger = logging.getLogger(__name__)

# LLM 입력 상한 (발화록이 길 때). 나머지 프롬프트·응답 여유를 남긴다.
_MAX_TRANSCRIPT_CHARS = 28_000


def _truncate_transcript(text: str, max_chars: int = _MAX_TRANSCRIPT_CHARS) -> str:
    if len(text) <= max_chars:
        return text
    head_n = (max_chars * 2) // 3
    tail_n = max_chars - head_n - 80
    if tail_n < 500:
        tail_n = 500
    head = text[:head_n]
    tail = text[-tail_n:]
    omitted = len(text) - head_n - tail_n
    return (
        f"{head}\n\n"
        f"... (중간 발화 약 {omitted}자 생략) ...\n\n"
        f"{tail}"
    )


def parse_meeting_minute_summary(raw_summary: str | None) -> dict | None:
    """meeting_minutes.summary(text)를 회의록 포맷 dict로 변환합니다."""
    if not raw_summary or not str(raw_summary).strip():
        return None

    text = str(raw_summary).strip()
    try:
        parsed = json.loads(text)
    except Exception:
        return {"overview_summary": text}

    if not isinstance(parsed, dict):
        return {"overview_summary": text}

    inner = parsed.get("summary")
    if isinstance(inner, dict):
        parsed = inner

    return parsed


async def build_and_save_minutes(
    db: Session,
    meeting_id: int,
) -> MeetingMinute:
    """DB 테이블에서 데이터를 수집하고 LLM으로 회의록을 생성해 저장합니다."""
    from langchain_openai import ChatOpenAI
    from app.core.config import settings
    from app.domains.action.models import WbsEpic, WbsTask, ActionItem
    from app.domains.action import minutes_repository as minutes_repo
    from app.domains.action import mongo_repository as mongo_repo

    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).one_or_none()
    if not meeting:
        raise ValueError(f"회의를 찾을 수 없습니다. (meeting_id: {meeting_id})")

    # ── 기본 메타 ────────────────────────────────────────────────────────
    dt_obj = meeting.started_at or meeting.scheduled_at
    datetime_str = dt_obj.strftime("%Y년 %m월 %d일 %H:%M") if dt_obj else ""
    date_str = dt_obj.strftime("%Y-%m-%d") if dt_obj else ""

    creator = db.query(User).filter(User.id == meeting.created_by).first()
    creator_name = creator.name if creator else ""
    dept_name = (
        minutes_repo.get_dept_name(db, creator, int(meeting.workspace_id))
        if creator
        else ""
    )

    # ── 참석자 ──────────────────────────────────────────────────────────
    attendee_rows = (
        db.query(User.name)
        .join(MeetingParticipant, MeetingParticipant.user_id == User.id)
        .filter(MeetingParticipant.meeting_id == meeting_id)
        .all()
    )
    attendee_names = [row.name for row in attendee_rows if row.name]

    # ── 결정 사항 ────────────────────────────────────────────────────────
    from app.domains.intelligence.models import Decision
    decisions = (
        db.query(Decision)
        .filter(Decision.meeting_id == meeting_id)
        .order_by(Decision.detected_at)
        .all()
    )
    decision_speaker_ids = [d.speaker_id for d in decisions if d.speaker_id]
    decision_speakers: dict[int, str] = {}
    if decision_speaker_ids:
        for u in db.query(User).filter(User.id.in_(decision_speaker_ids)).all():
            decision_speakers[u.id] = u.name or ""

    # ── WBS 에픽/태스크 ──────────────────────────────────────────────────
    epics = (
        db.query(WbsEpic)
        .filter(WbsEpic.meeting_id == meeting_id)
        .order_by(WbsEpic.order_index)
        .all()
    )
    epic_ids = [e.id for e in epics]
    tasks = (
        db.query(WbsTask)
        .filter(WbsTask.epic_id.in_(epic_ids))
        .order_by(WbsTask.order_index)
        .all()
        if epic_ids
        else []
    )

    # ── 액션 아이템 ──────────────────────────────────────────────────────
    action_items_rows = (
        db.query(ActionItem)
        .filter(ActionItem.meeting_id == meeting_id)
        .all()
    )
    action_assignee_ids = [
        a.assignee_id for a in action_items_rows if a.assignee_id
    ]
    action_assignees: dict[int, str] = {}
    if action_assignee_ids:
        users = db.query(User).filter(User.id.in_(action_assignee_ids)).all()
        action_assignees = {u.id: u.name for u in users}

    # ── 사진 ────────────────────────────────────────────────────────────
    existing_minute = (
        db.query(MeetingMinute)
        .filter(MeetingMinute.meeting_id == meeting_id)
        .first()
    )
    photo_urls: list[str] = []
    if existing_minute:
        photos = (
            db.query(MinutePhoto)
            .filter(MinutePhoto.minute_id == existing_minute.id)
            .order_by(MinutePhoto.taken_at.asc())
            .all()
        )
        photo_urls = [
            resolve_minute_photo_url(p.photo_url) for p in photos if p.photo_url
        ]

    # ── 회의 종료 파이프라인이 meeting_minutes.summary에 넣은 JSON ─────────
    pipeline_summary_lines: list[str] = []
    if existing_minute and (existing_minute.summary or "").strip():
        try:
            pipe = json.loads(existing_minute.summary)
            if isinstance(pipe, dict):
                if pipe.get("title"):
                    pipeline_summary_lines.append(
                        f"- 핵심 주제(자동 추출): {pipe['title']}"
                    )
                for i, kp in enumerate(pipe.get("key_points") or [], 1):
                    if str(kp).strip():
                        pipeline_summary_lines.append(f"  {i}. {kp}")
                flags = pipe.get("hallucination_flags") or []
                if flags:
                    pipeline_summary_lines.append("- 검토 플래그(근거 약함으로 표시된 항목):")
                    for f in flags[:10]:
                        pipeline_summary_lines.append(f"  · {f}")
        except json.JSONDecodeError:
            pipeline_summary_lines.append(
                f"- (원문): {(existing_minute.summary or '')[:800]}"
            )

    pipeline_summary_text = (
        "\n".join(pipeline_summary_lines) if pipeline_summary_lines else "(없음)"
    )

    # ── Mongo 발화록 (회의록 논의·개요의 사실 근거) ─────────────────────────
    utterances: list[dict] = []
    try:
        utterances = mongo_repo.get_meeting_utterances(meeting_id)
    except Exception:
        logger.warning(
            "Mongo utterances 조회 실패 (meeting_id=%s), 발화록 없이 진행",
            meeting_id,
            exc_info=True,
        )
    transcript_raw = "\n".join(
        f"[{u.get('speaker_label', '?')}] {(u.get('content') or '').strip()}"
        for u in utterances
        if (u.get("content") or "").strip()
    )
    has_transcript = bool(transcript_raw.strip())

    # 발화가 전혀 없으면 LLM·일시/참석자만 있는 가짜 개요 양식을 쓰지 않는다.
    if not has_transcript:
        logger.info(
            "Mongo 발화가 없어 LLM 회의록 생성을 건너뜁니다. 진행 기록 없음 본문만 저장합니다. meeting_id=%s",
            meeting_id,
        )
        content = _build_no_transcript_minutes()
        now = now_kst()
        if existing_minute:
            existing_minute.content = content
            existing_minute.updated_at = now
            db.commit()
            db.refresh(existing_minute)
            return existing_minute
        minute = MeetingMinute(
            meeting_id=meeting_id,
            content=content,
            status=MinuteStatus.draft,
            created_at=now,
            updated_at=now,
        )
        db.add(minute)
        db.commit()
        db.refresh(minute)
        # 실질 회의록이 없을 때는 '생성 완료' 알림을 보내지 않음
        return minute

    transcript_text = _truncate_transcript(transcript_raw)

    # ── 프롬프트용 텍스트 변환 ───────────────────────────────────────────
    # is_confirmed는 UI 검토 전 기본 False인 경우가 많아, 문구만으로는 합의 여부를 나타내지 않음
    decisions_text = (
        "\n".join(
            f"- {d.content} [is_confirmed={str(d.is_confirmed).lower()}]"
            + (
                f" (발화자: {decision_speakers.get(int(d.speaker_id), '')})"
                if d.speaker_id
                else ""
            )
            for d in decisions
        )
        or "(없음)"
    )
    epic_by_id = {e.id: e for e in epics}
    epics_text = (
        "\n".join(f"- [{e.id}] {e.title} (order={e.order_index})" for e in epics)
        or "(없음)"
    )
    tasks_text = (
        "\n".join(
            f"- [에픽: {epic_by_id.get(t.epic_id).title if epic_by_id.get(t.epic_id) else '?'}] "
            f"[{t.assignee_name or '미정'}] {t.title}"
            f" / 우선순위 {t.priority.value} / 진행 {t.progress}% / 상태 {t.status.value}"
            f" / 기한 ~{t.due_date.isoformat() if t.due_date else '미정'}"
            + (f" / 상세: {t.content.strip()[:400]}" if (t.content or "").strip() else "")
            for t in tasks
        )
        or "(없음)"
    )
    action_items_text = (
        "\n".join(
            f"- {action_assignees.get(a.assignee_id, '미정') if a.assignee_id else '미정'}:"
            f" {a.content}"
            f" (~{a.due_date.isoformat() if a.due_date else '미정'})"
            f" [상태 {a.status.value}]"
            + (f" [우선순위 {a.priority.value}]" if a.priority else "")
            for a in action_items_rows
        )
        or "(없음)"
    )

    dept_author_hint = ""
    if dept_name or creator_name:
        dept_author_hint = f"부서: {dept_name or '-'} / 회의 생성자(작성자 참고): {creator_name or '-'}"

    # ── LLM 호출 ─────────────────────────────────────────────────────────
    llm = ChatOpenAI(model="gpt-4o-mini", api_key=settings.OPENAI_API_KEY)

    prompt = f"""당신은 사내 회의록 작성자입니다. 아래 자료만 근거로 JSON 한 덩어리만 출력하세요. (설명·마크다운·코드펜스 금지)

## 합의·확정 표기 우선순위 (매우 중요)
워크벤치 **회의 노트(/notes) 화면 요약**은 아래 `[회의 핵심 논점 — meeting_minutes.summary]`의 key_points와 동일 출처이며, 사용자가 보는 "회의에서 합의된 내용"입니다.
1) **key_points**와 **발화록**에 확정·합의·담당·일정이 명확하면, 회의록(`overview_summary`, `discussion_items`, `decisions`)에도 **그에 맞게 확정된 결과로 서술**하세요.
2) MySQL `decisions` 각 줄 끝의 `[is_confirmed=false]`는 **UI에서 확정 버튼을 아직 누르지 않은 기술적 플래그**일 뿐이며, **key_points·발화와 모순되면 절대 이유로 삼아 "미확정이다"라고 뒤집지 마세요.**
3) key_points·발화에 근거가 없고 정말로 보류만 언급된 항목만 `pending_items`나 완곡한 미결 표현을 쓰세요.

## 입력 데이터 구분
1. **[회의 핵심 논점 — meeting_minutes.summary]** — 노트 페이지 요약과 동일. **최우선 참고.**
2. **발화록** — 사실 검증·구체 표현.
3. **MySQL decisions / wbs_tasks / action_items** — 반드시 빠짐없이 반영할 **주제·담당·일정**의 원천. 문장 톤(확정 vs 미확정)은 위 우선순위를 따름.

[회의 제목] {meeting.title}
[회의 일시] {datetime_str}  (JSON의 meetings[0].date는 반드시 "{date_str}" 형식 YYYY-MM-DD)
[참석자] {", ".join(attendee_names) or "(없음)"}
[조직·작성자 참고] {dept_author_hint or "(없음)"}

[회의 핵심 논점 — meeting_minutes.summary — 노트 /notes 요약과 동일 출처]
{pipeline_summary_text}

[MySQL decisions — 내용은 모두 반영. is_confirmed는 위 우선순위 참고용]
{decisions_text}

[MySQL wbs_epics]
{epics_text}

[MySQL wbs_tasks]
{tasks_text}

[MySQL action_items]
{action_items_text}

[발화록 Mongo utterances — 최대 약 {_MAX_TRANSCRIPT_CHARS}자, 길면 앞·뒤 유지]
{transcript_text}

## 출력 규칙
- JSON만 출력. 앞뒤에 다른 문자 금지.
- `meetings[0]`: title은 회의 제목과 동일, date는 "{date_str}", attendees는 참석자 이름 배열(위 순서 유지 권장).
- `overview_summary`: 2~4문장, 한국어 공손체(~습니다/~했습니다).
- `agenda_items`: 회의에서 다룬 안건을 짧은 명사구 배열(없으면 key_points·발화·태스크 제목에서 유추, 빈 배열 금지는 아님).
- `discussion_items`: topic+content 쌍. DB 결정·태스크·액션을 **다시 나열만** 하지 말고, **무엇을 왜 논의했는지** 발화·**key_points**에 기반해 서술.
- `decisions`: [MySQL decisions]의 **모든 결정 주제**를 빠짐없이 담되, 문장은 **key_points·발화의 합의 수준**에 맞추세요. key_points에 확정으로 적힌 내용을 "미확정이다"로 바꾸는 것은 **금지**입니다.
- `action_items`: [MySQL action_items]가 비어 있어도 [MySQL wbs_tasks]에서 기한·담당이 있으면 후보로 옮겨 적어도 됩니다. 이미 action_items에 있으면 그대로 반영. assignee는 실명, deadline은 YYYY-MM-DD 또는 null.
- `pending_items`: 미결·보류·추가 확인 필요 사항만. 없으면 [].

반드시 아래 키를 가진 JSON 단일 객체로만 답변하세요.

{{
    "meetings": [{{"title": {json.dumps(meeting.title, ensure_ascii=False)}, "date": "{date_str}", "attendees": {json.dumps(attendee_names, ensure_ascii=False)}}}],
    "overview_summary": "…",
    "agenda_items": ["…"],
    "discussion_items": [{{"topic": "…", "content": "…"}}],
    "decisions": ["…"],
    "action_items": [{{"assignee": "… 또는 null", "content": "…", "deadline": "YYYY-MM-DD 또는 null"}}],
    "pending_items": [{{"content": "…"}}]
}}"""

    try:
        result = await llm.ainvoke(prompt)
        json_match = re.search(r"\{.*\}", result.content, re.DOTALL)
        try:
            summary_dict = json.loads(json_match.group()) if json_match else {}
        except json.JSONDecodeError:
            summary_dict = {}

        content = _format_minutes(summary_dict) or _build_default_minutes(db, meeting_id)
    except Exception:
        logger.exception(
            "LLM 회의록 생성 실패, 기본 회의록으로 대체합니다. (meeting_id=%d)",
            meeting_id,
        )
        content = _build_default_minutes(db, meeting_id)

    # ── DB 저장 ──────────────────────────────────────────────────────────
    now = now_kst()
    if existing_minute:
        existing_minute.content = content
        existing_minute.updated_at = now
        db.commit()
        db.refresh(existing_minute)
        return existing_minute

    minute = MeetingMinute(
        meeting_id=meeting_id,
        content=content,
        status=MinuteStatus.draft,
        created_at=now,
        updated_at=now,
    )
    db.add(minute)
    db.commit()
    db.refresh(minute)

    _notify_participants(db, meeting_id)
    return minute


def _notify_participants(db: Session, meeting_id: int) -> None:
    try:
        meeting = db.query(Meeting).filter(Meeting.id == meeting_id).one_or_none()
        if meeting is None:
            return
        participant_ids = [
            int(uid)
            for (uid,) in db.query(MeetingParticipant.user_id)
            .filter(MeetingParticipant.meeting_id == meeting_id)
            .all()
        ]
        for uid in participant_ids:
            notification_service.create_notification(
                db,
                workspace_id=int(meeting.workspace_id),
                user_id=uid,
                type_=NotificationType.minutes_ready,
                title="회의록 생성 완료",
                body=f"[{meeting.title}] 회의록 초안이 생성되었습니다. 확인해 보세요.",
                link=f"/meetings/{meeting_id}/notes",
                dedupe_key=f"minutes_ready:{meeting_id}",
            )
    except Exception:
        logger.exception("참석자 알림 전송 실패 (meeting_id=%d)", meeting_id)


def _as_dict(item: object, text_key: str = "content") -> dict:
    if isinstance(item, dict):
        return item
    return {text_key: str(item)}


def _build_no_transcript_minutes() -> str:
    """
    Mongo 발화·전사가 없을 때 회의록 본문.
    일시/참석자만 적힌 '가짜 개요'를 만들지 않는다.
    """
    return (
        "## 회의 진행 기록 없음\n\n"
        "녹음·전사된 발화 데이터가 없습니다. **실질적으로 진행된 회의가 없거나**, "
        "음성이 수집되지 않았을 수 있습니다.\n\n"
        "회의실에 입장만 한 뒤 바로 종료한 경우 등에도 이 안내가 표시될 수 있습니다.\n"
    )


def _build_default_minutes(db: Session, meeting_id: int) -> str:
    """DB 정보만으로 기본 양식을 생성합니다. LLM·요약 불필요."""
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()

    lines: list[str] = ["## 개요"]
    if meeting:
        dt_obj = meeting.scheduled_at or meeting.started_at
        lines.append(f"- 일시: {dt_obj.strftime('%Y년 %m월 %d일 %H:%M')}" if dt_obj else "- 일시: ")
        participants = (
            db.query(User.name)
            .join(MeetingParticipant, MeetingParticipant.user_id == User.id)
            .filter(MeetingParticipant.meeting_id == meeting_id)
            .all()
        )
        names = ", ".join(row.name for row in participants if row.name)
        lines.append(f"- 참석자: {names}" if names else "- 참석자: ")
    else:
        lines += ["- 일시: ", "- 참석자: "]

    lines += [
        "",
        "## 논의 사항",
        "",
        "## 결정 사항",
        "",
        "## 액션 아이템",
        "",
        "## 미결/특이 사항",
        "",
    ]
    return "\n".join(lines)


def ensure_minutes(db: Session, meeting_id: int) -> MeetingMinute:
    """기존 회의록을 반환하거나, 없으면 기본 양식으로 생성 후 반환합니다."""
    from app.domains.action import mongo_repository as mongo_repo

    existing = db.query(MeetingMinute).filter(MeetingMinute.meeting_id == meeting_id).first()
    if existing:
        return existing

    try:
        utterances = mongo_repo.get_meeting_utterances(meeting_id)
    except Exception:
        utterances = []
    has_transcript = any((u.get("content") or "").strip() for u in utterances)
    content = (
        _build_default_minutes(db, meeting_id)
        if has_transcript
        else _build_no_transcript_minutes()
    )
    minute = MeetingMinute(
        meeting_id=meeting_id,
        content=content,
        summary="",
        status=MinuteStatus.draft,
        created_at=now_kst(),
        updated_at=now_kst(),
    )
    db.add(minute)
    db.commit()
    db.refresh(minute)
    return minute


def _format_minutes(summary: dict) -> str:
    lines: list[str] = []
    meetings = summary.get("meetings", []) or []
    first_meeting = meetings[0] if meetings and isinstance(meetings[0], dict) else {}

    title = first_meeting.get("title", "")
    date_text = first_meeting.get("date", "")
    attendees = summary.get("attendees", []) or first_meeting.get("attendees", []) or []

    if title:
        lines += ["## 제목", str(title), ""]
    if date_text:
        lines += [f"- 일시: {date_text}"]
    if attendees:
        lines += [f"- 참석자: {', '.join(str(n) for n in attendees if str(n).strip())}"]
    if date_text or attendees:
        lines.append("")

    overview_summary = summary.get("overview_summary", "")
    if overview_summary:
        lines += ["## 개요", str(overview_summary), ""]

    agenda_items = summary.get("agenda_items", []) or []
    if agenda_items:
        lines += ["## 안건"]
        lines.extend(f"{idx}. {str(item)}" for idx, item in enumerate(agenda_items, 1))
        lines.append("")

    discussion_items = summary.get("discussion_items", []) or []
    if discussion_items:
        lines += ["## 논의 사항", ""]
        for raw in discussion_items:
            item = _as_dict(raw, "content")
            topic = str(item.get("topic", "")).strip()
            content = str(item.get("content", "")).strip()
            if topic:
                lines.append(f"### {topic}")
                lines.append("")   # heading 뒤 빈줄 → Python-Markdown이 다음 단락과 구분
            if content:
                lines.append(content)
                lines.append("")   # 내용 뒤 빈줄 → 다음 heading 전 단락 분리
        lines.append("")

    decisions = summary.get("decisions", []) or []
    if decisions:
        lines += ["## 결정 사항"]
        for raw in decisions:
            d = _as_dict(raw, "decision")
            text = str(d.get("decision", "") or d.get("content", "")).strip()
            if text:
                lines.append(f"- {text}")
        lines.append("")

    action_items = summary.get("action_items", []) or []
    if action_items:
        lines += ["## 액션 아이템"]
        for raw in action_items:
            a = _as_dict(raw, "content")
            content = str(a.get("content", "")).strip()
            if not content:
                continue
            assignee = str(a.get("assignee", "") or "").strip()
            deadline = str(a.get("deadline", "") or "").strip()
            prefix = f"{assignee}: " if assignee else ""
            suffix = f" (~{deadline})" if deadline else ""
            lines.append(f"- {prefix}{content}{suffix}")
        lines.append("")

    pending_items = summary.get("pending_items", []) or []
    if pending_items:
        lines += ["## 미결 사항"]
        for raw in pending_items:
            p = _as_dict(raw, "content")
            content = str(p.get("content", "")).strip()
            if content:
                lines.append(f"- {content}")

    return "\n".join(lines)
