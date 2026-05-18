"""NL2SQL fallback — 온톨로지 seed 해소 실패 시 자연어를 SQL로 변환해 DB 직접 조회.

설계 원칙:
- 안전: SELECT만 허용, workspace_id 필터 강제, DML 감지 즉시 차단
- 경량: LangChain SQLDatabaseToolkit 없이 직접 구현 (의존성 최소화)
- 명시적 스키마: LLM에게 안전한 테이블/컬럼만 노출 (개인정보 컬럼 제외)

호출 시점:
    knowledge_node에서 build_ontology_context()가 빈 문자열을 반환했을 때.
    이메일 기반 검색, 자기 참조("나"), 속성/집계 기반 질문 등이 여기에 해당.
"""
from __future__ import annotations

import re

from sqlalchemy import text

# LLM에 노출할 스키마 — workspace_id로 격리 가능한 테이블만 포함
# 비밀번호, 토큰 등 민감 컬럼 의도적으로 제외
_SAFE_SCHEMA = """
users(id, name, email, role, birth_date, gender, phone_number, created_at)
workspace_members(id, workspace_id, user_id, role)
meetings(id, workspace_id, title, status, scheduled_at, ended_at)
meeting_participants(id, meeting_id, user_id, speaker_label)
wbs_epics(id, meeting_id, title)
wbs_tasks(id, epic_id, title, assignee_id, status, due_date, priority)
decisions(id, meeting_id, content, speaker_id, is_confirmed, detected_at)
departments(id, workspace_id, name)
""".strip()

# SELECT 이외의 DML/DDL 키워드 감지 패턴
_FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE)\b",
    re.IGNORECASE,
)


async def nl2sql_query(
    question: str,
    workspace_id: int,
    llm,
    user_id: int | None = None,
) -> str:
    """자연어 질문 → SQL 생성 → 실행 → 텍스트 반환.

    온톨로지 L1 실패 시 L2 fallback으로 호출.
    성공 시 ontology_ctx 자리에 주입되어 LLM 시스템 프롬프트에 포함됨.

    안전 장치:
        - DML/DDL 키워드 감지 시 즉시 "" 반환
        - workspace_id 필터 없는 SQL 차단 (다른 워크스페이스 데이터 노출 방지)
        - 결과 최대 50행 제한
        - 모든 예외를 catch해 "" 반환 (fallback 실패가 전체 응답을 막지 않도록)
    """
    user_hint = (
        f"현재 로그인한 사용자의 user_id={user_id}입니다. "
        "'나', '내가', '나의', '뭘 해야' 같은 자기 참조는 이 user_id를 사용하세요."
        if user_id
        else ""
    )

    prompt = f"""다음 질문에 답하기 위한 SQL SELECT 문을 작성하세요.

테이블 스키마:
{_SAFE_SCHEMA}

제약 (반드시 지킬 것):
1. SELECT만 허용. INSERT / UPDATE / DELETE / DROP 절대 금지.
2. 워크스페이스 격리: meetings, departments, workspace_members 테이블에는
   반드시 workspace_id = {workspace_id} 조건을 포함하세요.
   users 테이블 단독 조회 시에는 workspace_members JOIN으로 워크스페이스 범위를 제한하세요.
3. {user_hint}
4. LIMIT 50 필수.
5. SQL 코드만 출력. 반드시 ```sql ... ``` 코드블록 안에 작성.

질문: {question}
"""

    try:
        response = await llm.ainvoke(prompt)
        sql = _extract_sql(response.content)

        if not sql:
            return ""

        # 안전 검사 1: DML/DDL 차단
        if _FORBIDDEN.search(sql):
            return ""

        # 안전 검사 2: workspace_id 필터 누락 차단
        if "workspace_id" not in sql.lower():
            return ""

        rows = _execute_sql(sql)
        if not rows:
            return ""

        return _rows_to_text(rows, question)

    except Exception:
        return ""


def _extract_sql(content: str) -> str:
    """LLM 응답에서 SQL 코드블록 추출."""
    # ```sql ... ``` 형식 우선
    m = re.search(r"```(?:sql)?\s*(SELECT[\s\S]+?)```", content, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    # 코드블록 없으면 SELECT 시작 부분 직접 추출
    m = re.search(r"(SELECT\s[\s\S]+?)(?:;|\Z)", content, re.IGNORECASE)
    return m.group(1).strip() if m else ""


def _execute_sql(sql: str) -> list[dict]:
    """SQL 실행 후 결과를 dict 리스트로 반환. 실패 시 빈 리스트."""
    from app.infra.database.session import SessionLocal

    db = SessionLocal()
    try:
        result = db.execute(text(sql))
        cols = list(result.keys())
        return [dict(zip(cols, row)) for row in result.fetchmany(50)]
    except Exception:
        return []
    finally:
        db.close()


def _rows_to_text(rows: list[dict], question: str) -> str:
    """DB 결과를 LLM 프롬프트에 주입할 텍스트로 변환."""
    lines = [f"[DB 직접 조회 결과 — {question}]"]
    for row in rows:
        line = "  " + ", ".join(
            f"{k}={v}" for k, v in row.items() if v is not None
        )
        lines.append(line)
    return "\n".join(lines)
