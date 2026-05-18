# app/domains/action/routers/reports/py
import io
import json
import markdown as md_lib
from urllib.parse import quote
from fastapi import APIRouter, Depends, BackgroundTasks, Query, HTTPException
from fastapi.responses import HTMLResponse, FileResponse, RedirectResponse, StreamingResponse
from sqlalchemy.orm import Session

from app.infra.database.session import get_db
from app.domains.action import repository
from app.domains.action.models import ReportFormat
from app.domains.action.schemas import (
    ReportResponse, ReportGenerateRequest, ReportPatchRequest, ExportResponse
)
from app.domains.action.services import report_builder
from app.domains.user.dependencies import require_workspace_admin, require_workspace_member
from app.utils.s3_utils import download_file_bytes_from_s3, extract_s3_key_from_url, generate_presigned_url

router = APIRouter()

_GENERATORS = {
    "markdown": report_builder.generate_markdown,
    "html":     report_builder.generate_html,
    "excel":    report_builder.generate_excel,
    "wbs":      report_builder.generate_wbs,
}


def _resolve_report_thumbnail_url(value: str | None) -> str | None:
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    if text.startswith(("http://", "https://")):
        key = extract_s3_key_from_url(text)
        if key:
            return generate_presigned_url(key)
        return text
    return generate_presigned_url(text)


def _to_report_response(report) -> ReportResponse:
    return ReportResponse(
        id=int(report.id),
        format=report.format.value if hasattr(report.format, "value") else str(report.format),
        title=str(report.title),
        thumbnail_url=_resolve_report_thumbnail_url(report.thumbnail_url),
        updated_at=report.updated_at,
    )

@router.post("/reports/generate", response_model=ExportResponse)
async def generate_report(
    meeting_id: int,
    request: ReportGenerateRequest,
    background_tasks: BackgroundTasks,
    workspace_id: int = Query(..., description="워크스페이스ID"),
    db: Session = Depends(get_db),
    _admin = Depends(require_workspace_admin),
):
    fmt = request.format.lower()
    if fmt not in _GENERATORS:
        raise HTTPException(status_code=400, detail=f"지원하지 않는 포맷: {fmt}")
    
    background_tasks.add_task(
        _GENERATORS[fmt],
        db=db,
        meeting_id=meeting_id,
        user_id=_admin.id
    )
    return ExportResponse(status="processing")

@router.get("/reports", response_model=list[ReportResponse])
def get_reports(
    meeting_id: int,
    workspace_id: int = Query(...),
    db: Session = Depends(get_db),
    _member=Depends(require_workspace_member),
):
    return [_to_report_response(report) for report in repository.get_reports(db, meeting_id)]


@router.get("/reports/{report_id}", response_model=ReportResponse)
def get_report(
    meeting_id: int,
    report_id: int,
    workspace_id: int = Query(...),
    db: Session = Depends(get_db),
    _member=Depends(require_workspace_member),
):
    report = repository.get_report(db, report_id)
    if not report or report.meeting_id != meeting_id:
        raise HTTPException(status_code=404, detail="보고서를 찾을 수 없습니다.")
    return _to_report_response(report)


