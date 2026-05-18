# scripts/seed.py
from datetime import timedelta, date
from app.infra.database.session import SessionLocal
from app.domains.user.models import User
from app.domains.workspace.models import Workspace, WorkspaceMember, Department, MemberRole
from app.domains.meeting.models import Meeting, MeetingStatus
from app.domains.integration.models import Integration, ServiceType
from app.domains.action.models import (
    ActionItem, ActionStatus, Priority,
    WbsEpic, WbsTask, TaskStatus,
    Report, ReportFormat,
)
from app.domains.intelligence.models import MeetingMinute, MinuteStatus
from app.core.security import hash_password
from app.utils.time_utils import now_kst
from pymongo import MongoClient
from app.core.config import settings


def seed_test_data():
    _seed_mysql()
    _seed_mongo()


def _seed_mysql():
    db = SessionLocal()
    try:
        if db.query(User).filter(User.email == "test@workb.com").first():
            print("✅ [SEED] MySQL 데이터 이미 존재, 스킵")
            return

        _now = now_kst()
        _today = date(_now.year, _now.month, _now.day)

        # ── 1. 유저 3명 ────────────────────────────────────────────────────
        user_admin = User(
            email="test@workb.com",
            hashed_password=hash_password("test1234"),
            name="이대중",
            role="admin",
            workspace_id=None,
        )
        user_yerin = User(
            email="yerin@workb.com",
            hashed_password=hash_password("test1234"),
            name="김예린",
            role="member",
            workspace_id=None,
        )
        user_jungwoo = User(
            email="jungwoo@workb.com",
            hashed_password=hash_password("test1234"),
            name="홍정우",
            role="member",
            workspace_id=None,
        )
        db.add_all([user_admin, user_yerin, user_jungwoo])
        db.flush()

        # ── 2. 워크스페이스 ────────────────────────────────────────────────
        workspace = Workspace(
            owner_id=user_admin.id,
            name="WorkB 개발팀",
            industry="IT",
            default_language="ko",
        )
        db.add(workspace)
        db.flush()
        user_admin.workspace_id   = workspace.id
        user_yerin.workspace_id   = workspace.id
        user_jungwoo.workspace_id = workspace.id

        # ── 3. 부서 20개 ───────────────────────────────────────────────────
        DEPT_NAMES = [
            "개발팀", "프로덕트 기획팀", "데이터 분석팀", "QA팀", "인프라/보안팀",
            "UX/UI 디자인팀", "브랜드 기획팀", "영업팀", "마케팅팀", "그로스 마케팅팀",
            "고객 성공팀", "고객 지원팀", "인사팀", "피플/컬쳐팀", "재무팀",
            "회계팀", "총무팀", "법무/컴플라이언스팀", "전략 기획팀", "경영 관리팀",
        ]
        depts = []
        for name in DEPT_NAMES:
            d = Department(workspace_id=workspace.id, name=name)
            db.add(d)
            depts.append(d)
        db.flush()

        # ── 4. 워크스페이스 멤버 ────────────────────────────────────────────
        db.add_all([
            WorkspaceMember(
                workspace_id=workspace.id, user_id=user_admin.id,
                role=MemberRole.admin,  department_id=depts[0].id,   # 개발팀
            ),
            WorkspaceMember(
                workspace_id=workspace.id, user_id=user_yerin.id,
                role=MemberRole.member, department_id=depts[1].id,   # 프로덕트 기획팀
            ),
            WorkspaceMember(
                workspace_id=workspace.id, user_id=user_jungwoo.id,
                role=MemberRole.member, department_id=depts[8].id,   # 마케팅팀
            ),
        ])

        # ── 5. 회의 3개 ────────────────────────────────────────────────────
        meeting1 = Meeting(
            workspace_id=workspace.id,
            created_by=user_admin.id,
            title="2025년 2분기 개발 킥오프 회의",
            status=MeetingStatus.done,
            room_name="A 회의실",
            started_at=_now - timedelta(hours=2),
            ended_at=_now - timedelta(hours=1),
        )
        meeting2 = Meeting(
            workspace_id=workspace.id,
            created_by=user_admin.id,
            title="백엔드 API 설계 리뷰",
            status=MeetingStatus.done,
            room_name="B 회의실",
            started_at=_now - timedelta(days=3, hours=2),
            ended_at=_now - timedelta(days=3, hours=1),
        )
        meeting3 = Meeting(
            workspace_id=workspace.id,
            created_by=user_yerin.id,
            title="다음 스프린트 계획 회의",
            status=MeetingStatus.scheduled,
            room_name="C 회의실",
            started_at=_now + timedelta(days=1),
            ended_at=None,
        )
        db.add_all([meeting1, meeting2, meeting3])
        db.flush()

        # ── 6. 연동 (Slack 연결 완료 / JIRA·Google 미연결) ─────────────────
        db.add_all([
            Integration(
                workspace_id=workspace.id,
                service=ServiceType.slack,
                is_connected=True,
                access_token="xoxb-fake-dev-token-for-seed-only",
                extra_config={
                    "team_id": "T00000001",
                    "channel_id": "C00000001",
                },
            ),
            Integration(
                workspace_id=workspace.id,
                service=ServiceType.jira,
                is_connected=False,
                extra_config={},
            ),
            Integration(
                workspace_id=workspace.id,
                service=ServiceType.google_calendar,
                is_connected=False,
                extra_config={},
            ),
        ])

        # ── 7. 회의 1 — 액션 아이템 5개 ────────────────────────────────────
        db.add_all([
            ActionItem(
                meeting_id=meeting1.id,
                content="JIRA OAuth 2.0 클라이언트 구현 및 연동 테스트",
                assignee_id=user_admin.id,
                due_date=_today + timedelta(days=7),
                status=ActionStatus.done,
                detected_at=_now - timedelta(hours=1, minutes=50),
                priority=Priority.high,
                urgency="urgent",
            ),
            ActionItem(
                meeting_id=meeting1.id,
                content="워크스페이스 생성 시 Integration 3개 자동 INSERT 구현",
                assignee_id=user_yerin.id,
                due_date=_today + timedelta(days=3),
                status=ActionStatus.done,
                detected_at=_now - timedelta(hours=1, minutes=45),
                priority=Priority.medium,
                urgency="normal",
            ),
            ActionItem(
                meeting_id=meeting1.id,
                content="Slack 채널 선택 UI 및 내보내기 기능 프론트 연결",
                assignee_id=user_jungwoo.id,
                due_date=_today + timedelta(days=5),
                status=ActionStatus.in_progress,
                detected_at=_now - timedelta(hours=1, minutes=40),
                priority=Priority.high,
                urgency="urgent",
            ),
            ActionItem(
                meeting_id=meeting1.id,
                content="회의록 Notion 연동 백엔드 구현",
                assignee_id=user_admin.id,
                due_date=_today + timedelta(days=10),
                status=ActionStatus.pending,
                detected_at=_now - timedelta(hours=1, minutes=30),
                priority=Priority.medium,
                urgency="low",
            ),
            ActionItem(
                meeting_id=meeting1.id,
                content="WBS 드래그 앤 드롭 프론트엔드 구현",
                assignee_id=user_jungwoo.id,
                due_date=_today + timedelta(days=7),
                status=ActionStatus.pending,
                detected_at=_now - timedelta(hours=1, minutes=20),
                priority=Priority.low,
                urgency="normal",
            ),
        ])

        # ── 8. 회의 1 — WBS (3 에픽 × 2~3 태스크) ──────────────────────────
        e1 = WbsEpic(meeting_id=meeting1.id, title="백엔드 개발",   order_index=0)
        e2 = WbsEpic(meeting_id=meeting1.id, title="프론트엔드 개발", order_index=1)
        e3 = WbsEpic(meeting_id=meeting1.id, title="기획 및 문서화", order_index=2)
        db.add_all([e1, e2, e3])
        db.flush()

        db.add_all([
            # 백엔드 에픽
            WbsTask(
                epic_id=e1.id, title="JIRA OAuth 연동",
                assignee_id=user_admin.id, assignee_name="이대중",
                priority=Priority.high,   urgency="urgent",
                due_date=_today + timedelta(days=7),
                progress=100, status=TaskStatus.done, order_index=0,
            ),
            WbsTask(
                epic_id=e1.id, title="Slack 내보내기 API",
                assignee_id=user_admin.id, assignee_name="이대중",
                priority=Priority.medium, urgency="normal",
                due_date=_today + timedelta(days=5),
                progress=100, status=TaskStatus.done, order_index=1,
            ),
            WbsTask(
                epic_id=e1.id, title="WBS CRUD API 구현",
                assignee_id=user_admin.id, assignee_name="이대중",
                priority=Priority.medium, urgency="normal",
                due_date=_today + timedelta(days=10),
                progress=80, status=TaskStatus.in_progress, order_index=2,
            ),
            # 프론트엔드 에픽
            WbsTask(
                epic_id=e2.id, title="WBS 페이지 UI 구현",
                assignee_id=user_yerin.id, assignee_name="김예린",
                priority=Priority.high,   urgency="urgent",
                due_date=_today + timedelta(days=5),
                progress=60, status=TaskStatus.in_progress, order_index=0,
            ),
            WbsTask(
                epic_id=e2.id, title="연동 설정 페이지 구현",
                assignee_id=user_yerin.id, assignee_name="김예린",
                priority=Priority.medium, urgency="normal",
                due_date=_today + timedelta(days=3),
                progress=100, status=TaskStatus.done, order_index=1,
            ),
            WbsTask(
                epic_id=e2.id, title="JIRA 동기화 버튼 및 프리뷰 모달",
                assignee_id=user_yerin.id, assignee_name="김예린",
                priority=Priority.medium, urgency="normal",
                due_date=_today + timedelta(days=8),
                progress=0, status=TaskStatus.todo, order_index=2,
            ),
            # 기획 에픽
            WbsTask(
                epic_id=e3.id, title="서비스 소개 자료 작성",
                assignee_id=user_jungwoo.id, assignee_name="홍정우",
                priority=Priority.low,    urgency="low",
                due_date=_today + timedelta(days=14),
                progress=0, status=TaskStatus.todo, order_index=0,
            ),
            WbsTask(
                epic_id=e3.id, title="사용자 피드백 수집 계획 수립",
                assignee_id=user_jungwoo.id, assignee_name="홍정우",
                priority=Priority.medium, urgency="normal",
                due_date=_today + timedelta(days=12),
                progress=0, status=TaskStatus.todo, order_index=1,
            ),
        ])

        # ── 9. 회의 2 — WBS (2 에픽 × 2 태스크, 모두 완료) ─────────────────
        e4 = WbsEpic(meeting_id=meeting2.id, title="API 설계",  order_index=0)
        e5 = WbsEpic(meeting_id=meeting2.id, title="DB 설계",   order_index=1)
        db.add_all([e4, e5])
        db.flush()

        db.add_all([
            WbsTask(
                epic_id=e4.id, title="REST API 엔드포인트 정의",
                assignee_id=user_admin.id, assignee_name="이대중",
                priority=Priority.high,   urgency="urgent",
                due_date=_today - timedelta(days=2),
                progress=100, status=TaskStatus.done, order_index=0,
            ),
            WbsTask(
                epic_id=e4.id, title="API 문서 Swagger 작성",
                assignee_id=user_yerin.id, assignee_name="김예린",
                priority=Priority.medium, urgency="normal",
                due_date=_today - timedelta(days=1),
                progress=100, status=TaskStatus.done, order_index=1,
            ),
            WbsTask(
                epic_id=e5.id, title="MySQL 스키마 확정",
                assignee_id=user_admin.id, assignee_name="이대중",
                priority=Priority.high,   urgency="urgent",
                due_date=_today - timedelta(days=2),
                progress=100, status=TaskStatus.done, order_index=0,
            ),
            WbsTask(
                epic_id=e5.id, title="MongoDB 컬렉션 구조 정의",
                assignee_id=user_jungwoo.id, assignee_name="홍정우",
                priority=Priority.medium, urgency="normal",
                due_date=_today - timedelta(days=1),
                progress=100, status=TaskStatus.done, order_index=1,
            ),
        ])

        # ── 10. 회의 1 — 회의록 ──────────────────────────────────────────────
        db.add(MeetingMinute(
            meeting_id=meeting1.id,
            content="""# 2025년 2분기 개발 킥오프 회의록

**일시**: 2025년 4월 26일 14:00~15:00
**장소**: A 회의실
**참석자**: 이대중, 김예린, 홍정우

---

## 1. 회의 개요

2025년 2분기 개발 목표 및 역할 분담을 논의하였다.
JIRA 연동, Slack 내보내기, WBS 관리 기능의 우선순위를 확정하였다.

## 2. 주요 논의 사항

### 2.1 WBS 일정 확정

- 4월 말까지 백엔드 API 완성 목표
- 각자 담당 도메인 기준으로 태스크 분배
- JIRA를 통한 진행 상황 추적

### 2.2 JIRA 연동 방식 결정

- OAuth 2.0 (3LO) 방식 채택 — API Key 대비 보안 우수
- Atlassian 앱 등록 완료, cloud_id 자동 조회
- WbsEpic → JIRA Epic, WbsTask → JIRA Task 매핑

### 2.3 Slack 내보내기

- Block Kit 형식으로 회의록 전송
- 담당자 DM 자동 발송 기능 포함
- 보고서 스레드 첨부 옵션 추가

## 3. 결정 사항

| 항목 | 결정 내용 |
|------|----------|
| 보고서 포맷 | Markdown + Excel 우선 지원 |
| 내보내기 방식 | BackgroundTask (Fire & Forget) |
| JIRA 연동 | OAuth 2.0 (3LO) |
| 동기화 주기 | 수동 동기화 (사용자 트리거) |

## 4. 액션 아이템

| 담당자 | 내용 | 기한 | 우선순위 |
|--------|------|------|---------|
| 이대중 | JIRA OAuth 클라이언트 구현 | 05-03 | 높음 |
| 김예린 | Integration 자동 INSERT | 04-29 | 보통 |
| 홍정우 | Slack 채널 연동 프론트 | 05-01 | 높음 |

## 5. 다음 회의

- **일시**: 2025년 5월 3일 14:00
- **안건**: 2분기 중간 점검 및 JIRA 연동 데모
""",
            summary="2분기 개발 목표 및 역할 분담 논의. JIRA OAuth 연동·Slack 내보내기·WBS 기능 우선순위 확정.",
            status=MinuteStatus.final,
        ))

        # ── 11. 회의 2 — 회의록 ──────────────────────────────────────────────
        db.add(MeetingMinute(
            meeting_id=meeting2.id,
            content="""# 백엔드 API 설계 리뷰 회의록

**일시**: 2025년 4월 23일 14:00~15:00
**장소**: B 회의실
**참석자**: 이대중, 김예린, 홍정우

---

## 1. 논의 내용

### 1.1 REST API 엔드포인트 구조

- RESTful 원칙 준수 (명사 기반 URL)
- 도메인별 라우터 분리 (`action`, `integration`, `meeting` 등)
- BackgroundTask 패턴으로 외부 API 호출 비동기 처리

### 1.2 DB 스키마 확정

- **MySQL (포트 3307)**: users, workspaces, meetings, wbs_epics, wbs_tasks, integrations
- **MongoDB**: meeting_summaries, utterances (DB명: `meeting_assistant`)
- SQLAlchemy 2.0 스타일 (`Mapped`, `mapped_column`) 통일

## 2. 결정 사항

- SQLAlchemy 2.0 스타일 팀 전체 통일
- MySQL 포트 3307 (로컬 충돌 방지)
- MongoDB DB명 `meeting_assistant` 고정

## 3. 액션 아이템

| 담당자 | 내용 | 기한 |
|--------|------|------|
| 이대중 | MySQL 스키마 확정 및 마이그레이션 | 04-24 |
| 홍정우 | MongoDB 컬렉션 구조 문서화 | 04-24 |
""",
            summary="API 설계 리뷰 완료. DB 스키마 확정. SQLAlchemy 2.0 스타일 통일.",
            status=MinuteStatus.final,
        ))

        # ── 12. 회의 1 — 보고서 (Markdown) ──────────────────────────────────
        db.add(Report(
            meeting_id=meeting1.id,
            created_by=user_admin.id,
            format=ReportFormat.markdown,
            title="2025년 2분기 개발 킥오프 회의 보고서",
            content="""# 회의 보고서

**회의명**: 2025년 2분기 개발 킥오프 회의
**작성일**: 2025-04-26
**작성자**: 이대중

---

## 요약

2분기 개발 목표 및 역할 분담을 논의하였으며, JIRA·Slack·WBS 기능의 구현 일정을 확정하였다.

## 주요 결정 사항

1. 보고서 포맷: Markdown + Excel 우선 지원
2. 내보내기 방식: BackgroundTask 비동기 처리
3. JIRA 연동: OAuth 2.0 (3LO) 방식 채택

## WBS 요약

| 에픽 | 태스크 수 | 완료율 |
|------|---------|--------|
| 백엔드 개발 | 3 | 93% |
| 프론트엔드 개발 | 3 | 53% |
| 기획 및 문서화 | 2 | 0% |

## 액션 아이템

| 담당자 | 내용 | 기한 | 우선순위 | 긴급도 |
|--------|------|------|---------|--------|
| 이대중 | JIRA OAuth 클라이언트 구현 | 05-03 | 높음 | 긴급 |
| 김예린 | Integration 자동 INSERT | 04-29 | 보통 | 보통 |
| 홍정우 | Slack 채널 연동 프론트 | 05-01 | 높음 | 긴급 |
| 이대중 | Notion 연동 구현 | 05-10 | 보통 | 여유 |
| 홍정우 | WBS 드래그 앤 드롭 | 05-07 | 낮음 | 보통 |
""",
        ))

        db.commit()
        print("✅ [SEED] MySQL 테스트 데이터 삽입 완료")
        print("   ┌─────────────────────────────────────┐")
        print("   │  로그인 계정 (비밀번호 모두 test1234)  │")
        print("   ├─────────────────────────────────────┤")
        print("   │  admin  : test@workb.com             │")
        print("   │  member : yerin@workb.com            │")
        print("   │  member : jungwoo@workb.com          │")
        print("   └─────────────────────────────────────┘")
        print(f"   회의 {meeting1.id}개 (done×2, scheduled×1) / 에픽 5개 / 태스크 12개 생성")

    except Exception as e:
        db.rollback()
        print(f"❌ [SEED] MySQL 삽입 실패: {e}")
        import traceback; traceback.print_exc()
    finally:
        db.close()


