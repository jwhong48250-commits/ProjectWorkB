# app\domains\vision\service.py
import asyncio, os
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor

from app.domains.vision.agent_utils import (
    analyze_image, convert_pptx_to_images, analyze_ppt_slide_image
)
from app.domains.vision import repository
from app.utils.s3_utils import upload_fileobj_to_s3
from app.utils.time_utils import now_kst

def _save_capture_image(meeting_id: int, image_bytes: bytes) -> str:
    """캡처 이미지를 S3에 저장하고 object key 반환"""
    ts = now_kst().strftime("%Y%m%d_%H%M%S_%f")
    key = f"meetings/{meeting_id}/captures/{ts}.png"
    upload_fileobj_to_s3(
        fileobj=BytesIO(image_bytes),
        key=key,
        content_type="image/png",
    )
    return key

async def analyze_screen_share(image_bytes: bytes, meeting_id: int, seq: int | None) -> dict:
    file_url = _save_capture_image(meeting_id, image_bytes)
    analysis = await analyze_image(image_bytes, meeting_id, seq)
    repository.save_analysis(meeting_id=meeting_id, data=analysis, file_url=file_url)
    return {"timestamp": now_kst(), "file_url": file_url, **analysis}

async def get_analyses(meeting_id: int) -> list[dict]:
    return repository.get_analyses(meeting_id)

async def analyze_ppt(ppt_bytes: bytes, meeting_id: int) -> list[dict]:
    # convert_pptx_to_images는 subprocess + 파일 I/O -> executor에서 실행
    loop = asyncio.get_event_loop()
    images = await loop.run_in_executor(
        None,
        convert_pptx_to_images,
        ppt_bytes
    )

    # 슬라이드 분석은 LLM 호출 -> asyncio.gather로 병렬 처리
    analyses = await asyncio.gather(*[
        analyze_ppt_slide_image(image_bytes, i + 1, meeting_id)
        for i, image_bytes in enumerate(images)
    ])
    
    return [
        {
            "slide_number": i + 1,
            "text": a.get("ocr_text", ""),
            "chart_description": a.get("chart_description", ""),
            "key_points": a.get("key_points", []),
            "summary": a.get("summary", ""),
        }
        for i, a in enumerate(analyses)
    ]