from __future__ import annotations
import logging
import re
from app.core.ontology.schema import EntityType, Relation
from app.core.ontology.fetchers import ONTOLOGY
from app.infra.database.session import SessionLocal

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────
# 이름 정규화
# ──────────────────────────────────────────────────────────────────

def _normalize_name(name: str) -> str:
    """
    한국어 이름/제목에서 조사·경칭을 제거하고 공백을 정규화한다.

    _resolve_entity_id에서 ilike 검색 전에 호출해
    "00이", "00 씨", "기획  회의" 같은 변형도 DB에서 매칭되게 한다.

    처리 순서:
      1. 경칭 제거 (긴 것 우선: "팀장님" → "팀장" 오탐 방지)
      2. 조사 제거 (이름 최소 길이 2자 보장 → "이" 단독 이름 보호)
      3. 연속 공백 → 단일 공백

    예)
      "00이"     → "00"
      "000 씨"  → "000"
      "개발팀이"   → "개발팀"
      "기획  회의" → "기획 회의"
    """
    name = name.strip()

    # 1. 경칭 (긴 것 먼저 — "팀장님"이 "님"보다 먼저 매칭돼야 함)
    for suffix in ["팀장님", "대리님", "과장님", "부장님", "팀장", "대리", "과장", "부장", "님", "씨"]:
        if name.endswith(suffix) and len(name) > len(suffix):
            name = name[: -len(suffix)].strip()
            break  # 경칭은 하나만 제거

    # 2. 조사 (이름이 최소 3자 이상일 때만 제거 — 2자 이름의 마지막 글자 보호)
    for suffix in ["이가", "이는", "이랑", "이를", "이고", "이", "가", "은", "는", "를", "랑"]:
        if name.endswith(suffix) and len(name) > len(suffix) + 1:
            name = name[: -len(suffix)].strip()
            break  # 조사도 하나만 제거

    # 3. 연속 공백 정규화
    name = re.sub(r"\s+", " ", name)
    return name


# ──────────────────────────────────────────────────────────────────
# 엔티티 이름 → DB PK 해소
# ──────────────────────────────────────────────────────────────────

def _resolve_entity_id(
    entity_type: EntityType, name: str, workspace_id: int
) -> int | None:
    """
    엔티티 이름(name) → PK(id) 해소.

    LLM이 추출한 이름("000", "오프라인 테스트")을 실제 DB PK로 변환한다.
    fetch_fn에 PK를 넘겨야 하므로 필수 단계.

    지원 엔티티:
      USER       → users.name  ilike
      MEETING    → meetings.title ilike + workspace_id 필터
      WBS_TASK   → wbs_tasks.title ilike + workspace 경유 필터 (신규)
      DEPARTMENT → departments.name ilike + workspace_id 필터 (신규)
      DECISION   → decisions.content ilike + workspace 경유 필터 (신규)

    이름 정규화(_normalize_name)로 조사·경칭 변형도 처리.
    """
    norm = _normalize_name(name)

    db = SessionLocal()
    try:
        if entity_type == EntityType.USER:
            from app.domains.user.models import User

            # 1차: 이름 ilike 검색
            row = db.query(User.id).filter(User.name.ilike(f"%{norm}%")).first()
            if row:
                return row.id

            # 2차: 이메일 exact 매칭 (추출된 name이 이메일 형식인 경우)
            if "@" in norm:
                row = db.query(User.id).filter(User.email == norm).first()
            return row.id if row else None

        if entity_type == EntityType.MEETING:
            from app.domains.meeting.models import Meeting

            row = (
                db.query(Meeting.id)
                .filter(
                    Meeting.title.ilike(f"%{norm}%"),
                    Meeting.workspace_id == workspace_id,
                )
                .order_by(Meeting.scheduled_at.desc())
                .first()
            )
            return row.id if row else None

        if entity_type == EntityType.WBS_TASK:
            # WbsTask.meeting_id 없음 → WbsEpic.meeting_id → Meeting.workspace_id 경유
            from app.domains.action.models import WbsTask, WbsEpic
            from app.domains.meeting.models import Meeting

            row = (
                db.query(WbsTask.id)
                .join(WbsEpic, WbsTask.epic_id == WbsEpic.id)
                .join(Meeting, WbsEpic.meeting_id == Meeting.id)
                .filter(
                    WbsTask.title.ilike(f"%{norm}%"),
                    Meeting.workspace_id == workspace_id,
                )
                .first()
            )
            return row.id if row else None

        if entity_type == EntityType.DEPARTMENT:
            from app.domains.workspace.models import Department

            row = (
                db.query(Department.id)
                .filter(
                    Department.name.ilike(f"%{norm}%"),
                    Department.workspace_id == workspace_id,
                )
                .first()
            )
            return row.id if row else None

        if entity_type == EntityType.DECISION:
            # 결정사항 내용 일부로 역검색
            from app.domains.intelligence.models import Decision
            from app.domains.meeting.models import Meeting

            row = (
                db.query(Decision.id)
                .join(Meeting, Decision.meeting_id == Meeting.id)
                .filter(
                    Decision.content.ilike(f"%{norm}%"),
                    Meeting.workspace_id == workspace_id,
                )
                .first()
            )
            return row.id if row else None

    except Exception:
        return None
    finally:
        db.close()

    return None


# ──────────────────────────────────────────────────────────────────
# OntologyTraverser
# ──────────────────────────────────────────────────────────────────

