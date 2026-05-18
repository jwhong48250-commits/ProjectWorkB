from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Literal
from pydantic import BaseModel


# ──────────────────────────────────────────────────────────────────
# EntityType: 온톨로지에서 다루는 "엔티티(개체)" 종류
#
# 두 가지 범주로 나뉜다:
#
# [단건 엔티티] 질문에서 이름이 언급된 특정 개체
#   → LLM이 이름을 추출 → _resolve_entity_id로 DB PK 해소
#   → traverser가 해당 PK에서 출발해 관계를 탐색
#
# [워크스페이스 집합 엔티티] 카테고리 키워드로 트리거
#   → "장비 설정 알려줘" → WS_DEVICE
#   → entity_id 자리에 workspace_id를 넣어 전체 목록을 fetch
# ──────────────────────────────────────────────────────────────────
class EntityType(str, Enum):
    # ── 단건 엔티티 ─────────────────────────────────────────────
    USER       = "User"
    MEETING    = "Meeting"
    DECISION   = "Decision"
    WBS_TASK   = "WbsTask"
    DEPARTMENT = "Department"
    REPORT     = "Report"

    # ── 워크스페이스 집합 엔티티 ────────────────────────────────
    WS_MEMBERS     = "WsMembers"
    WS_DEPARTMENTS = "WsDepartments"
    WS_REPORTS     = "WsReports"
    WS_SCHEDULE    = "WsSchedule"
    WS_DEVICE      = "WsDevice"
    WS_INTEGRATION = "WsIntegration"
    WS_TASKS       = "WsTasks"
    WS_DECISIONS   = "WsDecisions"


# ──────────────────────────────────────────────────────────────────
# RelationType: 엔티티 간 방향성 관계 종류
#
# 세 가지 범주:
#   [순방향]  source → target 자연스러운 방향 (User→Meeting, Meeting→Decision)
#   [역방향]  target → source 역추적 (WbsTask→Meeting, Decision→User)
#   [집합]    워크스페이스 전체 목록 조회
#   [집계]    통계/요약 (terminal node — 이 타입에서 출발하는 관계 없음)
# ──────────────────────────────────────────────────────────────────
class RelationType(str, Enum):
    # ── 순방향 ──────────────────────────────────────────────────
    PARTICIPATED_IN = "participated_in"   # User → Meeting
    ASSIGNED_TO     = "assigned_to"       # User → WbsTask
    BELONGS_TO      = "belongs_to"        # User → Department
    HAS_TASK        = "has_task"          # Meeting → WbsTask
    HAS_DECISION    = "has_decision"      # Meeting → Decision
    HAS_REPORT      = "has_report"        # Meeting → Report
    HAS_MEMBER      = "has_member"        # Meeting → User

    # ── 역방향 ──────────────────────────────────────────────────
    # 이 관계들 덕분에 WbsTask·Decision·Department를 seed로 역추적 가능
    SOURCE_MEETING  = "source_meeting"    # WbsTask  → Meeting (WbsEpic 경유)
    ASSIGNED_BY     = "assigned_by"       # WbsTask  → User   (담당자 역방향)
    FROM_MEETING    = "from_meeting"      # Decision → Meeting (역방향)
    PROPOSED_BY     = "proposed_by"       # Decision → User   (발언자 역방향)
    HAS_DEPT_MEMBER = "has_dept_member"   # Department → User (부서 멤버 역방향)

    # ── 집계 (terminal) ─────────────────────────────────────────
    # 이 타입에서 출발하는 ONTOLOGY 항목이 없으므로 traverser가 자동 종료
    HAS_PROFILE  = "has_profile"   # User → 프로필 속성 (birth_date, email, gender 등)
    HAS_STATS    = "has_stats"     # User / Meeting / Department → Stats 요약
    HAS_CONTEXT  = "has_context"   # WbsTask / Decision → 컨텍스트 요약
    HAS_SUMMARY  = "has_summary"   # Meeting → 회의 요약 key_points (terminal)

    # ── 워크스페이스 집합 ────────────────────────────────────────
    LISTS_MEMBERS     = "lists_members"
    LISTS_DEPARTMENTS = "lists_departments"
    LISTS_REPORTS     = "lists_reports"
    LISTS_SCHEDULE    = "lists_schedule"
    LISTS_DEVICE      = "lists_device"
    LISTS_INTEGRATION = "lists_integration"
    LISTS_TASKS       = "lists_tasks"
    LISTS_DECISIONS   = "lists_decisions"


# ──────────────────────────────────────────────────────────────────
# Relation: 관계 하나를 선언적으로 표현하는 데이터 구조
#
# from_entity -[type]-> to_entity 방향으로
# fetch_fn(entity_id, workspace_id, ctx) 를 호출하면
# 연결된 엔티티 목록을 DB에서 가져온다.
# ──────────────────────────────────────────────────────────────────
@dataclass
class Relation:
    type: RelationType
    from_entity: EntityType
    to_entity: EntityType
    fetch_fn: Callable[[int, int], list[dict]]
    description: str       # 사람이 읽는 설명 (formatter / 디버깅용)

    # infer_at_depth:
    #   "이 관계는 depth ≥ N 일 때만 탐색한다"는 Circuit Breaker.
    #   depth=1: seed에서 바로 탐색 (기본, 대부분의 관계)
    #   depth=2: 2홉 이상에서만 탐색 (데이터 폭발 방지용)
    infer_at_depth: int = field(default=1)

    # weight:
    #   같은 depth에서 여러 관계를 탐색할 때 우선순위.
    #   traverser가 내림차순 정렬 후 처리 → 높을수록 LLM이 먼저 읽음.
    weight: float = field(default=1.0)


# ──────────────────────────────────────────────────────────────────
# LLM Structured Output 스키마
#
# build_ontology_context에서 llm.with_structured_output()에 전달.
# LLM이 질문에서 추출해야 할 정보를 Pydantic으로 강제한다.
# ──────────────────────────────────────────────────────────────────

# workspace_categories 허용값
WsCategoryLiteral = Literal[
    "WS_MEMBERS",
    "WS_DEPARTMENTS",
    "WS_REPORTS",
    "WS_SCHEDULE",
    "WS_DEVICE",
    "WS_INTEGRATION",
    "WS_TASKS",
    "WS_DECISIONS",
]


class ExtractedEntity(BaseModel):
    name: str
    # 기존 User / Meeting 에 WbsTask · Department · Decision 추가.
    # WbsTask:   "UI 개선 태스크 상태 어때?"    → {type: WbsTask,   name: "UI 개선"}
    # Department:"개발팀 구성원 보여줘"         → {type: Department, name: "개발팀"}
    # Decision:  특정 결정사항 내용이 언급될 때
    type: Literal["User", "Meeting", "WbsTask", "Department", "Decision"]


class ExtractionResult(BaseModel):
    entities: list[ExtractedEntity]               # 질문에 언급된 구체적 개체
    workspace_categories: list[WsCategoryLiteral] # 집합 조회 카테고리
    date_from: str | None                         # YYYY-MM-DD 또는 None
    date_to:   str | None