@router.get("/reports/{report_id}/view", response_class=HTMLResponse)
def view_report(
    meeting_id: int,
    report_id: int,
    workspace_id: int = Query(...),
    db: Session = Depends(get_db),
    _member=Depends(require_workspace_member),
):
    report = repository.get_report(db, report_id)
    if not report or report.meeting_id != meeting_id:
        raise HTTPException(status_code=404, detail="보고서를 찾을 수 없습니다.")

    # HTML 보고서 — content에 완성된 HTML이 저장됨
    if report.format == ReportFormat.html:
        if report.content:
            return report.content
        raise HTTPException(status_code=404, detail="HTML 보고서 내용이 없습니다.")

    # Markdown — 스타일된 HTML로 변환
    if report.format == ReportFormat.markdown:
        content   = report.content or ""
        html_body = md_lib.markdown(content, extensions=["tables", "fenced_code"])
        return f"""<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<style>body{{font-family:'Apple SD Gothic Neo',sans-serif;max-width:800px;margin:40px auto;
padding:0 24px;color:#1a1a2e;line-height:1.8}}
h1,h2,h3{{color:#5668F3}}table{{width:100%;border-collapse:collapse}}
th{{background:#EEF0FE;color:#5668F3;padding:8px 12px;text-align:left;border:1px solid #d0d5f5}}
td{{padding:8px 12px;border:1px solid #e5e7eb}}tr:nth-child(even) td{{background:#f9faff}}
code{{background:#f1f5f9;padding:2px 6px;border-radius:4px}}
pre{{background:#f1f5f9;padding:16px;border-radius:8px;overflow-x:auto}}</style>
</head><body>{html_body}</body></html>"""

    # WBS — 구조화된 HTML 카드 뷰
    if report.format == ReportFormat.wbs:
        wbs   = json.loads(report.content or "{}")
        HIGH_BADGE = '<span style="float:right;font-size:12px;background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:10px">high</span>'

        def _task_li(t: dict) -> str:
            badge = HIGH_BADGE if t.get("priority") == "high" else ""
            return (
                f"<li style='padding:6px 0;border-bottom:1px solid #EEF0FE'>"
                f"<strong style='color:#5668F3'>[{t.get('assignee','')}]</strong> "
                f"{t.get('title','')}{badge}</li>"
            )

        cards = []
        for epic in wbs.get("epics", []):
            tasks_html = "".join(_task_li(t) for t in epic.get("tasks", []))
            title = epic.get("title", "")
            cards.append(
                f'<div style="background:white;border-radius:12px;padding:24px;'
                f'margin-bottom:16px;box-shadow:0 1px 4px rgba(86,104,243,0.1)">'
                f'<h2 style="color:#5668F3;font-size:16px;margin-bottom:12px;padding-bottom:8px;'
                f'border-bottom:2px solid #EEF0FE">{title}</h2>'
                f'<ul style="list-style:none;padding:0">{tasks_html}</ul></div>'
            )

        return f"""<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<style>body{{font-family:'Apple SD Gothic Neo',sans-serif;background:#f8f9ff;
padding:32px 24px;color:#1a1a2e}}
h1{{color:#5668F3;margin-bottom:24px}}</style></head>
<body><h1>WBS</h1>{"".join(cards)}</body></html>"""

    raise HTTPException(status_code=400, detail="이 포맷은 view를 지원하지 않습니다.")


@router.get("/reports/{report_id}/download")
def download_report(
    meeting_id: int,
    report_id: int,
    workspace_id: int = Query(...),
    db: Session = Depends(get_db),
    _member=Depends(require_workspace_member),
):
    report = repository.get_report(db, report_id)
    if not report or report.meeting_id != meeting_id:
        raise HTTPException(status_code=404, detail="보고서를 찾을 수 없습니다.")

    def disposition(filename: str) -> str:
        encoded = quote(filename, safe='')
        return f"attachment; filename*=UTF-8''{encoded}"

    if report.format == ReportFormat.excel:
        if not report.file_url:
            raise HTTPException(status_code=404, detail="파일이 아직 생성되지 않았습니다.")
        file_url = str(report.file_url)
        if file_url.startswith(("http://", "https://")):
            return RedirectResponse(url=file_url, status_code=307)

        if file_url.startswith(("/", "storage/", "storage\\")):
            return FileResponse(
                file_url,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": disposition(f"{report.title}.xlsx")},
            )

        excel_bytes = download_file_bytes_from_s3(file_url)
        return StreamingResponse(
            io.BytesIO(excel_bytes),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": disposition(f"{report.title}.xlsx")},
        )

    if report.format == ReportFormat.html:
        html = report.content or ""
        return StreamingResponse(
            io.BytesIO(html.encode("utf-8")),
            media_type="text/html",
            headers={"Content-Disposition": disposition(f"{report.title}.html")},
        )

    if report.format == ReportFormat.markdown:
        return StreamingResponse(
            io.BytesIO((report.content or "").encode("utf-8")),
            media_type="text/markdown",
            headers={"Content-Disposition": disposition(f"{report.title}.md")},
        )

    if report.format == ReportFormat.wbs:
        return StreamingResponse(
            io.BytesIO((report.content or "{}").encode("utf-8")),
            media_type="application/json",
            headers={"Content-Disposition": disposition(f"{report.title}.json")},
        )

    raise HTTPException(status_code=400, detail="다운로드 불가 포맷입니다.")

@router.patch("/reports/{report_id}", response_model=ReportResponse)
def patch_report(
    meeting_id: int,
    report_id: int,
    body: ReportPatchRequest,
    workspace_id: int = Query(...),
    db: Session = Depends(get_db),
    _admin=Depends(require_workspace_admin),
):
    report = repository.get_report(db, report_id)
    if not report or report.meeting_id != meeting_id:
        raise HTTPException(status_code=404, detail="보고서를 찾을 수 없습니다.")
    if report.format == ReportFormat.excel:
        raise HTTPException(status_code=400, detail="Excel 보고서는 수정할 수 없습니다.")
    return _to_report_response(repository.update_report(db, report_id, body.content))