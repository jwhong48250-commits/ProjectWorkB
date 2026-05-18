"""
token_tracker.py - 단계별 토큰/품질/비용 누적 기록

모든 평가 스크립트(evaluate_chatbot.py, evaluate_embeddings.py, evaluate_cache.py)에서
save_token_record()를 호출해 token_history.jsonl에 한 줄씩 기록한다.
visualize_all.py는 이 파일을 읽어 전체 단계를 종합 시각화한다.

단독 실행 시: python token_tracker.py
-> token_history.jsonl을 읽어 토큰/응답시간 3-패널 빠른 비교 출력
(전체 9단계 종합 시각화는 visualize_all.py 사용)
"""
import json
import numpy as np
import matplotlib
import matplotlib.pyplot as plt
from datetime import datetime
from pathlib import Path

# token_history.jsonl 위치: scripts/ 폴더 안 (이 파일과 같은 위치)
HISTORY_PATH = Path(__file__).parent / "token_history.jsonl"

# -- 모델별 토큰 단가 (USD per 1K tokens, 2026-04 기준) --
# 비용 계산에 사용. 모델명이 없으면 "default" (gpt-4o 단가) 적용.
TOKEN_PRICE = {
    # ── GPT-5.4 계열 ───────────────────────────────────────────────────────
    "gpt-5.4":        {"input": 0.0025,   "output": 0.015},    # $2.50 / $15 per MTok
    "gpt-5.4-mini":   {"input": 0.00075,  "output": 0.0045},   # $0.75 / $4.50 per MTok
    "gpt-5.4-nano":   {"input": 0.0002,   "output": 0.00125},  # $0.20 / $1.25 per MTok

    # ── GPT-4o 계열 (기존 유지) ────────────────────────────────────────────
    "gpt-4o":         {"input": 0.0025,   "output": 0.010},
    "gpt-4o-mini":    {"input": 0.00015,  "output": 0.0006},

    # ── 임베딩 (출력 토큰 없음) ────────────────────────────────────────────
    "text-embedding-3-small": {"input": 0.00002, "output": 0.0},

    # ── 모델명 없을 때 기본값 ──────────────────────────────────────────────
    "default":              {"input": 0.0025,   "output": 0.015},
}

# ── 내부 헬퍼 ─────────────────────────────────────────────────────────────
def _calc_cost(results: list[dict]) -> float:
    """
    results 리스트 전체의 예상 비용(USD)을 합산해 변환.

    - error가 있는 케이스는 제외
    - r["model"]이 없으면 "default" 단가 사용
    - 소수점 6자리까지 반올림 (마이크로달러 단위)
    """
    total = 0.0
    for r in results:
        if r.get("error"):
            continue
        price = TOKEN_PRICE.get(r.get("model", "default"), TOKEN_PRICE["default"])
        total += (r.get("input_tokens", 0) / 1000) * price["input"]
        total += (r.get("output_tokens", 0) / 1000) * price["output"]
    return round(total, len(TOKEN_PRICE))

def _avg(key: str, records: list[dict]):
    """
    records에서 key 필드의 평균을 계산.

    - None이거나 error가 있는 항목은 제외
    - 유효한 값이 하나도 없으면 None 반환 (0 대신 None -> 시각화에서 구분 가능)
    """
    vals = [r[key] for r in records if r.get(key) is not None and not r.get("error")]
    return round(float(np.mean(vals)), len(TOKEN_PRICE) - 2) if vals else None

# -- 공개 API --
def save_token_record(step: str, results: list[dict]):
    """
    각 단계 평가 직후 호출. 토큰・품질・비용을 token_history.jsonl에 한 줄 추가

    Args:
        step: 단계 이름
        results: 평가 결과 딕셔너리 리스트. 각 항목은 아래 필드를 포함할 수 있음:
                필수: input_tokens (int)
                선택: ouput_tokens, latency, model,
                    keyword_score, rouge_score, tool_correct, uncertainty_socre,
                    cache_hit (evaluate_cache.py 전용),
                    error (있으면 해당 케이스 제외)

    저장 형식 예시:
        {"step": "베이스라인", "timestamp": "2026-04-16T...",
        "avg_input_tokens": 820.0, "estimated_cost_usd": 0.002050, ...}
    """
    # error 없고 input_tokens가 있는 케이스만 집계
    valid = [r for r in results if not r.get("error") and r.get("input_tokens") is not None]
    if not valid:
        print(f"[{step}] 저장할 유효한 결과 없음")
        return
    
    record = {
        "step": step,
        "timestamp": datetime.now().isoformat(),
        "n_cases": len(valid),

        # -- 토큰 --
        # avg: 케이스당 평균 (프롬프트 최적화 효과 측정에 사용)
        # total: 전체 합산 (비용 계산 검증용)
        "avg_input_tokens": round(float(np.mean([r["input_tokens"] for r in valid])), 1),
        "avg_output_tokens": round(float(np.mean([r.get("output_tokens", 0) for r in valid])), 1),
        "total_input_tokens": int(sum(r["input_tokens"] for r in valid)),
        "total_ouput_tokens": int(sum(r.get("output_tokens") for r in valid)),

        # -- 응답시간 --
        # latency 없는 케이스(임베딩 평가 등) 제외 후 평균
        "avg_latency": round(
            float(np.mean([r["latency"] for r in valid if r.get("latency")])), 2
        ),

        # -- 비용 --
        # 모델별 단가 * 토큰 수로 계산. 캐시 히트 케이스는 토큰=0이므로 자동 반영됨.
        "estimated_cost_usd": _calc_cost(results),

        # -- 품질 지표 (해당 스크립트에서 측정한 것만 채워짐, 나머지는 None) --
        # evaluate_chatbot.py -> keyword_score, rouge_score, tool_correct, uncertainty_score
        # evaluate_embeddings.py → keyword_score(=Precision@k), rouge_score(=MRR), tool_correct(=Silhouette)
        # evaluate_cache.py → cache_hit_rate
        "avg_keyword_score": _avg("keyword_score", valid),
        "avg_rouge_socre": _avg("rouge_score", valid),
        "avg_tool_correct": _avg("tool_correct", valid),
        "avg_uncertainty_score": _avg("uncertainty_score", valid),
        "cache_hit_rate": _avg("cache_hit", valid),
    }

    # 파일이 없으면 자동 생성, 있으면 맨 끝에 한 줄 추가 (JSONL 형식)
    with open(HISTORY_PATH, "a", encoding="utf-8") as f:
        json.dump(record, f, ensure_ascii=False)
        f.write("\n")

    print(
        f"\n[{step}]"
        f"입력토큰: {record['avg_input_tokens']:.0f} | "
        f"출력토큰: {record['avg_output_tokens']:.0f} | "
        f"응답시간: {record['avg_latency']}s | "
        f"비용: ${record['estimated_cost_usd']}"
    )

