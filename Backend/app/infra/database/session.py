# app/infra/database/session.py
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from app.core.config import settings

def _get_database_url() -> str:
    url = settings.DATABASE_URL
    if url and url.startswith("mysql://"):
        url = url.replace("mysql://", "mysql+pymysql://", 1)
    return url

engine = create_engine(_get_database_url())
SessionLocal = sessionmaker(
    autocommit=False, 
    autoflush=False, 
    bind=engine
    )

def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()