# app/utils/s3_utils.py
"""AWS S3 업로드/조회 유틸리티.

- AWS 자격증명은 `app/core/config.py`의 `Settings`(.env) 에서만 읽어온다.
- 외부에는 다음 함수들을 노출한다:
    * upload_fileobj_to_s3(...) : 바이트/파일 객체를 S3에 업로드
    * upload_upload_file_to_s3(...) : FastAPI `UploadFile`을 S3에 업로드
    * get_object_url(key)   : 퍼블릭/가상 호스팅 URL 반환 (버킷이 공개일 때만 유효)
    * generate_presigned_url(key, expires_in) : 한시적 접근용 Presigned URL 생성
"""
from __future__ import annotations

import logging
import mimetypes
import uuid
from pathlib import Path
from typing import BinaryIO, Optional
from urllib.parse import unquote, urlparse

import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException, UploadFile, status

from app.core.config import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 내부 클라이언트 (모듈 단위 싱글턴)
# ---------------------------------------------------------------------------
_s3_client = None


def _get_s3_client():
    """boto3 S3 클라이언트 싱글턴 반환.

    .env 의 AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION 값을 사용한다.
    필수 설정이 없으면 명확한 에러를 발생시켜 운영 중 누락을 빠르게 탐지한다.
    """
    global _s3_client
    if _s3_client is not None:
        return _s3_client

    if not settings.AWS_ACCESS_KEY_ID or not settings.AWS_SECRET_ACCESS_KEY:
        raise RuntimeError(
            "AWS 자격 증명이 설정되어 있지 않습니다. .env 의 "
            "AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY 를 확인하세요."
        )
    if not settings.AWS_S3_BUCKET:
        raise RuntimeError(".env 의 AWS_S3_BUCKET 이 비어 있습니다.")

    _s3_client = boto3.client(
        "s3",
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_REGION,
        # SigV4 + virtual-hosted style → presigned URL 호환성 ↑
        config=BotoConfig(signature_version="s3v4", s3={"addressing_style": "virtual"}),
    )
    return _s3_client


# ---------------------------------------------------------------------------
# 키 생성 헬퍼
# ---------------------------------------------------------------------------
def build_object_key(filename: str, prefix: str = "") -> str:
    """충돌 없는 S3 object key 를 생성한다.

    예) prefix="meetings/3/photos", filename="a.png"
        → "meetings/3/photos/3f1a...c89.png"
    """
    suffix = Path(filename).suffix.lower()
    unique = uuid.uuid4().hex
    key = f"{unique}{suffix}" if suffix else unique
    if prefix:
        key = f"{prefix.strip('/')}/{key}"
    return key


# ---------------------------------------------------------------------------
# 업로드
# ---------------------------------------------------------------------------
def upload_fileobj_to_s3(
    fileobj: BinaryIO,
    key: str,
    content_type: Optional[str] = None,
    bucket: Optional[str] = None,
) -> str:
    """파일 객체(BinaryIO)를 S3에 업로드하고 object key 를 반환한다.

    Args:
        fileobj: read() 가능한 바이너리 파일 객체.
        key: S3 object key (예: "meetings/3/photos/abc.png")
        content_type: Content-Type. 미지정 시 확장자로 추론.
        bucket: 사용할 버킷명. 미지정 시 settings.AWS_S3_BUCKET.
    """
    client = _get_s3_client()
    target_bucket = bucket or settings.AWS_S3_BUCKET

    extra_args: dict = {}
    guessed = content_type or mimetypes.guess_type(key)[0]
    if guessed:
        extra_args["ContentType"] = guessed

    try:
        client.upload_fileobj(fileobj, target_bucket, key, ExtraArgs=extra_args)
    except (BotoCoreError, ClientError) as exc:
        logger.exception("S3 업로드 실패: bucket=%s key=%s", target_bucket, key)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="S3 업로드 중 오류가 발생했습니다.",
        ) from exc
    return key


def download_file_bytes_from_s3(
    key: str,
    bucket: Optional[str] = None,
) -> bytes:
    """S3 object key를 읽어 bytes로 반환한다."""
    client = _get_s3_client()
    target_bucket = bucket or settings.AWS_S3_BUCKET
    try:
        response = client.get_object(Bucket=target_bucket, Key=key)
        body = response.get("Body")
        if body is None:
            raise KeyError("Body not found")
        data = body.read()
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in {"NoSuchKey", "404"}:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="파일을 찾을 수 없습니다.",
            ) from exc
        logger.exception("S3 다운로드 실패: bucket=%s key=%s", target_bucket, key)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="S3 다운로드 중 오류가 발생했습니다.",
        ) from exc
    except (BotoCoreError, KeyError, AttributeError) as exc:
        logger.exception("S3 다운로드 실패: bucket=%s key=%s", target_bucket, key)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="S3 다운로드 중 오류가 발생했습니다.",
        ) from exc
    return data


