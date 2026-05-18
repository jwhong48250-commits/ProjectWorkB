# app\domains\knowledge\router.py
import uuid
from fastapi import BackgroundTasks
from datetime import date
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.graph.workflow import knowledge_app
from app.domains.workspace.deps import require_workspace_member
from app.domains.knowledge.schemas import (
    ChatbotHistoryMessage,
    ChatbotHistoryResponse,
    ChatbotMessageRequest,
    ChatbotMessageResponse,
    ChatbotReportRequest,
    DocumentUploadResponse,
    PastMeetingsResponse,
    PastMeetingItem,
)
from app.domains.meeting.schemas import MeetingSearchParams, MeetingSearchResponse
from app.domains.meeting.service import MeetingSearchService
from app.domains.knowledge import repository
from app.utils.time_utils import now_kst
from app.domains.knowledge.agent_utils import quick_report_node
from app.domains.knowledge.service import ingest_document, analyze_document_for_display
from app.domains.user.repository import get_user_by_id
from app.domains.user.service import user_profile_context

router = APIRouter()

# 지원 확장자 -> file_type 매핑
_EXT_MAP = {
    "pdf": "pdf",
    "pptx": "pptx",
    "ppt": "pptx",
    "html": "html",
    "htm": "html",
    "md": "md",
    "markdown": "md",
    "docx": "docx",
    "doc": "doc",
    "xlsx": "xlsx",
    "xls": "xls",
}


@router.get(
    "/workspaces/{workspace_id}/meetings/search",
    response_model=MeetingSearchResponse,
)
def search_workspace_meetings(
    workspace_id: int,
    db: Session = Depends(get_db),
    _member: int = Depends(require_workspace_member),
    keyword: Optional[str] = Query(None, description="회의 제목 부분 일치 검색"),
    from_date: Optional[date] = Query(
        None, description="scheduled_at 기준 시작일(포함)"
    ),
    to_date: Optional[date] = Query(None, description="scheduled_at 기준 종료일(포함)"),
    participant_id: Optional[int] = Query(
        None, description="해당 user_id가 참석자로 포함된 회의만"
    ),
):
    """
    키워드·날짜·참석자 조건으로 워크스페이스 내 과거/예정 회의를 검색합니다.
    """
    params = MeetingSearchParams(
        keyword=keyword,
        from_date=from_date,
        to_date=to_date,
        participant_id=participant_id,
    )
    return MeetingSearchService.search(db, workspace_id, params)


@router.post("/workspace/{workspace_id}/chatbot/message")
async def chatbot_message(
    workspace_id: int,
    req: ChatbotMessageRequest,
    session_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user_id: int = Depends(require_workspace_member),
):
    from app.domains.workspace.repository import get_workspace_membership
    from app.domains.workspace.models import MemberRole

    session_id = session_id or str(uuid.uuid4())
    user = get_user_by_id(db, current_user_id)

    membership = get_workspace_membership(db, workspace_id, current_user_id)
    is_admin = membership is not None and membership.role == MemberRole.admin

    state = {
        "session_id": session_id,
        "meeting_id": req.meeting_id,
        "workspace_id": workspace_id,
        "user_id": current_user_id,
        "is_admin": is_admin,
        "user_profile": user_profile_context(user) if user else {},
        "user_question": req.message,
        "past_meeting_ids": req.past_meeting_ids,
        "function_type": "",
        "chat_response": "",
    }
    result = await knowledge_app.ainvoke(state)

    import logging as _rlog

    _cm = result.get("candidate_meetings")
    _rlog.getLogger(__name__).warning(
        "[router] function_type=%r candidate_meetings=%s",
        result.get("function_type"),
        len(_cm) if _cm else None,
    )

    await repository.save_chat_log(
        workspace_id, current_user_id, session_id, "user", req.message, ""
    )
    await repository.save_chat_log(
        workspace_id,
        current_user_id,
        session_id,
        "assistant",
        result["chat_response"],
        result["function_type"],
        active_meeting_ids=result.get("active_meeting_ids"),
    )

    return ChatbotMessageResponse(
        session_id=session_id,
        function_type=result["function_type"],
        answer=result["chat_response"],
        result={
            "sources": result.get("web_sources", []),
            "action_button": result.get("action_button"),
            "candidate_meetings": result.get("candidate_meetings"),
        },
        timestamp=now_kst(),
    )


@router.get(
    "/workspace/{workspace_id}/chatbot/history", response_model=ChatbotHistoryResponse
)
async def chatbot_history(workspace_id: int, session_id: str):
    logs = await repository.get_chat_history(workspace_id, session_id)
    return ChatbotHistoryResponse(
        messages=[
            ChatbotHistoryMessage(
                role=log["role"],
                content=log["content"],
                function_type=log["function_type"],
                timestamp=log["timestamp"],
            )
            for log in logs
        ]
    )


