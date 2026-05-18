""""
evaluate_optimization.py

- 실제 knowledge/agent_utils.py의 react_agent를 직접 호출
- 단일 모델 (agent_utils.py에 설정된 모델 그대로)
- --step 인자로 단계 레이블 지정 -> token_history.jsonl에 누적 기록

실행 흐름:
    python evaluate_optimization.py --step 베이스라인
    # knowledge/agent_utils.py 프롬프트 수정(STEP 1)
    python evaluate_optimization.py --step STEP1_프롬프트
    # 모델 라우팅 추가 (STEP 2)
    python evaluate_optimization.py --step STEP2_모델라우팅
    ...
"""
import sys, os, time, argparse
import matplotlib
import matplotlib.pyplot as plt
import numpy as np
from transformers import pipeline

from app.domains.knowledge.agent_utils import react_agent
from app.utils.redis_utils import get_meeting_context
from token_tracker import save_token_record

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
matplotlib.rcParams['font.family'] = 'AppleGothic'

MEETING_ID = 'test-meeting-001'

# ── Zero-shot NLI 불확실성 감지 ───────────────────────────────────────────
_nli = pipeline(
    "zero-shot-classfication",
    model=""
)