def load_history() -> list[dict]:
    """
    token_history.jsonl 전체를 리스트로 로드.

    visualize_all.py와 compare_steps()에서 사용.
    파일이 없으면 빈 리스트 반환 (예외 없음).
    """
    if not HISTORY_PATH.exists():
        return []
    with open(HISTORY_PATH, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]
    
# -- 단독 실행용 빠른 비교 --
def compare_steps():
    """
    token_history.jsonl을 읽어 토큰・응답시간 3~패널 막대/꺽은선 출력.

    전체 9단계 종합 시각화(waterfall, 품질 비교 등)는 visualize_all.py 사용.
    이 함수는 "지금까지 기록된 단계가 잘 쌓이고 있는지" 빠르게 확인하는 용도.
    """
    records = load_history()
    if not records:
        print("token_history.jsonl 없음 — 먼저 각 단계 평가를 실행하세요.")
        print("  예) python evaluate_chatbot.py")
        return
    
    steps = [r["step"] for r in records]
    input_tokens = [r["avg_input_tokens"] for r in records]
    output_tokens = [r["avg_output_tokens"] for r in records]
    latencies = [r["avg_latency"] for r in records]

    # 베이스라인(첫 번째 기록) 대비 절감률 계산
    baseline_in = input_tokens[0] or 1
    baseline_out = output_tokens[0] or 1

    fig, axes = plt.subplots(1, 3, figsize=(18, 6))
    fig.suptitle("단계별 토큰 절감 추이 (빠른 확인용)", fontsize=14)

    # -- 패널 1: 입력 토큰 막대 --
    ax = axes[0]
    bars = ax.bar(steps, input_tokens, coler="steelblue")
    ax.set_title("평균 입력 토큰")
    ax.set_ylim(0, max(input_tokens) * 1.25)
    ax.tick_params(axis='x', rotation=30)
    for bar, val in zip(bars, input_tokens):
        pct = (1 - val / baseline_in) * 100
        # 막대 위에 토큰 수 + 베이스라인 대비 절감률 표시
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + 5,
            f"{val:.0f}\n(-{pct:.0f}%)",
            ha='center', fontsize=8,
        )

    # -- 패널 2: 출력 토큰 막대 --
    ax = axes[1]
    bars = ax.bar(steps, output_tokens, color="coral")
    ax.set_title("평균 출력 토큰")
    ax.set_ylim(0, max(output_tokens) * 1.25)
    ax.tick_params(axis='x', rotation=30)
    for bar, val in zip(bars, output_tokens):
        pct = (1 - val / baseline_out) * 100
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + 1,
            f"{val:.0f}\n(-{pct:.0f}%)",
            ha='center', fontsize=8,
        )

    # -- 패널 3: 응답시간 꺽은선 --
    # 꺽은선으로 표시 - 최적화가 응답 속도에 미치는 영향 확인
    ax = axes[2]
    ax.plot(steps, latencies, marker='o', color='mediumseagreen', linewidth=2)
    ax.set_title('평균 응답 시간 (초)')
    ax.set_ylim(0, max(latencies) * 1.3)
    ax.tick_params(axis='x', rotation=30)
    for step, val in zip(steps, latencies):
        ax.annotate(
            f"{val}s", (step, val),
            textcoords="offset points", xytext=(0, 8),
            ha='center', fontsize=8,
        )
    
    plt.tight_layout()
    out = Path(__file__).parent / "token_reduction_progress.png"
    plt.savefig(out, dpi=150)
    print(f"저장: {out}")
    plt.show()

if __name__ == "__main__":
    compare_steps()