import sys, os, time, json, re

_BACKEND_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_SCRIPTS_DIR = os.path.abspath(os.path.dirname(__file__))
sys.path[:0] = [_BACKEND_ROOT, _SCRIPTS_DIR]

import matplotlib.pyplot as plt
import matplotlib
matplotlib.rcParams['font.family'] = 'AppleGothic'
import numpy as np
from transformers import pipeline
from langchain_openai import ChatOpenAI
from langchain_community.tools.tavily_search import TavilySearchResults
from langgraph.prebuilt import ToolNode, tools_condition
from langgraph.graph import StateGraph, MessagesState, END
from app.core.config import settings
from app.utils.redis_utils import get_meeting_context
from app.domains.knowledge.agent_utils import (
    search_past_meetings, search_internal_db,
    register_calendar, update_calendar_event,
    delete_calendar_event, get_calendar_events
)

MEETING_ID = "test-meeting-001"
WORKSPACE_ID = "workspace-001"
SAVE_MODELS = {"gpt-4o", "gpt-4o-mini", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"}

MODELS = {
    "gpt-4o": ChatOpenAI(model="gpt-4o", api_key=settings.OPENAI_API_KEY),
    "gpt-4o-mini": ChatOpenAI(model="gpt-4o-mini", api_key=settings.OPENAI_API_KEY),
    "gpt-5.4":      ChatOpenAI(model="gpt-5.4",      api_key=settings.OPENAI_API_KEY),
    "gpt-5.4-mini": ChatOpenAI(model="gpt-5.4-mini", api_key=settings.OPENAI_API_KEY),
    "gpt-5.4-nano": ChatOpenAI(model="gpt-5.4-nano", api_key=settings.OPENAI_API_KEY),
}

# -- Zero-shot NLI 불확실성 감지 --
# 모듈 로드 시 한 번만 초기화 (추론마다 모델 로드하지 않음)
_nli = pipeline(
    "zero-shot-classification",
    model="MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7",
)

def uncertainty_score(answer: str) -> float:
    """
    답변이 불확실성을 표현하는 정도를 0~1로 반환.
    키워드 매칭 대신 NLI로 의미 기반 판단.
    """
    result = _nli(answer, candidate_labels=['불확실한 표현', '확실한 표현'])
    idx = result['labels'].index('불확실한 표현')
    return round(result['scores'][idx], 4)

TEST_CASES = [
    # ── 발화 기반 질문 ──────────────────────────────
    {
        "question": "오늘 결정된 사항이 뭐야?",
        "expected_keywords": ["결정", "마케팅", "예산"],
        "ground_truth": "마케팅 예산 500만원으로 결정, 다음 회의 4월 20일",
        "requires_uncertainty": False,
        "expect_tool": None,
    },
    {
        "question": "마케팅 예산이 얼마로 결정됐어?",
        "expected_keywords": ["500만원", "마케팅"],
        "ground_truth": "마케팅 예산은 500만원으로 결정됐습니다",
        "requires_uncertainty": False,
        "expect_tool": None,
    },
    {
        "question": "다음 회의 일정이 언제야?",
        "expected_keywords": ["4월 20일"],
        "ground_truth": "다음 회의는 4월 20일",
        "requires_uncertainty": False,
        "expect_tool": None,
    },
    {
        "question": "오늘 회의에서 미결된 사항이 있어?",
        "expected_keywords": [],
        "ground_truth": None,
        "requires_uncertainty": True,
        "expect_tool": None,
    },
    {
        "question": "누가 마케팅 예산 결정했어?",
        "expected_keywords": [],
        "ground_truth": None,
        "requires_uncertainty": True,
        "expect_tool": None,
    },

    # ── 요약 ────────────────────────────────────────
    {
        "question": "오늘 회의 요약해줘",
        "expected_keywords": ["논의", "결정", "미결"],
        "ground_truth": None,
        "requires_uncertainty": False,
        "expect_tool": None,
    },
    {
        "question": "지금까지 논의된 내용 정리해줘",
        "expected_keywords": ["논의", "결정"],
        "ground_truth": None,
        "requires_uncertainty": False,
        "expect_tool": None,
    },

    # ── 웹 검색 ─────────────────────────────────────
    {
        "question": "마케팅 최신 트렌드 검색해줘",
        "expected_keywords": [],
        "ground_truth": None,
        "requires_uncertainty": False,
        "expect_tool": "tavily_search_results_json",
    },
    {
        "question": "경쟁사 A사 최근 마케팅 전략 알아봐줘",
        "expected_keywords": [],
        "ground_truth": None,
        "requires_uncertainty": False,
        "expect_tool": "tavily_search_results_json",
    },
    {
        "question": "SNS 광고 단가 요즘 얼마야?",
        "expected_keywords": [],
        "ground_truth": None,
        "requires_uncertainty": False,
        "expect_tool": "tavily_search_results_json",
    },

    # ── 이전 회의 검색 ──────────────────────────────
    {
        "question": "지난 회의에서 예산 관련해서 뭐 얘기했어?",
        "expected_keywords": [],
        "ground_truth": None,
        "requires_uncertainty": True,
        "expect_tool": "search_past_meetings",
    },
    {
        "question": "이전에 마케팅 전략 회의한 적 있어?",
        "expected_keywords": [],
        "ground_truth": None,
        "requires_uncertainty": True,
        "expect_tool": "search_past_meetings",
    },

    # ── 회의에 없는 정보 ────────────────────────────
    {
        "question": "지난 분기 매출이 얼마야?",
        "expected_keywords": [],
        "ground_truth": None,
        "requires_uncertainty": True,
        "expect_tool": None,
    },
    {
        "question": "팀원 김철수 연락처 알아?",
        "expected_keywords": [],
        "ground_truth": None,
        "requires_uncertainty": True,
        "expect_tool": None,
    },

    # ── 캘린더 ──────────────────────────────────────
    # {
    #     "question": "4월 20일 오후 2시에 팀 미팅 일정 등록해줘",
    #     "expected_keywords": ["등록", "4월 20일"],
    #     "ground_truth": None,
    #     "requires_uncertainty": False,
    #     "expect_tool": "register_calendar",
    # },
    # {
    #     "question": "다음 회의 일정 캘린더에 추가해줘",
    #     "expected_keywords": ["등록"],
    #     "ground_truth": None,
    #     "requires_uncertainty": False,
    #     "expect_tool": "register_calendar",
    # },
    # {
    #     "question": "이번 주 일정 보여줘",
    #     "expected_keywords": [],
    #     "ground_truth": None,
    #     "requires_uncertainty": False,
    #     "expect_tool": "get_calendar_events",
    # },
]

web_search = TavilySearchResults(max_results=5, tavily_api_key=settings.TAVILY_API_KEY)
tools = [
    web_search, search_past_meetings, search_internal_db,
    # register_calendar, update_calendar_event,
    # delete_calendar_event, get_calendar_events
]

def build_agent(model):
    llm_with_tools = model.bind_tools(tools)

    def agent_node(state):
        return {"messages": [llm_with_tools.invoke(state["messages"])]}

    graph = StateGraph(MessagesState)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", ToolNode(tools))
    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", tools_condition)
    graph.add_edge("tools", "agent")
    return graph.compile()

def build_system_prompt() -> str:
    context = get_meeting_context(MEETING_ID)
    return f"""당신은 회의 AI 어시스턴트입니다.

현재 회의 발화 내용:
{context}

규칙:
- 회의 발화 데이터는 최대 약 30초 전까지의 내용만 반영됩니다. 가장 최근 발화는 포함되지 않을 수 있음을
답변에 명시하세요.
- 회의 내용만으로 답할 수 있으면 도구 없이 답변하세요.
- 정보가 불완전하더라도 회의에서 언급된 내용을 바탕으로 최대한 답변하세요.
- 확실하지 않은 정보는 "~라고 언급됐습니다" 형식으로 답변하세요.
- 외부 자료가 필요하면 web_search를 사용하세요.
- 이전 회의 내용이 필요하면 search_past_meetings를 사용하세요.
- 회사 내부 문서가 필요하면 search_internal_db를 사용하세요.
- 일정 등록 요청이면 register_calendar를 사용하세요.
- 일정 수정 요청이면 update_calendar_event를 사용하세요.
- 일정 삭제 요청이면 delete_calendar_event를 사용하세요.
- 특정 날짜나 일정에 대해 물어보면 get_calendar_events를 사용하세요.
- 일정 종료 시간이 언급되지 않았으면 시작 시간 기준 1시간 후로 설정하세요."""

def evaluate_one(model_name: str, model, case: dict) -> dict:
    agent = build_agent(model)
    system_prompt = build_system_prompt()

    start = time.time()
    try:
        result = agent.invoke({
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": case["question"]}
            ]
        })
        latency = time.time() - start
        raw = result["messages"][-1].content
        if isinstance(raw, list):
            answer = "".join(
                part if isinstance(part, str) else str(part) for part in raw
            )
        elif raw is None:
            answer = ""
        else:
            answer = str(raw)

        tools_used = []
        for m in result["messages"]:
            if hasattr(m, "tool_calls") and m.tool_calls:
                tools_used.extend([tc["name"] for tc in m.tool_calls])

        meta = getattr(result["messages"][-1], "usage_metadata", None) or {}
        error = None
    except Exception as e:
        return {"model": model_name, "case": case["question"], "error": str(e)}

    # 1. 키워드 포함률
    keyword_hits = sum(1 for kw in case["expected_keywords"] if kw in answer)
    keyword_score = keyword_hits / len(case["expected_keywords"]) if case["expected_keywords"] else None

    # 2. 30초 딜레이 고지
    delay_notice = "30초" in answer or "최근 발화" in answer

    # 3. 불확실성 표현
    u_score = None
    if case["requires_uncertainty"]:
        u_score = uncertainty_score(answer)

    # 4. 한국어 어조
    formal_korean = "습니다" in answer or "입니다" in answer

    # 5. ROUGE-1
    rouge_score = None
    if case["ground_truth"]:
        ref_tokens = set(case["ground_truth"].split())
        hyp_tokens = set(answer.split())
        rouge_score = len(ref_tokens & hyp_tokens) / len(ref_tokens) if ref_tokens else None

    # 6. 도구 선택 정확도
    expected_tool = case.get("expect_tool")
    tool_correct = None
    if expected_tool:
        tool_correct = 1.0 if expected_tool in tools_used else 0.0

    return {
        "model": model_name,
        "case": case["question"],
        "latency": round(latency, 2),
        "input_tokens": meta.get("input_tokens", 0),
        "output_tokens": meta.get("output_tokens", 0),
        "answer_length": len(answer),
        "keyword_score": keyword_score,
        "delay_notice": delay_notice,
        "uncertainty_score": u_score,
        "formal_korean": formal_korean,
        "rouge_score": rouge_score,
        "tool_correct": tool_correct,
        "tools_used": tools_used,
        "answer": answer,
        "error": None,
    }

