from pathlib import Path
from io import BytesIO

from fastapi import HTTPException, UploadFile, status
from app.utils.s3_utils import upload_fileobj_to_s3

MAX_LOCAL_IMAGE_SIZE = 1024 * 1024
IMAGE_EXTENSIONS = {
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


async def save_local_image(file: UploadFile, directory: Path, stem: str) -> str:
    if file.content_type not in IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이미지 파일만 업로드할 수 있습니다.",
        )

    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="빈 파일은 업로드할 수 없습니다.",
        )
    if len(content) > MAX_LOCAL_IMAGE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="이미지는 1MB 이하 파일을 사용해 주세요.",
        )

    extension = IMAGE_EXTENSIONS[file.content_type]
    key = f"{directory.name}/{stem}{extension}"
    upload_fileobj_to_s3(
        fileobj=BytesIO(content),
        key=key,
        content_type=file.content_type,
    )
    return key
