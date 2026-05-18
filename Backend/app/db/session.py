"""Compatibility imports for modules that still use app.db.session."""

from app.infra.database.base import Base
from app.infra.database.session import SessionLocal, engine, get_db

__all__ = ["Base", "SessionLocal", "engine", "get_db"]
