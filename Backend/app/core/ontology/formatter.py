from typing import Any


def graph_to_text(graph: list[dict]) -> str:
    """
    traverser가 반환한 그래프를 LLM 프롬프트용 텍스트로 반환한다.

    출력 구조:
        [엔티티 타입] 엔티티 이름/제목
            ├─ [직접 관계] 관계 설명
            │       - 항목1: 필드=값, ...
            │       - 항목2: ...
            └─ [추론] 복합 관계 설명 (via 경유 관계)
                    - 항목1: ...

    직접 관계(_relations)와 추론 관계(_inferred)를 시각적으로 구분해
    LLM이 데이터 출처를 파악하기 쉽게 한다.
    """
    lines = []

    for entity in graph:
        # ── 헤더 ─────────────────────────────────────────────────
        entity_type = entity.get("type", "Unknown")
        label = entity.get("name") or entity.get("title") or f"id={entity.get('id')}"
        lines.append(f"[{entity_type}] {label}")

        # ── 직접 관계 (_relations) ────────────────────────────────
        relations: dict = entity.get("_relations", {})
        for description, items in relations.items():
            lines.append(f"  ├─ {description}")
            for item in items:
                lines.append(f"  │   - {_format_item(item, skip={'type', 'id'})}")

        # ── 추론 관계 (_inferred) ─────────────────────────────────
        # "↳ [추론]" 접두사로 직접 관계와 구분
        inferred: dict = entity.get("_inferred", {})
        for description, items in inferred.items():
            lines.append(f"  └─ ↳ [추론] {description}")
            for item in items:
                lines.append(f"       - {_format_item(item, skip={'type', 'id'})}")

        lines.append("")  # 엔티티 간 빈 줄

    return "\n".join(lines).strip()


def _format_item(item: dict, skip: set[str] | None = None) -> str:
    """
    dict 한 항목을 "key=value, key=value" 형태의 한 줄 문자열로 반환.
    skip에 포함된 키는 출력에서 제외한다 (type, id 같은 메타 필드).
    None 값은 출력하지 않는다.
    """
    skip = skip or set()
    parts = []
    for k, v in item.items():
        if k in skip or v is None:
            continue
        parts.append(f"{k}={v}")
    return ", ".join(parts) if parts else "(데이터 없음)"
