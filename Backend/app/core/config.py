# app\core\config.py
from typing import Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # 1. 시스템 기본 설정
    ENV: str = "dev"
    DEBUG: bool = False
    RESET_DB_ON_STARTUP: bool = False
    DATABASE_URL: Optional[str] = None
    SECRET_KEY: str = "secret_key"
    ALGORITHM: str = "HS256"
    REDIS_URL: str = "redis://localhost:6379"
    MONGODB_URL: str = "mongodb://localhost:27017"
    CHROMA_HOST: str = "localhost"
    CHROMA_PORT: int = 8001

    # 2. AI
    OPENAI_API_KEY: Optional[str] = None
    GEMINI_API_KEY: Optional[str] = None
    ANTHROPIC_API_KEY: Optional[str] = None
    TAVILY_API_KEY: Optional[str] = None

    # 3. Slack
    SLACK_CLIENT_ID: Optional[str] = None
    SLACK_CLIENT_SECRET: Optional[str] = None
    SLACK_REDIRECT_URI: Optional[str] = "https://localhost/api/v1/integrations/slack/callback"

    # 4. JIRA
    JIRA_CLIENT_ID: Optional[str] = None
    JIRA_CLIENT_SECRET: Optional[str] = None
    JIRA_REDIRECT_URI: str = "http://localhost:8000/api/v1/integrations/jira/callback"

    # 5. Google
    GOOGLE_CLIENT_ID: Optional[str] = None
    GOOGLE_CLIENT_SECRET: Optional[str] = None
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/v1/integrations/google/callback"
    GOOGLE_LOGIN_REDIRECT_URI: str = "http://localhost:8000/api/v1/users/oauth/google/callback"

    # 6. 카카오
    KAKAO_REST_API_KEY: Optional[str] = None
    KAKAO_CLIENT_SECRET: Optional[str] = None
    KAKAO_LOGIN_REDIRECT_URI: str = "http://localhost:8000/api/v1/users/oauth/kakao/callback"

    # 7. FRONTEND
    FRONTEND_URL: str = "http://localhost:5173"

    # 8. Email
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: int = 587
    SMTP_USERNAME: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_FROM_EMAIL: Optional[str] = None
    SMTP_FROM_NAME: str = "Workb"
    SMTP_USE_TLS: bool = True
    ADMIN_SIGNUP_EMAIL_ENABLED: bool = True
    PASSWORD_RESET_TOKEN_MINUTES: int = 30

    # 9. Notifications (background jobs)
    NOTIFICATION_JOBS_ENABLED: bool = True
    NOTIFICATION_JOB_INTERVAL_SEC: int = 60

    # 10. 개발·QA 전용 기능
    WAV_SIM_ENABLED: bool = False  # WAV 업로드로 회의 시뮬레이션 (운영에서는 False)

    # 11. AWS S3
    AWS_ACCESS_KEY_ID: Optional[str] = None
    AWS_SECRET_ACCESS_KEY: Optional[str] = None
    AWS_REGION: str = "ap-northeast-2"
    AWS_S3_BUCKET: Optional[str] = None
    AWS_S3_PRESIGNED_EXPIRES: int = 3600  # Presigned URL 기본 만료(초)

    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug(cls, value):
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"release", "prod", "production", "false", "0", "no", "off"}:
                return False
            if normalized in {"debug", "dev", "development", "true", "1", "yes", "on"}:
                return True
        return value

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
