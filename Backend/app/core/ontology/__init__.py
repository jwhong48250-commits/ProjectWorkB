from __future__ import annotations
import re
import logging
from sqlalchemy import text
from app.core.ontology.schema import EntityType, ExtractionResult
from app.core.ontology.traverser import OntologyTraverser
from app.core.ontology.formatter import graph_to_text
from app.utils.time_utils import now_kst

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────
# LLM 기반 seed 해소
# ──────────────────────────────────────────────────────────────────

# PK 탐색용 최소 스키마 (LLM에 노출)
_SEED_SCHEMA = """
users(id, name, email, role)
  → workspace 범위: JOIN workspace_members wm ON wm.user_id = users.id
                    WHERE wm.workspace_id = {workspace_id}
meetings(id, workspace_id, title, scheduled_at)
wbs_tasks(id, title, epic_id)
  → workspace 범위: JOIN wbs_epics ep ON ep.id = wbs_tasks.epic_id
                    JOIN meetings m ON m.id = ep.meeting_id
                    WHERE m.workspace_id = {workspace_id}
departments(id, workspace_id, name)
decisions(id, meeting_id, content)
  → workspace 범위: JOIN meetings m ON m.id = decisions.meeting_id
                    WHERE m.workspace_id = {workspace_id}
""".strip()

_SEED_FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE)\b",
    re.IGNORECASE,
)

# 자기 참조 키워드 — user_id 직접 주입
_SELF_REF_TERMS = ["나는", "난 ", "나의", "내가", "나에게", "나한테", "뭘 해야", "내 할 일", "내 태스크", "내 일정"]


async def resolve_seed_with_llm(
    entity_type: str, identifier: str, workspace_id: int, llm
) -> int | None:
    """
    LLM이 최소 SQL을 생성해 엔티티 PK를 해소한다.

    고정된 ilike 패턴 대신 LLM이 식별자 형태(이름/이메일/내용/역할 등)에
    맞는 컬럼·테이블을 스스로 선택하므로 어떤 식별자도 처리 가능.

    안전 장치:
      - DML/DDL 차단
      - workspace_id 격리 검증
      - 결과는 id 1개만 반환
    """
    schema = _SEED_SCHEMA.format(workspace_id=workspace_id)

    prompt = f"""다음 엔티티의 id(PK)를 찾는 SQL SELECT 문을 작성하세요.

엔티티 타입: {entity_type}
식별자(identifier): {identifier}
workspace_id: {workspace_id}

{schema}

규칙:
1. SELECT id 만 조회
2. LIMIT 1 필수
3. workspace_id = {workspace_id} 범위 격리 필수
4. 이름 검색은 LIKE '%{identifier}%', 이메일은 exact match
5. SQL 코드블록(```sql ... ```) 안에만 작성"""

    try:
        response = await llm.ainvoke(prompt)
        sql = _extract_seed_sql(response.content)
        if not sql:
            return None
        if _SEED_FORBIDDEN.search(sql):
            logger.warning("[Ontology] seed SQL contains forbidden keyword: %s", sql[:100])
            return None
        # workspace 격리 확인 — users 단독 조회 시 workspace_members JOIN 필요
        if "workspace_id" not in sql.lower() and "workspace_members" not in sql.lower():
            logger.warning("[Ontology] seed SQL missing workspace filter: %s", sql[:100])
            return None
        return _execute_seed_sql(sql)
    except Exception as e:
        logger.debug("[Ontology] resolve_seed_with_llm failed: %s", e)
        return None


