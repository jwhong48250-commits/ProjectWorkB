"""
Create MySQL tables based on SQLAlchemy models.

Why this exists:
- app/core/lifespan.py drops all tables when DEBUG=True.
- This script lets you create the schema once without running the API server.
"""

from app.infra.database.base import Base
from app.infra.database.session import engine

# Import models so SQLAlchemy registers tables on Base.metadata
from app.domains.user.models import User  # noqa: F401
from app.domains.workspace.models import Workspace, InviteCode, WorkspaceMember, DeviceSetting  # noqa: F401
from app.domains.meeting.models import Meeting, MeetingParticipant, SpeakerProfile  # noqa: F401
from app.domains.intelligence.models import Decision, MeetingMinute, MinutePhoto, ReviewRequest  # noqa: F401
from app.domains.action.models import ActionItem, WbsEpic, WbsTask, Report  # noqa: F401
from app.domains.integration.models import Integration  # noqa: F401


def main() -> None:
    Base.metadata.create_all(bind=engine)
    print("Schema created (create_all).")


if __name__ == "__main__":
    main()

