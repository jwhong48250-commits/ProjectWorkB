# app/infra/clients/session_manager.py
import httpx
from typing import Optional

class ClientSessionManager:
    """
    애플리케이션 전역에서 httpx.AsyncClient 인스턴스를 하나만 생성하고 관리하는 싱글톤 클래스
    """
    _client: Optional[httpx.AsyncClient] = None

    @classmethod
    async def get_client(cls) -> httpx.AsyncClient:
        """
        이미 생성된 클라잉너트가 있다면 반환하고, 없으면 새로 생성
        """
        if cls._client is None or cls._client.is_closed:
            # 커넥션 pool 설정을 포함하여 클라이언트 생성
            cls._client = httpx.AsyncClient(
                timeout=httpx.Timeout(10.0),
                limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)
            )
        return cls._client

    @classmethod
    async def close_client(cls):
        """
        애플리케이션이 종료될 때 호출하여 모든 연결을 안전하게 닫음
        """
        if cls._client and not cls._client.is_closed:
            await cls._client.aclose()
            cls._client = None