def get_avg(metric, model_name, all_results):
    vals = [r[metric] for r in all_results
            if r["model"] == model_name
            and r.get(metric) is not None
            and not r.get("error")]
    return np.mean(vals) if vals else 0

def visualize(all_results: list[dict]):
    model_names = list(MODELS.keys())

    fig, axes = plt.subplots(2, 3, figsize=(18, 11))
    fig.suptitle("챗봇 모델 비교 평가 (Knowledge 도메인) — 베이스라인", fontsize=15)

    # 1. 평균 응답 시간
    ax = axes[0][0]
    latencies = [get_avg("latency", m, all_results) for m in model_names]
    bars = ax.bar(model_names, latencies, color="steelblue")
    ax.set_title("평균 응답 시간 (초)")
    ax.tick_params(axis='x', rotation=20)
    for bar, val in zip(bars, latencies):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.1,
                f"{val:.1f}s", ha='center', fontsize=9)

    # 2. 평균 입력 토큰
    ax = axes[0][1]
    tokens = [get_avg("input_tokens", m, all_results) for m in model_names]
    bars = ax.bar(model_names, tokens, color="coral")
    ax.set_title("평균 입력 토큰")
    ax.tick_params(axis='x', rotation=20)
    for bar, val in zip(bars, tokens):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 5,
                f"{int(val)}", ha='center', fontsize=9)

    # 3. 키워드 포함률
    ax = axes[0][2]
    kw_scores = [get_avg("keyword_score", m, all_results) for m in model_names]
    bars = ax.bar(model_names, kw_scores, color="mediumseagreen")
    ax.set_ylim(0, 1)
    ax.set_title("키워드 포함률")
    ax.tick_params(axis='x', rotation=20)
    for bar, val in zip(bars, kw_scores):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.02,
                f"{val:.0%}", ha='center', fontsize=9)

    # 4. 규칙 준수율
    ax = axes[1][0]
    x = np.arange(len(model_names))
    width = 0.25
    metrics = {
        "딜레이고지": [get_avg("delay_notice", m, all_results) for m in model_names],
        "불확실성표현": [get_avg("uncertainty_score", m, all_results) for m in model_names],
        "한국어어조": [get_avg("formal_korean", m, all_results) for m in model_names],
    }
    colors = ["steelblue", "coral", "mediumseagreen"]
    for i, (label, values) in enumerate(metrics.items()):
        ax.bar(x + i * width, values, width, label=label, color=colors[i])
    ax.set_xticks(x + width)
    ax.set_xticklabels(model_names, fontsize=8, rotation=20)
    ax.set_ylim(0, 1)
    ax.set_title("규칙 준수율")
    ax.legend(fontsize=8)

    # 5. 도구 선택 정확도
    ax = axes[1][1]
    tool_scores = [get_avg("tool_correct", m, all_results) for m in model_names]
    bars = ax.bar(model_names, tool_scores, color="mediumpurple")
    ax.set_ylim(0, 1)
    ax.set_title("도구 선택 정확도")
    ax.tick_params(axis='x', rotation=20)
    for bar, val in zip(bars, tool_scores):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.02,
                f"{val:.0%}", ha='center', fontsize=9)

    # 6. 종합 비교
    ax = axes[1][2]
    categories = ["응답속도\n(역수)", "키워드\n포함", "도구선택\n정확도", "규칙\n준수"]
    x = np.arange(len(categories))
    width = 0.2
    max_lat = max(get_avg("latency", m, all_results) for m in model_names) or 1
    palette = [
        "steelblue", "coral", "mediumseagreen", "mediumpurple",
        "darkorange", "olive", "brown", "teal",
    ]
    n_models = len(model_names)
    for i, model in enumerate(model_names):
        rule_score = np.mean([
            get_avg("delay_notice", model, all_results),
            get_avg("formal_korean", model, all_results),
            get_avg("uncertainty_score", model, all_results),
        ])
        values = [
            1 - get_avg("latency", model, all_results) / max_lat,
            get_avg("keyword_score", model, all_results),
            get_avg("tool_correct", model, all_results),
            rule_score,
        ]
        ax.bar(x + i * width, values, width, label=model, color=palette[i % len(palette)])
    ax.set_xticks(x + width * (n_models - 1) / 2)
    ax.set_xticklabels(categories, fontsize=8)
    ax.set_ylim(0, 1)
    ax.set_title("종합 비교")
    ax.legend(fontsize=7)

    plt.tight_layout()
    out_png = os.path.join(_SCRIPTS_DIR, "chatbot_eval_result.png")
    plt.savefig(out_png, dpi=150)
    print(f"\n결과 저장: {out_png}")
    plt.show()

    # 정성 평가 출력
    print("\n" + "="*60)
    print("[정성 평가]")
    for case in TEST_CASES:
        print(f"\n질문: {case['question']}")
        for r in all_results:
            if r["case"] == case["question"] and not r.get("error"):
                print(f"  [{r['model']}]")
                print(f"    도구: {r['tools_used'] or '없음'}")
                ans = r.get("answer") or ""
                print(f"    답변: {str(ans)[:120]}")

if __name__ == "__main__":
    print("챗봇 모델 베이스라인 평가 시작...\n")
    all_results = []

    for case in TEST_CASES:
        print(f"질문: {case['question']}")
        for model_name, model in MODELS.items():
            print(f"  → {model_name} 테스트 중...")
            r = evaluate_one(model_name, model, case)
            all_results.append(r)
            if r.get("error"):
                print(f"    오류: {r['error']}")
            else:
                print(f"    latency: {r['latency']}s | 도구: {r['tools_used'] or '없음'}")

    visualize(all_results)

    # 단계별 토큰 저장
    from token_tracker import save_token_record
    save_token_record("베이스라인", all_results)

    with open(os.path.join(_SCRIPTS_DIR, "eval_results_external.json"), "w", encoding="utf-8") as f:
        json.dump(
            [r for r in all_results if r["model"] in SAVE_MODELS],
            f, ensure_ascii=False, indent=2, default=str
        )
    print(f"외부 LLM 평가 결과 저장: {os.path.join(_SCRIPTS_DIR, 'eval_results_external.json')}")