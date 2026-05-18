# app\core\graph\supervisor.py

from app.core.graph.state import SharedState

async def supervisor_node(state: SharedState):
    """
    중앙 통제실:
    SharedState를 기반으로 다음 노드를 결정
    """

    # 0단계: 연동 설정 로드 
    if not state.get("integration_settings"):
        return {"next_node": "integration"}

    transcript = state.get("transcript", "")
    retrieved_docs = state.get("retrieved_docs")
    summary = state.get("summary")

    # 1단계: 검색 필요
    if transcript and not retrieved_docs:
        return {
            "next_node": "knowledge",
            "search_query": transcript
        }

    # 2단계: 요약 필요
    if retrieved_docs and not summary:
        return {
            "next_node": "intelligence"
        }

    # 종료
    return {"next_node": "end"}