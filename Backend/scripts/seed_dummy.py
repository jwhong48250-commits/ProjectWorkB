"""
seed_dummy.py - /docs 테스트용 더미 데이터 삽입

삽입 대상:
    - MongoDB: utterances (현재 회의 = meeting_id 4, 이전 회의 = meeting_id 2, 3)
    - MongoDB: meeting_contexts (이전 회의 요약)
    - MongoDB: meeting_summaries (quick_report 캐시, meeting_id 2, 3)
    - MySQL: meetings (meeting_id 2, 3 = done, meeting_id 4 = in_progress, meeting_id 5 = scheduled)

실행:
    python scripts/seed_dummy.py
    python scripts/seed_dummy.py --flush   # 기존 데이터 삭제 후 재삽입
    python scripts/seed_dummy.py --delete  # 더미 데이터만 안전하게 삭제
"""
import sys, os, json, argparse
from pymongo import MongoClient
from datetime import datetime
from sqlalchemy import create_engine, text

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
from app.core.config import settings

# --- 클라이언트 ---
mongo_db = MongoClient(settings.MONGODB_URL)["meeting_assistant"]

# 현재 회의 ID (MongoDB utterances + MySQL in_progress)
DEFAULT_MEETING_ID = "36"

# ------------------------------------------------------------------
# 현재 회의 발화 (meeting_id 4) — MongoDB utterances 컬렉션
# content: agent_utils.py transcript 조회용
# text: search snippet용 (두 필드 동일값)
# ------------------------------------------------------------------
CURRENT_UTTERANCES = {
    "meeting_id": 36,
    "workspace_id": 2,
    "created_at": datetime(2026, 4, 27, 10, 0, 0),
    "updated_at": datetime(2026, 4, 27, 10, 10, 0),
    "total_duration_sec": 600,
    "meeting_start_time": datetime(2026, 4, 27, 10, 0, 0),
    "utterances": [
        {"seq": 1, "speaker_id": 1, "speaker_label": "박지수", "content": "오늘 회의 시작하겠습니다. 신규 백엔드 아키텍처 방향성 논의가 주요 안건입니다.", "text": "오늘 회의 시작하겠습니다. 신규 백엔드 아키텍처 방향성 논의가 주요 안건입니다.", "timestamp": "2026-04-27T10:00:00"},
        {"seq": 2, "speaker_id": 2, "speaker_label": "이민준", "content": "FastAPI에서 Django로 마이그레이션하는 건 리소스 낭비인 것 같아요. 현행 유지가 낫지 않을까요?", "text": "FastAPI에서 Django로 마이그레이션하는 건 리소스 낭비인 것 같아요. 현행 유지가 낫지 않을까요?", "timestamp": "2026-04-27T10:01:00"},
        {"seq": 3, "speaker_id": 1, "speaker_label": "박지수", "content": "동의합니다. FastAPI 그대로 가되, 모듈 구조를 도메인별로 정리하는 방향으로 결정합시다.", "text": "동의합니다. FastAPI 그대로 가되, 모듈 구조를 도메인별로 정리하는 방향으로 결정합시다.", "timestamp": "2026-04-27T10:02:00"},
        {"seq": 4, "speaker_id": 2, "speaker_label": "이민준", "content": "그러면 김철수 님이 도메인 분리 작업 맡아주실 수 있을까요? 이번 주 금요일까지 초안 부탁드립니다.", "text": "그러면 김철수 님이 도메인 분리 작업 맡아주실 수 있을까요? 이번 주 금요일까지 초안 부탁드립니다.", "timestamp": "2026-04-27T10:03:00"},
        {"seq": 5, "speaker_id": 1, "speaker_label": "박지수", "content": "Redis 캐시 TTL 설정 건은 아직 결론이 안 났죠? 다음 회의 전까지 검토 필요합니다.", "text": "Redis 캐시 TTL 설정 건은 아직 결론이 안 났죠? 다음 회의 전까지 검토 필요합니다.", "timestamp": "2026-04-27T10:04:00"},
        {"seq": 6, "speaker_id": 3, "speaker_label": "김철수", "content": "인증 모듈 리팩토링은 ASAP으로 진행해야 할 것 같습니다. 보안 이슈가 있어요.", "text": "인증 모듈 리팩토링은 ASAP으로 진행해야 할 것 같습니다. 보안 이슈가 있어요.", "timestamp": "2026-04-27T10:05:00"},
        {"seq": 7, "speaker_id": 3, "speaker_label": "김철수", "content": "JWT 토큰 만료 처리 로직이 현재 누락되어 있습니다. 반드시 이번 스프린트 안에 수정해야 합니다.", "text": "JWT 토큰 만료 처리 로직이 현재 누락되어 있습니다. 반드시 이번 스프린트 안에 수정해야 합니다.", "timestamp": "2026-04-27T10:06:00"},
        {"seq": 8, "speaker_id": None, "speaker_label": "알 수 없음", "content": "데이터베이스 인덱스 최적화도 논의가 필요합니다.", "text": "데이터베이스 인덱스 최적화도 논의가 필요합니다.", "timestamp": "2026-04-27T10:07:00"},
        {"seq": 9, "speaker_id": None, "speaker_label": "알 수 없음", "content": "다음 회의는 5월 4일 오전 10시로 잡겠습니다.", "text": "다음 회의는 5월 4일 오전 10시로 잡겠습니다.", "timestamp": "2026-04-27T10:08:00"},
        {"seq": 10, "speaker_id": 1, "speaker_label": "박지수", "content": "이번 회의 정리하겠습니다. 도메인 분리는 김철수 님, 인증 모듈 수정은 이번 스프린트 필수, Redis TTL은 미결입니다.", "text": "이번 회의 정리하겠습니다. 도메인 분리는 김철수 님, 인증 모듈 수정은 이번 스프린트 필수, Redis TTL은 미결입니다.", "timestamp": "2026-04-27T10:09:00"},
    ],
}