class OntologyTraverser:
    """
    지식 그래프 탐색기.

    seed 엔티티(들)에서 출발해 ONTOLOGY에 정의된 관계를 따라
    최대 max_depth 홉까지 관련 데이터를 자동으로 수집한다.

    핵심 알고리즘:
    1. seed 엔티티를 큐에 넣는다.
    2. 현재 엔티티 타입에서 출발하는 관계를 ONTOLOGY에서 찾는다.
    3. 관계를 weight 내림차순으로 정렬 (중요한 관계를 먼저 처리)
    4. infer_at_depth <= current_depth 조건을 만족하는 관계만 탐색
    5. fetch_fn(entity_id, workspace_id, ctx)를 호출해 데이터 수집.
    6. 수집된 데이터를 새 엔티티로 간주해 다음 depth 탐색.
    7. visited 셋으로 순환 참조 방지.
    8. 추론 결과를 root 엔티티의 "_inferred" 딕셔너리에 누적.

    결과 그래프 구조:
    [
        {
            "id": 42,
            "type": "User",
            "name": "000",
            "_relations": {                              ← depth=1 직접 관계
                "사용자가 참여한 회의": [...meetings],
                "사용자에게 할당된 태스크": [...tasks],
                "사용자 활동 통계": [{meetings_count:5, tasks_count:8, ...}],
            },
            "_inferred": {                               ← depth=2 추론 관계
                "회의에서 나온 결정 사항 (via 사용자가 참여한 회의)": [...],
            }
        },
    ]
    """

    def __init__(self, max_depth: int = 2):
        self.max_depth = max_depth

    def traverse(
        self,
        seed_entities: list[dict],
        workspace_id: int,
    ) -> list[dict]:
        """
        seed_entities: [{"id": int, "type": str, "name": str, "ctx": dict}, ...]
          - id   : 엔티티 PK (None이면 name으로 해소 시도)
          - type : EntityType enum 문자열 값
          - name : 엔티티 이름 (id 해소 실패 시 로그용)
          - ctx  : {"date_from": ..., "date_to": ...} 날짜 필터

        반환: root 엔티티에 _relations, _inferred가 채워진 리스트
        """
        result = []

        for seed in seed_entities:
            entity_id   = seed.get("id")
            entity_type = seed.get("type")
            ctx         = seed.get("ctx") or {}

            # id가 없으면 이름으로 DB 해소 시도
            if not entity_id and seed.get("name"):
                entity_id = _resolve_entity_id(
                    EntityType(entity_type),
                    seed["name"],
                    workspace_id,
                )
                if entity_id:
                    logger.debug(
                        "[Ontology] resolved %s(%r) → id=%s",
                        entity_type, seed["name"], entity_id,
                    )
                else:
                    logger.debug(
                        "[Ontology] resolve failed: %s(%r) — seed skipped",
                        entity_type, seed["name"],
                    )

            if not entity_id:
                continue  # 해소 실패 — 이 seed는 건너뜀

            root = {**seed, "id": entity_id, "_relations": {}, "_inferred": {}}
            visited: set[tuple] = {(entity_type, entity_id)}

            self._explore(
                entity=root,
                workspace_id=workspace_id,
                depth=1,
                visited=visited,
                ctx=ctx,
                root=root,
                via_description=None,
                via_relation=None,
            )
            result.append(root)

        return result

    def _explore(
        self,
        entity: dict,
        workspace_id: int,
        depth: int,
        visited: set,
        ctx: dict,
        root: dict,
        via_description: str | None,
        via_relation: str | None,
    ) -> None:
        if depth > self.max_depth:
            return

        # 이 엔티티 타입에서 출발하는 관계 목록
        # infer_at_depth <= depth 조건으로 Circuit Breaker 적용
        relations: list[Relation] = [
            r
            for r in ONTOLOGY
            if r.from_entity.value == entity["type"]
            and r.infer_at_depth <= depth
        ]
        relations.sort(key=lambda r: r.weight, reverse=True)

        for relation in relations:
            try:
                children = relation.fetch_fn(entity["id"], workspace_id, ctx)
            except Exception as e:
                # 조용히 넘기지 않고 debug 로그로 남김 → 문제 추적 가능
                logger.debug(
                    "[Ontology] fetch_fn error: %s(%s) → %s: %s",
                    entity["type"], entity["id"], relation.description, e,
                )
                children = []

            logger.debug(
                "[Ontology] %s(%s) → %s: %d건",
                entity["type"], entity["id"], relation.description, len(children),
            )

            if not children:
                continue

            # depth=1: 직접 연결 → _relations
            # depth>=2: 추론 결과 → _inferred
            if depth == 1:
                root["_relations"][relation.description] = children
            else:
                inferred_key = (
                    f"{relation.description} (via {via_description})"
                    if via_description
                    else relation.description
                )
                existing = {
                    item["id"]
                    for item in root["_inferred"].get(inferred_key, [])
                    if item.get("id")  # terminal node는 id 없을 수 있음
                }
                new_items = [c for c in children if c.get("id") not in existing]
                if new_items:
                    root["_inferred"].setdefault(inferred_key, []).extend(new_items)

            # 다음 depth 탐색
            # terminal 타입(UserStats, MeetingStats 등)은 ONTOLOGY에
            # from_entity로 등록되지 않으므로 _explore 진입 후 relations=[] → 자동 종료
            for child in children:
                child_key = (child.get("type"), child.get("id"))
                if child_key in visited:
                    continue
                visited.add(child_key)
                self._explore(
                    entity=child,
                    workspace_id=workspace_id,
                    depth=depth + 1,
                    visited=visited,
                    ctx=ctx,
                    root=root,
                    via_description=relation.description,
                    via_relation=relation.type.value,
                )