def _extract_seed_sql(content: str) -> str:
    m = re.search(r"```(?:sql)?\s*(SELECT[\s\S]+?)```", content, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    m = re.search(r"(SELECT\s[\s\S]+?)(?:;|\Z)", content, re.IGNORECASE)
    return m.group(1).strip() if m else ""


def _execute_seed_sql(sql: str) -> int | None:
    from app.infra.database.session import SessionLocal

    db = SessionLocal()
    try:
        result = db.execute(text(sql))
        row = result.fetchone()
        return int(row[0]) if row and row[0] is not None else None
    except Exception as e:
        logger.debug("[Ontology] seed SQL execute failed: %s", e)
        return None
    finally:
        db.close()


# Literal → EntityType 매핑 (schema.py의 WsCategoryLiteral과 1:1 대응)
_WS_ENTITY_MAP: dict[str, EntityType] = {
    "WS_MEMBERS":     EntityType.WS_MEMBERS,
    "WS_DEPARTMENTS": EntityType.WS_DEPARTMENTS,
    "WS_REPORTS":     EntityType.WS_REPORTS,
    "WS_SCHEDULE":    EntityType.WS_SCHEDULE,
    "WS_DEVICE":      EntityType.WS_DEVICE,
    "WS_INTEGRATION": EntityType.WS_INTEGRATION,
    "WS_TASKS":       EntityType.WS_TASKS,
    "WS_DECISIONS":   EntityType.WS_DECISIONS,
}


def _infer_max_depth(question: str) -> int:
    """
    질문 복잡도에 따라 온톨로지 탐색 깊이를 동적으로 결정한다.

    depth=2 (기본값):
        대부분의 질문. seed → 이웃 → 이웃의 이웃 (2홉).
        "조수민 참여 회의 결정사항" → User→Meeting(1)→Decision(2)
        "개발팀 멤버 태스크"        → Department→User(1)→WbsTask(2)

    depth=3 (확장):
        3개 이상 엔티티 타입을 가로지르는 복합 질문.
        "개발팀 사람들이 담당한 태스크의 회의" →
            Department→User(1)→WbsTask(2)→Meeting(3)
        보수적으로 유지: depth 증가 시 컨텍스트 토큰 급증.
    """
    depth3_patterns = [
        # "팀/부서 + 사람들/구성원 + 태스크/회의/결정" 패턴
        r"(팀|부서).{0,10}(사람|구성원|멤버).{0,10}(태스크|WBS|결정|회의|보고서)",
        # "담당한 태스크 + 의 + 회의/결정" 역추적 3홉 패턴
        r"담당.{0,10}(태스크|WBS).{0,10}(회의|결정|보고서)",
    ]
    for pattern in depth3_patterns:
        if re.search(pattern, question):
            return 3
    return 2


async def build_ontology_context(
    question: str,
    workspace_id: int,
    llm,
    user_id: int | None = None,
    active_meeting_ids: list[int] | None = None,
) -> str:
    """
    질문 → 온톨로지 컨텍스트 텍스트 생성 메인 진입점.

    처리 흐름:
    1. llm.with_structured_output(ExtractionResult)로 엔티티 + 카테고리 + 날짜 추출
    2. seed_entities 구성:
       - 자기 참조("나", "내가" 등) + user_id → User seed 직접 주입 (SQL 불필요)
       - 단건 엔티티: resolve_seed_with_llm()으로 LLM이 최소 SQL 생성 → PK 해소
         (이름·이메일·역할 등 어떤 식별자도 LLM이 컬럼 선택, ilike 고정 없음)
       - WS_* 카테고리: entity_id = workspace_id (전체 목록 fetch)
    3. _infer_max_depth(question)으로 탐색 깊이 동적 결정
    4. OntologyTraverser로 그래프 탐색 (seed PK 이후는 온톨로지가 전담)
    5. graph_to_text()로 LLM 프롬프트용 텍스트 변환 후 반환

    반환값: knowledge_node의 system_prompt에 주입되는 컨텍스트 문자열.
    엔티티가 전혀 감지되지 않으면 빈 문자열 반환.
    """

    # ── Step 1: Structured Output으로 추출 (LLM 1회 호출) ────────
    structured_llm = llm.with_structured_output(ExtractionResult)

    today_str = now_kst().strftime("%Y-%m-%d")
    extraction_prompt = f"""
    오늘 날짜: {today_str}

    다음 질문에서 아래 정보를 추출하세요.

    질문: {question}

    entities 규칙:
    - 질문에 사람 이름이 있으면 type=User로 추가
        주의: "님", "씨", "팀장", "대리" 등 경칭이 붙은 명사는 사람 이름입니다.
        주의: "XXX에 대해", "XXX가 누구", "XXX는 어떤 사람" 패턴도 사람 이름입니다.
        예) "대중님에 대해 알려줘"   → entities: [{{type:User, name:"대중님"}}]
        예) "조수민 어떤 사람이야"   → entities: [{{type:User, name:"조수민"}}]
    - 질문에 회의 이름이 있으면 type=Meeting으로 추가
        주의: "WBS", "결정사항", "보고서", "요약", "태스크" 바로 앞에 오는 명사/명사구는
            회의 이름일 가능성이 높습니다. 반드시 Meeting으로 추가하세요.
        예) "오프라인 다시 테스트 WBS 알려줘"     → entities: [{{type:Meeting, name:"오프라인 다시 테스트"}}]
        예) "4월 기획 미팅 결정사항 보여줘"       → entities: [{{type:Meeting, name:"4월 기획 미팅"}}]
        예) "UI 개편 회의 요약해줘"              → entities: [{{type:Meeting, name:"UI 개편 회의"}}]
    - 질문에 특정 태스크/WBS 항목 이름이 있으면 type=WbsTask로 추가
        (예: "UI 개선 태스크 상태 어때?" → name="UI 개선", type=WbsTask)
    - 질문에 부서/팀 이름이 있으면 type=Department로 추가
        (예: "개발팀 구성원 보여줘" → name="개발팀", type=Department)
    - 질문에 특정 결정사항 내용이 언급되면 type=Decision으로 추가
    - 이름이 없으면 빈 배열

    workspace_categories 규칙 (해당하는 항목만 포함):
    - 멤버/팀원/인원/구성원/누가 있어 → WS_MEMBERS
    - 일정/예정/미팅/스케줄/언제 → WS_SCHEDULE
    - 연동/연결/Jira/Slack/캘린더/Google → WS_INTEGRATION
    - 장비/마이크/카메라/설정/디바이스 → WS_DEVICE
    - 태스크/WBS/할 일/작업/진행률 (특정 이름 없이 전체 조회) → WS_TASKS
    - 결정/확정/합의/결정사항 (특정 이름 없이 전체 조회) → WS_DECISIONS
    - 보고서/회의록/리포트 → WS_REPORTS
    - 부서/팀/조직 (특정 이름 없이 전체 조회) → WS_DEPARTMENTS
    - 해당 없으면 빈 배열

    date 규칙:
    - "지난달" → 이전 달 1일~말일 계산해서 YYYY-MM-DD 형식으로
    - "이번 주" → 이번 주 월요일~일요일
    - "오늘" → 오늘 날짜 하루
    - 날짜 언급 없으면 null
    """

    try:
        result: ExtractionResult = await structured_llm.ainvoke(extraction_prompt)
    except Exception as e:
        import logging as _log
        _log.getLogger(__name__).warning("[Ontology] structured output failed: %s", e)
        return ""

    import logging as _log
    _log.getLogger(__name__).warning(
        "[Ontology] extracted entities=%s categories=%s",
        [(e.type, e.name) for e in result.entities],
        result.workspace_categories,
    )

    ctx = {"date_from": result.date_from, "date_to": result.date_to}

    # ── Step 2: seed_entities 구성 ────────────────────────────────
    seed_entities: list[dict] = []

    # 자기 참조("나", "내가", ...) → user_id를 직접 seed로 주입
    if user_id and any(term in question for term in _SELF_REF_TERMS):
        seed_entities.append({
            "id": user_id,
            "type": EntityType.USER.value,
            "name": "나",
            "ctx": ctx,
        })

    # active_meeting_ids가 있으면 Meeting seed로 직접 주입 (LLM 추출 없이)
    added_meeting_ids: set[int] = set()
    if active_meeting_ids:
        for mid in active_meeting_ids:
            seed_entities.append({
                "id": mid,
                "type": EntityType.MEETING.value,
                "name": f"Meeting#{mid}",
                "ctx": ctx,
            })
            added_meeting_ids.add(mid)

    import asyncio

    if result.entities:
        resolved_ids = await asyncio.gather(*[
            resolve_seed_with_llm(ent.type, ent.name, workspace_id, llm)
            for ent in result.entities
        ])
        for ent, resolved_id in zip(result.entities, resolved_ids):
            # active_meeting_ids로 이미 추가된 Meeting이면 skip
            if ent.type == "Meeting" and resolved_id in added_meeting_ids:
                continue
            seed_entities.append({
                "id": resolved_id,
                "type": ent.type,
                "name": ent.name,
                "ctx": ctx,
            })

    added_ws_types: set[str] = set()
    for category in result.workspace_categories:
        ws_type = _WS_ENTITY_MAP[category]
        if ws_type.value not in added_ws_types:
            seed_entities.append({
                "id": workspace_id,
                "type": ws_type.value,
                "name": ws_type.value,
                "ctx": ctx,
            })
            added_ws_types.add(ws_type.value)

    if not seed_entities:
        return ""

    # ── Step 3: 탐색 깊이 동적 결정 ─────────────────────────────
    max_depth = _infer_max_depth(question)

    # ── Step 4: 그래프 탐색 ───────────────────────────────────────
    traverser = OntologyTraverser(max_depth=max_depth)
    graph = traverser.traverse(seed_entities, workspace_id)

    if not graph:
        return ""

    # ── Step 5: 텍스트 변환 ───────────────────────────────────────
    return graph_to_text(graph)
