# app/infa/client/base.py
import httpx
import logging
from typing import Dict, Any, Optional
from .session_manager import ClientSessionManager

# 로깅 설정: 문제가 생겼을 때 기록을 남김
logger = logging.getLogger(__name__)

class BaseClient:
    """
    모든 외부 API 클라이언트의 부모가 되는 기본 클래스
    """
    def __init__(self, base_url: str, headers: Optional[Dict[str, str]] = None):
        # 외부 서비스의 기본주소 설정
        self.base_url = base_url.rstrip('/')
        self.headers = headers or {}

    async def _request(self, method: str, endpoint: str, **kwargs) -> Dict[str, Any]:
        """
        실제로 인터넷을 통해 데이터를 주고 받는 함수
        """
        # 1. 주소 합치긔 (기본주소 + 세부 경로)
        url = f"{self.base_url}/{endpoint.lstrip('/')}"

        # 2. 세션 관리자로 client 가져옴
        client = await ClientSessionManager.get_client()

        try:
            # 3. 비동기 방식 통신 수행
            response = await client.request(method, url, headers=self.headers, **kwargs)

            # 4. 결과 확인: 오류를 확인하고 에러 발생시킴
            response.raise_for_status()

            # 5. 오류 없으면 성공~
            if not response.content:
                return {}
            return response.json()
        
        except httpx.HTTPStatusError as e:
            # 외부 인프라에서 에러 응답을 보낸 경우
            logger.error(f"외부 인프라 에러 응답 - {e.response.status_code} : {e.response.text}")

            # 에러를 상위로 전달하여 state['errors']에 기록 되도록 함
            raise e

        except Exception as e: 
            # 예상치 못한 에러 발생
            logger.error(f"외부 API 통신 중 에러 발생: {str(e)}")

            # 에러를 상위로 전달하여 state['errors']에 기록 되도록 함
            raise e