# ------------------------------------------------------------------
# MongoDB 이전 회의 요약 (meeting_id 2, 3) — meeting_contexts 컬렉션
# ------------------------------------------------------------------
PAST_MEETINGS = [
    {
        "meeting_id": 34,
        "workspace_id": 2,
        "title": "2026-04-10 스프린트 계획 회의",
        "summary": (
            "4월 스프린트 목표 설정 및 태스크 배분 논의. "
            "프론트엔드 컴포넌트 리팩토링 우선순위 높음으로 결정. "
            "액션 아이템: 이민준 - 컴포넌트 설계 문서 작성 (미완료), "
            "박지수 - API 명세서 업데이트 (완료). "
            "다음 회의에서 중간 점검 예정."
        ),
        "created_at": datetime(2026, 4, 10, 10, 0, 0),
    },
    {
        "meeting_id": 35,
        "workspace_id": 2,
        "title": "2026-04-17 백엔드 아키텍처 사전 논의",
        "summary": (
            "FastAPI 도메인 구조 개편 필요성에 대해 논의함. "
            "인증 모듈 JWT 토큰 만료 처리 누락 이슈 제기됨. "
            "액션 아이템: 김철수 - 도메인 분리 초안 작성 (미완료), "
            "이민준 - Redis TTL 정책 검토 (미완료). "
            "다음 회의에서 진행 상황 확인 예정."
        ),
        "created_at": datetime(2026, 4, 17, 10, 0, 0),
    },
]

