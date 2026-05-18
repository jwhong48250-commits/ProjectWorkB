# app\domains\vision\agent_utils.py
import base64, json, io, re, subprocess, tempfile, os, shutil
from pdf2image import convert_from_path
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage
from app.core.config import settings
from app.utils.redis_utils import (
    get_meeting_context, get_related_utterance, get_past_meeting_context
)

vision_llm = ChatOpenAI(
    model="o4-mini",
    api_key=settings.OPENAI_API_KEY,
)

def get_libreoffice_path() -> str:
    candidates = [
        "soffice",
        "libreoffice",
    ]
    for path in candidates:
        if shutil.which(path) or os.path.exists(path):
            return path
    raise FileNotFoundError("LibreOffice 실행 파일을 찾을 수 없습니다.")

def encode_image(image_bytes: bytes) -> str:
    return base64.b64encode(image_bytes).decode("utf-8")

# --- 이미지 캡처 분석 ---
async def analyze_image(image_bytes: bytes, meeting_id: int, seq: int | None = None) -> dict:
    """화면 캡처 이미지 OCR + 차트 분석"""
    context = (
        await get_related_utterance(meeting_id, seq) 
        or await get_meeting_context(meeting_id)
        or await get_past_meeting_context(meeting_id)
    )
    context_section = f"현재 회의 발화 내용:\n{context}\n" if context else ""

    message = HumanMessage(content=[
        {
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{encode_image(image_bytes)}"}
        },
        {
            "type": "text",
            "text": f"""
            {context_section}

            위 화면을 분석해주세요:
            1. 텍스트 추출 (OCR)
            2. 차트/그래프/도표는 수치와 구조를 상세히 분석하세요.
            3. 참고용 이미지(사진 등)는 회의 발화 내용과 어떤 맥락으로 연관되는지만 간략히 서술하세요.
            4. 회의 맥락과 연관된 핵심 포인트 요약
            5. key_points는 이미지와 직접 관련된 발화나 이미지에서 도출되는 포인트만 포함하세요. 이미지 주제와 무관한 발화는 제외하세요.

            모든 답변은 한국어로 작성하세요.

            반드시 아래 JSON 형식으로만 답변하세요:
            {{"ocr_text": "...", "chart_description": "...", "key_points": ["...", "..."]}}
            """
        } 
    ])

    result = await vision_llm.ainvoke([message])

    try:
        json_match = re.search(r'\{.*\}', result.content, re.DOTALL)
        if json_match:
            return json.loads(json_match.group())
    except Exception:
        pass

    return {"ocr_text": result.content, "chart_description": "", "key_points": []}

def convert_pptx_to_images(ppt_bytes: bytes) -> list[bytes]:
    """PPT 슬라이드별 이미지 변환 (LibreOffice -> PDF -> PNG)"""
    # 임시 파일 저장
    with tempfile.TemporaryDirectory() as tmpdir:
        pptx_path = os.path.join(tmpdir, "slides.pptx")
        with open(pptx_path, "wb") as f:
            f.write(ppt_bytes)

        subprocess.run(
            [get_libreoffice_path(), "--headless", "--convert-to", "pdf", "--outdir", tmpdir, pptx_path],
            check=True, capture_output=True
        )

        pdf_path = os.path.join(tmpdir, "slides.pdf")
        images = convert_from_path(pdf_path, dpi=150)

        result = []
        for img in images:
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            result.append(buf.getvalue())
        return result

async def analyze_ppt_slide_image(image_bytes: bytes, slide_number: int, meeting_id: int) -> dict:
    """슬라이드 이미지 전체를 Gemini Vision으로 분석"""
    context = await get_meeting_context(meeting_id) or await get_past_meeting_context(meeting_id)
    context_section = f"현재 회의 발화 내용:\n{context}\n" if context else ""

    message = HumanMessage(content=[
        {
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{encode_image(image_bytes)}"}
        },
        {
            "type": "text",
            "text": f"""
            {context_section}

            위는 PPT {slide_number}번째 슬라이드입니다. 다음을 분석해주세요:
            1. 텍스트 내용
            2. 차트/그래프/도표/아키텍처 다이어그램은 수치, 구조, 연결 관계를 상세히 분석하세요.
            3. 참고용 이미지(사진 등)는 회의 발화 내용과 어떤 맥락으로 연관되는지만 간략히 서술하세요.
            4. 회의 맥락과 연관된 핵심 포인트 요약
            5. key_points는 슬라이드 내용과 직접 관련된 발화나 슬라이드에서 도출되는 포인트만 포함하세요. 슬라이드 주제와 무관한 발화는 제외하세요.

            모든 답변은 한국어로 작성하세요.

            반드시 아래 JSON 형식으로만 답변하세요:
            {{"ocr_text": "...", "chart_description": "...", "key_points": ["...", "..."], "summary": "..."}}
            """
        }
    ])

    result = await vision_llm.ainvoke([message])

    try:
        json_match = re.search(r'\{.*\}', result.content, re.DOTALL)
        if json_match:
            return json.loads(json_match.group())
    except Exception:
        pass

    return {"ocr_text": "", "chart_description": "", "key_points": [], "summary": result.content}



        