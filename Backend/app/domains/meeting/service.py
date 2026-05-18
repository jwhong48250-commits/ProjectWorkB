# app\domains\meeting\service.py
from collections import defaultdict
from datetime import date, datetime, time, timedelta

from fastapi import HTTPException, status
from sqlalchemy import case, desc
from sqlalchemy.orm import Session
import json as _json

from app.utils.time_utils import KST
from app.domains.action import mongo_repository as mongo_repo
from app.domains.meeting.models import (
    DiarizationMethod,
    Meeting,
    MeetingParticipant,
    MeetingStatus,
    SpeakerProfile,
)
from app.domains.meeting.schemas import (
    CreateMeetingRequest,
    CreateMeetingResponse,
    CreateMeetingResponseData,
    DeleteMeetingResponse,
    MeetingDetailOut,
    MeetingDetailParticipantOut,
    MeetingDetailResponse,
    UpdateMeetingRequest,
    MeetingSearchData,
    MeetingSearchItemOut,
    MeetingSearchParams,
    MeetingSearchParticipantOut,
    MeetingSearchResponse,
    MeetingHistoryItemOut,
    MeetingHistoryResponse,
    SpeakerProfileItem,
    SpeakerProfileListResponse,
    SpeakerProfileRegisterRequest,
    SpeakerProfileRegisterResponse,
)
from app.domains.user.models import User
from app.domains.intelligence.models import (
    Decision,
    MeetingMinute,
    MinutePhoto,
    ReviewRequest,
    MinuteStatus,
)
from app.domains.action.models import ActionItem, Report, WbsEpic, WbsTask
from app.domains.meeting.repository import MeetingHistoryRepository
from app.domains.workspace.models import MemberRole, WorkspaceMember
from app.domains.workspace.repository import get_workspace_membership
from app.domains.integration import service as integration_service
from app.infra.clients.google import GoogleCalendarClient
from app.domains.notification.models import NotificationType
from app.domains.notification import service as notification_service
from app.utils.time_utils import now_kst
from app.utils.s3_utils import upload_fileobj_to_s3

from io import BytesIO
import uuid

MINUTE_PHOTO_S3_PREFIX = "meetings"  # S3 키 구조: meetings/{meeting_id}/minute_photos/...


def _to_kst_naive(dt: datetime) -> datetime:
    """
    API로 들어온 datetime(대개 tz-aware UTC)을 KST 기준 naive datetime으로 변환해 DB에 저장한다.
    """
    if dt.tzinfo is None:
        # tz 정보가 없으면 KST로 간주
        return dt
    return dt.astimezone(KST).replace(tzinfo=None)