# ------------------------------------------------------------------
# MongoDB 이전 회의 raw 발화 (meeting_id 2, 3) — utterances 컬렉션
# content: agent_utils.py transcript 조회용 / text: search snippet용
# ------------------------------------------------------------------
PAST_UTTERANCES = [
    {
        "meeting_id": 34,
        "workspace_id": 2,
        "created_at": datetime(2026, 4, 10, 10, 0, 0),
        "updated_at": datetime(2026, 4, 10, 11, 0, 0),
        "total_duration_sec": 660,
        "meeting_start_time": datetime(2026, 4, 10, 10, 0, 0),
        "utterances": [
            {"seq": 1, "speaker_id": 1, "speaker_label": "박지수", "content": "오늘은 4월 스프린트 목표와 태스크 배분을 논의하겠습니다.", "text": "오늘은 4월 스프린트 목표와 태스크 배분을 논의하겠습니다.", "timestamp": "2026-04-10T10:00:00"},
            {"seq": 2, "speaker_id": 2, "speaker_label": "이민준", "content": "프론트엔드 컴포넌트 리팩토링을 이번 스프린트 최우선으로 잡아야 할 것 같아요.", "text": "프론트엔드 컴포넌트 리팩토링을 이번 스프린트 최우선으로 잡아야 할 것 같아요.", "timestamp": "2026-04-10T10:02:00"},
            {"seq": 3, "speaker_id": 1, "speaker_label": "박지수", "content": "동의합니다. 이민준 님이 컴포넌트 설계 문서 작성 맡아주시면 좋겠어요.", "text": "동의합니다. 이민준 님이 컴포넌트 설계 문서 작성 맡아주시면 좋겠어요.", "timestamp": "2026-04-10T10:05:00"},
            {"seq": 4, "speaker_id": 2, "speaker_label": "이민준", "content": "네, 제가 컴포넌트 설계 문서 작성하겠습니다. 언제까지 드려야 할까요?", "text": "네, 제가 컴포넌트 설계 문서 작성하겠습니다. 언제까지 드려야 할까요?", "timestamp": "2026-04-10T10:06:00"},
            {"seq": 5, "speaker_id": 1, "speaker_label": "박지수", "content": "다음 회의 전까지 초안 주시면 됩니다. 저는 API 명세서 업데이트 진행하겠습니다.", "text": "다음 회의 전까지 초안 주시면 됩니다. 저는 API 명세서 업데이트 진행하겠습니다.", "timestamp": "2026-04-10T10:08:00"},
            {"seq": 6, "speaker_id": 2, "speaker_label": "이민준", "content": "그리고 다음 회의에서 중간 점검 한 번 하는 게 좋겠습니다.", "text": "그리고 다음 회의에서 중간 점검 한 번 하는 게 좋겠습니다.", "timestamp": "2026-04-10T10:10:00"},
        ],
    },
    {
        "meeting_id": 35,
        "workspace_id": 2,
        "created_at": datetime(2026, 4, 17, 10, 0, 0),
        "updated_at": datetime(2026, 4, 17, 11, 0, 0),
        "total_duration_sec": 780,
        "meeting_start_time": datetime(2026, 4, 17, 10, 0, 0),
        "utterances": [
            {"seq": 1, "speaker_id": 1, "speaker_label": "박지수", "content": "FastAPI 도메인 구조를 전면 개편해야 한다는 의견이 있어서 오늘 논의하려고 합니다.", "text": "FastAPI 도메인 구조를 전면 개편해야 한다는 의견이 있어서 오늘 논의하려고 합니다.", "timestamp": "2026-04-17T10:00:00"},
            {"seq": 2, "speaker_id": 3, "speaker_label": "김철수", "content": "현재 구조가 너무 flat해서 도메인별로 분리가 필요합니다. 제가 초안 작성할게요.", "text": "현재 구조가 너무 flat해서 도메인별로 분리가 필요합니다. 제가 초안 작성할게요.", "timestamp": "2026-04-17T10:02:00"},
            {"seq": 3, "speaker_id": 2, "speaker_label": "이민준", "content": "인증 모듈에 JWT 토큰 만료 처리 로직이 누락된 것 발견했습니다. 보안상 심각한 이슈입니다.", "text": "인증 모듈에 JWT 토큰 만료 처리 로직이 누락된 것 발견했습니다. 보안상 심각한 이슈입니다.", "timestamp": "2026-04-17T10:05:00"},
            {"seq": 4, "speaker_id": 1, "speaker_label": "박지수", "content": "JWT 토큰 만료 처리는 이번 스프린트 안에 반드시 수정해야 합니다.", "text": "JWT 토큰 만료 처리는 이번 스프린트 안에 반드시 수정해야 합니다.", "timestamp": "2026-04-17T10:07:00"},
            {"seq": 5, "speaker_id": 2, "speaker_label": "이민준", "content": "Redis TTL 정책도 아직 결정이 안 났는데, 제가 검토해서 다음 회의 때 보고하겠습니다.", "text": "Redis TTL 정책도 아직 결정이 안 났는데, 제가 검토해서 다음 회의 때 보고하겠습니다.", "timestamp": "2026-04-17T10:10:00"},
            {"seq": 6, "speaker_id": 3, "speaker_label": "김철수", "content": "도메인 분리 초안은 이번 주 금요일까지 작성해서 공유하겠습니다.", "text": "도메인 분리 초안은 이번 주 금요일까지 작성해서 공유하겠습니다.", "timestamp": "2026-04-17T10:12:00"},
        ],
    },
]

