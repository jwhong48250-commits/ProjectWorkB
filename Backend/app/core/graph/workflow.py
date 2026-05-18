# app\core\graph\workflow.py

from langgraph.graph import StateGraph, END
from app.core.graph.state import SharedState
from app.core.graph.supervisor import supervisor_node
from app.domains.knowledge.agent_utils import (
    classify_intent, knowledge_node, past_summary_node,
    quick_report_node, report_guide_node,
)

from app.domains.integration.service import load_integration_settings
from app.infra.database.session import SessionLocal

async def integration_node(state: SharedState) -> dict:
    db = SessionLocal()
    try:
        return await load_integration_settings(state, db)
    finally:
        db.close()

workflow = StateGraph(SharedState)

# 1. 노드 등록 (Placeholder)
workflow.add_node("supervisor", supervisor_node)
workflow.add_node("meeting", lambda state: {"next_node": "supervisor"})
workflow.add_node("knowledge", lambda state: {"next_node": "supervisor"})
workflow.add_node("intelligence", lambda state: {"next_node": "supervisor"})
workflow.add_node("vision", lambda state: {"next_node": "supervisor"})
workflow.add_node("action", lambda state: {"next_node": "supervisor"})
workflow.add_node("quality", lambda state: {"next_node": "supervisor"})
workflow.add_node("integration", integration_node)

# 2. 시작점
workflow.set_entry_point("supervisor")

# 3. 조건부 라우팅 (Supervisor → 각 도메인)
workflow.add_conditional_edges(
    "supervisor",
    lambda state: state["next_node"],
    {
        "meeting": "meeting",
        "knowledge": "knowledge",
        "intelligence": "intelligence",
        "vision": "vision",
        "action": "action",
        "quality": "quality",
        "integration": "integration",
        "end": END,
    }
)

# 4. 모든 노드는 작업 후 Supervisor로 복귀
for node in ["meeting", "knowledge", "intelligence", "vision", "action", "quality", "integration"]:
    workflow.add_edge(node, "supervisor")

# 5. 컴파일
app_graph = workflow.compile()

# knowledge 노드를 서브그래프로 교체
knowledge_graph = StateGraph(SharedState)
knowledge_graph.add_node("classifier", classify_intent)
knowledge_graph.add_node("knowledge_agent", knowledge_node)
knowledge_graph.add_node("past_summary", past_summary_node)
knowledge_graph.add_node("quick_report", quick_report_node)
knowledge_graph.add_node("report_guide", report_guide_node)

knowledge_graph.set_entry_point("classifier")
knowledge_graph.add_conditional_edges(
    "classifier",
    # state["function_type"] 값에 따라 해당 노드로 이동
    lambda state: state["function_type"],
    {
        "past_summary": "past_summary",
        "quick_report": "quick_report",
        "report_guide": "report_guide",
        "agent": "knowledge_agent",
    }
)
knowledge_graph.add_edge("knowledge_agent", END)
knowledge_graph.add_edge("report_guide", END)
# past_summary, quick_report → 회의 특정 후 knowledge_agent로 위임
knowledge_graph.add_conditional_edges(
    "past_summary",
    lambda state: "knowledge_agent" if state.get("active_meeting_ids") and not state.get("chat_response") else END,
    {"knowledge_agent": "knowledge_agent", END: END},
)
knowledge_graph.add_conditional_edges(
    "quick_report",
    lambda state: "knowledge_agent" if state.get("active_meeting_ids") and not state.get("chat_response") else END,
    {"knowledge_agent": "knowledge_agent", END: END},
)

knowledge_app = knowledge_graph.compile()