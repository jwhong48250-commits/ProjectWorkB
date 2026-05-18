"""
워크스페이스 도메인의 데이터베이스 접근 로직을 담당하는 파일입니다.

현재는 워크스페이스 조회, 초대코드 재발급, 부서 CRUD에 필요한
최소 조회/생성/수정/삭제 기능을 구현합니다.
"""

from sqlalchemy.orm import Session

from app.domains.workspace.models import Department, InviteCode, MemberRole, Workspace, WorkspaceMember


def get_workspace_by_invite_code(db: Session, invite_code: str) -> Workspace | None:
    """
    초대코드를 기준으로 워크스페이스를 조회합니다.

    Args:
        db: 데이터베이스 세션입니다.
        invite_code: 조회할 초대코드입니다.

    Returns:
        워크스페이스가 존재하면 Workspace 객체를 반환하고,
        존재하지 않으면 None을 반환합니다.
    """
    return db.query(Workspace).filter(Workspace.invite_code == invite_code).first()


def get_workspace_membership(
    db: Session,
    workspace_id: int,
    user_id: int,
) -> WorkspaceMember | None:
    """
    워크스페이스 + 사용자 기준 멤버십 1건을 조회합니다.

    권한(인가) 검사 전용으로 쓰이며, 없으면 None입니다.
    """
    return (
        db.query(WorkspaceMember)
        .filter(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
        )
        .one_or_none()
    )


def create_workspace_membership(
    db: Session,
    workspace_id: int,
    user_id: int,
    role: MemberRole,
) -> WorkspaceMember:
    """
    사용자와 워크스페이스의 멤버십 row를 생성합니다.

    이미 같은 멤버십이 있으면 중복 생성하지 않고 기존 row를 반환합니다.
    """
    existing = get_workspace_membership(db, workspace_id, user_id)
    if existing:
        return existing

    membership = WorkspaceMember(
        workspace_id=workspace_id,
        user_id=user_id,
        role=role,
    )
    db.add(membership)
    db.commit()
    db.refresh(membership)
    return membership


