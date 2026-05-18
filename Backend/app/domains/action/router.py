# app\domains\action\router.py
from fastapi import APIRouter
from app.domains.action.routers import slack, jira, google, minutes, reports, wbs, batch

# http://localhost:8000/api/v1/actions/meetings/{meeting_id}
router = APIRouter(prefix="/meetings/{meeting_id}")

router.include_router(slack.router)
router.include_router(jira.router)
router.include_router(google.router)
router.include_router(minutes.router)
router.include_router(reports.router)
router.include_router(wbs.router)
router.include_router(batch.router)