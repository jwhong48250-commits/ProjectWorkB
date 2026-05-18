# app\domains\vision\schemas.py
from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class ScreenShareAnalyzeResponse(BaseModel):
    meeting_id: int
    ocr_text: str
    chart_description: str
    key_points: list[str]
    timestamp: datetime

class PptSlideResult(BaseModel):
    slide_number: int
    text: str
    chart_description: str
    key_points: list[str]
    summary: str

class PptUploadResponse(BaseModel):
    meeting_id: int
    total_slides: int
    slides: list[PptSlideResult]