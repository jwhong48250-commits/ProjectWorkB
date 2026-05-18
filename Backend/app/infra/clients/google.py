# app\infra\clients\google.py
import logging
from typing import Dict, Any, List, Optional
from .base import BaseClient

logger = logging.getLogger(__name__)

class GoogleCalendarClient(BaseClient):
    """
    Google Calendar API 직접 호출 클라이언트.
    integrations 테이블의 access_token 사용.
    토큰 만료는 service 에서 판단
    """
    def __init__(self, access_token: str):
        super().__init__(
            base_url="https://www.googleapis.com/calendar/v3",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            }
        )

    async def create_event(
            self,
            title: str,
            start_datetime: str,
            end_datetime: str,
            attendees: Optional[List[str]] = None,
            description: str = "",
            calendar_id: str = "",
    ) -> Dict[str, Any]:
        """
        Google Calendar 일정 생성.

        args:
            title: 일정 제목
            start_datetime: ISO 8601 형식 2025-05-01T10:10:00
            end_datetime: 
            attendees: 참석자 이메일 리스트
            description: 일정 설명 (선택)
            calendar_id: 캘린더 ID, 데이터베이스 기본키
        """
        if not calendar_id:
            raise ValueError("calendar_id가 필요합니다.")
        body: Dict[str, Any] = {
            "summary": title,
            "description": description,
            "start": {
                "dateTime": start_datetime,
                "timeZone": "Asia/Seoul"
            },
            "end": {
                "dateTime": end_datetime,
                "timeZone": "Asia/Seoul"
            },
        }
        if attendees:
            body["attendees"] = [{
                "email": email
        } for email in attendees]

        return await self._request(
            "POST", f"/calendars/{calendar_id}/events",
            json=body,
        )

    async def list_events(
            self,
            calendar_id: str = "",
            time_min: Optional[str] = None,
            max_results: int = 10,
    ) -> Dict[str, Any]:
        """
        캘린더 일정 목록 조회.
        다음 회의 제안 때 기존 일정이 있는지 확인도 함.

        args:
            calendar_id: 캘린더 ID
            time_min: 조회 시작 시각 ISO 8601 2025-04-16T10:10:10
            max_results: 최대 반환 건수
        """
        if not calendar_id:
            raise ValueError("calendar_id가 필요합니다.")
        params: Dict[str, Any] = {
            "maxResults": max_results,
            "singleEvents": True,
            "orderBy": "startTime",
        }
        if time_min:
            params['timeMin'] = time_min
        
        return await self._request(
            "GET",
            f"/calendars/{calendar_id}/events",
            params=params
        )

    async def list_calendars(self, min_access_role: str = "reader") -> Dict[str, Any]:
        """
        캘린더 목록 조회 (calendar.calendarList.list)
        """
        params: Dict[str, Any] = {
            "minAccessRole": min_access_role,
            "maxResults": 250,
        }
        return await self._request("GET", "/users/me/calendarList", params=params)

    async def create_calendar(self, summary: str, time_zone: str = "Asia/Seoul") -> Dict[str, Any]:
        """
        새 캘린더 생성 (calendar.calendars.insert)
        """
        body: Dict[str, Any] = {"summary": summary, "timeZone": time_zone}
        return await self._request("POST", "/calendars", json=body)

    async def get_free_slots (
            self,
            calendar_ids: List[str],
            time_min: str,
            time_max: str,
    ) -> Dict[str, Any]:
        """
        Freebusy API - 해당 workspace에 사용자들의 일정이 비는 시간을 캐치하는 API
        
        args: 
            calendar_ids: 구글 캘린더의 ID -> 워크스페이드에 1대1 매치
            time_min/time_max: ISO 8601 -> 2026-04-20T09:21:30

        return: {
            "calendars": {
                "email": {
                    "busy": [
                        {
                            "start": "2026-4-24T09:50:00",
                            "end": "2026-4-24T11:50:00"
                        }
                    ]
                }
            }
        }
        """
        body = {
            "timeMin": time_min,
            "timeMax": time_max,
            "timeZone": "Asia/Seoul",
            "items": [
                {
                    "id": cid
                } for cid in calendar_ids
            ]
        }

        return await self._request(
            "POST", "/freeBusy",
            json=body,
        )
    
    async def update_event_description(
            self,
            event_id: str,
            description: str,
            calendar_id: str = "",
    ) -> Dict[str, Any]:
        """
        기존 이벤트의 description 만 PATCH 하여
        일정의 설명만 바꾸는 함수.
        """
        if not calendar_id:
            raise ValueError("calendar_id가 필요합니다.")
        return await self._request(
            "PATCH", f"/calendars/{calendar_id}/events/{event_id}",
            json={
                "description": description
            },
        )
    
    async def update_event(
            self,
            event_id: str,
            title: str | None = None,
            start_datetime: str | None = None,
            end_datetime: str | None = None,
            attendees: list[str] | None = None,
            description: str | None = None,
            calendar_id: str = "",
    ) -> dict:
        '''
        받은 인수로 캘린더 업데이트

        구글 캘린더의 body 구조
        body: Dict[str, Any] = {
            "summary": title,
            "description": description,
            "start": {
                "dateTime": start_datetime,
                "timeZone": "Asia/Seoul"
            },
            "end": {
                "dateTime": end_datetime,
                "timeZone": "Asia/Seoul"
            },
        }
        if attendees:
            body["attendees"] = [{
                "email": email
        } for email in attendees]
        ''' 
        body = {}
        if title is not None:
            body['summary'] = title

        if description is not None:
            body['description'] = description
        
        if start_datetime is not None:
            body['start'] = {
                "dateTime": start_datetime,
                "timeZone": "Asia/Seoul"
            }
        
        if end_datetime is not None:
            body['end'] = {
                "dateTime": end_datetime,
                'timeZone': "Asia/Seoul"
            }
        
        if attendees is not None:
            body['attendees'] = [{"email": email} for email in attendees]

        if not calendar_id:
            raise ValueError("calendar_id가 필요합니다.")
        return await self._request(
            "PATCH", f"/calendars/{calendar_id}/events/{event_id}",
            json=body,
        )

    async def delete_event(
            self,
            event_id: str,
            calendar_id: str = "primary",
    ) -> Dict[str, Any]:
        """
        Google Calendar 일정 삭제.
        성공 시 Google API는 보통 빈 응답을 반환합니다.
        """
        if not calendar_id:
            raise ValueError("calendar_id가 필요합니다.")
        return await self._request(
            "DELETE",
            f"/calendars/{calendar_id}/events/{event_id}",
        )
