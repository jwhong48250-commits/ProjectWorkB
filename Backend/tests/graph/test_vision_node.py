"""
화면 공유 해석 노드 테스트.

vision 도메인의 agent_utils.py가 외부 패키지(pdf2image 등)에 의존하며
현재 모듈 수준에서 mock 처리 중입니다.
구현 안정화 후 아래 스킵을 해제하고 테스트를 작성하세요.
"""

import pytest


@pytest.mark.skip(reason="vision_node 미구현 또는 의존성 불안정 — 구현 완료 후 추가 예정")
class TestVisionNode:
    def test_ocr_extracts_text_from_screenshot(self):
        pass

    def test_chart_analysis_returns_structured_data(self):
        pass

    def test_maps_utterance_to_screen_content(self):
        pass

    def test_handles_non_text_image(self):
        pass