async def upload_upload_file_to_s3(
    file: UploadFile,
    prefix: str = "",
    bucket: Optional[str] = None,
) -> str:
    """FastAPI `UploadFile` 을 S3에 업로드하고 object key 를 반환한다.

    Args:
        file: FastAPI 의 UploadFile.
        prefix: S3 키 접두사 (디렉터리 역할). 예: "users/1/avatar"
    """
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="파일명이 비어 있습니다.",
        )

    key = build_object_key(file.filename, prefix=prefix)
    # UploadFile.file 은 SpooledTemporaryFile (BinaryIO 호환)
    return upload_fileobj_to_s3(
        fileobj=file.file,
        key=key,
        content_type=file.content_type,
        bucket=bucket,
    )


# ---------------------------------------------------------------------------
# URL 조회
# ---------------------------------------------------------------------------
def get_object_url(key: str, bucket: Optional[str] = None) -> str:
    """버킷이 퍼블릭일 때 사용할 가상 호스팅 스타일 URL.

    프라이빗 버킷이라면 이 URL은 인증 없이 접근할 수 없다.
    프론트엔드에 노출하려면 `generate_presigned_url()` 을 사용하라.
    """
    target_bucket = bucket or settings.AWS_S3_BUCKET
    if not target_bucket:
        raise RuntimeError(".env 의 AWS_S3_BUCKET 이 비어 있습니다.")
    return f"https://{target_bucket}.s3.{settings.AWS_REGION}.amazonaws.com/{key}"


def resolve_minute_photo_url(value: str, expires_in: Optional[int] = None) -> str:
    """`minute_photos.photo_url` 컬럼 값을 즉시 표시 가능한 URL로 변환한다.

    - 이미 외부 URL/data URI/file URI 이면 그대로 반환.
    - 과거 로컬 경로 데이터(예: ``storage\\meetings\\3\\minute_photos\\xxx.png``)면
      그대로 반환해 기존 정적 마운트(`/storage/...`) 또는 PDF 렌더러의
      file:// 변환 로직과 호환되게 한다.
    - 그 외에는 S3 object key 로 간주하고 Presigned URL 을 발급한다.
    """
    if not value:
        return ""

    text = value.strip()
    if text.startswith(("http://", "https://", "file://", "data:")):
        return text

    # 레거시 로컬 경로 데이터 보호 (Windows 백슬래시 / 정규화된 storage 경로)
    if (
        "\\" in text
        or text.startswith("storage/")
        or text.startswith("storage\\")
        or text.startswith("/storage/")
    ):
        return text

    return generate_presigned_url(text, expires_in=expires_in)


def generate_presigned_url(
    key: str,
    expires_in: Optional[int] = None,
    bucket: Optional[str] = None,
    method: str = "get_object",
) -> str:
    """프론트엔드 등 외부에 한시적 접근을 허용하는 Presigned URL 생성.

    Args:
        key: S3 object key.
        expires_in: 만료 시간(초). 미지정 시 settings.AWS_S3_PRESIGNED_EXPIRES.
        method: "get_object"(다운로드) 또는 "put_object"(업로드용).
    """
    client = _get_s3_client()
    target_bucket = bucket or settings.AWS_S3_BUCKET
    ttl = expires_in if expires_in is not None else settings.AWS_S3_PRESIGNED_EXPIRES

    try:
        return client.generate_presigned_url(
            ClientMethod=method,
            Params={"Bucket": target_bucket, "Key": key},
            ExpiresIn=ttl,
        )
    except (BotoCoreError, ClientError) as exc:
        logger.exception("Presigned URL 생성 실패: bucket=%s key=%s", target_bucket, key)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Presigned URL 생성 중 오류가 발생했습니다.",
        ) from exc


def extract_s3_key_from_url(value: str) -> str | None:
    """S3 URL에서 object key를 추출합니다. S3 URL이 아니면 None을 반환합니다."""
    if not value:
        return None
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"}:
        return None
    host = parsed.netloc.lower()
    if "amazonaws.com" not in host:
        return None
    path = parsed.path.lstrip("/")
    if not path:
        return None
    # path-style URL(s3.amazonaws.com/bucket/key) 지원
    if host.startswith("s3.") or host == "s3.amazonaws.com":
        parts = path.split("/", 1)
        if len(parts) == 2:
            return unquote(parts[1])
        return None
    return unquote(path)
