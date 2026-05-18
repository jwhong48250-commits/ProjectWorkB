# app\domains\vision\router.py
from fastapi import APIRouter, UploadFile, File, Form
from typing import Optional
from datetime import datetime
from app.domains.vision import service
from app.domains.vision.schemas import (
    ScreenShareAnalyzeResponse, PptUploadResponse, PptSlideResult
)

router = APIRouter()

@router.post("/workspace/{workspace_id}/screen-share/analyze", response_model=ScreenShareAnalyzeResponse)
async def analyze_screen(
    meeting_id: int,
    file: UploadFile = File(...),
    related_utterance_seq: Optional[int] = Form(None),
):
    image_bytes = await file.read()
    result = await service.analyze_screen_share(image_bytes, meeting_id, related_utterance_seq)
    return ScreenShareAnalyzeResponse(
        meeting_id=meeting_id,
        ocr_text=result.get("ocr_text", ""),
        chart_description=result.get("chart_description", ""),
        key_points=result.get("key_points", []),
        timestamp=result["timestamp"],
    )

@router.get("/workspace/{workspace_id}/screen-share/analyses")
async def get_analyses(meeting_id: int):
    analyses = await service.get_analyses(meeting_id)
    return {"meeting_id": meeting_id, "analyses": analyses}

@router.post("/workspace/{workspace_id}/screen-share/upload-ppt", response_model=PptUploadResponse)
async def upload_ppt(
    meeting_id: int,
    file: UploadFile = File(...)
):
    ppt_bytes = await file.read()
    slides = await service.analyze_ppt(ppt_bytes, meeting_id)
    return PptUploadResponse(
        meeting_id=meeting_id,
        total_slides=len(slides),
        slides=[PptSlideResult(**s) for s in slides]
    )