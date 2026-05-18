# app\core\graph\state.py
from typing import TypedDict, List, Optional, Annotated
import operator

class SharedState(TypedDict):
    # --- 1. 서비스 및 흐름 제어 (Control Plane) ---
    next_node: str               # 다음에 실행할 노드명
    current_scenario: str        # 현재 진행 중인 시나리오 ID (SCN-001 등)
    workspace_id: int            # 웹 온보딩에서 생성된 워크스페이스 고유 ID
    meeting_id: int              # 현재 세션의 회의 ID (기록 열람 및 저장용)
    user_id: int                 # 현재 로그인 사용자 ID
    is_admin: bool               # 워크스페이스 admin 여부 (WorkspaceMember.role == admin)
    session_id: str
    
    # --- 2. Meeting 도메인 (Scribe) ---
    # 실시간 발화 스트림 및 화자 정보를 누적 저장
    transcript: Annotated[List[dict], operator.add] # [{speaker: str, text: str, timestamp: str}]
    
    # --- 3. Knowledge 도메인 (Researcher) ---
    search_query: str            # RAG 검색 및 외부 지식 탐색을 위한 쿼리
    retrieved_docs: List[dict]   # 검색된 과거 회의록 또는 외부 자료 리스트
    chat_history: Annotated[List[dict], operator.add] # [챗봇] 대화 맥락 유지용 히스토리
    user_question: str           # 사용자가 챗봇에게 던진 개별 질문
    user_profile: dict           # 현재 로그인 사용자 프로필(이름, 나이, 연락처 등)
    chat_response: str           # 챗봇의 최종 답변
    past_meeting_ids: Optional[List[int]] # None = 전체, [1, 2, 3] = 선택된 이전 회의만
    active_meeting_ids: Optional[List[int]] # 세션 활성 회의 ID (이전 턴에서 논의된 회의들)
    candidate_meetings: Optional[List[dict]] # 선택기에 표시할 후보 회의 목록 (날짜 필터 적용)
    function_type: str           # "chat|search|summary|report|calendar|agent"
    web_sources: List[dict]      # 웹검색 결과 [{title, url, snippet}]
    
    # --- 4. Intelligence 도메인 (Analyst) ---
    summary: dict                 # 회의 전체 요약본 (초안 및 최종본)
    decisions: List[str]         # 도출된 주요 결정사항 및 미결 이슈 목록
    hallucination_flags: List[str]   # 요약/보고서에서 근거 불충분으로 검증 필요한 항목
    previous_context: str        # [회의 전] AI가 정리한 이전 회의 맥락 데이터
    
    # --- 5. Vision 도메인 (Interpreter) ---
    screenshot_analysis: str     # 공유 화면/이미지에서 추출된 OCR 및 맥락 해석 텍스트
    
    # --- 6. Action 도메인 (Architect) ---
    wbs: List[dict]              # [회의 후] 생성된 WBS [{task: str, owner: str, due: str}]
    realtime_actions: List[dict] # [회의 중] 실시간 감지된 액션 아이템 패널 데이터
    external_links: dict         # Jira 티켓, Google Calendar 이벤트, 내보내기 링크 정보
    
    # --- 7. 연동 및 품질 관리 (Integration & Quality) ---
    integration_settings: dict   # OAuth로 연결된 서비스 상태 (Jira, Slack, Calendar 등)
    accuracy_score: float        # 결과물(요약, WBS)에 대한 품질 점수 (0~1)
    errors: List[str]            # 각 노드 실행 중 발생한 에러 로그 누적
