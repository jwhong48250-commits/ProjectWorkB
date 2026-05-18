# app\domains\integration\repository.py
from sqlalchemy.orm import Session
from typing import List, Optional
from app.domains.integration.models import Integration, ServiceType
from datetime import datetime

def get_integrations(db: Session, workspace_id: int) -> List[Integration]:
    """워크스페이스의 전체 연동 목록 조회"""
    return db.query(Integration).filter(
        Integration.workspace_id == workspace_id
    ).all()

def get_integration(
        db: Session, workspace_id: int, service: ServiceType
) -> Optional[Integration]:
    """특정 서비스 연동 단일 조회"""
    return db.query(Integration).filter(
        Integration.workspace_id==workspace_id,
        Integration.service==service
    ).first()

def upsert_integration(
        db: Session,
        workspace_id: int,
        service: ServiceType,
        webhook_url: str
) -> Integration:
    """
    연동 등록 또는 업데이트.
    이미 존재하면 webhook_url 갱신, 없으면 새로 생성
    """
    integration = get_integration(db, workspace_id, service)

    if integration:
        integration.extra_config = {"webhook_url": webhook_url}
        integration.is_connected = True

    else:
        integration = Integration(
            workspace_id=workspace_id,
            service=service,
            extra_config={"webhook_url": webhook_url},
            is_connected=True
        )
    db.add(integration)
    db.commit()
    db.refresh(integration)
    return integration

def disconnect_integration(
        db: Session, workspace_id: int, service: ServiceType
) -> Optional[Integration]:
    """
    연동 해제 -webhook_url 삭제
    """
    integration = get_integration(db, workspace_id, service)

    if integration:
        integration.extra_config = None
        integration.is_connected = False
        integration.access_token = None
        integration.refresh_token = None
        integration.token_expires_at = None
        db.commit()
        db.refresh(integration)

    return integration

def update_tokens(
        db: Session,
        workspace_id: int,
        service: ServiceType,
        access_token: str,
        refresh_token: Optional[str] = None,
        token_expires_at: Optional[datetime] = None,
        extra_config: Optional[dict] = None,
) -> Integration:
    """
    OAuth token update -> DB CRUD
    """
    integration = get_integration(db, workspace_id, service)
    if not integration:
        integration = Integration(workspace_id=workspace_id, service=service)
        db.add(integration)

    integration.access_token = access_token
    integration.refresh_token = refresh_token
    integration.token_expires_at = token_expires_at
    integration.is_connected = True
    if extra_config:
        integration.extra_config = extra_config
    
    db.commit()
    db.refresh(integration)
    return integration

def create_default_integrations(db: Session, workspace_id: int) -> None:
    """워크스페이스 생성 시 5개 서비스 기본 row 생성"""
    for service in ServiceType:
        existing = get_integration(db, workspace_id, service)
        if not existing:
            db.add(Integration(
                workspace_id=workspace_id,
                service=service,
                is_connected=False,
            ))
    db.commit()