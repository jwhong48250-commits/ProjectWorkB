# app/domains/action/services/thumbnail.py
import io
from PIL import Image,ImageDraw, ImageFont

def generate_text_thumbnail_bytes(content: str) -> bytes:
    lines = [line.lstrip("#").strip() for line in content.split("\n") if line.strip()][:15]

    # 400x225 크기의 빈 이미지 생성 WebP 최적화 사이즈
    W, H = 400, 255
    img = Image.new("RGB", (W, H), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)

    try:
        font = ImageFont.truetype("arial.ttf", 12)
    except Exception:
        font = ImageFont.load_default()

    y = 10
    for line in lines:
        draw.text((10, y), line[:60], fill=(30, 30, 30), font=font)
        y += 16
        if y > H - 10:
            break
    
    output = io.BytesIO()
    img.save(output, "WEBP", quality=75)
    return output.getvalue()

def generate_format_thumbnail_bytes(format_name: str) -> bytes:
    colors = {
        "excel":    (33, 115, 70),
        'wbs':      (37, 99, 235),
        "html":     (234, 88, 12)
    }
    labels = {
        "excel":    "EXCEL",
        "wbs":      "WBS",
        "html":     "HTML"
    }

    W, H = 400, 255
    img = Image.new("RGB", (W, H), color=colors.get(format_name, (100, 100, 100)))
    draw = ImageDraw.Draw(img)

    try:
        font = ImageFont.truetype("arial.ttf", 48)
    except Exception:
        font = ImageFont.load_default()
    
    label = labels.get(format_name, format_name.upper())
    bbox = draw.textbbox((0, 0), label, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((W - tw) // 2, (H - th) //2), label, fill=(255, 255, 255), font=font)

    output = io.BytesIO()
    img.save(output, "WEBP", quality=75)
    return output.getvalue()