def _seed_mongo():
    try:
        client = MongoClient(settings.MONGODB_URL, serverSelectionTimeoutMS=5000)
        client.admin.command('ping')

        _now = now_kst()
        mongo_db = client['meeting_assistant']
        col = mongo_db["meeting_summaries"]

        # ── 회의 1 요약 ────────────────────────────────────────────────────
        if not col.find_one({"meeting_id": 1}):
            col.insert_one({
                "meeting_id": 1,
                "workspace_id": 1,
                "summary": {
                    "overview": {
                        "purpose": "2025년 2분기 백엔드 개발 일정 및 역할 분담 논의",
                        "datetime_str": "2025-04-26 14:00",
                    },
                    "attendees": ["이대중", "김예린", "홍정우"],
                    "discussion_items": [
                        {
                            "topic": "WBS 일정 확정",
                            "content": "4월 말까지 백엔드 API 완성 목표. 각자 담당 도메인 기준으로 분배.",
                        },
                        {
                            "topic": "JIRA 연동 방식 결정",
                            "content": "OAuth 2.0 방식 채택. WbsEpic → Epic, WbsTask → Task 매핑.",
                        },
                        {
                            "topic": "Slack 내보내기",
                            "content": "Block Kit 형식 회의록 전송. 담당자 DM 자동 발송.",
                        },
                    ],
                    "decisions": [
                        {
                            "decision": "보고서 포맷은 Markdown과 Excel 우선 지원",
                            "rationale": "HTML은 별도 저장 없이 즉시 변환으로 충분",
                            "opposing_opinion": "",
                        },
                        {
                            "decision": "JIRA 연동은 OAuth 2.0 (3LO) 방식 채택",
                            "rationale": "API Key 대비 보안 우수, 토큰 자동 갱신 가능",
                            "opposing_opinion": "",
                        },
                    ],
                    "action_items": [
                        {
                            "assignee": "이대중",
                            "content": "JIRA OAuth 2.0 클라이언트 구현",
                            "deadline": "2025-05-03",
                            "priority": "high",
                            "urgency": "urgent",
                        },
                        {
                            "assignee": "김예린",
                            "content": "워크스페이스 생성 시 Integration 3개 자동 INSERT",
                            "deadline": "2025-04-29",
                            "priority": "medium",
                            "urgency": "normal",
                        },
                        {
                            "assignee": "홍정우",
                            "content": "Slack 채널 연동 프론트 구현",
                            "deadline": "2025-05-01",
                            "priority": "high",
                            "urgency": "urgent",
                        },
                        {
                            "assignee": "이대중",
                            "content": "회의록 Notion 연동 구현",
                            "deadline": "2025-05-10",
                            "priority": "medium",
                            "urgency": "low",
                        },
                        {
                            "assignee": "홍정우",
                            "content": "WBS 드래그 앤 드롭 프론트 구현",
                            "deadline": "2025-05-07",
                            "priority": "low",
                            "urgency": "normal",
                        },
                    ],
                    "pending_items": [],
                    "next_meeting": "2025-05-03 14:00 예정",
                    "previous_followups": [],
                    "hallucination_flags": [],
                },
                "created_at": _now.isoformat(),
                "updated_at": _now.isoformat(),
            })

        # ── 회의 2 요약 ────────────────────────────────────────────────────
        if not col.find_one({"meeting_id": 2}):
            col.insert_one({
                "meeting_id": 2,
                "workspace_id": 1,
                "summary": {
                    "overview": {
                        "purpose": "백엔드 API 설계 리뷰 및 DB 스키마 확정",
                        "datetime_str": "2025-04-23 14:00",
                    },
                    "attendees": ["이대중", "김예린", "홍정우"],
                    "discussion_items": [
                        {
                            "topic": "REST API 엔드포인트 구조 검토",
                            "content": "RESTful 원칙 준수. 도메인별 라우터 분리.",
                        },
                        {
                            "topic": "DB 스키마 확정",
                            "content": "MySQL: 구조화 데이터. MongoDB: 발화·요약. 포트 3307 확정.",
                        },
                    ],
                    "decisions": [
                        {
                            "decision": "SQLAlchemy 2.0 스타일 팀 전체 통일",
                            "rationale": "Mapped, mapped_column 사용으로 타입 안전성 강화",
                            "opposing_opinion": "",
                        }
                    ],
                    "action_items": [
                        {
                            "assignee": "이대중",
                            "content": "MySQL 스키마 확정 및 마이그레이션 스크립트 작성",
                            "deadline": "2025-04-24",
                            "priority": "high",
                            "urgency": "urgent",
                        },
                        {
                            "assignee": "홍정우",
                            "content": "MongoDB 컬렉션 구조 문서화",
                            "deadline": "2025-04-24",
                            "priority": "medium",
                            "urgency": "normal",
                        },
                    ],
                    "pending_items": [],
                    "next_meeting": "2025-04-26 14:00",
                    "previous_followups": [],
                    "hallucination_flags": [],
                },
                "created_at": (_now - timedelta(days=3)).isoformat(),
                "updated_at": (_now - timedelta(days=3)).isoformat(),
            })

        print("✅ [SEED] MongoDB 테스트 데이터 삽입 완료")

    except Exception as e:
        print(f"❌ [SEED] MongoDB 삽입 실패: {e}")