def get_workspace_member_rows(
    db: Session,
    workspace_id: int,
    department_id: int | None = None,
) -> list[tuple[WorkspaceMember, object]]:
    """
    워크스페이스 멤버십 기준으로 사용자 정보를 함께 조회합니다.
    """
    from app.domains.user.models import User

    query = (
        db.query(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .filter(
            WorkspaceMember.workspace_id == workspace_id,
            User.is_active.is_(True),
        )
    )

    if department_id is not None:
        query = query.filter(WorkspaceMember.department_id == department_id)

    return query.order_by(WorkspaceMember.joined_at.asc(), User.id.asc()).all()


def update_workspace_membership_role(
    db: Session,
    workspace_id: int,
    user_id: int,
    role: MemberRole,
) -> WorkspaceMember | None:
    membership = get_workspace_membership(db, workspace_id, user_id)
    if not membership:
        return None

    membership.role = role
    db.commit()
    db.refresh(membership)
    return membership


def update_workspace_membership_department(
    db: Session,
    workspace_id: int,
    user_id: int,
    department_id: int | None,
) -> WorkspaceMember | None:
    membership = get_workspace_membership(db, workspace_id, user_id)
    if not membership:
        return None

    membership.department_id = department_id
    db.commit()
    db.refresh(membership)
    return membership


def count_workspace_members_by_department_id(db: Session, department_id: int) -> int:
    return (
        db.query(WorkspaceMember)
        .filter(WorkspaceMember.department_id == department_id)
        .count()
    )


def count_workspace_admins(db: Session, workspace_id: int) -> int:
    """
    워크스페이스에 남아 있는 관리자 수를 조회합니다.
    """
    return (
        db.query(WorkspaceMember)
        .filter(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.role == MemberRole.admin,
        )
        .count()
    )


def delete_workspace_membership(
    db: Session,
    workspace_id: int,
    user_id: int,
) -> bool:
    """
    사용자 1명의 워크스페이스 멤버십을 삭제합니다.
    """
    membership = get_workspace_membership(db, workspace_id, user_id)
    if not membership:
        return False

    db.delete(membership)
    db.commit()
    return True


def get_invite_code_by_code(db: Session, code: str) -> InviteCode | None:
    return db.query(InviteCode).filter(InviteCode.code == code).one_or_none()


def create_invite_code(
    db: Session,
    workspace_id: int,
    code: str,
    role: MemberRole,
    expires_at,
) -> InviteCode:
    invite = InviteCode(
        workspace_id=workspace_id,
        code=code,
        role=role,
        expires_at=expires_at,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return invite


def mark_invite_code_used(
    db: Session,
    invite: InviteCode,
    user_id: int,
) -> InviteCode:
    invite.is_used = True
    invite.used_by = user_id
    db.commit()
    db.refresh(invite)
    return invite


def get_workspace_by_id(db: Session, workspace_id: int) -> Workspace | None:
    """
    워크스페이스 ID를 기준으로 워크스페이스를 조회합니다.

    워크스페이스 상세 조회나 이후 설정/멤버/연동 기능에서
    공통으로 사용할 수 있는 기본 조회 함수입니다.

    Args:
        db: 데이터베이스 세션입니다.
        workspace_id: 조회할 워크스페이스 ID입니다.

    Returns:
        워크스페이스가 존재하면 Workspace 객체를 반환하고,
        존재하지 않으면 None을 반환합니다.
    """
    return db.query(Workspace).filter(Workspace.id == workspace_id).first()


def create_workspace(db: Session, name: str, invite_code: str) -> Workspace:
    """
    새로운 워크스페이스를 생성하고 데이터베이스에 저장합니다.

    Args:
        db: 데이터베이스 세션입니다.
        name: 워크스페이스 이름입니다.
        invite_code: 초대코드입니다.

    Returns:
        저장이 완료된 Workspace 객체를 반환합니다.
    """
    workspace = Workspace(
        name=name,
        invite_code=invite_code,
    )

    db.add(workspace)
    db.commit()
    db.refresh(workspace)

    return workspace


def update_workspace_invite_code(
    db: Session,
    workspace_id: int,
    invite_code: str,
) -> Workspace | None:
    """
    특정 워크스페이스의 초대코드를 새 값으로 갱신합니다.

    현재 구조에서는 워크스페이스별 기본 초대코드 1개만 저장하므로,
    초대코드 발급 API는 새 코드를 생성해서 기존 값을 교체하는 방식으로 처리합니다.

    Args:
        db: 데이터베이스 세션입니다.
        workspace_id: 초대코드를 갱신할 워크스페이스 ID입니다.
        invite_code: 새로 저장할 초대코드입니다.

    Returns:
        갱신된 Workspace 객체를 반환하고, 워크스페이스가 존재하지 않으면 None을 반환합니다.
    """
    workspace = db.query(Workspace).filter(Workspace.id == workspace_id).first()
    if not workspace:
        return None

    # 현재 저장된 기본 초대코드를 새 코드로 교체합니다.
    workspace.invite_code = invite_code

    db.commit()
    db.refresh(workspace)

    return workspace


_UNSET = object()


def update_workspace(
    db: Session,
    workspace_id: int,
    name: str | None = None,
    industry: str | None = None,
    default_language: str | None = None,
    summary_style: str | None = None,
    logo_url: str | None | object = _UNSET,
) -> Workspace | None:
    """
    워크스페이스 기본 설정을 수정합니다.

    전달된 값만 갱신하고, None인 값은 변경하지 않습니다.
    """
    workspace = db.query(Workspace).filter(Workspace.id == workspace_id).first()
    if not workspace:
        return None

    if name is not None:
        workspace.name = name
    if industry is not None:
        workspace.industry = industry
    if default_language is not None:
        workspace.default_language = default_language
    if summary_style is not None:
        workspace.summary_style = summary_style
    if logo_url is not _UNSET:
        workspace.logo_url = logo_url

    db.commit()
    db.refresh(workspace)

    return workspace


def get_departments_by_workspace_id(db: Session, workspace_id: int) -> list[Department]:
    """
    특정 워크스페이스에 속한 부서 목록을 조회합니다.
    """
    return (
        db.query(Department)
        .filter(Department.workspace_id == workspace_id)
        .order_by(Department.id.asc())
        .all()
    )


def get_department_by_id(
    db: Session,
    workspace_id: int,
    department_id: int,
) -> Department | None:
    """
    워크스페이스 ID와 부서 ID를 기준으로 부서를 조회합니다.

    다른 워크스페이스의 부서를 잘못 수정/삭제하지 않도록
    workspace_id와 department_id를 함께 조건으로 사용합니다.
    """
    return (
        db.query(Department)
        .filter(
            Department.workspace_id == workspace_id,
            Department.id == department_id,
        )
        .first()
    )


def create_department(
    db: Session,
    workspace_id: int,
    name: str,
) -> Department:
    """
    새 부서를 생성하고 저장합니다.
    """
    department = Department(
        workspace_id=workspace_id,
        name=name,
    )

    db.add(department)
    db.commit()
    db.refresh(department)

    return department


def update_department(
    db: Session,
    workspace_id: int,
    department_id: int,
    name: str,
) -> Department | None:
    """
    특정 부서 이름을 수정합니다.
    """
    department = get_department_by_id(db, workspace_id, department_id)
    if not department:
        return None

    department.name = name
    db.commit()
    db.refresh(department)

    return department


def delete_department(
    db: Session,
    workspace_id: int,
    department_id: int,
) -> bool:
    """
    특정 부서를 삭제합니다.

    Returns:
        삭제 성공 시 True, 대상이 없으면 False를 반환합니다.
    """
    department = get_department_by_id(db, workspace_id, department_id)
    if not department:
        return False

    db.delete(department)
    db.commit()
    return True