# ------------------------------------------------------------------
# MongoDB meeting_summaries (quick_report 캐시, meeting_id 2, 3)
# ------------------------------------------------------------------
MEETING_SUMMARIES = [
    {
        "meeting_id": 34,
        "workspace_id": 2,
        "summary": {
            "meetings": [{"title": "2026-04-10 스프린트 계획 회의", "date": "2026-04-10", "attendees": ["박지수", "이민준"]}],
            "overview_summary": "4월 스프린트 목표 설정 및 태스크 배분 논의. 프론트엔드 컴포넌트 리팩토링 최우선 결정.",
            "agenda_items": [{"topic": "스프린트 목표 설정"}, {"topic": "태스크 배분"}],
            "discussion_items": [
                {"topic": "프론트엔드 우선순위", "content": "컴포넌트 리팩토링을 이번 스프린트 최우선으로 결정"},
                {"topic": "API 명세서", "content": "박지수가 API 명세서 업데이트 담당"},
            ],
            "decisions": ["프론트엔드 컴포넌트 리팩토링 최우선 진행"],
            "action_items": [
                {"assignee": "이민준", "content": "컴포넌트 설계 문서 작성", "deadline": "2026-04-17", "urgency": "normal", "priority": "high"},
                {"assignee": "박지수", "content": "API 명세서 업데이트", "deadline": "2026-04-17", "urgency": "normal", "priority": "medium"},
            ],
            "pending_items": [{"content": "이민준 컴포넌트 설계 문서 미완료", "carried_over": True}],
            "next_meeting": "2026-04-17 10:00",
            "next_meeting_agenda": ["컴포넌트 설계 문서 중간 점검", "백엔드 아키텍처 논의"],
            "hallucination_flags": [],
        },
    },
    {
        "meeting_id": 35,
        "workspace_id": 2,
        "summary": {
            "meetings": [{"title": "2026-04-17 백엔드 아키텍처 사전 논의", "date": "2026-04-17", "attendees": ["박지수", "이민준", "김철수"]}],
            "overview_summary": "FastAPI 도메인 구조 개편 방향 합의. JWT 토큰 만료 처리 누락 이슈 발견 및 즉시 수정 결정.",
            "agenda_items": [{"topic": "FastAPI 도메인 구조 개편"}, {"topic": "보안 이슈 처리"}],
            "discussion_items": [
                {"topic": "도메인 분리 방향", "content": "flat 구조에서 도메인별 분리 필요성 합의"},
                {"topic": "JWT 보안 이슈", "content": "토큰 만료 처리 로직 누락 — 이번 스프린트 필수 수정"},
            ],
            "decisions": ["FastAPI 도메인별 구조 분리 진행", "JWT 토큰 만료 처리 이번 스프린트 필수"],
            "action_items": [
                {"assignee": "김철수", "content": "도메인 분리 초안 작성", "deadline": "2026-04-21", "urgency": "normal", "priority": "high"},
                {"assignee": "이민준", "content": "Redis TTL 정책 검토 및 보고", "deadline": "2026-04-24", "urgency": "normal", "priority": "medium"},
            ],
            "pending_items": [
                {"content": "김철수 도메인 분리 초안 미완료", "carried_over": True},
                {"content": "Redis TTL 정책 미결", "carried_over": True},
            ],
            "next_meeting": "2026-04-27 10:00",
            "next_meeting_agenda": ["도메인 분리 초안 검토", "백엔드 아키텍처 방향성 확정"],
            "hallucination_flags": [],
        },
    },
]