def _to_kst_aware(dt: datetime | None) -> datetime | None:
    """
    DB의 naive datetime을 KST(+09:00)로 응답하기 위한 tz-aware datetime으로 변환한다.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=KST)
    return dt.astimezone(KST)


class MeetingCreateService:
    """회의 생성(트랜잭션: meetings + meeting_participants)."""

    @staticmethod
    async def create_meeting(
        db: Session,
        workspace_id: int,
        created_by: int,
        payload: CreateMeetingRequest,
    ) -> CreateMeetingResponse:
        now = (
            datetime.now(payload.scheduled_at.tzinfo)
            if getattr(payload.scheduled_at, "tzinfo", None) is not None
            else datetime.now()
        )
        if payload.scheduled_at < now:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="현재보다 이전 시간으로 회의를 예약할 수 없습니다.",
            )

        meeting = Meeting(
            workspace_id=workspace_id,
            created_by=created_by,
            title=payload.title,
            meeting_type=payload.meeting_type,
            room_name=(payload.room_name or "미지정"),
            scheduled_at=_to_kst_naive(payload.scheduled_at),
            status=MeetingStatus.scheduled,
            google_calendar_event_id=None,
        )

        try:
            db.add(meeting)
            db.flush()

            # 생성자는 항상 참석자에 포함, is_host=1. 나머지는 participant_ids (중복·생성자 중복 제거)
            ordered_user_ids: list[int] = [created_by]
            for uid in payload.participant_ids:
                if uid != created_by and uid not in ordered_user_ids:
                    ordered_user_ids.append(uid)

            for uid in ordered_user_ids:
                db.add(
                    MeetingParticipant(
                        meeting_id=meeting.id,
                        user_id=uid,
                        is_host=(uid == created_by),
                    )
                )

            # 알림: 참석자 초대
            try:
                scheduled_kst = _to_kst_aware(meeting.scheduled_at)  # type: ignore[arg-type]
                notification_service.emit_meeting_invites(
                    db,
                    workspace_id=workspace_id,
                    meeting_id=int(meeting.id),
                    meeting_title=str(meeting.title),
                    scheduled_at_kst=scheduled_kst,
                    invited_user_ids=ordered_user_ids,
                    actor_user_id=created_by,
                )
            except Exception:
                # 알림 실패는 회의 생성 자체를 막지 않음
                pass

            if payload.sync_google_calendar:
                # Workspace 단위 Google OAuth 토큰을 사용해 캘린더 이벤트 생성 후 event_id 저장
                access_token = await integration_service.get_valid_google_token(
                    db, workspace_id
                )
                gcal = GoogleCalendarClient(access_token)
                calendar_id = (
                    integration_service.get_required_workspace_google_calendar_id(
                        db, workspace_id
                    )
                )

                emails = [
                    str(row[0])
                    for row in db.query(User.email)
                    .filter(User.id.in_(ordered_user_ids))
                    .all()
                    if row and row[0]
                ]

                start_dt = _to_kst_aware(meeting.scheduled_at)  # type: ignore[arg-type]
                end_dt = (start_dt or datetime.now(KST)) + timedelta(
                    minutes=max(1, int(payload.duration_minutes or 60))
                )

                ev = await gcal.create_event(
                    title=payload.title,
                    start_datetime=start_dt.isoformat(),
                    end_datetime=end_dt.isoformat(),
                    attendees=emails or None,
                    description=f"WorkB 회의: {payload.meeting_type}",
                    calendar_id=calendar_id,
                )
                meeting.google_calendar_event_id = (
                    ev.get("id") if isinstance(ev, dict) else None
                )

            db.commit()
            db.refresh(meeting)
        except Exception:
            db.rollback()
            raise

        return CreateMeetingResponse(
            success=True,
            data=CreateMeetingResponseData(
                meeting_id=int(meeting.id),
                title=meeting.title,
                room_name=getattr(meeting, "room_name", None),
                scheduled_at=_to_kst_aware(meeting.scheduled_at),  # type: ignore[arg-type]
                google_calendar_event_id=meeting.google_calendar_event_id,
            ),
            message="OK",
        )


class MeetingDeleteService:
    """회의 삭제(연관 데이터 포함)."""

    @staticmethod
    async def delete_meeting(
        db: Session,
        workspace_id: int,
        meeting_id: int,
        current_user_id: int,
    ) -> DeleteMeetingResponse:
        # NOTE: 권한 체크는 추후 워크스페이스 멤버십/role로 확장.
        meeting = (
            db.query(Meeting)
            .filter(Meeting.id == meeting_id, Meeting.workspace_id == workspace_id)
            .one_or_none()
        )
        if meeting is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="회의를 찾을 수 없습니다.",
            )

        try:
            # Google Calendar 이벤트도 함께 삭제 (있을 때만)
            if meeting.google_calendar_event_id:
                access_token = await integration_service.get_valid_google_token(
                    db, workspace_id
                )
                gcal = GoogleCalendarClient(access_token)
                calendar_id = (
                    integration_service.get_required_workspace_google_calendar_id(
                        db, workspace_id
                    )
                )
                try:
                    await gcal.delete_event(
                        meeting.google_calendar_event_id, calendar_id=calendar_id
                    )
                except Exception:
                    # 캘린더 삭제 실패로 DB 삭제 전체를 막지 않음 (토큰/권한/이미 삭제됨 등)
                    pass

            # 1) 회의록(분) + 하위 리소스
            minute = (
                db.query(MeetingMinute)
                .filter(MeetingMinute.meeting_id == meeting_id)
                .one_or_none()
            )
            if minute is not None:
                db.query(MinutePhoto).filter(MinutePhoto.minute_id == minute.id).delete(
                    synchronize_session=False
                )
                db.query(ReviewRequest).filter(
                    ReviewRequest.minute_id == minute.id
                ).delete(synchronize_session=False)
                db.delete(minute)

            # 2) decisions
            db.query(Decision).filter(Decision.meeting_id == meeting_id).delete(
                synchronize_session=False
            )

            # 3) meeting participants
            db.query(MeetingParticipant).filter(
                MeetingParticipant.meeting_id == meeting_id
            ).delete(synchronize_session=False)

            # 4) action items / reports
            db.query(ActionItem).filter(ActionItem.meeting_id == meeting_id).delete(
                synchronize_session=False
            )
            db.query(Report).filter(Report.meeting_id == meeting_id).delete(
                synchronize_session=False
            )

            # 5) wbs: tasks -> epics
            epic_ids = [
                int(e.id)
                for e in db.query(WbsEpic.id)
                .filter(WbsEpic.meeting_id == meeting_id)
                .all()
            ]
            if epic_ids:
                db.query(WbsTask).filter(WbsTask.epic_id.in_(epic_ids)).delete(
                    synchronize_session=False
                )
                db.query(WbsEpic).filter(WbsEpic.id.in_(epic_ids)).delete(
                    synchronize_session=False
                )

            # 6) finally meeting
            db.delete(meeting)

            db.commit()
        except HTTPException:
            db.rollback()
            raise
        except Exception:
            db.rollback()
            raise

        return DeleteMeetingResponse(success=True, message="OK")


class MeetingUpdateService:
    """회의 수정(회의 + 참석자)."""

    @staticmethod
    async def update_meeting(
        db: Session,
        workspace_id: int,
        meeting_id: int,
        current_user_id: int,
        payload: UpdateMeetingRequest,
    ) -> CreateMeetingResponse:
        meeting = (
            db.query(Meeting)
            .filter(Meeting.id == meeting_id, Meeting.workspace_id == workspace_id)
            .one_or_none()
        )
        if meeting is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="회의를 찾을 수 없습니다.",
            )

        now = (
            datetime.now(payload.scheduled_at.tzinfo)
            if getattr(payload.scheduled_at, "tzinfo", None) is not None
            else datetime.now()
        )
        if payload.scheduled_at < now:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="현재보다 이전 시간으로 회의를 예약할 수 없습니다.",
            )

        try:
            meeting.title = payload.title
            meeting.meeting_type = payload.meeting_type
            if payload.room_name is not None:
                meeting.room_name = payload.room_name or "미지정"
            meeting.scheduled_at = _to_kst_naive(payload.scheduled_at)

            # 참석자 갱신: 기존 제거 후 재삽입 (생성자는 host 유지)
            db.query(MeetingParticipant).filter(
                MeetingParticipant.meeting_id == meeting_id
            ).delete(synchronize_session=False)

            ordered_user_ids: list[int] = [meeting.created_by]
            for uid in payload.participant_ids:
                if uid != meeting.created_by and uid not in ordered_user_ids:
                    ordered_user_ids.append(uid)

            for uid in ordered_user_ids:
                db.add(
                    MeetingParticipant(
                        meeting_id=meeting.id,
                        user_id=uid,
                        is_host=(uid == meeting.created_by),
                    )
                )

            # Google Calendar 이벤트가 이미 연결되어 있으면 함께 수정
            if meeting.google_calendar_event_id:
                access_token = await integration_service.get_valid_google_token(
                    db, workspace_id
                )
                gcal = GoogleCalendarClient(access_token)
                calendar_id = (
                    integration_service.get_required_workspace_google_calendar_id(
                        db, workspace_id
                    )
                )

                emails = [
                    str(row[0])
                    for row in db.query(User.email)
                    .filter(User.id.in_(ordered_user_ids))
                    .all()
                    if row and row[0]
                ]

                start_dt = _to_kst_aware(meeting.scheduled_at)  # type: ignore[arg-type]
                end_dt = (start_dt or datetime.now(KST)) + timedelta(
                    minutes=max(1, int(payload.duration_minutes or 60))
                )

                await gcal.update_event(
                    event_id=meeting.google_calendar_event_id,
                    title=payload.title,
                    start_datetime=start_dt.isoformat(),
                    end_datetime=end_dt.isoformat(),
                    attendees=emails or None,
                    description=f"WorkB 회의: {payload.meeting_type}",
                    calendar_id=calendar_id,
                )
            elif payload.sync_google_calendar:
                # 기존에 연동되지 않았던 회의라도, 수정 시 연동 체크하면 새 이벤트를 생성
                access_token = await integration_service.get_valid_google_token(
                    db, workspace_id
                )
                gcal = GoogleCalendarClient(access_token)
                calendar_id = (
                    integration_service.get_required_workspace_google_calendar_id(
                        db, workspace_id
                    )
                )

                emails = [
                    str(row[0])
                    for row in db.query(User.email)
                    .filter(User.id.in_(ordered_user_ids))
                    .all()
                    if row and row[0]
                ]

                start_dt = _to_kst_aware(meeting.scheduled_at)  # type: ignore[arg-type]
                end_dt = (start_dt or datetime.now(KST)) + timedelta(
                    minutes=max(1, int(payload.duration_minutes or 60))
                )
                ev = await gcal.create_event(
                    title=payload.title,
                    start_datetime=start_dt.isoformat(),
                    end_datetime=end_dt.isoformat(),
                    attendees=emails or None,
                    description=f"WorkB 회의: {payload.meeting_type}",
                    calendar_id=calendar_id,
                )
                meeting.google_calendar_event_id = (
                    ev.get("id") if isinstance(ev, dict) else None
                )
            elif (
                payload.sync_google_calendar is False
                and meeting.google_calendar_event_id
            ):
                # 명시적으로 해제 요청이면 이벤트 삭제 후 연결 해제
                access_token = await integration_service.get_valid_google_token(
                    db, workspace_id
                )
                gcal = GoogleCalendarClient(access_token)
                calendar_id = (
                    integration_service.get_required_workspace_google_calendar_id(
                        db, workspace_id
                    )
                )
                try:
                    await gcal.delete_event(
                        meeting.google_calendar_event_id, calendar_id=calendar_id
                    )
                except Exception:
                    pass
                meeting.google_calendar_event_id = None

            db.commit()
            db.refresh(meeting)
        except HTTPException:
            db.rollback()
            raise
        except Exception:
            db.rollback()
            raise

        return CreateMeetingResponse(
            success=True,
            data=CreateMeetingResponseData(
                meeting_id=int(meeting.id),
                title=meeting.title,
                room_name=getattr(meeting, "room_name", None),
                scheduled_at=_to_kst_aware(meeting.scheduled_at),  # type: ignore[arg-type]
                google_calendar_event_id=meeting.google_calendar_event_id,
            ),
            message="OK",
        )


_MINUTE_PHOTO_CONTENT_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
}


class MinutePhotoService:
    @staticmethod
    def _build_s3_key(meeting_id: int, ext: str) -> str:
        """S3 object key 생성: ``meetings/{meeting_id}/minute_photos/{timestamp}_{uuid}.{ext}``"""
        filename = (
            f"{now_kst().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:12]}.{ext}"
        )
        return f"{MINUTE_PHOTO_S3_PREFIX}/{meeting_id}/minute_photos/{filename}"

    @staticmethod
    def save_captured_photo(
        db: Session,
        workspace_id: int,
        meeting_id: int,
        taken_by_user_id: int,
        image_bytes: bytes,
        ext: str = "png",
    ) -> MinutePhoto:
        meeting = (
            db.query(Meeting)
            .filter(Meeting.id == meeting_id, Meeting.workspace_id == workspace_id)
            .one_or_none()
        )
        if meeting is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="회의를 찾을 수 없습니다.",
            )

        minute = (
            db.query(MeetingMinute)
            .filter(MeetingMinute.meeting_id == meeting_id)
            .one_or_none()
        )
        if minute is None:
            minute = MeetingMinute(
                meeting_id=meeting_id,
                content=None,
                summary=None,
                status=MinuteStatus.draft,
                reviewer_id=None,
                review_status=None,
            )
            db.add(minute)
            db.flush()

        s3_key = MinutePhotoService._build_s3_key(meeting_id, ext)
        content_type = _MINUTE_PHOTO_CONTENT_TYPES.get(ext.lower(), "image/png")
        upload_fileobj_to_s3(
            fileobj=BytesIO(image_bytes),
            key=s3_key,
            content_type=content_type,
        )

        taken_at_naive = now_kst().replace(tzinfo=None)
        photo = MinutePhoto(
            minute_id=int(minute.id),
            photo_url=s3_key,
            taken_at=taken_at_naive,
            taken_by=taken_by_user_id,
        )
        db.add(photo)
        db.commit()
        db.refresh(photo)
        return photo


class MeetingLifecycleService:
    """회의 진행 상태 전환 (scheduled -> in_progress -> done)."""

    @staticmethod
    def start_meeting(db: Session, workspace_id: int, meeting_id: int) -> None:
        meeting = (
            db.query(Meeting)
            .filter(Meeting.id == meeting_id, Meeting.workspace_id == workspace_id)
            .one_or_none()
        )
        if meeting is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="회의를 찾을 수 없습니다.",
            )

        now_naive_kst = now_kst().replace(tzinfo=None)
        if meeting.status != MeetingStatus.in_progress:
            meeting.status = MeetingStatus.in_progress
        if meeting.started_at is None:
            meeting.started_at = now_naive_kst

        db.commit()

    @staticmethod
    def end_meeting(db: Session, workspace_id: int, meeting_id: int) -> None:
        meeting = (
            db.query(Meeting)
            .filter(Meeting.id == meeting_id, Meeting.workspace_id == workspace_id)
            .one_or_none()
        )
        if meeting is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="회의를 찾을 수 없습니다.",
            )

        now_naive_kst = now_kst().replace(tzinfo=None)
        if meeting.started_at is None:
            meeting.started_at = now_naive_kst
        meeting.ended_at = now_naive_kst
        meeting.status = MeetingStatus.done

        db.commit()


class MeetingSearchService:
    """워크스페이스 회의 검색 (동적 필터 + 배치 로딩으로 N+1 방지)."""

    @staticmethod
    def search(
        db: Session,
        workspace_id: int,
        params: MeetingSearchParams,
    ) -> MeetingSearchResponse:
        q = db.query(Meeting).filter(Meeting.workspace_id == workspace_id)

        if params.keyword is not None:
            kw = params.keyword.strip()
            if kw:
                q = q.filter(Meeting.title.ilike(f"%{kw}%"))

        if params.from_date is not None:
            q = q.filter(
                Meeting.scheduled_at >= datetime.combine(params.from_date, time.min)
            )

        if params.to_date is not None:
            q = q.filter(
                Meeting.scheduled_at <= datetime.combine(params.to_date, time.max)
            )

        if params.participant_id is not None:
            q = (
                q.join(
                    MeetingParticipant,
                    MeetingParticipant.meeting_id == Meeting.id,
                ).filter(MeetingParticipant.user_id == params.participant_id)
            ).distinct()

        meetings = q.order_by(
            case((Meeting.scheduled_at.is_(None), 1), else_=0),
            desc(Meeting.scheduled_at),
        ).all()

        if not meetings:
            return MeetingSearchResponse(
                success=True,
                data=MeetingSearchData(meetings=[]),
                message="OK",
            )

        m_ids = [int(m.id) for m in meetings]

        # 참석자 + 이름: 회의 ID 단위로 한 번에 조회 (N+1 방지)
        participant_rows = (
            db.query(MeetingParticipant, User.name)
            .join(User, User.id == MeetingParticipant.user_id)
            .filter(MeetingParticipant.meeting_id.in_(m_ids))
            .order_by(MeetingParticipant.meeting_id, MeetingParticipant.id)
            .all()
        )
        participants_by_meeting: dict[int, list[MeetingSearchParticipantOut]] = (
            defaultdict(list)
        )
        for mp, user_name in participant_rows:
            participants_by_meeting[int(mp.meeting_id)].append(
                MeetingSearchParticipantOut(
                    user_id=int(mp.user_id),
                    name=user_name,
                )
            )

        # 회의록 요약: meeting_id IN 한 번에 조회
        minute_rows = (
            db.query(MeetingMinute).filter(MeetingMinute.meeting_id.in_(m_ids)).all()
        )
        summary_by_meeting: dict[int, str | None] = {
            int(row.meeting_id): row.summary for row in minute_rows
        }

        items: list[MeetingSearchItemOut] = []
        for m in meetings:
            mid = int(m.id)
            items.append(
                MeetingSearchItemOut(
                    meeting_id=mid,
                    title=m.title,
                    room_name=getattr(m, "room_name", None),
                    status=getattr(
                        getattr(m, "status", None),
                        "value",
                        str(getattr(m, "status", "")),
                    ),
                    scheduled_at=_to_kst_aware(m.scheduled_at),  # type: ignore[arg-type]
                    started_at=_to_kst_aware(m.started_at),  # type: ignore[arg-type]
                    ended_at=_to_kst_aware(m.ended_at),  # type: ignore[arg-type]
                    participants=participants_by_meeting.get(mid, []),
                    summary=summary_by_meeting.get(mid),
                )
            )

        return MeetingSearchResponse(
            success=True,
            data=MeetingSearchData(meetings=items),
            message="OK",
        )


class MeetingHistoryService:
    """회의 히스토리 검색 (제목 + 회의록 content/summary, outerjoin)."""

    @staticmethod
    def get_history(
        db: Session,
        workspace_id: int,
        keyword: str | None,
        page: int,
        size: int,
        participant_user_id: int | None = None,
        on_date: date | None = None,
        status_filter: str = "all",
    ) -> MeetingHistoryResponse:
        page = max(int(page), 1)
        size = max(min(int(size), 100), 1)

        total, rows = MeetingHistoryRepository.search_history(
            db=db,
            workspace_id=workspace_id,
            keyword=keyword,
            page=page,
            size=size,
            participant_user_id=participant_user_id,
            on_date=on_date,
            status_filter=status_filter,
        )

        m_ids = [int(m.id) for m, _ in rows]
        participants_by_meeting: dict[int, list[MeetingDetailParticipantOut]] = (
            defaultdict(list)
        )
        if m_ids:
            participant_rows = (
                db.query(MeetingParticipant, User.name)
                .join(User, User.id == MeetingParticipant.user_id)
                .filter(MeetingParticipant.meeting_id.in_(m_ids))
                .order_by(MeetingParticipant.meeting_id, MeetingParticipant.id)
                .all()
            )
            for mp, user_name in participant_rows:
                participants_by_meeting[int(mp.meeting_id)].append(
                    MeetingDetailParticipantOut(
                        user_id=int(mp.user_id),
                        name=str(user_name),
                    )
                )

        items: list[MeetingHistoryItemOut] = []
        for meeting, minute in rows:
            mid = int(meeting.id)
            items.append(
                MeetingHistoryItemOut(
                    id=mid,
                    title=meeting.title,
                    status=(
                        meeting.status.value
                        if isinstance(meeting.status, MeetingStatus)
                        else str(meeting.status)
                    ),
                    scheduled_at=_to_kst_aware(meeting.scheduled_at),  # type: ignore[arg-type]
                    started_at=_to_kst_aware(meeting.started_at),  # type: ignore[arg-type]
                    ended_at=_to_kst_aware(meeting.ended_at),  # type: ignore[arg-type]
                    summary=(minute.summary if minute else None),
                    participants=participants_by_meeting.get(mid, []),
                )
            )

        return MeetingHistoryResponse(total=total, page=page, meetings=items)


class MeetingDetailService:
    """워크스페이스 소속 회의 단건 조회 (상세·참석자)."""

    @staticmethod
    def get_meeting(
        db: Session, workspace_id: int, meeting_id: int
    ) -> MeetingDetailResponse:
        meeting = (
            db.query(Meeting)
            .filter(Meeting.id == meeting_id, Meeting.workspace_id == workspace_id)
            .one_or_none()
        )
        if meeting is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="회의를 찾을 수 없습니다.",
            )

        rows = (
            db.query(MeetingParticipant, User.name)
            .join(User, User.id == MeetingParticipant.user_id)
            .filter(MeetingParticipant.meeting_id == meeting_id)
            .order_by(MeetingParticipant.id)
            .all()
        )

        minute = (
            db.query(MeetingMinute)
            .filter(MeetingMinute.meeting_id == meeting_id)
            .first()
        )

        # 발화(전사)가 없으면 key_points 요약도 사실 근거가 없을 수 있어 노출하지 않는다.
        try:
            utterance_rows = mongo_repo.get_meeting_utterances(meeting_id)
        except Exception:
            utterance_rows = []
        has_transcript = any(
            (u.get("content") or "").strip() for u in utterance_rows
        )

        summary_text = None
        if minute and minute.summary and has_transcript:
            try:
                parsed = _json.loads(minute.summary)
                key_points = parsed.get("key_points", [])
                if key_points:
                    summary_text = "\n".join(f"* {kp}" for kp in key_points)
            except Exception:
                pass

        participants = [
            MeetingDetailParticipantOut(user_id=int(mp.user_id), name=str(name))
            for mp, name in rows
        ]

        status_str = (
            meeting.status.value
            if isinstance(meeting.status, MeetingStatus)
            else str(meeting.status)
        )

        return MeetingDetailResponse(
            success=True,
            data=MeetingDetailOut(
                id=int(meeting.id),
                title=str(meeting.title),
                status=status_str,
                meeting_type=meeting.meeting_type,
                room_name=getattr(meeting, "room_name", None),
                scheduled_at=_to_kst_aware(meeting.scheduled_at),  # type: ignore[arg-type]
                started_at=_to_kst_aware(meeting.started_at),  # type: ignore[arg-type]
                ended_at=_to_kst_aware(meeting.ended_at),  # type: ignore[arg-type]
                summary=summary_text,
                participants=participants,
            ),
            message="OK",
        )


def _workspace_role_for_user(
    db: Session,
    workspace_id: int,
    user: User,
) -> str | None:
    membership = get_workspace_membership(db, workspace_id, user.id)
    if membership:
        return membership.role.value
    if user.workspace_id == workspace_id:
        return user.role
    return None


def _speaker_profile_item(
    user: User,
    role: str,
    profile: SpeakerProfile | None,
) -> SpeakerProfileItem:
    return SpeakerProfileItem(
        user_id=user.id,
        name=user.name,
        email=user.email,
        role=role,
        is_verified=bool(profile and profile.is_verified),
        diarization_method=profile.diarization_method.value if profile else None,
        updated_at=profile.updated_at if profile else None,
    )


class SpeakerProfileService:
    @staticmethod
    def list_profiles(
        db: Session,
        workspace_id: int,
        current_user_id: int,
    ) -> SpeakerProfileListResponse:
        current_user = db.query(User).filter(User.id == current_user_id).one_or_none()
        if current_user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="사용자를 찾을 수 없습니다.",
            )

        current_role = _workspace_role_for_user(db, workspace_id, current_user)
        if current_role is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="워크스페이스 멤버만 수행할 수 있습니다.",
            )

        if current_role == MemberRole.admin.value:
            member_rows = (
                db.query(User, WorkspaceMember.role)
                .join(WorkspaceMember, WorkspaceMember.user_id == User.id)
                .filter(WorkspaceMember.workspace_id == workspace_id)
                .order_by(User.id.asc())
                .all()
            )
        else:
            member_rows = [(current_user, MemberRole(current_role))]

        user_ids = [int(user.id) for user, _role in member_rows]
        profile_rows = (
            db.query(SpeakerProfile)
            .filter(
                SpeakerProfile.user_id.in_(user_ids),
            )
            .order_by(
                SpeakerProfile.user_id.asc(),
                SpeakerProfile.is_verified.desc(),
                desc(SpeakerProfile.updated_at),
                desc(SpeakerProfile.id),
            )
            .all()
            if user_ids
            else []
        )
        profiles_by_user: dict[int, SpeakerProfile] = {}
        for profile in profile_rows:
            profiles_by_user.setdefault(int(profile.user_id), profile)

        return SpeakerProfileListResponse(
            profiles=[
                _speaker_profile_item(
                    user=user,
                    role=role.value if isinstance(role, MemberRole) else str(role),
                    profile=profiles_by_user.get(int(user.id)),
                )
                for user, role in member_rows
            ]
        )

    @staticmethod
    def register_profile(
        db: Session,
        workspace_id: int,
        current_user_id: int,
        payload: SpeakerProfileRegisterRequest,
    ) -> SpeakerProfileRegisterResponse:
        current_user = db.query(User).filter(User.id == current_user_id).one_or_none()
        if current_user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="사용자를 찾을 수 없습니다.",
            )

        current_role = _workspace_role_for_user(db, workspace_id, current_user)
        if current_role is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="워크스페이스 멤버만 수행할 수 있습니다.",
            )

        target_user_id = payload.user_id or current_user_id
        if target_user_id != current_user_id and current_role != MemberRole.admin.value:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="본인 화자 프로필만 등록할 수 있습니다.",
            )

        target_user = db.query(User).filter(User.id == target_user_id).one_or_none()
        if target_user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="대상 사용자를 찾을 수 없습니다.",
            )

        target_role = _workspace_role_for_user(db, workspace_id, target_user)
        if target_role is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="같은 워크스페이스 멤버만 등록할 수 있습니다.",
            )

        profile = (
            db.query(SpeakerProfile)
            .filter(
                SpeakerProfile.workspace_id == workspace_id,
                SpeakerProfile.user_id == target_user_id,
            )
            .one_or_none()
        )
        if profile is None:
            profile = SpeakerProfile(
                workspace_id=workspace_id,
                user_id=target_user_id,
                diarization_method=DiarizationMethod(payload.diarization_method),
                is_verified=True,
            )
            db.add(profile)
        else:
            profile.diarization_method = DiarizationMethod(payload.diarization_method)
            profile.is_verified = True

        db.commit()
        db.refresh(profile)

        return SpeakerProfileRegisterResponse(
            profile=_speaker_profile_item(target_user, target_role, profile),
            message="화자 프로필이 등록되었습니다.",
        )
