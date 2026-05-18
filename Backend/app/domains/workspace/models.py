# app\domains\workspace\models.py
import enum

from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, Integer, String, func

from app.infra.database.base import Base


class MemberRole(str, enum.Enum):
    admin = "admin"
    member = "member"
    viewer = "viewer"


class Workspace(Base):
    __tablename__ = "workspaces"

    id = Column(Integer, primary_key=True, autoincrement=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    name = Column(String(100), nullable=False)
    invite_code = Column(String(20), unique=True, index=True, nullable=True)
    industry = Column(String(100), nullable=True)
    default_language = Column(String(20), default="ko", nullable=True)
    summary_style = Column(String(100), nullable=True)
    logo_url = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)


class InviteCode(Base):
    __tablename__ = "invite_codes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id"), nullable=False)
    code = Column(String(50), unique=True, nullable=False)
    role = Column(Enum(MemberRole), default=MemberRole.member)
    is_used = Column(Boolean, default=False)
    used_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    expires_at = Column(DateTime, default=func.now(), nullable=False)
    created_at = Column(DateTime, default=func.now(), nullable=False)


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    role = Column(Enum(MemberRole), nullable=False)
    joined_at = Column(DateTime, default=func.now(), nullable=False)


class DeviceSetting(Base):
    __tablename__ = "device_settings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id"), unique=True, nullable=False)
    device_name = Column(String(200), nullable=False)
    microphone_device = Column(String(200), nullable=True)
    webcam_device = Column(String(200), nullable=False)
    webcam_enabled = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)


class Department(Base):
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)
