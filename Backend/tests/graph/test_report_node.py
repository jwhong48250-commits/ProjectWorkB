"""
보고서 노드 테스트.

현재 별도의 report_node 함수가 구현되어 있지 않습니다.
보고서 생성 기능은 intelligence 도메인에서 처리할 예정입니다.
구현 완료 후 아래 스킵을 해제하고 테스트를 작성하세요.
"""

import pytest


@pytest.mark.skip(reason="report_node 미구현 — intelligence 도메인 완성 후 추가 예정")
class TestReportNode:
    def test_generates_report_from_summary(self):
        pass

    def test_includes_wbs_section(self):
        pass

    def test_handles_empty_summary(self):
        pass