def _dummy_meeting_ids(current_meeting_id: int) -> list[int]:
    past_ids = [m["meeting_id"] for m in PAST_MEETINGS]
    # 현재 회의 + 다음 예정 회의(quick_report next_meeting 조회용)
    return past_ids + [int(current_meeting_id), 37]


def delete_mysql(current_meeting_id: int, workspace_id: int) -> None:
    """seed_dummy.py가 만든(또는 기대한) 더미 데이터만 정리합니다."""
    engine = create_engine(settings.DATABASE_URL)
    ids = _dummy_meeting_ids(current_meeting_id)

    def safe_exec(conn, sql: str, params: dict) -> None:
        try:
            conn.execute(text(sql), params)
        except Exception as exc:
            # 환경별로 테이블이 없거나 스키마가 다를 수 있어 best-effort로 진행
            print(f"  [MySQL] skip: {sql.splitlines()[0][:60]}... ({exc})")

    with engine.connect() as conn:
        print(f"  [MySQL] 더미 데이터 삭제 시작: meeting_id={ids} (workspace_id={workspace_id})")

        # 1) meeting_minutes 기반으로 minute_photos / review_requests 제거
        safe_exec(
            conn,
            """
            DELETE mp
            FROM minute_photos mp
            JOIN meeting_minutes mm ON mm.id = mp.minute_id
            WHERE mm.meeting_id IN :ids
            """,
            {"ids": tuple(ids)},
        )
        safe_exec(
            conn,
            """
            DELETE rr
            FROM review_requests rr
            JOIN meeting_minutes mm ON mm.id = rr.minute_id
            WHERE mm.meeting_id IN :ids
            """,
            {"ids": tuple(ids)},
        )

        # 2) WBS (tasks -> epics)
        safe_exec(
            conn,
            """
            DELETE wt
            FROM wbs_tasks wt
            JOIN wbs_epics we ON we.id = wt.epic_id
            WHERE we.meeting_id IN :ids
            """,
            {"ids": tuple(ids)},
        )
        safe_exec(
            conn,
            "DELETE FROM wbs_epics WHERE meeting_id IN :ids",
            {"ids": tuple(ids)},
        )

        # 3) 기타 meeting_id FK 테이블들 (있을 수 있는 것들)
        safe_exec(conn, "DELETE FROM action_items WHERE meeting_id IN :ids", {"ids": tuple(ids)})
        safe_exec(conn, "DELETE FROM reports WHERE meeting_id IN :ids", {"ids": tuple(ids)})
        safe_exec(conn, "DELETE FROM decisions WHERE meeting_id IN :ids", {"ids": tuple(ids)})

        # 4) 참가자/회의록/회의
        safe_exec(conn, "DELETE FROM meeting_participants WHERE meeting_id IN :ids", {"ids": tuple(ids)})
        safe_exec(conn, "DELETE FROM meeting_minutes WHERE meeting_id IN :ids", {"ids": tuple(ids)})
        safe_exec(conn, "DELETE FROM meetings WHERE id IN :ids", {"ids": tuple(ids)})

        conn.commit()
        print("  [MySQL] 더미 데이터 삭제 완료")


def delete_mongo(current_meeting_id: int, workspace_id: int) -> None:
    """seed_dummy.py가 만든 더미 문서만 정리합니다."""
    ids = _dummy_meeting_ids(current_meeting_id)
    print(f"  [MongoDB] 더미 데이터 삭제 시작: meeting_id={ids} (workspace_id={workspace_id})")

    mongo_db["utterances"].delete_many({"meeting_id": {"$in": ids}})
    mongo_db["meeting_contexts"].delete_many({"meeting_id": {"$in": ids}, "workspace_id": workspace_id})
    mongo_db["meeting_summaries"].delete_many({"meeting_id": {"$in": ids}, "workspace_id": workspace_id})

    print("  [MongoDB] 더미 데이터 삭제 완료")


