# app\domains\integration\schemas.py
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from app.domains.integration.models import ServiceType

# --- Response Schemas ---
class IntegrationResponse(BaseModel):
    "연동 단일 항목 응답"
    id: int
    service: ServiceType
    is_connected: bool
    selected_channel_id: Optional[str] = None
    selected_calendar_id: Optional[str] = None
    selected_calendar_name: Optional[str] = None
    selected_project_key: Optional[str] = None
    
    updated_at: datetime

    class Config:
        from_attributes = True

class IntegrationListResponse(BaseModel):
    """연동 목록 응답"""
    integrations: List[IntegrationResponse]

# --- Request Scheams (API Key 방식) ---
class SlackChannelSelectRequest(BaseModel):
    channel_id: str
    
# -- OAuth Response ---

class OAuthUrlResponse(BaseModel):
    auth_url: str

# --- Slack ---
class SlackChannelItem(BaseModel):
    id: str
    name: str

class SlackChannelListResponse(BaseModel):
    channels: List[SlackChannelItem]

class TestIntegrationResponse(BaseModel):
    success: bool
    status: str # "ok" | "expired" | "revoked" | "disconnected" | "error"
    message: str

class GoogleCalendarEventItem(BaseModel):
    id: str
    title: str
    start: str
    end: str
    description: Optional[str] = None
    html_link: Optional[str] = None

class GoogleCalendarEventsResponse(BaseModel):
    events: List[GoogleCalendarEventItem]


class GoogleCalendarItem(BaseModel):
    id: str
    summary: str
    primary: bool = False
    access_role: Optional[str] = None


class GoogleCalendarListResponse(BaseModel):
    calendars: List[GoogleCalendarItem]


class GoogleCalendarCreateRequest(BaseModel):
    name: str


class GoogleCalendarCreateResponse(BaseModel):
    calendar_id: str
    summary: str


class GoogleCalendarSelectRequest(BaseModel):
    calendar_id: str
    calendar_name: Optional[str] = None


# JIRA
class JiraProjectItem(BaseModel):
    key: str
    name: str

class JiraProjectListResponse(BaseModel):
    projects: List[JiraProjectItem]

class JiraStatusListResponse(BaseModel):
    statuses: List[str]

class JiraSiteItem(BaseModel):
    id:     str
    name:   str
    url:    str

class JiraSiteListResponse(BaseModel):
    sites:  List[JiraSiteItem]

class JiraSiteSelectRequest(BaseModel):
    cloud_id: str
    site_url: str