@router.get(
    "/workspace/{workspace_id}/past_meetings", response_model=PastMeetingsResponse
)
async def get_past_meetings_endpont(
    workspace_id: int,
    db: Session = Depends(get_db),
    current_user_id: int = Depends(require_workspace_member),
):
    from app.domains.workspace.repository import get_workspace_membership
    from app.domains.workspace.models import MemberRole

    membership = get_workspace_membership(db, workspace_id, current_user_id)
    is_admin = membership is not None and membership.role == MemberRole.admin
    filter_user_id = None if is_admin else current_user_id

    meetings = await repository.get_past_meetings(workspace_id, user_id=filter_user_id)
    return PastMeetingsResponse(
        meetings=[PastMeetingItem(**m) for m in meetings],
        total=len(meetings),
    )


@router.post("/workspace/{workspace_id}/chatbot/sessions")
async def create_chatbot_session(
    workspace_id: int, _memeber: int = Depends(require_workspace_member)
):
    """새 대화 시작 — 새 session_id 발급."""
    return {"session_id": str(uuid.uuid4())}


@router.get("/workspace/{workspace_id}/chatbot/sessions")
async def list_chatbot_sessions(
    workspace_id: int,
    _memeber: int = Depends(require_workspace_member),
):
    """전 대화 목록 조회."""
    sessions = await repository.get_chat_sessions(workspace_id)
    return {"sessions": sessions}


@router.patch("/workspace/{workspace_id}/chatbot/sessions/{session_id}")
async def rename_chatbot_session(
    workspace_id: int,
    session_id: str,
    body: dict,
    _member: int = Depends(require_workspace_member),
):
    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=422, detail="title은 비워둘 수 없습니다.")
    updated = await repository.rename_chat_session(workspace_id, session_id, title)
    if not updated:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
    return {"status": "updated"}


@router.delete("/workspace/{workspace_id}/chatbot/sessions/{session_id}")
async def delete_chatbot_session(
    workspace_id: int,
    session_id: str,
    _member: int = Depends(require_workspace_member),
):
    deleted = await repository.delete_chat_session(workspace_id, session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
    return {"status": "deleted"}


@router.post("/workspace/{workspace_id}/chatbot/quick_report")
async def chatbot_report(
    workspace_id: int,
    req: ChatbotReportRequest,
    background_tasks: BackgroundTasks,
):
    state = {
        "meeting_id": req.meeting_id,
        "workspace_id": workspace_id,
        "past_meeting_ids": req.past_meeting_ids,
        "user_question": "",
        "function_type": "",
        "chat_response": "",
    }
    # 백그라운드로 실행 — 회의 종료 시 fire-and-forget 호출용
    # quick_report_node 내부에서 meeting_summaries에 저장까지 처리
    background_tasks.add_task(_run_quick_report, workspace_id, state)
    return {"status": "accepted"}


async def _run_quick_report(workspace_id: int, state: dict):
    """백그라운드 quick_report 생성 헬퍼."""
    try:
        await quick_report_node(state)
    except Exception:
        pass  # 백그라운드 실패는 조용히 무시


@router.post(
    "/workspace/{workspace_id}/documents", response_model=DocumentUploadResponse
)
async def upload_document(
    workspace_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
):
    """
    내부 문서 업로드 -> ChromaDB 임베딩 저장.
    같은 파일 재업로드 시 기존 벡터를 덮어씀 (중복 없음).
    스캔 이미지 PDF처럼 텍스트 추출 불가 시 422 반환.
    """
    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    file_type = _EXT_MAP.get(ext)
    if not file_type:
        supported = ", ".join(f".{e}" for e in _EXT_MAP)
        raise HTTPException(
            status_code=415,
            detail=f".{ext}는 지원하지 않는 형식입니다. 지원 형식: {supported}",
        )

    file_bytes = await file.read()

    background_tasks.add_task(
        ingest_document,
        workspace_id=workspace_id,
        filename=file.filename,
        file_type=file_type,
        file_bytes=file_bytes,
        title=title,
    )

    return DocumentUploadResponse(
        doc_id=f"{workspace_id}_{file.filename}",
        chunks=-1,
        title=title or file.filename,
        uploaded_at=now_kst(),
    )


@router.post("/workspace/{workspace_id}/documents/analyze")
async def analyze_document_endpoint(
    workspace_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
):
    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    file_type = _EXT_MAP.get(ext)
    if not file_type:
        raise HTTPException(
            status_code=415, detail=f".{ext}는 지원하지 않는 형식입니다."
        )

    file_bytes = await file.read()

    result = await analyze_document_for_display(
        workspace_id=workspace_id,
        filename=file.filename,
        file_bytes=file_bytes,
        file_type=file_type,
        title=title,
    )

    background_tasks.add_task(
        ingest_document,
        workspace_id=workspace_id,
        filename=file.filename,
        file_type=file_type,
        file_bytes=file_bytes,
        title=title,
    )

    return {**result, "timestamp": now_kst().isoformat()}