def seed_mysql(meeting_id: int, workspace_id: int, flush: bool):
    engine = create_engine(settings.DATABASE_URL)
    with engine.connect() as conn:
        if flush:
            delete_mysql(meeting_id, workspace_id)

        row = conn.execute(
            text("SELECT id FROM users WHERE workspace_id = :wid LIMIT 1"),
            {"wid": workspace_id}
        ).fetchone()
        created_by = row.id if row else 1

        # 워크스페이스 전체 유저 조회 (참여자 삽입용)
        user_rows = conn.execute(
            text("SELECT id FROM users WHERE workspace_id = :wid"),
            {"wid": workspace_id}
        ).fetchall()
        user_ids = [r.id for r in user_rows] or [created_by]

        for pm in PAST_MEETINGS:
            conn.execute(
                text("""
                    INSERT IGNORE INTO meetings
                        (id, workspace_id, created_by, title, room_name, status,
                         scheduled_at, created_at, updated_at)
                    VALUES
                        (:id, :workspace_id, :created_by, :title, '테스트 룸', 'done',
                        :created_at, :created_at, :created_at)
                """),
                {
                    "id": pm["meeting_id"],
                    "workspace_id": workspace_id,
                    "created_by": created_by,
                    "title": pm["title"],
                    "created_at": pm["created_at"],
                }
            )
            # 참여자 삽입 — get_past_meetings가 participants 기준 필터링
            for uid in user_ids:
                conn.execute(
                    text("""
                        INSERT IGNORE INTO meeting_participants (meeting_id, user_id)
                        VALUES (:mid, :uid)
                    """),
                    {"mid": pm["meeting_id"], "uid": uid}
                )

        # 현재 진행 중 회의
        conn.execute(
            text("""
                INSERT IGNORE INTO meetings
                    (id, workspace_id, created_by, title, room_name, status, created_at, updated_at)
                VALUES
                    (:id, :workspace_id, :created_by, :title, '테스트 룸', 'in_progress', NOW(), NOW())
            """),
            {
                "id": meeting_id,
                "workspace_id": workspace_id,
                "created_by": created_by,
                "title": "2026-04-27 백엔드 아키텍처 논의",
            }
        )

        # 다음 예정 회의 (quick_report_node next_meeting 조회용)
        conn.execute(
            text("""
                INSERT IGNORE INTO meetings
                    (id, workspace_id, created_by, title, room_name, status, scheduled_at, created_at, updated_at)
                VALUES
                    (:id, :workspace_id, :created_by, :title, '테스트 룸', 'scheduled',
                    :scheduled_at, NOW(), NOW())
            """),
            {
                "id": 37,
                "workspace_id": workspace_id,
                "created_by": created_by,
                "title": "2026-05-04 아키텍처 확정 회의",
                "scheduled_at": datetime(2026, 5, 4, 10, 0, 0),
            }
        )
        # meeting_minutes — past_summary_node가 key_points 읽는 소스
        MINUTES = [
            {
                "meeting_id": 34,
                "summary": json.dumps({
                    "title": "스프린트 계획 회의",
                    "key_points": [
                        "프론트엔드 컴포넌트 리팩토링 최우선으로 결정",
                        "이민준 - 컴포넌트 설계 문서 작성 (기한: 다음 회의 전)",
                        "박지수 - API 명세서 업데이트 완료",
                        "다음 회의에서 중간 점검 예정",
                    ],
                    "hallucination_flags": [],
                }, ensure_ascii=False),
            },
            {
                "meeting_id": 35,
                "summary": json.dumps({
                    "title": "백엔드 아키텍처 사전 논의",
                    "key_points": [
                        "FastAPI 도메인별 구조 분리 필요성 합의",
                        "JWT 토큰 만료 처리 누락 발견 — 이번 스프린트 필수 수정",
                        "김철수 - 도메인 분리 초안 작성 (기한: 이번 주 금요일)",
                        "이민준 - Redis TTL 정책 검토 후 다음 회의 보고",
                    ],
                    "hallucination_flags": [],
                }, ensure_ascii=False),
            },
        ]
        for m in MINUTES:
            conn.execute(
                text("""
                    INSERT IGNORE INTO meeting_minutes
                        (meeting_id, content, summary, status, review_status, created_at, updated_at)
                    VALUES
                        (:meeting_id, '', :summary, 'final', 'approved', NOW(), NOW())
                """),
                m
            )

        # wbs_epics + wbs_tasks — query_wbs_tasks 도구 테스트용
        WBS = [
            {
                "meeting_id": 34,
                "epic_title": "스프린트 계획 액션 아이템",
                "tasks": [
                    {"title": "컴포넌트 설계 문서 작성", "content": "프론트엔드 컴포넌트 설계 문서 초안 작성", "assignee_name": "이민준", "due_date": "2026-04-17", "priority": "high", "urgency": "normal", "status": "todo"},
                    {"title": "API 명세서 업데이트", "content": "REST API 명세서 최신화", "assignee_name": "박지수", "due_date": None, "priority": "medium", "urgency": "normal", "status": "done"},
                ],
            },
            {
                "meeting_id": 35,
                "epic_title": "백엔드 아키텍처 액션 아이템",
                "tasks": [
                    {"title": "도메인 분리 초안 작성", "content": "FastAPI 도메인별 구조 분리 설계 초안 작성 후 팀 공유", "assignee_name": "김철수", "due_date": "2026-04-21", "priority": "high", "urgency": "normal", "status": "todo"},
                    {"title": "JWT 만료 처리 수정", "content": "인증 모듈 JWT 토큰 만료 처리 로직 추가 — 보안 이슈", "assignee_name": "이민준", "due_date": "2026-04-24", "priority": "critical", "urgency": "urgent", "status": "in_progress"},
                    {"title": "Redis TTL 정책 검토", "content": "Redis TTL 정책 조사 및 권고안 작성 후 다음 회의 보고", "assignee_name": "이민준", "due_date": "2026-04-24", "priority": "medium", "urgency": "normal", "status": "todo"},
                ],
            },
        ]
        for wbs in WBS:
            result = conn.execute(
                text("""
                    INSERT IGNORE INTO wbs_epics (meeting_id, title, order_index)
                    VALUES (:meeting_id, :title, 0)
                """),
                {"meeting_id": wbs["meeting_id"], "title": wbs["epic_title"]}
            )
            epic_id = result.lastrowid
            if not epic_id:
                row = conn.execute(
                    text("SELECT id FROM wbs_epics WHERE meeting_id=:mid AND title=:title"),
                    {"mid": wbs["meeting_id"], "title": wbs["epic_title"]}
                ).fetchone()
                epic_id = row.id if row else None
            if epic_id:
                for i, t in enumerate(wbs["tasks"]):
                    conn.execute(
                        text("""
                            INSERT IGNORE INTO wbs_tasks
                                (epic_id, title, content, assignee_name, due_date,
                                 priority, urgency, status, order_index)
                            VALUES
                                (:epic_id, :title, :content, :assignee_name, :due_date,
                                 :priority, :urgency, :status, :order_index)
                        """),
                        {
                            "epic_id": epic_id, "title": t["title"], "content": t["content"],
                            "assignee_name": t["assignee_name"], "due_date": t["due_date"],
                            "priority": t["priority"], "urgency": t["urgency"],
                            "status": t["status"], "order_index": i,
                        }
                    )
            print(f"  [MySQL] WBS 삽입: meeting_id={wbs['meeting_id']} ({len(wbs['tasks'])}개 태스크)")

        conn.commit()
    print(f"  [MySQL] 이전 회의 {[m['meeting_id'] for m in PAST_MEETINGS]} (참여자 {user_ids}) + 현재 회의 {meeting_id} + 예정 회의 37 삽입")


def seed_mongo(workspace_id: int, flush: bool):
    """MongoDB utterances + meeting_contexts + meeting_summaries 삽입."""

    # --- utterances (현재 회의 + 이전 회의) ---
    utt_col = mongo_db["utterances"]

    if flush:
        ids = [u["meeting_id"] for u in PAST_UTTERANCES] + [CURRENT_UTTERANCES["meeting_id"]]
        utt_col.delete_many({"meeting_id": {"$in": ids}})
        print(f"  [MongoDB] utterances 기존 데이터 삭제: meeting_id={ids}")

    utt_indexes = [idx["name"] for idx in utt_col.list_indexes()]
    if "utterances_text" not in utt_indexes:
        utt_col.create_index(
            [("utterances.text", "text"), ("utterances.speaker_label", "text")],
            name="utterances_text"
        )
        print("  [MongoDB] utterances $text 인덱스 생성")

    # 현재 회의 발화
    utt_col.update_one(
        {"meeting_id": CURRENT_UTTERANCES["meeting_id"]},
        {"$setOnInsert": CURRENT_UTTERANCES},
        upsert=True,
    )
    print(f"  [MongoDB] 현재 회의 발화 삽입: meeting_id={CURRENT_UTTERANCES['meeting_id']} ({len(CURRENT_UTTERANCES['utterances'])}건)")

    # 이전 회의 발화
    for doc in PAST_UTTERANCES:
        utt_col.update_one(
            {"meeting_id": doc["meeting_id"]},
            {"$setOnInsert": doc},
            upsert=True,
        )
        print(f"  [MongoDB] 이전 회의 발화 삽입: meeting_id={doc['meeting_id']} ({len(doc['utterances'])}건)")

    # --- meeting_contexts (이전 회의 요약) ---
    ctx_col = mongo_db["meeting_contexts"]

    if flush:
        ids = [m["meeting_id"] for m in PAST_MEETINGS] + [CURRENT_UTTERANCES["meeting_id"], 37]
        ctx_col.delete_many({"meeting_id": {"$in": ids}, "workspace_id": workspace_id})
        print(f"  [MongoDB] meeting_contexts 더미 데이터 삭제: meeting_id={ids}")

    ctx_indexes = [idx["name"] for idx in ctx_col.list_indexes()]
    if "summary_text" not in ctx_indexes:
        ctx_col.create_index([("summary", "text"), ("title", "text")], name="summary_text")
        print("  [MongoDB] $text 인덱스 생성: summary + title")

    for pm in PAST_MEETINGS:
        ctx_col.update_one(
            {"meeting_id": pm["meeting_id"]},
            {"$setOnInsert": {**pm, "workspace_id": workspace_id}},
            upsert=True,
        )
        print(f"  [MongoDB] 이전 회의 요약 삽입: {pm['title']}")

    # --- meeting_summaries (quick_report 캐시) ---
    sum_col = mongo_db["meeting_summaries"]

    if flush:
        ids = [s["meeting_id"] for s in MEETING_SUMMARIES]
        sum_col.delete_many({"meeting_id": {"$in": ids}})
        print(f"  [MongoDB] meeting_summaries 기존 데이터 삭제: meeting_id={ids}")

    for s in MEETING_SUMMARIES:
        sum_col.update_one(
            {"meeting_id": s["meeting_id"]},
            {"$setOnInsert": s},
            upsert=True,
        )
        print(f"  [MongoDB] quick_report 캐시 삽입: meeting_id={s['meeting_id']}")


def main():
    parser = argparse.ArgumentParser(description="더미 데이터 삽입")
    parser.add_argument("--meeting-id", default=DEFAULT_MEETING_ID, help="현재 회의 meeting_id")
    parser.add_argument("--workspace-id", type=int, default=2, help="테스트용 workspace_id")
    parser.add_argument("--flush", action="store_true", help="기존 데이터 삭제 후 재삽입")
    parser.add_argument("--delete", action="store_true", help="더미 데이터만 삭제하고 종료")
    args = parser.parse_args()

    meeting_id_int = int(args.meeting_id)

    if args.delete:
        print(f"\n더미 데이터 삭제 시작 (current meeting_id={meeting_id_int}, workspace_id={args.workspace_id})")
        delete_mysql(meeting_id_int, args.workspace_id)
        delete_mongo(meeting_id_int, args.workspace_id)
        print("\n완료. 더미 데이터 삭제가 끝났습니다.")
        return

    print(f"\n더미 데이터 삽입 시작 (현재 meeting_id={args.meeting_id}, workspace_id={args.workspace_id}, flush={args.flush})")
    seed_mysql(meeting_id_int, args.workspace_id, args.flush)
    seed_mongo(args.workspace_id, args.flush)
    print(f"\n완료. /live/{args.meeting_id} 에서 ChatFAB 테스트하세요.")


if __name__ == "__main__":
    main()
